/**
 * IEEE33 标准配电网 — 拓扑数据（固定坐标布局，参考标准 IEEE33 图）
 *
 * 布局:
 *   主馈线 Bus1-18: 横向排列 y=240, x 间距≈54
 *   分支1 Bus19-22: Bus2 向下 y=340,400,460,520
 *   分支2 Bus23-25: Bus3 向下 y=330,400,470
 *   分支3 Bus26-33: Bus6 向右 y=400, x 间距≈54
 *   联络开关: 折线 routing，避免长斜线穿插
 */

import type { BusNode, BranchLine, TieSwitchData, FaultScenario } from './topologyTypes';

// ==================== 节点坐标 (SVG viewBox="0 0 1050 580") ====================
const MF = (i: number) => ({ x: 60 + (i - 1) * 54, y: 240 });

// 关键节点 x 坐标（避免在 COORDS 初始化中自引用）
const B2_X = MF(2).x;  // 114
const B3_X = MF(3).x;  // 168
const B6_X = MF(6).x;  // 330
const B7_X = MF(7).x;  // 384
const B8_X = MF(8).x;  // 438
const B9_X = MF(9).x;  // 492
const B10_X = MF(10).x; // 546
const B11_X = MF(11).x; // 600
const B12_X = MF(12).x; // 654
const B13_X = MF(13).x; // 708
const B15_X = MF(15).x; // 816
const B18_X = MF(18).x; // 978
const B21_X = B2_X;     // 114
const B22_X = B2_X;     // 114
const B25_X = B3_X;     // 168
const B29_X = B9_X;     // 492
const B33_X = B13_X;    // 708

const COORDS: Record<number, { x: number; y: number }> = {
  1:MF(1),2:MF(2),3:MF(3),4:MF(4),5:MF(5),6:MF(6),7:MF(7),8:MF(8),9:MF(9),
  10:MF(10),11:MF(11),12:MF(12),13:MF(13),14:MF(14),15:MF(15),16:MF(16),17:MF(17),18:MF(18),
  19:{x:B2_X,y:340},20:{x:B2_X,y:400},21:{x:B2_X,y:460},22:{x:B2_X,y:520},
  23:{x:B3_X,y:330},24:{x:B3_X,y:400},25:{x:B3_X,y:470},
  26:{x:B6_X,y:400},27:{x:B7_X,y:400},28:{x:B8_X,y:400},
  29:{x:B9_X,y:400},30:{x:B10_X,y:400},31:{x:B11_X,y:400},
  32:{x:B12_X,y:400},33:{x:B13_X,y:400},
};

/** 节点负荷 (kW, kvar) */
const LOADS: Record<number, [number, number]> = {
  1:[0,0],2:[100,60],3:[90,40],4:[120,80],5:[60,30],6:[60,20],7:[200,100],8:[200,100],
  9:[60,20],10:[60,20],11:[45,30],12:[60,35],13:[60,35],14:[120,80],15:[60,10],
  16:[60,20],17:[60,20],18:[90,40],19:[90,40],20:[90,40],21:[90,40],22:[90,40],
  23:[90,50],24:[420,200],25:[60,25],26:[60,25],27:[60,20],28:[60,20],29:[120,70],
  30:[200,600],31:[150,70],32:[210,100],33:[60,40],
};
const VOLTAGES: Record<number, number> = {
  1:1.0,2:0.997,3:0.983,4:0.976,5:0.968,6:0.950,7:0.946,8:0.941,9:0.936,
  10:0.930,11:0.928,12:0.927,13:0.922,14:0.916,15:0.910,16:0.908,17:0.907,
  18:0.904,19:0.997,20:0.993,21:0.992,22:0.992,23:0.980,24:0.974,25:0.972,
  26:0.948,27:0.946,28:0.944,29:0.940,30:0.934,31:0.931,32:0.928,33:0.925,
};

