"""
IEEE 33 节点标准配电网 — 种子数据

拓扑结构：
  主馈线: 1-2-3-4-5-6-7-8-9-10-11-12-13-14-15-16-17-18
  支路一: 2-19-20-21-22
  支路二: 3-23-24-25
  支路三: 6-26-27-28-29-30-31-32-33
  联络开关: T1(8-21) T2(9-15) T3(12-22) T4(18-33) T5(25-29) 常开
"""

import json
from sqlalchemy.orm import Session
from app.models.topology import BusNode, Branch, TieSwitch

# ========== 节点负荷 & 电压 ==========
# bus_no -> (name, node_type, load_p (kW), load_q (kvar), voltage, feeder, x_coord, y_coord)
BUS_DATA: list[tuple] = [
    (1,  "Bus 1",  "source", 0,    0,    1.000, "主馈线", 40,  310),
    (2,  "Bus 2",  "load",   100,  60,   0.997, "主馈线", 95,  310),
    (3,  "Bus 3",  "load",   90,   40,   0.983, "主馈线", 150, 310),
    (4,  "Bus 4",  "load",   120,  80,   0.976, "主馈线", 205, 310),
    (5,  "Bus 5",  "load",   60,   30,   0.968, "主馈线", 260, 310),
    (6,  "Bus 6",  "load",   60,   20,   0.950, "主馈线", 315, 310),
    (7,  "Bus 7",  "load",   200,  100,  0.946, "主馈线", 370, 310),
    (8,  "Bus 8",  "load",   200,  100,  0.941, "主馈线", 425, 310),
    (9,  "Bus 9",  "load",   60,   20,   0.936, "主馈线", 480, 310),
    (10, "Bus 10", "load",   60,   20,   0.930, "主馈线", 535, 310),
    (11, "Bus 11", "load",   45,   30,   0.928, "主馈线", 590, 310),
    (12, "Bus 12", "load",   60,   35,   0.927, "主馈线", 645, 310),
    (13, "Bus 13", "load",   60,   35,   0.922, "主馈线", 700, 310),
    (14, "Bus 14", "load",   120,  80,   0.916, "主馈线", 755, 310),
    (15, "Bus 15", "load",   60,   10,   0.910, "主馈线", 810, 310),
    (16, "Bus 16", "load",   60,   20,   0.908, "主馈线", 865, 310),
    (17, "Bus 17", "load",   60,   20,   0.907, "主馈线", 910, 310),
    (18, "Bus 18", "load",   90,   40,   0.904, "主馈线", 955, 310),
    (19, "Bus 19", "load",   90,   40,   0.997, "分支1",  95,  400),
    (20, "Bus 20", "load",   90,   40,   0.993, "分支1",  95,  460),
    (21, "Bus 21", "load",   90,   40,   0.992, "分支1",  95,  520),
    (22, "Bus 22", "load",   90,   40,   0.992, "分支1",  95,  560),
    (23, "Bus 23", "load",   90,   50,   0.980, "分支2",  150, 390),
    (24, "Bus 24", "load",   420,  200,  0.974, "分支2",  150, 440),
    (25, "Bus 25", "load",   60,   25,   0.972, "分支2",  150, 490),
    (26, "Bus 26", "load",   60,   25,   0.948, "分支3",  315, 230),
    (27, "Bus 27", "load",   60,   20,   0.946, "分支3",  370, 230),
    (28, "Bus 28", "load",   60,   20,   0.944, "分支3",  425, 230),
    (29, "Bus 29", "load",   120,  70,   0.940, "分支3",  480, 230),
    (30, "Bus 30", "load",   200,  600,  0.934, "分支3",  535, 180),
    (31, "Bus 31", "load",   150,  70,   0.931, "分支3",  590, 160),
    (32, "Bus 32", "load",   210,  100,  0.928, "分支3",  645, 140),
    (33, "Bus 33", "load",   60,   40,   0.925, "分支3",  700, 120),
]

