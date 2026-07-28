import { useState, useMemo, useCallback, useEffect } from 'react';
import { buses, lines, tieSwitches, faultScenarios, findBus, findLine, computeOutageBuses, computeRestoredBuses, computeOutageForNodeFault } from './topologyData';
import type { BusNode, BranchLine, TieSwitchData } from './topologyTypes';
import type { TieSwitchPath } from './topologyData';
import type { PredictResult } from '../../services/flaskApi';
import type { RealtimeLatest } from '../../services/apiClient';
import './IEEE33Topology.css';

const SVG_W = 1050, SVG_H = 600;

function sf(v: unknown, d = 2): string { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : '--'; }
function rcol(c?: string): string { if (c === 'yellow') return '#f1c40f'; if (c === 'red') return '#e74c3c'; return '#4dc9f6'; }

/** 根据实时数据的 risk_level / voltage_pu 计算节点颜色 */
function realtimeNodeColor(rn: { risk_level?: string; voltage_pu?: number } | undefined): string | null {
  if (!rn) return null;
  // 优先 risk_level
  if (rn.risk_level === 'low') return '#2ecc71';
  if (rn.risk_level === 'medium') return '#f1c40f';
  if (rn.risk_level === 'high') return '#e74c3c';
  // 无 risk_level 则按 voltage_pu
  if (rn.voltage_pu !== undefined) {
    if (rn.voltage_pu < 0.95 || rn.voltage_pu > 1.05) return '#e74c3c';
    if (rn.voltage_pu >= 0.95 && rn.voltage_pu < 0.97) return '#f1c40f';
    return '#2ecc71';
  }
  // 既无 risk_level 也无 voltage → 灰色 (unknown)
  return '#95a5a6';
}