// ==================== 生成节点列表 ====================
export const buses: BusNode[] = [];
function fmt(n: number) { return `BUS-${String(n).padStart(2, '0')}`; }
function busName(n: number): string {
  if (n === 1) return '电源节点'; if (n === 18) return '主馈线末端'; if (n === 33) return '馈线末端';
  return `负荷节点${n}`;
}
for (let i = 1; i <= 33; i++) {
  const c = COORDS[i] || { x: 0, y: 0 };
  const [mw, kvar] = LOADS[i] || [0, 0];
  let feeder: BusNode['feeder'] = '主馈线';
  if (i >= 19 && i <= 22) feeder = '分支1';
  else if (i >= 23 && i <= 25) feeder = '分支2';
  else if (i >= 26 && i <= 33) feeder = '分支3';
  let parent: string | undefined, children: string[] = [];
  if (i >= 2 && i <= 17) { parent = fmt(i - 1); children = [fmt(i + 1)]; }
  else if (i === 18) { parent = fmt(17); }
  else if (i === 19) { parent = fmt(2); children = [fmt(20)]; }
  else if (i === 20) { parent = fmt(19); children = [fmt(21)]; }
  else if (i === 21) { parent = fmt(20); children = [fmt(22)]; }
  else if (i === 22) { parent = fmt(21); }
  else if (i === 23) { parent = fmt(3); children = [fmt(24)]; }
  else if (i === 24) { parent = fmt(23); children = [fmt(25)]; }
  else if (i === 25) { parent = fmt(24); }
  else if (i === 26) { parent = fmt(6); children = [fmt(27)]; }
  else if (i >= 27 && i <= 32) { parent = fmt(i - 1); children = [fmt(i + 1)]; }
  else if (i === 33) { parent = fmt(32); }
  buses.push({ id: fmt(i), num: i, label: `Bus ${i}`, name: busName(i), x: c.x, y: c.y,
    loadMw: mw / 1000, loadKvar: kvar / 1000, voltagePu: VOLTAGES[i] || 0.95,
    status: 'normal', feeder, parent, children });
}

// ==================== 线路 ====================
function br(id: string, f: number, t: number, lt: 'main'|'branch', r: number, x: number, lr: number, sw?: string): BranchLine {
  return { id, from: fmt(f), to: fmt(t), fromNum: f, toNum: t, name: id, lineType: lt, resistance: r, reactance: x,
    loadRate: lr, status: 'normal', switchType: (sw as any) || 'none', switchStatus: 'closed' };
}
export const lines: BranchLine[] = [
  br('L1',1,2,'main',0.092,0.047,38,'breaker'),br('L2',2,3,'main',0.493,0.251,42),br('L3',3,4,'main',0.366,0.186,35),
  br('L4',4,5,'main',0.381,0.194,51,'sectionSwitch'),br('L5',5,6,'main',0.819,0.707,28),br('L6',6,7,'main',0.187,0.619,44),
  br('L7',7,8,'main',0.711,0.235,39,'sectionSwitch'),br('L8',8,9,'main',0.744,0.550,46),br('L9',9,10,'main',0.104,0.074,32),
  br('L10',10,11,'main',0.196,0.150,25),br('L11',11,12,'main',0.374,0.124,30,'sectionSwitch'),
  br('L12',12,13,'main',1.468,1.155,27),br('L13',13,14,'main',0.542,0.713,33),br('L14',14,15,'main',0.591,0.526,41),
  br('L15',15,16,'main',0.746,0.545,36),br('L16',16,17,'main',1.289,1.721,22),br('L17',17,18,'main',0.732,0.574,18),
  br('L18',2,19,'branch',0.164,0.157,31),br('L19',19,20,'branch',1.504,1.355,20),br('L20',20,21,'branch',0.410,0.478,15),
  br('L21',21,22,'branch',0.709,0.937,12),br('L22',3,23,'branch',0.451,0.308,24),br('L23',23,24,'branch',0.898,0.709,18),
  br('L24',24,25,'branch',0.896,0.701,16),br('L25',6,26,'branch',0.203,0.103,29),br('L26',26,27,'branch',0.284,0.145,26),
  br('L27',27,28,'branch',1.059,0.934,22),br('L28',28,29,'branch',0.804,0.701,19),br('L29',29,30,'branch',0.508,0.259,14),
  br('L30',30,31,'branch',0.974,0.963,17),br('L31',31,32,'branch',0.310,0.362,11),br('L32',32,33,'branch',0.341,0.530,8),
];

