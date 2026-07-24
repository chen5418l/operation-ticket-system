import { useState, useRef } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';

// ============ 演示数据对象（标注"演示数据"） ============
interface DataObjectRow {
  id: string;
  name: string;
  content: string;
  source: string;          // 数据来源
  version: string;          // 版本
  updatedAt: string;        // 更新时间
  modules: string;          // 使用模块
  productionReady: string;  // 可用于正式流程
  status: string;
  detailRows: string[];
}

const dataObjects: DataObjectRow[] = [
  { id: '1', name: 'IEEE33 节点数据', content: 'Bus1-Bus33 节点基础信息：编号、负荷、电压、所属馈线、坐标',
    source: '内置演示', version: 'IEEE33 标准测试模型', updatedAt: '2026-07-05（系统初始化）', modules: '拓扑可视化、故障分析', productionReady: '否（演示数据）',
    status: '已加载', detailRows: ['节点总数：33','电源节点：Bus1','负荷节点：Bus2-Bus33','主馈线：Bus1-Bus18','分支：Bus19-Bus22 / Bus23-Bus25 / Bus26-Bus33'] },
  { id: '2', name: '线路拓扑数据', content: '32条主干线 + 5条联络线的连接关系及阻抗参数',
    source: '内置演示', version: 'IEEE33 标准测试模型', updatedAt: '2026-07-05（系统初始化）', modules: '故障分析、边界判定、转供决策', productionReady: '否（演示数据）',
    status: '已加载', detailRows: ['主干线：32条','联络线：5条(T1-T5)','线路状态：Simulink 实时更新'] },
  { id: '3', name: '联络开关数据', content: 'T1-T5 常开联络开关：转供容量、负载率、安全校验结果',
    source: '实时 + 内置演示', version: '实时', updatedAt: '实时（随 Simulink 推送更新）', modules: '转供决策、安全校验', productionReady: '部分（容量为演示默认值）',
    status: '实时同步', detailRows: ['T1: Bus8-21 (容量 1200kW)','T2: Bus9-15 (容量 1200kW)','T3: Bus12-22 (容量 1200kW)','T4: Bus18-33 (容量 1200kW)','T5: Bus25-29 (容量 500kW)','注：容量为 IEEE33 标准默认值，非实际设备参数'] },
  { id: '4', name: '运行限值数据', content: '电压上下限 (0.90-1.10pu)、负载率上限 (80%)、N-1 裕度要求',
    source: '内置示例', version: 'v1.0 示例限值', updatedAt: '2026-07-05', modules: '转供决策、安全校验', productionReady: '否（示例限值）',
    status: '示例数据', detailRows: ['电压上限：1.10 pu','电压下限：0.90 pu','负载率预警：80%','负载率上限：100%','N-1 裕度：≥20%','⚠ 以上为 IEEE33 标准参考值，非实际电网定值'] },
  { id: '5', name: '操作票模板', content: '故障隔离、负荷转供、恢复供电标准操作步骤模板',
    source: '内置示例', version: 'v1.0 示例模板', updatedAt: '2026-07-05', modules: '操作序列生成、模板化成票', productionReady: '否（示例模板）',
    status: '示例数据', detailRows: ['模板1：馈线故障隔离','模板2：联络开关转供恢复','模板3：运行方式调整','模板4：恢复供电操作','⚠ 当前为演示模板，不适用于真实调度场景'] },
  { id: '6', name: '安全校验规则', content: '防误操作规则(五防)、越限校验、孤岛校验、操作顺序校验',
    source: '内置示例', version: 'v1.0 示例规则', updatedAt: '2026-07-05', modules: '安全校验', productionReady: '否（示例规则）',
    status: '示例数据', detailRows: ['规则1：设备状态校验','规则2：倒闸顺序校验','规则3：拓扑关系校验','规则4：容量约束校验','规则5：N-1约束校验','规则6：FA策略校验','规则7：五防互锁校验','规则8：人工修改复校','⚠ 当前为内置示例规则，非实际安全校验规则'] },
];

// ============ 规则/模板维护数据 ============
interface RuleTemplateRow {
  id: string;
  name: string;
  purpose: string;
  version: string;
  effectiveVersion: string;   // 当前生效版本
  modules: string;            // 适用模块
  usedInCurrentFlow: string;  // 当前流程是否使用
  changeImpact: string;       // 修改影响说明
  status: string;
}