export default function IEEE33Topology({ predictData, realtimeData }: { predictData?: PredictResult; realtimeData?: RealtimeLatest | null }) {
  // 核心状态：故障线路 + 故障节点 + 恢复节点
  const [faultLineIds, setFaultLineIds] = useState<Set<string>>(new Set());
  const [faultBusIds, setFaultBusIds] = useState<Set<string>>(new Set());
  const [restoredBusIds, setRestoredBusIds] = useState<Set<string>>(new Set());
  const [selTies, setSelTies] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<{ t: string; d: any; x: number; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // 保存故障线路到 localStorage 供后续页面使用
  useEffect(() => {
    if (faultLineIds.size > 0) {
      const fid = Array.from(faultLineIds)[0];
      const fl = findLine(fid);
      if (fl) {
        import('../../store/workflowStore').then(({ saveCurrentWorkflow }) => {
          saveCurrentWorkflow({ fault_line: `${fl.fromNum}-${fl.toNum}` });
        });
      }
    }
  }, [faultLineIds]);

  // ========== 失电计算：合并线路故障 + 节点故障 ==========
  const outageBusIds = useMemo(() => {
    if (faultLineIds.size === 0 && faultBusIds.size === 0) return new Set<string>();
    // 合并所有失电节点（取并集）
    const all = new Set<string>();
    if (faultLineIds.size > 0) {
      for (const id of computeOutageBuses(Array.from(faultLineIds))) all.add(id);
    }
    if (faultBusIds.size > 0) {
      for (const bid of faultBusIds) {
        for (const id of computeOutageForNodeFault(bid)) all.add(id);
      }
    }
    // 故障节点本身也标记为失电
    for (const bid of faultBusIds) all.add(bid);
    return all;
  }, [faultLineIds, faultBusIds]);

  // 实际失电 = BFS计算的失电 - 已恢复
  const actualOutage = useMemo(() => {
    const s = new Set(outageBusIds);
    for (const id of restoredBusIds) s.delete(id);
    return s;
  }, [outageBusIds, restoredBusIds]);

  // 可用联络开关：一端outage、一端正常
  const availableTies = useMemo(() => {
    if (faultLineIds.size === 0) return [];
    return tieSwitches.filter(tie => {
      const fromOut = outageBusIds.has(tie.fromBus);
      const toOut = outageBusIds.has(tie.toBus);
      return (fromOut && !toOut) || (!fromOut && toOut);
    });
  }, [faultLineIds, outageBusIds]);

  // ========== 操作 ==========
  const toggleFault = useCallback((lineId: string) => {
    setFaultLineIds(prev => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
      return next;
    });
    setRestoredBusIds(new Set()); setSelTies(new Set()); setDetail(null);
  }, []);

  const toggleFaultBus = useCallback((busId: string) => {
    setFaultBusIds(prev => {
      const next = new Set(prev);
      if (next.has(busId)) next.delete(busId); else next.add(busId);
      return next;
    });
    setRestoredBusIds(new Set()); setSelTies(new Set()); setDetail(null);
  }, []);

  const applyTransfer = useCallback((tie: TieSwitchData) => {
    if (faultLineIds.size === 0 && faultBusIds.size === 0) return;
    const next = new Set(selTies);
    if (next.has(tie.id)) next.delete(tie.id); else next.add(tie.id);
    setSelTies(next);
    if (next.size > 0) {
      const active = faultLineIds.size > 0 ? Array.from(faultLineIds) : ['__none__'];
      const tiePairs = Array.from(next).map(tid => { const tt = tieSwitches.find(x => x.id === tid)!; return { from: tt.fromBus, to: tt.toBus }; });
      const { restored } = computeRestoredBuses(active, tiePairs);
      setRestoredBusIds(restored);
    } else { setRestoredBusIds(new Set()); }
    setDetail(null);
  }, [faultLineIds, faultBusIds, selTies]);

  const clearAll = useCallback(() => {
    setFaultLineIds(new Set()); setFaultBusIds(new Set());
    setRestoredBusIds(new Set()); setSelTies(new Set()); setDetail(null);
  }, []);

  const doPreset = useCallback((scenarioId: string) => {
    const sc = faultScenarios.find(s => s.id === scenarioId);
    if (sc) { setFaultLineIds(new Set([sc.lineId])); setFaultBusIds(new Set()); setRestoredBusIds(new Set()); setSelTies(new Set()); setDetail(null); }
  }, []);

  const doDemo = useCallback(() => {
    setFaultLineIds(new Set(['L8'])); setFaultBusIds(new Set());
    setRestoredBusIds(new Set()); setSelTies(new Set());
    setTimeout(() => {
      const t2 = tieSwitches.find(t => t.id === 'T2');
      if (t2) { setSelTies(new Set(['T2'])); const { restored } = computeRestoredBuses(['L8'], [{from: t2.fromBus, to: t2.toBus}]); setRestoredBusIds(restored); }
    }, 500);
  }, []);

  const showPanel = useCallback((t: string, d: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setDetail({ t, d, x: e.clientX, y: e.clientY });
  }, []);

  // ========== 颜色 ==========
  function busFill(bus: BusNode): string {
    // 1) 交互故障状态（最高优先级）
    if (faultBusIds.has(bus.id)) return '#e74c3c';
    if (faultLineIds.size > 0) {
      const isFaultEndpoint = Array.from(faultLineIds).some(fid => { const l = findLine(fid); return l && (l.from === bus.id || l.to === bus.id); });
      if (isFaultEndpoint) return '#e74c3c';
    }
    if (restoredBusIds.has(bus.id)) return '#2ecc71';
    if (actualOutage.has(bus.id)) return '#555';

    // 2) 实时数据着色（无故障时生效）
    if (realtimeData?.nodes) {
      const rn = realtimeData.nodes.find(n => n.node === bus.num);
      const rc = realtimeNodeColor(rn);
      if (rc) return rc;
    }

    // 3) 预测数据（原有行为）
    if (predictData?.nodes) { const pn = predictData.nodes.find(n => n.Bus === bus.num); if (pn) return rcol(pn.risk_color); }

    // 4) 默认正常色
    return '#4dc9f6';
  }

  function busGlowColor(bus: BusNode): string {
    if (faultBusIds.has(bus.id)) return 'rgba(231,76,60,0.6)';
    if (faultLineIds.size > 0) {
      const isFaultEndpoint = Array.from(faultLineIds).some(fid => {
        const l = findLine(fid);
        return l && (l.from === bus.id || l.to === bus.id);
      });
      if (isFaultEndpoint) return 'rgba(231,76,60,0.6)';
    }
    if (restoredBusIds.has(bus.id)) return 'rgba(46,204,113,0.5)';
    if (actualOutage.has(bus.id)) return 'rgba(138,138,138,0.2)';

    // 实时数据光晕
    if (realtimeData?.nodes && faultLineIds.size === 0 && faultBusIds.size === 0) {
      const rn = realtimeData.nodes.find(n => n.node === bus.num);
      if (rn?.risk_level === 'high') return 'rgba(231,76,60,0.35)';
      if (rn?.risk_level === 'medium') return 'rgba(241,196,15,0.35)';
      if (rn?.risk_level === 'low') return 'rgba(46,204,113,0.3)';
    }

    return 'rgba(56,217,255,0.4)';
  }

  function lineFill(line: BranchLine): string {
    if (faultLineIds.has(line.id)) return '#e74c3c';
    if (selTies.size > 0) {
      const t = tieSwitches.find(x => x.id === Array.from(selTies)[0]);
      if (t && (line.from === t.fromBus || line.to === t.toBus || line.from === t.toBus || line.to === t.fromBus)) return '#2ecc71';
    }
    return '#8ab4d6';
  }

  // ========== 渲染 ==========
  return (
    <div style={{ position: 'relative' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 14px', background: '#f3f6f9', borderRadius: 6, border: '1px solid #c8d6e5', fontSize: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 11 }}>故障场景:</span>
        {faultScenarios.map(s => (
          <button key={s.id}
            onClick={() => doPreset(s.id)}
            style={{
              padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
              background: faultLineIds.has(s.lineId) && faultLineIds.size === 1 ? '#e74c3c' : '#fff',
              color: faultLineIds.has(s.lineId) && faultLineIds.size === 1 ? '#fff' : '#1f2937',
              border: `1px solid ${faultLineIds.has(s.lineId) && faultLineIds.size === 1 ? '#e74c3c' : '#c8d6e5'}`,
              fontWeight: faultLineIds.has(s.lineId) && faultLineIds.size === 1 ? 600 : 400,
            }}>{s.label}</button>
        ))}
        <span style={{ color: '#c8d6e5' }}>|</span>
        <span style={{ fontSize: 10, color: '#667085' }}>
          💡 直接点击拓扑图中<strong>线路</strong>即可设置/取消故障
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={doDemo}
          style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>▶ 开始演示</button>
        <span style={{ fontSize: 9, color: '#b8860b', background: '#fff8e1', padding: '2px 6px', borderRadius: 3, border: '1px solid #ffe082', whiteSpace: 'nowrap' }}>演示流程，不生成正式操作票</span>
        <button onClick={clearAll}
          style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' }}>清除重置</button>
      </div>

      {/* 故障状态行 */}
      {(faultLineIds.size > 0 || faultBusIds.size > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 10px', background: '#ffebee', borderRadius: 4, marginBottom: 10, fontSize: 11 }}>
          <span style={{ fontWeight: 600, color: '#e74c3c' }}>
            故障 ({faultLineIds.size + faultBusIds.size}):
          </span>
          {faultLineIds.size > 0 && <span style={{ color: '#e74c3c', fontSize: 10 }}>线路:</span>}
          {Array.from(faultLineIds).map(fid => {
            const l = findLine(fid);
            return <span key={fid} style={{fontSize:11,color:'#e74c3c',fontWeight:600,background:'#fff',padding:'2px 8px',borderRadius:3,border:'1px solid #ffcdd2'}}>{l?.name||fid} Bus{l?.fromNum}-{l?.toNum}</span>;
          })}
          {faultBusIds.size > 0 && <span style={{ color: '#e74c3c', fontSize: 10 }}>节点:</span>}
          {Array.from(faultBusIds).map(bid => {
            const b = findBus(bid);
            return <span key={bid} style={{fontSize:11,color:'#e74c3c',fontWeight:600,background:'#fff',padding:'2px 8px',borderRadius:3,border:'1px solid #ffcdd2'}}>{b?.label||bid}</span>;
          })}
          <span style={{ color: '#667085', marginLeft: 4 }}>失电: {actualOutage.size} 节点</span>
          {restoredBusIds.size > 0 && <span style={{ color: '#2ecc71', fontWeight: 600 }}>已恢复: {restoredBusIds.size} 节点</span>}
        </div>
      )}
      {!faultLineIds.size && !faultBusIds.size && (
        <div style={{ marginBottom: 10, padding: '6px 10px', background: '#e8f5e9', borderRadius: 4, fontSize: 11, color: '#1f8a4c' }}>
          💡 点击线路设置线路故障 | 点击节点设置节点故障 | 右键节点查看详情
        </div>
      )}

      {/* SVG */}
      <div className="ieee33-container" onClick={() => setDetail(null)}>
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
          {Array.from({ length: 14 }, (_, i) => <line key={`gv${i}`} x1={i * 78} y1={0} x2={i * 78} y2={SVG_H} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />)}
          {Array.from({ length: 9 }, (_, i) => <line key={`gh${i}`} x1={0} y1={i * 68} x2={SVG_W} y2={i * 68} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />)}
          <text x={SVG_W / 2} y={22} textAnchor="middle" fill="#6b7d8e" fontSize={12} fontWeight={600}>IEEE 33 节点标准配电网单线图</text>
          <text x={500} y={228} textAnchor="middle" fill="#6b7d8e" fontSize={9} opacity={0.4}>主馈线 Bus1 → Bus18</text>
          <text x={114} y={545} textAnchor="middle" fill="#6b7d8e" fontSize={9} opacity={0.5}>分支1</text>
          <text x={168} y={495} textAnchor="middle" fill="#6b7d8e" fontSize={9} opacity={0.5}>分支2</text>
          <text x={510} y={392} textAnchor="middle" fill="#6b7d8e" fontSize={9} opacity={0.5}>分支3 Bus26 → Bus33</text>

          {/* ===== 渲染线路 ===== */}
          {lines.map(l => {
            const fb = findBus(l.from), tb = findBus(l.to);
            if (!fb || !tb) return null;
            const isFault = faultLineIds.has(l.id);
            const c = lineFill(l);
            const sw = l.lineType === 'main' ? 3 : 2;
            const effW = isFault ? sw + 3 : sw;
            return (
              <g key={l.id} style={{ cursor: l.lineType !== 'tie' ? 'pointer' : 'default' }}>
                {/* 不透明宽点击区 */}
                {l.lineType !== 'tie' && (
                  <line x1={fb.x} y1={fb.y} x2={tb.x} y2={tb.y}
                    stroke="transparent" strokeWidth={18}
                    onClick={e => { e.stopPropagation(); toggleFault(l.id); }} />
                )}
                {/* 高亮光晕 */}
                {isFault && <line x1={fb.x} y1={fb.y} x2={tb.x} y2={tb.y} stroke="rgba(231,76,60,0.4)" strokeWidth={effW + 8} />}
                {/* 线路本体 */}
                <line x1={fb.x} y1={fb.y} x2={tb.x} y2={tb.y} stroke={c} strokeWidth={effW}
                  style={{ transition: 'all 0.2s' }}
                  onClick={e => {
                    if (l.lineType !== 'tie') { e.stopPropagation(); toggleFault(l.id); }
                  }} />
                {/* 开关标记 */}
                {l.switchType === 'breaker' && <rect x={fb.x - 6} y={fb.y - 6} width={12} height={12} rx={2} fill="#0a1622" stroke={c} strokeWidth={2} />}
                {l.switchType === 'sectionSwitch' && <circle cx={(fb.x + tb.x) / 2} cy={(fb.y + tb.y) / 2} r={5} fill="#0a1622" stroke={c} strokeWidth={2} />}
              </g>
            );
          })}

          {/* ===== 渲染联络开关(折线) ===== */}
          {(tieSwitches as TieSwitchPath[]).map(tie => {
            const isSel = selTies.has(tie.id);
            const isAvail = availableTies.some(t => t.id === tie.id);
            const c = isSel ? '#f1c40f' : isAvail ? '#2ecc71' : '#ffffff';
            const pts = tie.polyline.split(' ').map(p => p.split(',').map(Number));
            const m = pts[Math.floor(pts.length / 2)];
            return (
              <g key={'tie-' + tie.id} style={{ cursor: isAvail ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoverId('tie-' + tie.id)} onMouseLeave={() => setHoverId(null)}>
                {isSel && <polyline points={tie.polyline} fill="none" stroke="rgba(241,196,15,0.4)" strokeWidth={8} />}
                <polyline points={tie.polyline} fill="none" stroke={c}
                  strokeWidth={isSel ? 3.5 : isAvail ? 2.8 : 2.2}
                  strokeDasharray="7,4"
                  onClick={e => { e.stopPropagation(); if (isAvail) applyTransfer(tie); else showPanel('tie', tie, e); }} />
                <polyline points={tie.polyline} fill="none" stroke="transparent" strokeWidth={20}
                  onClick={e => { e.stopPropagation(); if (isAvail) applyTransfer(tie); else showPanel('tie', tie, e); }} />
                <rect x={m[0] - 40} y={m[1] - 12} width={80} height={24} rx={4}
                  fill={isSel ? '#f1c40f' : isAvail ? '#2ecc71' : '#0a1622'}
                  stroke={c} strokeWidth={1} opacity={0.95} />
                <text x={m[0]} y={m[1] + 3} textAnchor="middle"
                  fill={isSel ? '#000' : isAvail ? '#fff' : c} fontSize={11} fontWeight={700}>
                  {tie.name} {isAvail ? '可用' : ''}
                </text>
              </g>
            );
          })}

          {/* ===== 渲染节点 ===== */}
          {buses.map(bus => {
            const r = bus.num === 1 ? 8 : 5;
            const isH = hoverId === bus.id;
            const fill = busFill(bus);
            const glow = busGlowColor(bus);
            const isOutage = actualOutage.has(bus.id);
            const isRestored = restoredBusIds.has(bus.id);
            const isFault = faultLineIds.size > 0 && Array.from(faultLineIds).some(fid => {
              const l = findLine(fid); return l && (l.from === bus.id || l.to === bus.id);
            });
            return (
              <g key={bus.id} className="ieee33-node" style={{ cursor: 'pointer' }}
                onClick={e => { e.stopPropagation(); toggleFaultBus(bus.id); }}
                onContextMenu={e => { e.preventDefault(); showPanel('bus', bus, e); }}
                onMouseEnter={() => setHoverId(bus.id)} onMouseLeave={() => setHoverId(null)}>
                {(isOutage || isFault) && <circle cx={bus.x} cy={bus.y} r={r + 14} fill={glow} />}
                {isRestored && <circle cx={bus.x} cy={bus.y} r={r + 10} fill={glow} />}
                <rect x={bus.x - r} y={bus.y - r} width={r * 2} height={r * 2} rx={2} fill={fill}
                  stroke={isH ? '#fff' : fill} strokeWidth={isH ? 2.5 : 1.5}
                  style={{ transition: 'fill 0.2s' }} />
                <text x={bus.x} y={bus.y - r - 5} textAnchor="middle"
                  fill={isOutage ? '#666' : '#e8f0f8'} fontSize={bus.num <= 18 ? 10 : 9}
                  fontWeight={bus.num === 1 ? 700 : 500}>{bus.num}</text>
                {/* 预测净P */}
                {predictData?.nodes && (() => { const pn = predictData.nodes.find(n => n.Bus === bus.num); if (!pn) return null; return <text x={bus.x} y={bus.y + r + 10} textAnchor="middle" fill={rcol(pn.risk_color)} fontSize={7} fontWeight={600}>净P:{sf(pn.P_Net_kW,0)}kW</text>; })()}
                {bus.num === 1 && (
                  <g>
                    <rect x={bus.x - 22} y={bus.y - 26} width={44} height={16} rx={3} fill="#1a3a2a" stroke="#4dc9f6" strokeWidth={1.5} />
                    <text x={bus.x} y={bus.y - 15} textAnchor="middle" fill="#4dc9f6" fontSize={10} fontWeight={700}>电源</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* N-FAULT 标记 */}
          {Array.from(faultBusIds).map(bid => {
            const b = findBus(bid); if (!b) return null;
            return <g key={'nf-'+bid}><rect x={b.x-26} y={b.y-30} width={52} height={18} rx={3} fill="#e74c3c"/><text x={b.x} y={b.y-17} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>N-FAULT</text></g>;
          })}

          {/* FAULT 标记 */}
          {Array.from(faultLineIds).map(fid => {
            const fl = findLine(fid); if (!fl) return null;
            const fb = findBus(fl.from), tb = findBus(fl.to);
            if (!fb || !tb) return null;
            const mx = (fb.x + tb.x) / 2, my = (fb.y + tb.y) / 2;
            return (
              <g key={'ft-' + fid}>
                <rect x={mx - 22} y={my - 28} width={44} height={18} rx={3} fill="#e74c3c" />
                <text x={mx} y={my - 16} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>FAULT</text>
              </g>
            );
          })}

          {/* 状态文字 */}
          {faultLineIds.size > 0 && restoredBusIds.size === 0 && (
            <text x={SVG_W - 20} y={SVG_H - 8} textAnchor="end" fill="#ff4757" fontSize={12} fontWeight={600}>
              失电: {actualOutage.size} 节点
            </text>
          )}
          {restoredBusIds.size > 0 && (
            <text x={SVG_W - 20} y={SVG_H - 8} textAnchor="end" fill="#2ed573" fontSize={12} fontWeight={600}>
              已恢复: {restoredBusIds.size} 节点 | {selTies.size > 0 ? Array.from(selTies).map(tid => tieSwitches.find(t => t.id === tid)?.name).join(' + ') : ''}
            </text>
          )}

          {/* 图例 */}
          <g transform={`translate(${SVG_W - 210}, ${SVG_H - 85})`}>
            <rect x={0} y={0} width={200} height={75} rx={4} fill="rgba(0,0,0,0.7)" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
            <rect x={12} y={14} width={10} height={10} rx={1} fill="#4dc9f6" /><text x={28} y={23} fill="#8a9bb5" fontSize={9}>正常节点</text>
            <rect x={82} y={14} width={10} height={10} rx={1} fill="#555" /><text x={98} y={23} fill="#8a9bb5" fontSize={9}>失电节点</text>
            <rect x={152} y={14} width={10} height={10} rx={1} fill="#2ecc71" /><text x={168} y={23} fill="#8a9bb5" fontSize={9}>已恢复</text>
            <line x1={12} y1={44} x2={32} y2={44} stroke="#e74c3c" strokeWidth={2} strokeDasharray="5,3" /><text x={38} y={48} fill="#8a9bb5" fontSize={9}>联络开关</text>
            <line x1={120} y1={44} x2={140} y2={44} stroke="#ff9800" strokeWidth={2} strokeDasharray="5,3" /><text x={146} y={48} fill="#8a9bb5" fontSize={9}>可用</text>
            <line x1={12} y1={60} x2={32} y2={60} stroke="#8ab4d6" strokeWidth={2.5} /><text x={38} y={64} fill="#8a9bb5" fontSize={9}>正常馈线</text>
          </g>
        </svg>
      </div>

      {/* 转供方案面板 */}
      {faultLineIds.size > 0 && availableTies.length > 0 && (
        <div style={{ marginTop: 10, padding: '12px 16px', background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5' }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#1f2937', marginBottom: 8 }}>
            💡 可用转供联络开关 ({availableTies.length}):
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {availableTies.map(t => (
              <button key={t.id}
                onClick={() => applyTransfer(t)}
                style={{
                  padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  background: selTies.has(t.id) ? '#2ecc71' : '#f3f6f9',
                  color: selTies.has(t.id) ? '#fff' : '#1f2937',
                  border: `1px solid ${selTies.has(t.id) ? '#2ecc71' : '#c8d6e5'}`,
                  fontWeight: selTies.has(t.id) ? 700 : 400,
                }}>
                {selTies.has(t.id) ? '✅ ' : ''}{t.name} | 容量:{t.transferCapacityMw}MW
              </button>
            ))}
          </div>
          {restoredBusIds.size > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#2ecc71', fontWeight: 600 }}>
              ✅ 采用 {selTies.size > 0 ? Array.from(selTies).map(tid => tieSwitches.find(t => t.id === tid)?.name).join(" + ") : "--"} — 恢复 {restoredBusIds.size} 个节点
            </div>
          )}
        </div>
      )}

      {/* 详情浮动面板 */}
      {detail && <DetailPanel {...detail} onClose={() => setDetail(null)}
        faultLineIds={faultLineIds} onToggleFault={toggleFault} />}
    </div>
  );
}

// ===== 详情面板 =====
function DetailPanel(p: {
  t: string; d: any; x: number; y: number; onClose: () => void;
  faultLineIds: Set<string>; onToggleFault: (lid: string) => void;
}) {
  const s: React.CSSProperties = {
    position: 'fixed', left: Math.min(p.x, window.innerWidth - 320), top: Math.min(p.y, window.innerHeight - 440),
    width: 300, background: '#fff', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
    padding: 16, zIndex: 1000, border: '1px solid #c8d6e5', maxHeight: 420, overflowY: 'auto',
  };
  const btn: React.CSSProperties = { width: '100%', marginTop: 8, padding: '7px 0', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: 'none' };
  const h4: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #e2e8f0', color: '#1f2937' };

  if (p.t === 'bus') {
    const b = p.d as BusNode;
    const isOutage = p.faultLineIds.size > 0 && Array.from(p.faultLineIds).some(fid => { const l = findLine(fid); return l && (l.from === b.id || l.to === b.id); });
    return (
      <div style={s}>
        <h4 style={h4}>🔵 节点 {b.label}</h4>
        <R l="编号" v={b.num} /><R l="馈线" v={b.feeder} />
        <R l="有功负荷" v={`${b.loadMw.toFixed(2)} MW`} />
        <R l="无功负荷" v={`${b.loadKvar.toFixed(2)} kVar`} />
        <R l="电压" v={`${b.voltagePu.toFixed(3)} pu`} c={b.voltagePu < 0.93 ? '#e74c3c' : '#2ecc71'} />
        <R l="状态" v={isOutage ? '⚠ 故障端点' : '正常'} c={isOutage ? '#e74c3c' : '#2ecc71'} />
        <button style={{ ...btn, background: '#f3f6f9', color: '#667085', border: '1px solid #c8d6e5' }} onClick={p.onClose}>关闭</button>
      </div>
    );
  }

  if (p.t === 'line') {
    const l = p.d as BranchLine;
    const isFault = p.faultLineIds.has(l.id);
    return (
      <div style={s}>
        <h4 style={h4}>📏 线路 {l.name}</h4>
        <R l="类型" v={l.lineType === 'main' ? '主馈线' : '分支线'} />
        <R l="连接" v={`Bus${l.fromNum} → Bus${l.toNum}`} />
        <R l="R/X" v={`${l.resistance}/${l.reactance} Ω`} />
        <R l="负载率" v={`${l.loadRate}%`} c={l.loadRate > 40 ? '#f1c40f' : '#2ecc71'} />
        <R l="开关" v={l.switchType === 'breaker' ? '断路器' : l.switchType === 'sectionSwitch' ? '分段开关' : '无'} />
        <R l="当前状态" v={isFault ? '🔴 故障' : '🟢 正常'} c={isFault ? '#e74c3c' : '#2ecc71'} />
        {l.lineType !== 'tie' && (
          <button style={{ ...btn, background: isFault ? '#2ecc71' : '#e74c3c', color: '#fff' }}
            onClick={() => { p.onToggleFault(l.id); p.onClose(); }}>
            {isFault ? '✅ 清除故障' : '⚡ 设为故障'}
          </button>
        )}
        <button style={{ ...btn, background: '#f3f6f9', color: '#667085', border: '1px solid #c8d6e5', marginTop: 4 }} onClick={p.onClose}>关闭</button>
      </div>
    );
  }

  if (p.t === 'tie') {
    const t = p.d as TieSwitchData;
    return (
      <div style={s}>
        <h4 style={h4}>🔗 {t.name}</h4>
        <R l="连接" v={`${findBus(t.fromBus)?.label} ↔ ${findBus(t.toBus)?.label}`} />
        <R l="状态" v="常开" c="#f1c40f" />
        <R l="容量" v={`${t.transferCapacityMw} MW`} />
        <R l="负载率" v={`${(t.estimatedLoadRate * 100).toFixed(0)}%`} />
        <R l="最低电压" v={`${t.minVoltagePu.toFixed(3)} pu`} />
        <R l="校验" v={t.safetyCheck.result === 'pass' ? '✅ 通过' : t.safetyCheck.result === 'warn' ? '⚠ 警告' : '🚫 阻断'} />
        <button style={{ ...btn, background: '#f3f6f9', color: '#667085', border: '1px solid #c8d6e5' }} onClick={p.onClose}>关闭</button>
      </div>
    );
  }

  return null;
}

function R({ l, v, c }: { l: string; v: string | number; c?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f3f6f9', fontSize: 12 }}>
      <span style={{ color: '#667085' }}>{l}</span>
      <span style={{ color: c || '#1f2937', fontWeight: c ? 600 : 400, textAlign: 'right', maxWidth: 160, wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