// ==================== 联络开关（含折线路径点） ====================
export interface TieSwitchPath extends TieSwitchData {
  polyline: string; // SVG polyline points "x1,y1 x2,y2 ..."
}
// 联络开关折线路由：横平竖直，避开节点和正常馈线，标签在水平段中点
export const tieSwitches: TieSwitchPath[] = [
  // T1 8-21: Bus8→下→左→上到Bus21（水平段在y=480, Bus20=400与Bus21=460之间）
  { id:'T1',name:'T1 8-21 常开',fromBus:fmt(8),toBus:fmt(21),fromNum:8,toNum:21,status:'open',transferCapacityMw:1.2,estimatedLoadRate:0.72,minVoltagePu:0.935,
    safetyCheck:{result:'pass',reason:'容量充足，N-1通过'},fromX:B8_X,fromY:240,toX:B21_X,toY:460,
    polyline: `${B8_X},240 ${B8_X},480 ${B21_X},480 ${B21_X},460` },
  // T2 9-15: Bus9→下→右→上到Bus15（浅U型在主馈线下方）
  { id:'T2',name:'T2 9-15 常开',fromBus:fmt(9),toBus:fmt(15),fromNum:9,toNum:15,status:'open',transferCapacityMw:0.9,estimatedLoadRate:0.78,minVoltagePu:0.928,
    safetyCheck:{result:'pass',reason:'路径短，推荐方案'},fromX:B9_X,fromY:240,toX:B15_X,toY:240,
    polyline: `${B9_X},240 ${B9_X},295 ${B15_X},295 ${B15_X},240` },
  // T3 12-22: Bus12→下→左→下到Bus22（水平段在y=510, Bus21=460与Bus22=520之间）
  { id:'T3',name:'T3 12-22 常开',fromBus:fmt(12),toBus:fmt(22),fromNum:12,toNum:22,status:'open',transferCapacityMw:0.8,estimatedLoadRate:0.81,minVoltagePu:0.922,
    safetyCheck:{result:'warn',reason:'负载率接近预警'},fromX:B12_X,fromY:240,toX:B22_X,toY:520,
    polyline: `${B12_X},240 ${B12_X},510 ${B22_X},510 ${B22_X},520` },
  // T4 18-33: Bus18→下→左→下到Bus33（水平段在y=340, 分支3的上方）
  { id:'T4',name:'T4 18-33 常开',fromBus:fmt(18),toBus:fmt(33),fromNum:18,toNum:33,status:'open',transferCapacityMw:0.6,estimatedLoadRate:0.65,minVoltagePu:0.940,
    safetyCheck:{result:'pass',reason:'电压裕度充足'},fromX:B18_X,fromY:240,toX:B33_X,toY:400,
    polyline: `${B18_X},240 ${B18_X},340 ${B33_X},340 ${B33_X},400` },
  // T5 25-29: Bus25→下→右→上到Bus29（水平段在y=540, 全图最底部）
  { id:'T5',name:'T5 25-29 常开',fromBus:fmt(25),toBus:fmt(29),fromNum:25,toNum:29,status:'open',transferCapacityMw:0.5,estimatedLoadRate:0.58,minVoltagePu:0.945,
    safetyCheck:{result:'pass',reason:'电压质量好'},fromX:B25_X,fromY:470,toX:B29_X,toY:400,
    polyline: `${B25_X},470 ${B25_X},540 ${B29_X},540 ${B29_X},400` },
];

