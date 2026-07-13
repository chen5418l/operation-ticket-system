import { useState, useRef } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';

// ============ 演示数据 ============
const dataObjects = [
  { id: '1', name: 'IEEE33节点数据', content: 'Bus1-Bus33节点基础信息：节点编号、负荷(p/q)、电压、所属馈线、坐标', status: '已加载', detailRows: ['节点总数：33','电源节点：Bus1','负荷节点：Bus2-Bus33','主馈线：Bus1-Bus18','分支1：Bus19-Bus22','分支2：Bus23-Bus25','分支3：Bus26-Bus33'] },
  { id: '2', name: '线路拓扑数据', content: '正常馈线和支路连接关系：L1-L32，含电阻、电抗、负载率', status: '已加载', detailRows: ['主馈线：L1-L17','分支线：L18-L32','断路器：L1出口','分段开关：L4/L7/L11','总线路数：32'] },
  { id: '3', name: '联络开关数据', content: 'T1-T5常开联络开关：转供容量、预计负载率、安全校验结果', status: '已加载', detailRows: ['T1: Bus8-21 (1.2MW)','T2: Bus9-15 (0.9MW) ★推荐','T3: Bus12-22 (0.8MW) ⚠预警','T4: Bus18-33 (0.6MW)','T5: Bus25-29 (0.5MW)'] },
  { id: '4', name: '运行限值数据', content: '电压上下限(0.90-1.10pu)、负载率上限(80%)、N-1裕度要求', status: '示例数据', detailRows: ['电压上限：1.10 pu','电压下限：0.90 pu','负载率预警：80%','负载率上限：100%','N-1裕度：≥20%'] },
  { id: '5', name: '操作票模板', content: '故障隔离、负荷转供、恢复供电操作模板，含标准操作步骤', status: '示例数据', detailRows: ['模板1：馈线故障隔离','模板2：联络开关转供恢复','模板3：运行方式调整','模板4：恢复供电操作','模板格式：步骤编号+操作内容+安全提示'] },
  { id: '6', name: '安全校验规则', content: '防误操作规则(五防)、越限校验规则、孤岛校验规则、操作顺序校验', status: '示例数据', detailRows: ['规则1：设备状态校验','规则2：倒闸顺序校验','规则3：拓扑关系校验','规则4：容量约束校验','规则5：N-1约束校验','规则6：FA策略校验','规则7：五防互锁校验','规则8：人工修改复校'] },
];

const ruleTemplates = [
  { id: '1', name: '故障隔离模板', purpose: '生成故障隔离操作序列', version: 'v1.0', status: '启用' },
  { id: '2', name: '转供恢复模板', purpose: '生成转供恢复操作序列', version: 'v1.0', status: '启用' },
  { id: '3', name: '安全校验规则', purpose: '校验操作票是否满足安全约束', version: 'v1.0', status: '启用' },
  { id: '4', name: 'IEEE33拓扑模板', purpose: '初始化标准测试系统数据', version: 'v1.0', status: '启用' },
];

const statusCards = [
  { label: '拓扑模型', status: '已导入', desc: '33节点/32线路/5联络开关' },
  { label: '设备台账', status: '已校验', desc: 'Bus1-Bus33参数完整' },
  { label: '运行限值', status: '已维护', desc: '电压/电流/容量约束' },
  { label: '开关状态', status: '实时同步', desc: 'MySQL数据实时读取' },
  { label: '规则模板', status: '版本有效', desc: '4套模板已加载' },
];

const importSteps = [
  { label: '选择文件', desc: '上传 Excel/CSV' },
  { label: '字段映射', desc: '匹配数据字段' },
  { label: '数据校验', desc: '完整性检查' },
  { label: '冲突处理', desc: '版本冲突解决' },
  { label: '版本发布', desc: '新版本生效' },
];

