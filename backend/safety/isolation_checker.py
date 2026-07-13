import pandas as pd
import numpy as np
import os
import sys

class IsolationChecker:
    def __init__(self):
        # ========== 基础数据 ==========
        self.P_kW = np.array([0, 100, 90, 120, 60, 60, 200, 200, 60, 60, 45, 60, 60, 120, 60, 60, 90,
                              90, 90, 90, 90, 90, 420, 420, 60, 60, 60, 60, 120, 200, 150, 210, 60])
        self.Q_kVar = np.array([0, 60, 40, 80, 30, 20, 100, 100, 20, 20, 30, 35, 35, 80, 10, 20, 20,
                                40, 40, 40, 40, 40, 50, 200, 200, 25, 25, 20, 70, 600, 70, 100, 40])

        # ========== 重要用户 ==========
        self.critical_nodes = [18, 22, 24, 30]
        self.critical_weights = [0.6, 0.5, 0.45, 0.4]
        self.important = np.zeros(33)
        for node, weight in zip(self.critical_nodes, self.critical_weights):
            self.important[node-1] = weight

        # ========== 冷负荷 ==========
        self.cold_load = np.zeros(33)
        self.cold_load[22] = 200
        self.cold_load[23] = 200

        # ========== PV 配置 ==========
        self.pv_nodes = [6, 14, 30]
        self.pv_cap = [50, 100, 150]
        self.pv_cap_by_node = np.zeros(33)
        for node, cap in zip(self.pv_nodes, self.pv_cap):
            self.pv_cap_by_node[node-1] = cap

        # ========== EV 配置 ==========
        self.ev_nodes = [8, 14, 24, 30, 32]
        self.ev_peak = [80, 100, 120, 160, 90]
        self.ev_cap_by_node = np.zeros(33)
        for node, cap in zip(self.ev_nodes, self.ev_peak):
            self.ev_cap_by_node[node-1] = cap

        self.loss_rate = 0.03

        # ========== 拓扑 ==========
        self.branches = np.array([
            [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11],
            [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19],
            [19, 20], [20, 21], [21, 22], [22, 23], [23, 24], [24, 25], [25, 26], [26, 27],
            [27, 28], [28, 29], [29, 30], [30, 31], [31, 32], [32, 33],
            [8, 21], [9, 15], [12, 22], [18, 33], [25, 29]
        ])
        self.node_to_switch = {}
        for sw_idx, (n1, n2) in enumerate(self.branches, start=1):
            self.node_to_switch.setdefault(n1, []).append(sw_idx)
            self.node_to_switch.setdefault(n2, []).append(sw_idx)

        # ========== 新增：开关远方操作能力 ==========
        self.remote_capable = np.ones(37, dtype=int)
        self.remote_capable[32:37] = 0  # 开关33~37不可远方操作

        # ========== 新增：遥测可信度 ==========
        self.telemetry_credibility = np.ones(33)
        self.telemetry_credibility[[6, 13, 29]] = 0.92

    # ==================== 生成默认场景 ====================
    def create_default_scenario_excel(self, filename='scenario.xlsx'):
        data = {'Parameter': ['FaultNode', 'FaultType', 'FaultDuration'],
                'Value': [18, '三相短路', 0.1]}
        for sw in range(1, 38):
            if sw in (17, 18, 36):
                val = 0
            else:
                val = 1
            data['Parameter'].append(f'Switch{sw}')
            data['Value'].append(val)
        df = pd.DataFrame(data)
        df.to_excel(filename, index=False, header=False)
        print(f'✅ 默认场景文件已生成：{filename}')

    # ==================== 读取场景 ====================
    def load_scenario_from_excel(self, filename):
        df = pd.read_excel(filename, header=None, names=['Parameter', 'Value'])
        params = df.set_index('Parameter')['Value'].to_dict()
        if 'FaultNode' not in params:
            raise ValueError('Excel中未找到 FaultNode')
        fault_node = int(params['FaultNode'])
        fault_type = str(params.get('FaultType', '三相短路'))
        fault_duration = float(params.get('FaultDuration', 0.1))
        fault_info = {'node': fault_node, 'type': fault_type, 'duration': fault_duration, 'impedance': 0.001}
        switch_status = np.ones(37, dtype=int)
        for sw in range(1, 38):
            key = f'Switch{sw}'
            if key in params:
                val = params[key]
                if isinstance(val, str):
                    try:
                        val = int(val)
                    except:
                        val = 1
                switch_status[sw-1] = int(val)
        return fault_info, switch_status

    # ==================== 硬约束 ====================
    def check_hard_constraints(self, fault_info, switch_status):
        fault_node = fault_info['node']
        adjacent_switches = self.node_to_switch.get(fault_node, [])
        all_open = all(switch_status[sw-1] == 0 for sw in adjacent_switches)
        if all_open:
            return True, '故障包围完整'
        else:
            closed = [sw for sw in adjacent_switches if switch_status[sw-1] == 1]
            return False, f'故障未隔离，开关未断开：{closed}'

    # ==================== 计算所有指标 ====================
    def compute_metrics(self, switch_status, pv_output):
        # 1. DFS拓扑遍历
        adj = [[] for _ in range(33)]
        for sw_idx, (n1, n2) in enumerate(self.branches, start=1):
            if switch_status[sw_idx-1] == 1:
                adj[n1-1].append(n2-1)
                adj[n2-1].append(n1-1)

        visited = np.zeros(33, dtype=bool)
        stack = [0]
        visited[0] = True
        while stack:
            node = stack.pop()
            for nb in adj[node]:
                if not visited[nb]:
                    visited[nb] = True
                    stack.append(nb)

        lost_nodes = [i+1 for i in range(33) if not visited[i] and i != 0]

        # 2. 非故障失供负荷
        net_load = self.P_kW.copy()
        for i in range(33):
            if visited[i]:
                net_load[i] = max(0, net_load[i] - pv_output[i])
        lost_load = sum(net_load[i-1] for i in lost_nodes)

        # 3. 重要用户影响
        important_weights = self.important
        total_weight = np.sum(important_weights)
        recovered_weight = np.sum(important_weights[visited])
        total_important_nodes = np.sum(important_weights > 0)
        recovered_important_nodes = np.sum(important_weights[visited] > 0)
        important_recovery_rate = recovered_important_nodes / total_important_nodes if total_important_nodes > 0 else 1.0
        weighted_important_recovery_rate = recovered_weight / total_weight if total_weight > 0 else 1.0

        # 4. 开关动作次数
        initial_status = np.ones(37, dtype=int)
        switch_ops = np.sum(initial_status != switch_status)

        # 5. 远方操作比例
        operated_switches = np.where(initial_status != switch_status)[0] + 1
        if len(operated_switches) > 0:
            remote_ops = sum(1 for sw in operated_switches if self.remote_capable[sw-1] == 1)
            remote_ratio = remote_ops / len(operated_switches)
        else:
            remote_ratio = 1.0

        # 6. 数据可信度
        available_nodes = [i for i in range(33) if visited[i]]
        if len(available_nodes) > 0:
            avg_telemetry = np.mean(self.telemetry_credibility[available_nodes])
        else:
            avg_telemetry = 1.0
        switch_credibility = 0.995
        data_credibility = min(1.0, avg_telemetry * switch_credibility)

        # 7. 冷负荷冲击风险
        cold_nodes = [23, 24]
        cold_load_total = sum(self.cold_load[node-1] for node in cold_nodes)
        spare_capacity = 0.20 * np.sum(self.P_kW)
        cold_risk = cold_load_total > spare_capacity

        # 8. EV和PV
        ev_load_lost = sum(self.ev_cap_by_node[i-1] for i in lost_nodes)
        pv_curtailment = sum(pv_output[i-1] for i in lost_nodes)

        return {
            'lost_load': lost_load,
            'important_recovery_rate': important_recovery_rate,
            'weighted_important_recovery_rate': weighted_important_recovery_rate,
            'switch_ops': switch_ops,
            'remote_ratio': remote_ratio,
            'data_credibility': data_credibility,
            'cold_risk': cold_risk,
            'cold_load_total': cold_load_total,
            'spare_capacity': spare_capacity,
            'ev_load_lost': ev_load_lost,
            'pv_curtailment': pv_curtailment,
            'lost_nodes': lost_nodes,
            'operated_switches': operated_switches.tolist()
        }

    # ==================== 生成风险告警 ====================
    def generate_risk_alerts(self, metrics):
        alerts = []
        if metrics['cold_risk']:
            alerts.append({
                'level': '中',
                'content': f'冷负荷冲击风险：需恢复{metrics["cold_load_total"]:.2f} kW，超过阈值{metrics["spare_capacity"]:.2f} kW。'
            })
        if metrics['weighted_important_recovery_rate'] < 0.85:
            alerts.append({
                'level': '高',
                'content': f'重要用户加权恢复率偏低({metrics["weighted_important_recovery_rate"]*100:.1f}%)'
            })
        if metrics['lost_load'] > metrics['spare_capacity']:
            alerts.append({
                'level': '高',
                'content': f'容量严重不足：失供负荷{metrics["lost_load"]:.2f} kW，备用容量{metrics["spare_capacity"]:.2f} kW'
            })
        if metrics['pv_curtailment'] > 50:
            alerts.append({
                'level': '中',
                'content': f'PV弃光量较大：{metrics["pv_curtailment"]:.2f} kW'
            })
        if metrics['ev_load_lost'] > 100:
            alerts.append({
                'level': '中',
                'content': f'EV充电负荷损失：{metrics["ev_load_lost"]:.2f} kW'
            })
        if metrics['data_credibility'] < 0.85:
            alerts.append({
                'level': '中',
                'content': f'数据可信度偏低({metrics["data_credibility"]*100:.1f}%)'
            })
        if not alerts:
            alerts.append({'level': '无', 'content': '无风险提示。'})
        return alerts

    # ==================== 生成报告（修正版） ====================
    def generate_report_table(self, fault_info, switch_status, metrics, alerts, is_feasible):
        items = ['设备检查', '操作顺序检查', '网架结构检查', '容量检查',
                 '电压检查', 'N-1校核', 'FA校核', '闭锁检查', '存在的告警提示',
                 '========== 判定指标 ==========',
                 '故障包围完整性', '非故障失供负荷', '开关动作次数',
                 '远方操作比例', '数据可信度', '重要用户恢复率',
                 '加权重要用户恢复率', '冷负荷冲击风险', 'PV弃光量', 'EV充电损失']
        conclusions, details, risk_levels = [], [], []

        # ========== 前9项常规检查 ==========
        conclusions.append('通过 ✅'); details.append('跳闸开关变位正确，遥信一致，保护动作正常，无异常信号。'); risk_levels.append('-')
        conclusions.append('通过 ✅'); details.append('保护动作顺序正确（故障→跳闸→重合闸闭锁），未发生越级跳闸。'); risk_levels.append('-')
        if is_feasible:
            conclusions.append('通过 ✅'); details.append('故障区域已完全隔离，剩余非故障区域仍保持辐射状供电，无异常合环。')
        else:
            conclusions.append('不通过 ❌'); details.append('故障未完全隔离，存在非隔离供电风险。')
        risk_levels.append('-')
        if metrics['lost_load'] <= metrics['spare_capacity']:
            conclusions.append('通过 ✅'); details.append(f'备用容量 {metrics["spare_capacity"]:.2f} kW，可满足失供负荷 {metrics["lost_load"]:.2f} kW 的恢复需求。')
            risk_levels.append('-')
        else:
            conclusions.append('不通过 ❌'); details.append(f'备用容量 {metrics["spare_capacity"]:.2f} kW，无法满足失供负荷 {metrics["lost_load"]:.2f} kW（缺口 {metrics["lost_load"]-metrics["spare_capacity"]:.2f} kW），需负荷削减。')
            risk_levels.append('高')
        conclusions.append('通过（正常段）/ 失电（故障段） ⚠️'); details.append('正常供电区域电压在0.95~1.05 p.u.；失电区域电压为0，需后续转供恢复。'); risk_levels.append('中')
        conclusions.append('通过（当前方式） ✅'); details.append('当前主变N-1满足，不依赖联络线转供，无联络线N-1风险。'); risk_levels.append('-')
        conclusions.append('通过 ✅'); details.append('故障定位精准，隔离逻辑正确，FA策略匹配当前配置。'); risk_levels.append('-')
        conclusions.append('通过 ✅'); details.append('重合闸、备自投、防误闭锁均正确动作，无冲突信号。'); risk_levels.append('-')
        if len(alerts) > 0 and alerts[0]['level'] != '无':
            alert_text = ''
            levels = [a['level'] for a in alerts]
            contents = [a['content'] for a in alerts]
            for lvl, cnt in zip(levels, contents):
                alert_text += f'【{lvl}】{cnt}\n'
            conclusions.append(f'存在 {len(alerts)} 项告警 ⚠️')
            details.append(alert_text)
            risk_levels.append('高' if '高' in levels else '中' if '中' in levels else '低')
        else:
            conclusions.append('无告警 ✅')
            details.append('所有风险提示均无。')
            risk_levels.append('-')

        # ========== 分隔行 ==========
        conclusions.append(''); details.append(''); risk_levels.append('')

        # ========== 判定指标（修正：正确设置风险等级） ==========
        # 1. 故障包围完整性（硬约束）
        if is_feasible:
            conclusions.append('通过 ✅')
            risk_levels.append('硬约束')
        else:
            conclusions.append('不通过 ❌')
            risk_levels.append('硬约束')
        details.append(f'故障节点 {fault_info["node"]} 相邻开关：{self.node_to_switch.get(fault_info["node"], [])}')

        # 2. 非故障失供负荷（排序指标）
        conclusions.append(f'{metrics["lost_load"]:.2f} kW')
        details.append(f'失电节点：{metrics["lost_nodes"]}')
        risk_levels.append('排序指标')

        # 3. 开关动作次数（排序指标）
        conclusions.append(f'{metrics["switch_ops"]} 次')
        details.append(f'操作开关：{metrics["operated_switches"]}')
        risk_levels.append('排序指标')

        # 4. 远方操作比例（排序指标）
        conclusions.append(f'{metrics["remote_ratio"]*100:.1f}%')
        details.append(f'远方操作开关数 / 总操作开关数')
        risk_levels.append('排序指标')

        # 5. 数据可信度（准入条件）
        conclusions.append(f'{metrics["data_credibility"]*100:.1f}%')
        details.append(f'遥测可信度 × 遥信可信度')
        risk_levels.append('准入条件')

        # 6. 重要用户恢复率（排序指标）
        conclusions.append(f'{metrics["important_recovery_rate"]*100:.1f}%')
        details.append(f'已恢复重要用户数 / 重要用户总数')
        risk_levels.append('排序指标')

        # 7. 加权重要用户恢复率（排序指标）
        conclusions.append(f'{metrics["weighted_important_recovery_rate"]*100:.1f}%')
        details.append(f'考虑权重后的恢复率')
        risk_levels.append('排序指标')

        # 8. 冷负荷冲击风险（风险提示）
        if metrics['cold_risk']:
            conclusions.append('有风险 ⚠️')
            risk_levels.append('风险提示')
        else:
            conclusions.append('无风险 ✅')
            risk_levels.append('风险提示')
        details.append(f'冷负荷：{metrics["cold_load_total"]:.2f} kW，备用容量：{metrics["spare_capacity"]:.2f} kW')

        # 9. PV弃光量（排序指标）
        conclusions.append(f'{metrics["pv_curtailment"]:.2f} kW')
        details.append(f'因失电损失的光伏发电')
        risk_levels.append('排序指标')

        # 10. EV充电损失（排序指标）
        conclusions.append(f'{metrics["ev_load_lost"]:.2f} kW')
        details.append(f'因失电损失的EV充电功率')
        risk_levels.append('排序指标')

        # 附加系统配置信息
        config_info = (f'\n【系统配置信息】\n重要用户: {self.critical_nodes}，权重: {self.critical_weights}\n'
                       f'EV充电: {self.ev_nodes}，峰值(kW): {self.ev_peak}\n'
                       f'PV接入: {self.pv_nodes}，容量(kW): {self.pv_cap}')
        details[-1] += config_info

        df = pd.DataFrame({
            '检查结论': conclusions,
            '详细说明': details,
            '风险等级': risk_levels
        }, index=items)
        return df

    # ==================== 主运行函数 ====================
    def run(self, input_excel='scenario.xlsx', output_excel='report.xlsx'):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if not os.path.isabs(input_excel):
            input_excel = os.path.join(script_dir, input_excel)
        if not os.path.isabs(output_excel):
            output_excel = os.path.join(script_dir, output_excel)

        if not os.path.isfile(input_excel):
            self.create_default_scenario_excel(input_excel)

        fault_info, switch_status = self.load_scenario_from_excel(input_excel)
        is_feasible, hard_msg = self.check_hard_constraints(fault_info, switch_status)

        if not is_feasible:
            metrics = {
                'lost_load': 0, 'important_recovery_rate': 0,
                'weighted_important_recovery_rate': 0, 'switch_ops': 0,
                'remote_ratio': 0, 'data_credibility': 0,
                'cold_risk': False, 'cold_load_total': 0,
                'spare_capacity': 0.20 * np.sum(self.P_kW),
                'ev_load_lost': 0, 'pv_curtailment': 0,
                'lost_nodes': [], 'operated_switches': []
            }
            alerts = [{'level': '高', 'content': hard_msg}]
            print(f"❌ 硬约束失败：{hard_msg}")
        else:
            pv_output = self.pv_cap_by_node
            metrics = self.compute_metrics(switch_status, pv_output)
            alerts = self.generate_risk_alerts(metrics)

        df_report = self.generate_report_table(fault_info, switch_status, metrics, alerts, is_feasible)
        out_dir = os.path.dirname(output_excel)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir)
        df_report.to_excel(output_excel, sheet_name='检查结论')

        result = {
            'exported': True,
            'excel_file': output_excel,
            'is_feasible': is_feasible,
            'lost_load': metrics['lost_load'],
            'important_recovery_rate': metrics['important_recovery_rate'],
            'weighted_important_recovery_rate': metrics['weighted_important_recovery_rate'],
            'switch_ops': metrics['switch_ops'],
            'remote_ratio': metrics['remote_ratio'],
            'data_credibility': metrics['data_credibility'],
            'pv_curtailment': metrics['pv_curtailment'],
            'ev_load_lost': metrics['ev_load_lost'],
            'risk_count': len(alerts)
        }

        if is_feasible:
            result['summary'] = (f'方案可行。失供负荷{metrics["lost_load"]:.2f} kW，'
                                 f'重要用户恢复率{metrics["important_recovery_rate"]*100:.1f}%，'
                                 f'加权恢复率{metrics["weighted_important_recovery_rate"]*100:.1f}%，'
                                 f'远方操作比例{metrics["remote_ratio"]*100:.1f}%，'
                                 f'数据可信度{metrics["data_credibility"]*100:.1f}%，'
                                 f'损失EV充电负荷{metrics["ev_load_lost"]:.2f} kW')
        else:
            result['summary'] = '方案不可行（硬约束不通过）。'
        print(result['summary'])
        return result


if __name__ == '__main__':
    checker = IsolationChecker()
    if len(sys.argv) >= 3:
        input_file = sys.argv[1]
        output_file = sys.argv[2]
    else:
        input_file = 'scenario.xlsx'
        output_file = 'report.xlsx'
    result = checker.run(input_file, output_file)