// ==================== 故障场景 ====================
export const faultScenarios: FaultScenario[] = [
  { id:'F1',label:'L4: Bus4-5 故障',lineId:'L4',faultSection:'Bus4-Bus5',lostBuses:[5,6,7,8,9,10,11,12,13,14,15,16,17,18,26,27,28,29,30,31,32,33],availableTies:['T1','T2'],description:'主馈线中段故障，下游大面积失电'},
  { id:'F2',label:'L8: Bus8-9 故障',lineId:'L8',faultSection:'Bus8-Bus9',lostBuses:[9,10,11,12,13,14,15,16,17,18],availableTies:['T2','T3','T4'],description:'常用演示场景，T2为推荐转供路径'},
  { id:'F5',label:'L13: Bus13-14 故障',lineId:'L13',faultSection:'Bus13-Bus14',lostBuses:[14,15,16,17,18],availableTies:['T3','T4'],description:'验收流程A：预期ALG-001/T2/9-15'},
  { id:'F6',label:'L3: Bus3-4 故障',lineId:'L3',faultSection:'Bus3-Bus4',lostBuses:[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,23,24,25,26,27,28,29,30,31,32,33],availableTies:['T1','T2','T3','T4','T5'],description:'验收流程B：预期ALG-003/T5/25-29'},
  { id:'F3',label:'L2: Bus2-3 故障',lineId:'L2',faultSection:'Bus2-Bus3',lostBuses:[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,23,24,25,26,27,28,29,30,31,32,33],availableTies:['T1','T2','T3','T4','T5'],description:'上游故障，大面积失电'},
  { id:'F4',label:'L25: Bus6-26 故障',lineId:'L25',faultSection:'Bus6-Bus26',lostBuses:[26,27,28,29,30,31,32,33],availableTies:['T4','T5'],description:'分支3出口故障'},
];

// ==================== 辅助 ====================
export function findBus(id: string) { return buses.find(b => b.id === id); }
export function findLine(id: string) { return lines.find(l => l.id === id); }

/** BFS 计算失电节点 — 支持单故障或多故障 */
export function computeOutageBuses(faultLineId: string | string[]): string[] {
  const faultSet = new Set(Array.isArray(faultLineId) ? faultLineId : [faultLineId]);
  const adj = new Map<string, string[]>();
  for (const l of lines) {
    if (faultSet.has(l.id)) continue;
    if (l.switchStatus === 'closed') {
      if (!adj.has(l.from)) adj.set(l.from, []); if (!adj.has(l.to)) adj.set(l.to, []);
      adj.get(l.from)!.push(l.to); adj.get(l.to)!.push(l.from);
    }
  }
  const visited = new Set<string>(); const q = ['BUS-01'];
  while (q.length) { const u = q.shift()!; if (visited.has(u)) continue; visited.add(u); for (const v of adj.get(u) || []) { if (!visited.has(v)) q.push(v); } }
  return buses.filter(b => !visited.has(b.id)).map(b => b.id);
}

export function getTransferOptions(faultLineId: string) {
  const lost = new Set(computeOutageBuses(faultLineId));
  return tieSwitches.filter(t => { const fl=lost.has(t.fromBus),tl=lost.has(t.toBus); return (fl&&!tl)||(!fl&&tl); });
}

/**
 * 计算转供后的恢复节点（基于 BFS 连通性）
 * 1. 断掉故障线路，BFS → oldReachable
 * 2. 合上联络开关，BFS → newReachable
 * 3. 恢复节点 = newReachable - oldReachable
 * 4. 仍失电节点 = 全部节点 - newReachable
 */