export default function DataManagement() {
  const [detail, setDetail] = useState<{ title: string; rows: string[] } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [importStep, setImportStep] = useState(-1);
  const fileRef = useRef<HTMLInputElement>(null);

  // ====== 数据对象列 ======
  const objectColumns = [
    { key: 'name', title: '数据对象', dataIndex: 'name' as const },
    { key: 'content', title: '维护内容', dataIndex: 'content' as const, render: (r: typeof dataObjects[0]) => <span style={{ wordBreak:'break-all' }}>{r.content}</span> },
    { key: 'status', title: '状态', dataIndex: 'status' as const, render: (r: typeof dataObjects[0]) => <StatusBadge status={r.status} /> },
    { key: 'action', title: '操作', width: 80, render: (r: typeof dataObjects[0]) => (
      <button onClick={() => setDetail({ title: r.name, rows: r.detailRows })}
        style={{ padding:'3px 12px', borderRadius:4, border:'1px solid #1f8a4c', background:'#fff', color:'#1f8a4c', cursor:'pointer', fontSize:12 }}>
        查看
      </button>
    )},
  ];

  // ====== 规则列 ======
  const ruleColumns = [
    { key: 'name', title: '规则/模板', dataIndex: 'name' as const },
    { key: 'purpose', title: '用途', dataIndex: 'purpose' as const },
    { key: 'version', title: '版本', dataIndex: 'version' as const },
    { key: 'status', title: '状态', dataIndex: 'status' as const, render: (r: typeof ruleTemplates[0]) => <StatusBadge status={r.status} /> },
    { key: 'action', title: '操作', width: 80, render: (r: typeof ruleTemplates[0]) => (
      <button onClick={() => setDetail({ title: r.name, rows: [`用途：${r.purpose}`, `版本：${r.version}`, `状态：${r.status}`, '当前版本暂不支持在线编辑模板内容'] })}
        style={{ padding:'3px 12px', borderRadius:4, border:'1px solid #1f8a4c', background:'#fff', color:'#1f8a4c', cursor:'pointer', fontSize:12 }}>
        查看
      </button>
    )},
  ];

  // ====== 导入流程点击 ======
  const handleImportStep = (i: number) => {
    setImportStep(i);
    if (i === 0) { fileRef.current?.click(); return; }
    if (i === 1 && !selectedFile) { alert('请先在步骤1中选择文件'); return; }
    if (i >= 3) { alert('当前版本暂未开放真实导入，后续支持 Excel/CSV 数据导入。'); return; }
    alert('当前版本暂未开放真实导入，后续支持 Excel/CSV 数据导入。');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setSelectedFile(f.name); setImportStep(1); }
  };

  return (
    <PageContainer title="数据管理">
      {/* 数据状态卡片 — 可点击 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {statusCards.map((item) => (
          <div key={item.label}
            onClick={() => alert(`${item.label}：${item.desc}\n\n功能开发中：该模块详情查看将在后续版本支持。`)}
            style={{
              background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6,
              padding: '14px 20px', flex: 1, minWidth: 140, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 8,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = '#1f8a4c'; (e.target as HTMLElement).style.boxShadow = '0 1px 4px rgba(31,138,76,0.15)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = '#c8d6e5'; (e.target as HTMLElement).style.boxShadow = 'none'; }}
          >
            <span style={{ fontSize: 12, color: '#667085' }}>{item.label}</span>
            <StatusBadge status={item.status} />
          </div>
        ))}
      </div>

      {/* 数据对象维护表 */}
      <SectionCard title="数据对象维护" style={{ marginBottom: 20 }} extra={
        <span style={{ fontSize: 11, color: '#f2c94c', background: '#fff8e1', padding: '2px 8px', borderRadius: 3 }}>演示数据</span>
      }>
        <DataTable columns={objectColumns} data={dataObjects} rowKey={(r) => r.id} />
      </SectionCard>

      {/* 规则/模板维护表 */}
      <SectionCard title="规则/模板维护" style={{ marginBottom: 20 }} extra={
        <span style={{ fontSize: 11, color: '#f2c94c', background: '#fff8e1', padding: '2px 8px', borderRadius: 3 }}>演示数据</span>
      }>
        <DataTable columns={ruleColumns} data={ruleTemplates} rowKey={(r) => r.id} />
      </SectionCard>

      {/* 数据导入流程 — 可点击 */}
      <SectionCard title="数据导入流程" style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: '#667085', marginBottom: 14 }}>
          用于拓扑模型、设备台账、运行限值和规则模板的统一导入与版本管理。
        </p>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFileChange} />
        {selectedFile && (
          <div style={{ marginBottom: 12, padding: '8px 14px', background: '#e8f5e9', borderRadius: 4, fontSize: 12, color: '#1f8a4c' }}>
            已选择文件：<strong>{selectedFile}</strong>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
          {importSteps.map((step, i) => (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}
              onClick={() => handleImportStep(i)}>
              <div style={{
                padding: '14px 20px', borderRadius: 6, textAlign: 'center', minWidth: 110, cursor: 'pointer',
                background: i < importStep ? '#e8f5e9' : i === importStep ? '#e3f0ff' : i < 3 ? '#f3f6f9' : '#fff8e1',
                border: `2px solid ${i < importStep ? '#1f8a4c' : i === importStep ? '#2f80ed' : i < 3 ? '#c8d6e5' : '#ffe082'}`,
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

      {/* 底部提示 */}
      <div style={{
        background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6,
        padding: '10px 16px', fontSize: 12, color: '#667085',
      }}>
        <strong style={{ color: '#1f2937' }}>功能说明：</strong>
        当前版本为原型演示系统，数据为演示数据。支持 Excel/CSV 文件选择（前端读取文件名），真实导入将在后续版本中实现。
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0,
          background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
          onClick={() => setDetail(null)}>
          <div style={{ background:'#fff', borderRadius:8, padding:24, width:460, boxShadow:'0 4px 16px rgba(0,0,0,0.15)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize:15, fontWeight:600, marginBottom:16, color:'#1f2937', paddingBottom:10, borderBottom:'1px solid #e2e8f0' }}>
              {detail.title}
            </h3>
            {detail.rows.map((r, i) => (
              <div key={i} style={{ padding:'6px 0', fontSize:13, color:'#1f2937', borderBottom:'1px solid #f3f6f9' }}>
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