const ruleTemplates: RuleTemplateRow[] = [
  { id: '1', name: '故障隔离模板', purpose: '生成故障隔离操作序列', version: 'v1.0',
    effectiveVersion: 'v1.0（示例）', modules: '操作序列生成', usedInCurrentFlow: '是（演示流程）', changeImpact: '影响所有新生成的操作票中故障隔离步骤的内容和顺序',
    status: '启用' },
  { id: '2', name: '转供恢复模板', purpose: '生成转供恢复操作序列', version: 'v1.0',
    effectiveVersion: 'v1.0（示例）', modules: '操作序列生成', usedInCurrentFlow: '是（演示流程）', changeImpact: '影响负荷转移和恢复供电阶段的操作内容',
    status: '启用' },
  { id: '3', name: '安全校验规则', purpose: '校验操作票是否满足安全约束', version: 'v1.0',
    effectiveVersion: 'v1.0（示例）', modules: '安全校验', usedInCurrentFlow: '是（演示流程）', changeImpact: '影响所有安全校验项的判定标准和阈值',
    status: '启用' },
  { id: '4', name: 'IEEE33 拓扑模板', purpose: '初始化标准测试系统数据', version: 'v1.0',
    effectiveVersion: 'v1.0（示例）', modules: '拓扑可视化、故障分析', usedInCurrentFlow: '是（演示流程）', changeImpact: '影响整个系统的拓扑基础和故障分析结果',
    status: '启用' },
];

// ============ 状态卡 ============
const statusCards = [
  { label: '拓扑模型', status: '已导入', desc: '演示模型', note: 'IEEE33 标准测试系统' },
  { label: '设备台账', status: '演示台账', desc: '非生产数据', note: 'Bus1-Bus33 示例参数' },
  { label: '运行限值', status: '示例限值', desc: 'IEEE33 标准参考值', note: '非实际电网定值' },
  { label: '开关状态', status: '实时同步', desc: 'Simulink 推送', note: '随实时数据更新' },
  { label: '规则模板', status: '示例规则 v1.0', desc: '5套模板', note: '内置演示，不可在线编辑' },
];

// ============ 数据导入步骤（仅前端预览） ============
const importSteps = [
  { label: '选择文件', desc: '上传 Excel/CSV' },
  { label: '字段预览', desc: '匹配数据字段' },
  { label: '数据校验', desc: '格式与完整性检查' },
  { label: '版本管理', desc: '新旧版本对比' },
  { label: '发布生效', desc: '导入并生效' },
];