export function computeRestoredBuses(faultLineIds: string[], ties: { from: string; to: string }[]): {
  restored: Set<string>;
  stillOutage: Set<string>;
} {
  const faultSet = new Set(faultLineIds);
  function buildAdj(): Map<string, string[]> {
    const adj = new Map<string, string[]>();
    for (const l of lines) {
      if (faultSet.has(l.id)) continue;
      if (l.switchStatus === 'closed') {
        if (!adj.has(l.from)) adj.set(l.from, []);
        if (!adj.has(l.to)) adj.set(l.to, []);
        adj.get(l.from)!.push(l.to);
        adj.get(l.to)!.push(l.from);
      }
    }
    return adj;
  }
  function bfs(adj: Map<string, string[]>, start: string): Set<string> {
    const visited = new Set<string>();
    const q = [start];
    while (q.length) { const u = q.shift()!; if (visited.has(u)) continue; visited.add(u); for (const v of adj.get(u) || []) { if (!visited.has(v)) q.push(v); } }
    return visited;
  }

  const adjBefore = buildAdj();
  const oldReachable = bfs(adjBefore, 'BUS-01');

  // 转供后：合上所有选中的联络开关
  const adjAfter = buildAdj();
  for (const tie of ties) {
    if (!adjAfter.has(tie.from)) adjAfter.set(tie.from, []);
    if (!adjAfter.has(tie.to)) adjAfter.set(tie.to, []);
    adjAfter.get(tie.from)!.push(tie.to);
    adjAfter.get(tie.to)!.push(tie.from);
  }

  const newReachable = bfs(adjAfter, 'BUS-01');
  const allNodes = new Set(buses.map(b => b.id));

  const restored = new Set<string>();
  for (const id of newReachable) {
    if (!oldReachable.has(id)) restored.add(id);
  }

  const stillOutage = new Set<string>();
  for (const id of allNodes) {
    if (!newReachable.has(id) && !faultSet.has(id)) stillOutage.add(id);
  }

  return { restored, stillOutage };
}

/**
 * 节点故障分析：排除故障节点及其所有关联线路，BFS 计算失电
 * @param faultBusId 故障节点 ID（如 BUS-05）
 */
export function computeOutageForNodeFault(faultBusId: string): string[] {
  // 找出故障节点关联的所有线路
  const incidentLines = lines.filter(l => l.from === faultBusId || l.to === faultBusId);
  const incidentLineIds = new Set(incidentLines.map(l => l.id));
  // 构建邻接表：排除关联线路，且故障节点不可达
  const adj = new Map<string, string[]>();
  for (const l of lines) {
    if (incidentLineIds.has(l.id)) continue;
    if (l.switchStatus === 'closed') {
      if (!adj.has(l.from)) adj.set(l.from, []);
      if (!adj.has(l.to)) adj.set(l.to, []);
      adj.get(l.from)!.push(l.to);
      adj.get(l.to)!.push(l.from);
    }
  }
  // BFS 从 Bus1 出发，排除故障节点
  const visited = new Set<string>();
  const q = ['BUS-01'];
  while (q.length) {
    const u = q.shift()!;
    if (visited.has(u) || u === faultBusId) continue;
    visited.add(u);
    for (const v of adj.get(u) || []) {
      if (!visited.has(v) && v !== faultBusId) q.push(v);
    }
  }
  return buses.filter(b => b.id !== faultBusId && !visited.has(b.id)).map(b => b.id);
}

/** DEMO 模式默认数据导出 */
export const defaultMockData = {
  nodes: buses.map(b => ({ busNo: b.num, name: b.name, nodeType: b.feeder === '主馈线' ? 'source' : 'load',
    voltage: b.voltagePu, loadP: b.loadMw * 1000, loadQ: b.loadKvar * 1000,
    status: b.status, feeder: b.feeder, xCoord: b.x, yCoord: b.y })),
  branches: lines.map(l => ({ lineId: l.id, fromBus: l.fromNum, toBus: l.toNum, lineType: l.lineType, status: l.status,
    switchState: l.switchStatus || 'closed', loadRate: l.loadRate, isFault: false,
    resistance: l.resistance, reactance: l.reactance, switchType: l.switchType || 'none' })),
  tieSwitches: tieSwitches.map(t => ({ tieId: t.id, name: t.name, fromBus: t.fromNum, toBus: t.toNum,
    status: t.status, normallyOpen: true, capacity: t.transferCapacityMw,
    riskLevel: t.safetyCheck.result === 'pass' ? 'low' : 'medium',
    fromX: t.fromX, fromY: t.fromY, toX: t.toX, toY: t.toY })),
};