# ========== 线路 ==========
# (line_id, from_bus, to_bus, line_type, resistance, reactance, load_rate, switch_type)
BRANCH_DATA: list[tuple] = [
    ("L1", 1,2,"main",0.092,0.047,38,"breaker"),
    ("L2", 2,3,"main",0.493,0.251,42,"none"),
    ("L3", 3,4,"main",0.366,0.186,35,"none"),
    ("L4", 4,5,"main",0.381,0.194,51,"sectionSwitch"),
    ("L5", 5,6,"main",0.819,0.707,28,"none"),
    ("L6", 6,7,"main",0.187,0.619,44,"none"),
    ("L7", 7,8,"main",0.711,0.235,39,"sectionSwitch"),
    ("L8", 8,9,"main",0.744,0.550,46,"none"),
    ("L9", 9,10,"main",0.104,0.074,32,"none"),
    ("L10",10,11,"main",0.196,0.150,25,"none"),
    ("L11",11,12,"main",0.374,0.124,30,"sectionSwitch"),
    ("L12",12,13,"main",1.468,1.155,27,"none"),
    ("L13",13,14,"main",0.542,0.713,33,"none"),
    ("L14",14,15,"main",0.591,0.526,41,"none"),
    ("L15",15,16,"main",0.746,0.545,36,"none"),
    ("L16",16,17,"main",1.289,1.721,22,"none"),
    ("L17",17,18,"main",0.732,0.574,18,"none"),
    ("L18",2,19,"branch",0.164,0.157,31,"none"),
    ("L19",19,20,"branch",1.504,1.355,20,"none"),
    ("L20",20,21,"branch",0.410,0.478,15,"none"),
    ("L21",21,22,"branch",0.709,0.937,12,"none"),
    ("L22",3,23,"branch",0.451,0.308,24,"none"),
    ("L23",23,24,"branch",0.898,0.709,18,"none"),
    ("L24",24,25,"branch",0.896,0.701,16,"none"),
    ("L25",6,26,"branch",0.203,0.103,29,"none"),
    ("L26",26,27,"branch",0.284,0.145,26,"none"),
    ("L27",27,28,"branch",1.059,0.934,22,"none"),
    ("L28",28,29,"branch",0.804,0.701,19,"none"),
    ("L29",29,30,"branch",0.508,0.259,14,"none"),
    ("L30",30,31,"branch",0.974,0.963,17,"none"),
    ("L31",31,32,"branch",0.310,0.362,11,"none"),
    ("L32",32,33,"branch",0.341,0.530,8,"none"),
]

# ========== 联络开关 ==========
# (tie_id, name, from_bus, to_bus, capacity, risk_level, from_x, from_y, to_x, to_y)
TIE_DATA: list[tuple] = [
    ("T1","T1: Bus8-21",  8, 21, 1.2, "low",    425,310, 95, 520),
    ("T2","T2: Bus9-15",  9, 15, 0.9, "low",    480,310, 810,310),
    ("T3","T3: Bus12-22", 12,22, 0.8, "medium", 645,310, 95, 560),
    ("T4","T4: Bus18-33", 18,33, 0.6, "low",    955,310, 700,120),
    ("T5","T5: Bus25-29", 25,29, 0.5, "low",    150,490, 480,230),
]


def seed_ieee33(db: Session):
    """初始化 IEEE33 数据（若已存在则跳过）"""
    if db.query(BusNode).count() > 0:
        return {"message": "IEEE33 数据已存在，跳过初始化", "nodes": db.query(BusNode).count()}

    # 插入节点
    for (bus_no, name, ntype, lp, lq, v, feeder, x, y) in BUS_DATA:
        db.add(BusNode(bus_no=bus_no, name=name, node_type=ntype, load_p=lp, load_q=lq,
                       voltage=v, feeder=feeder, x_coord=x, y_coord=y, status="normal"))
    # 插入线路
    for (lid, fb, tb, ltype, r, x, lr, swt) in BRANCH_DATA:
        db.add(Branch(line_id=lid, from_bus=fb, to_bus=tb, line_type=ltype,
                      resistance=r, reactance=x, load_rate=lr, switch_type=swt,
                      status="normal", switch_state="closed", is_fault=False))
    # 插入联络开关
    for (tid, name, fb, tb, cap, risk, fx, fy, tx, ty) in TIE_DATA:
        db.add(TieSwitch(tie_id=tid, name=name, from_bus=fb, to_bus=tb,
                         status="open", normally_open=True, capacity=cap, risk_level=risk,
                         from_x=fx, from_y=fy, to_x=tx, to_y=ty))

    db.commit()
    return {"message": "IEEE33 数据初始化完成", "nodes": len(BUS_DATA), "branches": len(BRANCH_DATA), "ties": len(TIE_DATA)}