export default function DataManagement() {
  const [detail, setDetail] = useState<{ title: string; rows: string[] } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importStep, setImportStep] = useState(-1);
  const fileRef = useRef<HTMLInputElement>(null);

  // ====== 数据对象列 ======
  const objectColumns = [
    { key: 'name', title: '数据对象', dataIndex: 'name' as const, width: 130 },
    { key: 'content', title: '维护内容', dataIndex: 'content' as const, render: (r: DataObjectRow) => <span style={{ wordBreak:'break-all', fontSize: 12 }}>{r.content}</span> },
    { key: 'source', title: '数据来源', dataIndex: 'source' as const, width: 100, render: (r: DataObjectRow) => (
      <span style={{ fontSize: 11, color: r.source.includes('演示') || r.source.includes('示例') ? '#b8860b' : '#667085' }}>{r.source}</span>
    )},
    { key: 'version', title: '版本', dataIndex: 'version' as const, width: 90, render: (r: DataObjectRow) => <span style={{ fontSize: 11 }}>{r.version}</span> },
    { key: 'updatedAt', title: '更新时间', dataIndex: 'updatedAt' as const, width: 110, render: (r: DataObjectRow) => <span style={{ fontSize: 11 }}>{r.updatedAt}</span> },
    { key: 'modules', title: '使用模块', dataIndex: 'modules' as const, width: 130, render: (r: DataObjectRow) => <span style={{ fontSize: 11 }}>{r.modules}</span> },
    { key: 'productionReady', title: '可用于正式流程', dataIndex: 'productionReady' as const, width: 110, render: (r: DataObjectRow) => (
      <span style={{ fontSize: 11, fontWeight: 600, color: r.productionReady.startsWith('否') ? '#eb5757' : r.productionReady.startsWith('部分') ? '#b8860b' : '#1f8a4c' }}>{r.productionReady}</span>
    )},
    { key: 'action', title: '', width: 50, render: (r: DataObjectRow) => (
      <button onClick={() => setDetail({ title: r.name, rows: r.detailRows })}
        style={{ padding:'2px 10px', borderRadius:4, border:'1px solid #1f8a4c', background:'#fff', color:'#1f8a4c', cursor:'pointer', fontSize:11 }}>
        详情
      </button>
    )},
  ];

  // ====== 规则/模板列 ======
  const ruleColumns = [
    { key: 'name', title: '规则/模板', dataIndex: 'name' as const, width: 120 },
    { key: 'purpose', title: '用途', dataIndex: 'purpose' as const, width: 130 },
    { key: 'effectiveVersion', title: '当前生效版本', dataIndex: 'effectiveVersion' as const, width: 110, render: (r: RuleTemplateRow) => <span style={{ fontSize: 11 }}>{r.effectiveVersion}</span> },
    { key: 'modules', title: '适用模块', dataIndex: 'modules' as const, width: 100, render: (r: RuleTemplateRow) => <span style={{ fontSize: 11 }}>{r.modules}</span> },
    { key: 'usedInCurrentFlow', title: '当前流程是否使用', dataIndex: 'usedInCurrentFlow' as const, width: 110, render: (r: RuleTemplateRow) => (
      <span style={{ fontSize: 11, color: r.usedInCurrentFlow.startsWith('是') ? '#1f8a4c' : '#94a3b8' }}>{r.usedInCurrentFlow}</span>
    )},
    { key: 'changeImpact', title: '修改影响说明', dataIndex: 'changeImpact' as const, render: (r: RuleTemplateRow) => <span style={{ fontSize: 11, color: '#667085' }}>{r.changeImpact}</span> },
    { key: 'action', title: '', width: 50, render: (r: RuleTemplateRow) => (
      <button onClick={() => setDetail({ title: r.name, rows: [
        `用途：${r.purpose}`, `当前生效版本：${r.effectiveVersion}`, `适用模块：${r.modules}`,
        `当前流程是否使用：${r.usedInCurrentFlow}`, `修改影响说明：${r.changeImpact}`,
        '当前版本暂不支持在线编辑模板内容',
      ]})}
        style={{ padding:'2px 10px', borderRadius:4, border:'1px solid #1f8a4c', background:'#fff', color:'#1f8a4c', cursor:'pointer', fontSize:11 }}>
        详情
      </button>
    )},
  ];

  // ====== 导入流程点击 ======
  const handleImportStep = (i: number) => {
    setImportStep(i);
    if (i === 0) { fileRef.current?.click(); return; }
    if (i === 1 && !selectedFile) { alert('请先在步骤1中选择文件'); return; }
    // 诚实：步骤 2-4 均为前端预览，不伪造导入成功
    alert('当前版本仅支持前端选择文件与字段预览，真实导入/发布/回滚待后端实现。');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setSelectedFile(f.name); setImportStep(1); }
  };

  return (
    <PageContainer title="数据管理">
      {/* ====== 顶部提示横幅 ====== */}
      <div style={{
        background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6,
        padding: '8px 14px', marginBottom: 16, fontSize: 12, color: '#b8860b',
      }}>
        ⚠️ <strong>演示数据，不作为正式操作依据。</strong>当前页面所有数据均为 IEEE33 标准测试模型的内置示例数据，非实际生产电网数据。
      </div>

      {/* ====== 数据状态卡片 ====== */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {statusCards.map((item) => (
          <div key={item.label}
            style={{
              background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6,
              padding: '14px 20px', flex: 1, minWidth: 150,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <span style={{ fontSize: 12, color: '#667085' }}>{item.label}</span>
            <StatusBadge status={item.status} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.desc}</span>
            <span style={{ fontSize: 10, color: '#b0b8c1' }}>{item.note}</span>
          </div>
        ))}
      </div>

      {/* ====== 数据对象维护表 ====== */}
      <SectionCard title="数据对象维护" style={{ marginBottom: 20 }} extra={
        <span style={{ fontSize: 11, color: '#b8860b', background: '#fff8e1', padding: '2px 8px', borderRadius: 3, border: '1px solid #f2c94c' }}>
          ⚠ 演示数据，不作为正式操作依据
        </span>
      }>
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={objectColumns} data={dataObjects} rowKey={(r) => r.id} />
        </div>
      </SectionCard>

      {/* ====== 规则/模板维护表 ====== */}
      <SectionCard title="规则/模板维护" style={{ marginBottom: 20 }} extra={
        <span style={{ fontSize: 11, color: '#b8860b', background: '#fff8e1', padding: '2px 8px', borderRadius: 3, border: '1px solid #f2c94c' }}>
          ⚠ 演示数据，不作为正式操作依据
        </span>
      }>
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={ruleColumns} data={ruleTemplates} rowKey={(r) => r.id} />
        </div>
      </SectionCard>

      {/* ====== 数据导入流程 ====== */}
      <SectionCard title="数据导入流程" style={{ marginBottom: 20 }}>
        <div style={{
          background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 4,
          padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#2f80ed',
        }}>
          ℹ️ 当前版本仅支持前端选择文件与字段预览，真实导入/发布/回滚待后端实现。
        </div>
        <p style={{ fontSize: 12, color: '#667085', marginBottom: 14 }}>
          用于拓扑模型、设备台账、运行限值和规则模板的统一导入与版本管理。
        </p>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFileChange} />
        {selectedFile && (
          <div style={{ marginBottom: 12, padding: '8px 14px', background: '#e8f5e9', borderRadius: 4, fontSize: 12, color: '#1f8a4c' }}>
            已选择文件：<strong>{selectedFile}</strong>（仅前端读取文件名，未上传至后端）
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
          {importSteps.map((step, i) => (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}
              onClick={() => handleImportStep(i)}>
              <div style={{
                padding: '14px 20px', borderRadius: 6, textAlign: 'center', minWidth: 110, cursor: 'pointer',
                background: i < importStep ? '#e8f5e9' : i === importStep ? '#e3f0ff' : '#f3f6f9',
                border: `2px solid ${i < importStep ? '#1f8a4c' : i === importStep ? '#2f80ed' : '#c8d6e5'}`,
                transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: 18, fontWeight: 700,
                  color: i < importStep ? '#1f8a4c' : i === importStep ? '#2f80ed' : '#94a3b8',
                  marginBottom: 4 }}>
                  {i < importStep ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', marginBottom: 2 }}>{step.label}</div>
                <div style={{ fontSize: 11, color: '#667085' }}>{step.desc}</div>
              </div>
              {i < importSteps.length - 1 && (
                <div style={{ color: '#c8d6e5', fontSize: 18, padding: '0 4px', flexShrink: 0, cursor:'default' }}>→</div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ====== 底部说明 ====== */}
      <div style={{
        background: '#f3f6f9', border: '1px solid #c8d6e5', borderRadius: 6,
        padding: '10px 16px', fontSize: 12, color: '#667085',
      }}>
        <strong style={{ color: '#1f2937' }}>功能说明：</strong>
        当前版本为原型演示系统，所有数据均为 IEEE33 标准测试模型的内置示例数据。支持 Excel/CSV 文件选择（前端读取文件名），真实导入/校验/发布/回滚将在后续版本中实现。
        <span style={{ display: 'block', marginTop: 4, color: '#94a3b8' }}>数据来源：topologyData.ts（静态拓扑） + Simulink 实时推送（开关状态/负荷/电压） + 内置示例（限值/模板/规则）</span>
      </div>

      {/* ====== 详情弹窗 ====== */}
      {detail && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
          onClick={() => setDetail(null)}>
          <div style={{ background:'#fff', borderRadius:8, padding:24, width:480, maxHeight:'70vh', overflow:'auto', boxShadow:'0 4px 16px rgba(0,0,0,0.15)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize:15, fontWeight:600, marginBottom:16, color:'#1f2937', paddingBottom:10, borderBottom:'1px solid #e2e8f0' }}>
              {detail.title}
            </h3>
            {detail.rows.map((r, i) => (
              <div key={i} style={{ padding:'6px 0', fontSize:13, color: r.startsWith('⚠') ? '#b8860b' : '#1f2937', borderBottom:'1px solid #f3f6f9' }}>
                {r}
              </div>
            ))}
            <button onClick={() => setDetail(null)}
              style={{ marginTop:16, padding:'6px 20px', borderRadius:4, border:'1px solid #c8d6e5', background:'#f3f6f9', color:'#667085', cursor:'pointer', fontSize:13, width:'100%' }}>
              关闭
            </button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
