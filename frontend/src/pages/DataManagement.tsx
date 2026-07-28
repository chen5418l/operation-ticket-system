import { useEffect, useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import SectionCard from '../components/SectionCard';

/* ==================== 类型 ==================== */
interface RealtimeNode { node: number; load_kw: number; voltage_pu: number; pv_kw: number; ev_kw: number; risk_level: string; }
interface RealtimeLine { line: string; current_a: number; power_kw: number; status: number; }
interface TopoBranch { from: number; to: number; r: number; x: number; status?: number; }
interface TopoTieSwitch { id: string; from: number; to: number; line: string; rated_kw?: number; }

/* ==================== 静态定义 ==================== */
const TIE_DEFAULTS = [
  { id: 'T1', line: '8-21', from: 8, to: 21, ratedKw: 1200 },
  { id: 'T2', line: '9-15', from: 9, to: 15, ratedKw: 1200 },
  { id: 'T3', line: '12-22', from: 12, to: 22, ratedKw: 1200 },
  { id: 'T4', line: '18-33', from: 18, to: 33, ratedKw: 1200 },
  { id: 'T5', line: '25-29', from: 25, to: 29, ratedKw: 500 },
];

const SAFETY_RULES = [
  { id: 'R1', name: '设备状态校验', severity: '阻断', category: '五防', description: '操作前确认被操作设备处于可操作状态，断路器与隔离开关状态匹配，无接地刀闸合闸时送电', applyTo: '全部操作步骤' },
  { id: 'R2', name: '倒闸顺序校验', severity: '阻断', category: '操作顺序', description: '停电：先断断路器→再拉隔离开关；送电：先合隔离开关→再合断路器。严禁带负荷拉合隔离开关', applyTo: '开断/闭合步骤' },
  { id: 'R3', name: '拓扑关系校验', severity: '阻断', category: '拓扑', description: '转供后网络保持辐射状(无环网)，无孤立节点，联络开关闭合后对应分段开关断开', applyTo: '转供步骤' },
  { id: 'R4', name: '容量约束校验', severity: '阻断', category: '潮流', description: '转供后线路和变压器负载不超过额定容量，联络线转供容量不超过限值，电压不越限', applyTo: '转供步骤' },
  { id: 'R5', name: 'N-1 约束校验', severity: '警告', category: '潮流', description: '转供后系统仍满足 N-1 准则：任一元件故障退出后，剩余元件不过载、电压不越限', applyTo: '方案级校验' },
  { id: 'R6', name: 'FA 策略校验', severity: '警告', category: '自动化', description: '转供方案需与馈线自动化(FA)策略兼容，不产生 FA 逻辑冲突或误动风险', applyTo: '方案级校验' },
  { id: 'R7', name: '五防互锁校验', severity: '阻断', category: '五防', description: '防止误分误合断路器、防止带负荷拉合隔离开关、防止带电合接地刀闸、防止带地线送电、防止误入带电间隔', applyTo: '全部操作步骤' },
  { id: 'R8', name: '人工修改复校', severity: '警告', category: '审核', description: '任何对自动生成操作序列的人工修改，必须经第二人复核确认后方可生效', applyTo: '人工修改后' },
];

const TICKET_TEMPLATES = [
  { id: 'TPL1', name: '馈线故障隔离', steps: [
    { seq: 1, action: '确认故障', detail: '根据保护动作信号和故障录波，确认故障馈线和故障区段' },
    { seq: 2, action: '断开馈线断路器', detail: '遥控或就地断开故障馈线出口断路器' },
    { seq: 3, action: '拉开两侧隔离开关', detail: '依次拉开故障区段两侧隔离开关，形成明显断开点' },
    { seq: 4, action: '验电', detail: '在故障区段两侧验电，确认无电压' },
    { seq: 5, action: '挂接地线', detail: '在故障区段两侧挂接地线' },
  ]},
  { id: 'TPL2', name: '联络开关转供恢复', steps: [
    { seq: 1, action: '确认联络开关状态', detail: '确认联络开关处于分闸位置，两侧隔离开关已合上' },
    { seq: 2, action: '核对相序', detail: '核对联络开关两侧相序一致' },
    { seq: 3, action: '合联络开关', detail: '遥控或就地合上联络开关' },
    { seq: 4, action: '确认负荷转移', detail: '检查负荷转移情况，确认无过载' },
    { seq: 5, action: '调整运行方式', detail: '根据需要调整运行方式，恢复对停电区段供电' },
  ]},
  { id: 'TPL3', name: '运行方式调整', steps: [
    { seq: 1, action: '制定调整方案', detail: '根据负荷预测和N-1分析，制定运行方式调整方案' },
    { seq: 2, action: '合环操作', detail: '先合联络开关形成合环运行（短时）' },
    { seq: 3, action: '解环操作', detail: '断开指定分段开关，恢复辐射状运行' },
    { seq: 4, action: '潮流校验', detail: '调整后校验电压和负载率均在限值内' },
  ]},
  { id: 'TPL4', name: '恢复供电操作', steps: [
    { seq: 1, action: '拆除接地线', detail: '依次拆除故障区段两侧接地线' },
    { seq: 2, action: '合上隔离开关', detail: '依次合上故障区段两侧隔离开关' },
    { seq: 3, action: '合上断路器', detail: '合上馈线出口断路器，恢复供电' },
    { seq: 4, action: '确认供电恢复', detail: '检查电压和负荷，确认供电恢复正常' },
    { seq: 5, action: '汇报调度', detail: '向调度汇报操作完成，记录操作时间' },
  ]},
];

const LIMITS = [
  { item: '电压上限', value: '1.10 pu', basis: 'GB/T 12325 供电电压偏差', note: '10kV 及以下三相供电电压偏差不超过标称电压的 ±7%' },
  { item: '电压下限', value: '0.90 pu', basis: 'GB/T 12325', note: '正常运行方式下不低于 0.90 pu；故障后不低于 0.85 pu' },
  { item: '负载率预警', value: '80%', basis: '调度运行规程', note: '超过 80% 时发出预警，提醒调度员关注' },
  { item: '负载率上限', value: '100%', basis: '设备额定容量', note: '正常运行不超过额定容量；N-1 故障后可短时超过 100%' },
  { item: 'N-1 裕度', value: '≥20%', basis: 'DL/T 5729 配电网规划设计技术导则', note: '单条线路故障退出后，剩余线路负载不超过 100%' },
  { item: '短路电流', value: '≤20 kA', basis: '断路器开断能力', note: '短路电流不超过断路器额定开断电流' },
];

function fmt(v: number, d = 1): string { return Number.isFinite(v) ? v.toFixed(d) : '--'; }

/* ==================== 详情弹窗（根据类型渲染不同内容） ==================== */
function DetailModal({ title, type, onClose, data }: {
  title: string; type: string; onClose: () => void;
  data: { nodes?: RealtimeNode[]; lines?: RealtimeLine[]; branches?: TopoBranch[]; ties?: TopoTieSwitch[] };
}) {
  const renderContent = () => {
    switch (type) {
      // ---- 节点数据 ----
      case 'nodes': {
        const nodes = data.nodes || [];
        if (!nodes.length) return <p style={{ color:'#94a3b8', fontSize:13 }}>暂无实时节点数据</p>;
        return (
          <div>
            <p style={{ fontSize:11, color:'#667085', marginBottom:10 }}>
              共 {nodes.length} 个节点（数据来源：Simulink 实时推送）
            </p>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:'2px solid #e2e8f0', textAlign:'left', color:'#667085' }}>
                  <th style={{ padding:'5px 8px' }}>Bus</th><th style={{ padding:'5px 8px' }}>负荷(kW)</th>
                  <th style={{ padding:'5px 8px' }}>电压(pu)</th><th style={{ padding:'5px 8px' }}>光伏(kW)</th>
                  <th style={{ padding:'5px 8px' }}>充电(kW)</th><th style={{ padding:'5px 8px' }}>风险</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map(n => (
                  <tr key={n.node} style={{ borderBottom:'1px solid #f3f6f9' }}>
                    <td style={{ padding:'4px 8px', fontWeight:600 }}>Bus-{n.node}</td>
                    <td style={{ padding:'4px 8px' }}>{fmt(n.load_kw, 1)}</td>
                    <td style={{ padding:'4px 8px', color: n.voltage_pu < 0.95 ? '#eb5757' : n.voltage_pu < 0.97 ? '#b8860b' : '#1f2937', fontWeight: n.voltage_pu < 0.95 ? 600 : 400 }}>
                      {fmt(n.voltage_pu, 4)}
                    </td>
                    <td style={{ padding:'4px 8px', color:'#94a3b8' }}>{fmt(n.pv_kw, 1)}</td>
                    <td style={{ padding:'4px 8px', color:'#94a3b8' }}>{fmt(n.ev_kw, 1)}</td>
                    <td style={{ padding:'4px 8px' }}>
                      <span style={{ padding:'1px 5px', borderRadius:2, fontSize:9, fontWeight:600,
                        background: n.risk_level === 'high' ? '#ffebee' : n.risk_level === 'medium' ? '#fff8e1' : '#e8f5e9',
                        color: n.risk_level === 'high' ? '#eb5757' : n.risk_level === 'medium' ? '#b8860b' : '#1f8a4c',
                      }}>{n.risk_level === 'high' ? '高' : n.risk_level === 'medium' ? '中' : '低'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      // ---- 线路数据 ----
      case 'lines': {
        const lines = data.lines || [];
        const branches = data.branches || [];
        const branchMap: Record<string, TopoBranch> = {};
        for (const b of branches) {
          branchMap[`${b.from}-${b.to}`] = b;
          branchMap[`${b.to}-${b.from}`] = b;
        }
        if (!lines.length) return <p style={{ color:'#94a3b8', fontSize:13 }}>暂无实时线路数据</p>;
        return (
          <div>
            <p style={{ fontSize:11, color:'#667085', marginBottom:10 }}>
              共 {lines.length} 条线路（实时电流/功率 + 静态阻抗参数）
            </p>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:'2px solid #e2e8f0', textAlign:'left', color:'#667085' }}>
                  <th style={{ padding:'5px 8px' }}>线路</th><th style={{ padding:'5px 8px' }}>电流(A)</th>
                  <th style={{ padding:'5px 8px' }}>功率(kW)</th><th style={{ padding:'5px 8px' }}>状态</th>
                  <th style={{ padding:'5px 8px' }}>r(pu)</th><th style={{ padding:'5px 8px' }}>x(pu)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const b = branchMap[l.line] || {} as TopoBranch;
                  return (
                    <tr key={l.line} style={{ borderBottom:'1px solid #f3f6f9' }}>
                      <td style={{ padding:'4px 8px', fontWeight:600, fontFamily:'monospace' }}>{l.line}</td>
                      <td style={{ padding:'4px 8px' }}>{fmt(l.current_a, 2)}</td>
                      <td style={{ padding:'4px 8px' }}>{fmt(l.power_kw, 1)}</td>
                      <td style={{ padding:'4px 8px' }}>
                        <span style={{ padding:'1px 5px', borderRadius:2, fontSize:9, fontWeight:600,
                          background: l.status === 1 ? '#e8f5e9' : '#ffebee',
                          color: l.status === 1 ? '#1f8a4c' : '#eb5757',
                        }}>{l.status === 1 ? '合' : '开'}</span>
                      </td>
                      <td style={{ padding:'4px 8px', color:'#94a3b8', fontFamily:'monospace' }}>{b.r != null ? b.r.toFixed(4) : '-'}</td>
                      <td style={{ padding:'4px 8px', color:'#94a3b8', fontFamily:'monospace' }}>{b.x != null ? b.x.toFixed(4) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }

      // ---- 联络开关 ----
      case 'ties': {
        const ties = data.ties || [];
        const items = ties.length >= 5 ? ties : TIE_DEFAULTS;
        return (
          <div>
            <p style={{ fontSize:11, color:'#667085', marginBottom:10 }}>
              {ties.length >= 5 ? `共 ${ties.length} 组联络开关（来源：拓扑数据）` : '共 5 组联络开关（IEEE33 标准配置）'}
            </p>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:'2px solid #e2e8f0', textAlign:'left', color:'#667085' }}>
                  <th style={{ padding:'5px 8px' }}>编号</th><th style={{ padding:'5px 8px' }}>线路</th>
                  <th style={{ padding:'5px 8px' }}>源端 Bus</th><th style={{ padding:'5px 8px' }}>对端 Bus</th>
                  <th style={{ padding:'5px 8px' }}>额定容量(kW)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t: any, i: number) => (
                  <tr key={i} style={{ borderBottom:'1px solid #f3f6f9' }}>
                    <td style={{ padding:'4px 8px', fontWeight:700, color:'#1f8a4c' }}>{t.id || `T${i+1}`}</td>
                    <td style={{ padding:'4px 8px', fontFamily:'monospace' }}>{t.line || `${t.from}-${t.to}`}</td>
                    <td style={{ padding:'4px 8px' }}>Bus-{t.from}</td>
                    <td style={{ padding:'4px 8px' }}>Bus-{t.to}</td>
                    <td style={{ padding:'4px 8px', fontWeight:600 }}>{t.ratedKw || t.rated_kw || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop:10, fontSize:10, color:'#94a3b8' }}>
              联络开关正常运行时常开。转供时闭合，通过联络线将失电负荷转移至相邻馈线。
            </div>
          </div>
        );
      }

      // ---- 运行限值 ----
      case 'limits':
        return (
          <div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:'2px solid #e2e8f0', textAlign:'left', color:'#667085' }}>
                  <th style={{ padding:'5px 8px' }}>限值项</th><th style={{ padding:'5px 8px' }}>定值</th>
                  <th style={{ padding:'5px 8px' }}>依据</th><th style={{ padding:'5px 8px' }}>说明</th>
                </tr>
              </thead>
              <tbody>
                {LIMITS.map((l, i) => (
                  <tr key={i} style={{ borderBottom:'1px solid #f3f6f9' }}>
                    <td style={{ padding:'5px 8px', fontWeight:600 }}>{l.item}</td>
                    <td style={{ padding:'5px 8px', fontFamily:'monospace', fontWeight:700, color:'#1f8a4c' }}>{l.value}</td>
                    <td style={{ padding:'5px 8px', color:'#667085' }}>{l.basis}</td>
                    <td style={{ padding:'5px 8px', color:'#1f2937' }}>{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop:10, fontSize:10, color:'#b8860b', background:'#fff8e1', padding:'6px 10px', borderRadius:4 }}>
              ⚠️ 以上为 IEEE33 标准参考值和通用规程要求。实际运行限值需由电网运方部门根据本网实际情况核定。
            </div>
          </div>
        );

      // ---- 操作票模板 ----
      case 'templates':
        return (
          <div>
            {TICKET_TEMPLATES.map(tpl => (
              <div key={tpl.id} style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize:13, fontWeight:600, color:'#1f2937', marginBottom:6 }}>
                  {tpl.id} {tpl.name}
                </h4>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr style={{ borderBottom:'2px solid #e2e8f0', textAlign:'left', color:'#667085' }}>
                      <th style={{ padding:'4px 8px', width:40 }}>序号</th>
                      <th style={{ padding:'4px 8px', width:130 }}>操作</th>
                      <th style={{ padding:'4px 8px' }}>详细说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tpl.steps.map(s => (
                      <tr key={s.seq} style={{ borderBottom:'1px solid #f3f6f9' }}>
                        <td style={{ padding:'4px 8px', fontWeight:600, color:'#1f8a4c' }}>{s.seq}</td>
                        <td style={{ padding:'4px 8px', fontWeight:500 }}>{s.action}</td>
                        <td style={{ padding:'4px 8px', color:'#1f2937' }}>{s.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        );

      default:
        return <p style={{ color:'#94a3b8', fontSize:13 }}>暂无详细数据</p>;
    }
  };

  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0,
      background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
      onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:8, padding:24, width:820, maxWidth:'95vw', maxHeight:'80vh', overflow:'auto', boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'1px solid #e2e8f0' }}>
          <h3 style={{ fontSize:15, fontWeight:600, color:'#1f2937', margin:0 }}>{title}</h3>
          <button onClick={onClose} style={{ padding:'4px 12px', borderRadius:4, border:'1px solid #c8d6e5', background:'#f3f6f9', color:'#667085', cursor:'pointer', fontSize:12 }}>
            ✕ 关闭
          </button>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}

/* ==================== 主组件 ==================== */
export default function DataManagement() {
  const [detail, setDetail] = useState<{ title: string; type: string } | null>(null);
  const [algoAvailable, setAlgoAvailable] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<string>('检测中...');
  const [rtNodes, setRtNodes] = useState<RealtimeNode[]>([]);
  const [rtLines, setRtLines] = useState<RealtimeLine[]>([]);
  const [topoBranches, setTopoBranches] = useState<TopoBranch[]>([]);
  const [topoTies, setTopoTies] = useState<TopoTieSwitch[]>([]);

  // 拉取实时数据 + 拓扑数据
  useEffect(() => {
    // 算法状态
    fetch('http://localhost:8000/api/algorithm/health')
      .then(r => r.json()).then(d => setAlgoAvailable(d.available === true)).catch(() => {});

    // Simulink 实时数据
    fetch('http://localhost:8000/api/realtime/latest')
      .then(r => r.json()).then(d => {
        if (d?.success && d.nodes?.length) {
          setRtNodes(d.nodes);
          setRtLines(d.lines || []);
          setRealtimeStatus(`${d.source_tag || '实时'} · ${d.nodes.length}节点 · ${(d.lines||[]).length}线路`);
        } else {
          setRealtimeStatus('仿真模式（无实时推送）');
        }
      }).catch(() => setRealtimeStatus('后端未连接'));

    // 拓扑数据（拿阻抗参数）
    fetch('http://localhost:8000/api/topology/ieee33')
      .then(r => r.json()).then(d => {
        if (d?.code === 200 && d.data) {
          setTopoBranches(d.data.branches || []);
          setTopoTies(d.data.tieSwitches || []);
        }
      }).catch(() => {});
  }, []);

  // ---- 数据对象定义 ----
  const dataObjects = [
    { id: '1', name: 'IEEE33 节点数据', type: 'nodes', content: 'Bus1-Bus33：实时负荷(kW)、电压(pu)、光伏/充电、风险等级', source: rtNodes.length > 0 ? 'Simulink 实时' : '内置模型', modules: '拓扑可视化、故障分析', ready: rtNodes.length > 0 },
    { id: '2', name: '线路拓扑数据', type: 'lines', content: '37条线路：实时电流(A)、功率(kW)、开关状态 + 静态阻抗参数(r,x)', source: rtLines.length > 0 ? 'Simulink 实时' : '内置模型', modules: '故障分析、边界判定、转供决策', ready: rtLines.length > 0 },
    { id: '3', name: '联络开关配置', type: 'ties', content: 'T1-T5 常开联络开关：额定容量、两端 Bus、转供能力', source: '内置模型', modules: '转供决策', ready: false },
    { id: '4', name: '运行限值定值', type: 'limits', content: '电压上下限(0.90-1.10pu)、负载率上限(100%)、N-1 裕度(≥20%)、短路电流', source: '内置示例', modules: '安全校验', ready: false },
    { id: '5', name: '操作票模板', type: 'templates', content: '4套标准模板：故障隔离、转供恢复、方式调整、恢复供电', source: '内置示例', modules: '操作序列生成、模板化成票', ready: false },
    { id: '6', name: '安全校验规则', type: 'rules', content: '8项校验规则：五防、倒闸顺序、拓扑、容量、N-1、FA策略、五防互锁、人工复校', source: '内置示例', modules: '安全校验', ready: false },
  ];

  // ---- 数据对象列 ----
  const objectColumns = [
    { key: 'name', title: '数据对象', dataIndex: 'name' as const, width: 120, render: (r: typeof dataObjects[0]) => (
      <span style={{ fontWeight: 600, fontSize: 12 }}>{r.name}</span>
    )},
    { key: 'content', title: '维护内容', dataIndex: 'content' as const, render: (r: typeof dataObjects[0]) => <span style={{ wordBreak:'break-all', fontSize: 11 }}>{r.content}</span> },
    { key: 'source', title: '数据来源', dataIndex: 'source' as const, width: 90, render: (r: typeof dataObjects[0]) => (
      <span style={{ fontSize: 10, fontWeight:500, padding:'1px 5px', borderRadius:3,
        background: r.ready ? '#e8f5e9' : '#fff8e1',
        color: r.ready ? '#1f8a4c' : '#b8860b',
      }}>{r.source}</span>
    )},
    { key: 'modules', title: '使用模块', dataIndex: 'modules' as const, width: 150, render: (r: typeof dataObjects[0]) => <span style={{ fontSize: 10 }}>{r.modules}</span> },
    { key: 'action', title: '', width: 52, render: (r: typeof dataObjects[0]) => (
      <button onClick={() => setDetail({ title: r.name, type: r.type })}
        style={{ padding:'3px 10px', borderRadius:4, border:'1px solid #1f8a4c', background:'#fff', color:'#1f8a4c', cursor:'pointer', fontSize:10, fontWeight:600 }}>
        查看详情
      </button>
    )},
  ];

  // ---- 安全规则列 ----
  const ruleColumns = [
    { key: 'id', title: '编号', dataIndex: 'id' as const, width: 36, render: (r: typeof SAFETY_RULES[0]) => <span style={{ fontSize: 10, fontFamily:'monospace', color:'#667085' }}>{r.id}</span> },
    { key: 'name', title: '规则名称', dataIndex: 'name' as const, width: 115 },
    { key: 'severity', title: '级别', dataIndex: 'severity' as const, width: 48, render: (r: typeof SAFETY_RULES[0]) => (
      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 2,
        background: r.severity === '阻断' ? '#ffebee' : '#fff8e1',
        color: r.severity === '阻断' ? '#eb5757' : '#b8860b',
      }}>{r.severity}</span>
    )},
    { key: 'category', title: '类别', dataIndex: 'category' as const, width: 52, render: (r: typeof SAFETY_RULES[0]) => <span style={{ fontSize: 10, color:'#667085' }}>{r.category}</span> },
    { key: 'description', title: '规则说明', dataIndex: 'description' as const, render: (r: typeof SAFETY_RULES[0]) => <span style={{ fontSize: 11 }}>{r.description}</span> },
    { key: 'applyTo', title: '适用范围', dataIndex: 'applyTo' as const, width: 90, render: (r: typeof SAFETY_RULES[0]) => <span style={{ fontSize: 10, color:'#94a3b8' }}>{r.applyTo}</span> },
  ];

  return (
    <PageContainer title="数据管理">
      {/* ====== 1. 顶部提示 ====== */}
      <div style={{
        background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6,
        padding: '8px 14px', marginBottom: 14, fontSize: 11, color: '#b8860b',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      }}>
        <span>⚠️ 当前为 IEEE33 仿真验证阶段，运行限值、安全规则、操作票模板均为内置示例，非实际生产定值。</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>
          8010：<span style={{ color: algoAvailable ? '#1f8a4c' : '#b8860b' }}>{algoAvailable ? '在线' : '离线'}</span>
          <span style={{ margin: '0 6px', color: '#c8d6e5' }}>|</span>
          数据源：<span style={{ color: rtNodes.length > 0 ? '#1f8a4c' : '#b8860b' }}>{realtimeStatus}</span>
        </span>
      </div>

      {/* ====== 2. 概览卡片 ====== */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '节点', value: rtNodes.length || 33, sub: rtNodes.length > 0 ? 'Simulink 实时' : 'IEEE33 静态', ok: rtNodes.length > 0 },
          { label: '线路', value: rtLines.length || 37, sub: rtLines.length > 0 ? '37条（含5条联络线）' : 'IEEE33 静态', ok: rtLines.length > 0 },
          { label: '联络开关', value: '5 组', sub: 'T1-T5 常开', ok: null },
          { label: '运行限值', value: '6 项', sub: '示例定值', ok: false },
        ].map(item => (
          <div key={item.label} style={{
            background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6,
            padding: '12px 18px', flex: 1, minWidth: 110,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%',
                background: item.ok === true ? '#1f8a4c' : item.ok === false ? '#f2c94c' : '#94a3b8' }} />
              <span style={{ fontSize: 11, color: '#667085' }}>{item.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2937' }}>{item.value}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ====== 3. 数据对象维护（可点击查看详情） ====== */}
      <SectionCard title="数据对象维护" style={{ marginBottom: 16 }}>
        <DataTable columns={objectColumns} data={dataObjects} rowKey={r => r.id} />
      </SectionCard>

      {/* ====== 4. 安全校验规则 ====== */}
      <SectionCard title="安全校验规则（8 项）" style={{ marginBottom: 16 }}>
        <DataTable columns={ruleColumns} data={SAFETY_RULES} rowKey={r => r.id} />
      </SectionCard>

      {/* ====== 5. 底部数据链路 ====== */}
      <div style={{
        background: '#f3f6f9', border: '1px solid #c8d6e5', borderRadius: 6,
        padding: '10px 16px', fontSize: 11, color: '#667085',
      }}>
        <strong style={{ color: '#1f2937' }}>数据链路：</strong>
        实时开关状态/负荷/电压(Simulink → 实时接口 → 后端 8000) → 拓扑模型(静态 IEEE33 + 实时注入) → 联络开关容量(内置默认值) → 运行限值(内置示例) → 安全校验规则(内置 8 项) → 操作票模板(内置 4 套)
        <span style={{ display: 'block', marginTop: 4, color: '#94a3b8' }}>
          生产环境下，运行限值、安全规则和操作票模板需由电网运方部门确认后录入。实时数据来源通过 Simulink Token 验证。
        </span>
      </div>

      {/* ====== 详情弹窗 ====== */}
      {detail && (
        <DetailModal
          title={detail.title} type={detail.type}
          onClose={() => setDetail(null)}
          data={{ nodes: rtNodes, lines: rtLines, branches: topoBranches, ties: topoTies }}
        />
      )}
    </PageContainer>
  );
}
