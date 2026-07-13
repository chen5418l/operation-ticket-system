/** 拓扑状态颜色 / 样式工具 */
import type { BusNode, BranchLine, TieSwitchData } from './topologyTypes';

export const COLORS = {
  bg: '#0a1622',
  gridLine: 'rgba(255,255,255,0.04)',
  busNormal: '#38d9ff',
  busNormalGlow: 'rgba(56,217,255,0.4)',
  busOutage: '#8a8a8a',
  busOutageGlow: 'rgba(138,138,138,0.2)',
  busFault: '#ff4757',
  busFaultGlow: 'rgba(255,71,87,0.6)',
  busRestored: '#2ed573',
  busRestoredGlow: 'rgba(46,213,115,0.5)',
  lineNormal: '#8ab4d6',
  lineFault: '#ff4757',
  lineFaultGlow: 'rgba(255,71,87,0.3)',
  lineHighlight: '#2ed573',
  lineOutage: '#4a5568',
  tieLine: '#ff4757',
  tieLineGlow: 'rgba(255,71,87,0.25)',
  tieActive: '#f1c40f',
  textPrimary: '#d0dce8',
  textDim: '#6b7d8e',
  textBright: '#e8f0f8',
  substation: '#38d9ff',
};

export function busColor(bus: BusNode, isOutage: boolean, isRestored: boolean) {
  if (isRestored) return COLORS.busRestored;
  if (isOutage) return COLORS.busOutage;
  if (bus.status === 'fault') return COLORS.busFault;
  return COLORS.busNormal;
}

export function busGlow(bus: BusNode, isOutage: boolean, isRestored: boolean) {
  if (isRestored) return COLORS.busRestoredGlow;
  if (isOutage) return COLORS.busOutageGlow;
  if (bus.status === 'fault') return COLORS.busFaultGlow;
  return COLORS.busNormalGlow;
}

export function lineColor(line: BranchLine, faultLineId: string | null, highlightPath: { from: string; to: string } | null) {
  if (line.id === faultLineId) return COLORS.lineFault;
  if (highlightPath && (line.from === highlightPath.from || line.to === highlightPath.to || line.from === highlightPath.to || line.to === highlightPath.from)) return COLORS.lineHighlight;
  if (line.status === 'fault') return COLORS.lineFault;
  if (line.switchStatus === 'open') return COLORS.lineOutage;
  return COLORS.lineNormal;
}

export function tieColor(_tie: TieSwitchData, isSelected: boolean) {
  return isSelected ? COLORS.tieActive : COLORS.tieLine;
}

export function statusLabel(s: string) {
  const m: Record<string, string> = { open: '分位', closed: '合位', fault: '故障', normal: '正常', warning: '预警', locked: '闭锁', outage: '失电', restored: '已恢复' };
  return m[s] || s;
}

export function typeLabel(t: string) {
  const m: Record<string, string> = { bus: '母线节点', breaker: '断路器', sectionSwitch: '分段开关', tieSwitch: '联络开关', main: '主馈线', branch: '分支线', tie: '联络线' };
  return m[t] || t;
}
