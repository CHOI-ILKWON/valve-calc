// CH-20261124-04 (2026-11-24) 밸브 화면 개편 회귀 시험 — 실행: node --test tests/ch-20261124-04.test.mjs
// 붙여넣기 해석 · 기본 입상관 · 존 나누기(A안/B안/경계층) · 확인 목록 분류 · 계산 결과 불변
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const src=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function load(){
  const el=()=>({innerHTML:'',value:'',addEventListener(){},classList:{toggle(){}},click(){},querySelectorAll:()=>[],scrollIntoView(){}});
  const els={};
  const ctx={console,Math,JSON,Date,URL:{createObjectURL(){return ''},revokeObjectURL(){}},Blob:function(){},setTimeout,alert(){},confirm:()=>true,
    localStorage:{getItem(){return null},setItem(){},removeItem(){}},
    document:{getElementById:id=>els[id]||(els[id]=el()),querySelectorAll:()=>[],createElement:el}};
  ctx.window={addEventListener(){},print(){}};
  vm.createContext(ctx); vm.runInContext(src,ctx);
  return {ctx,els,run:c=>{const v=vm.runInContext(c,ctx);return v===undefined?undefined:JSON.parse(JSON.stringify(v));}};
}
const PASTE='펌프=2대(1대 예비,SET); Q=235 L/min; 총용량=12 ㎥; 유효=9.6 ㎥; 칸=자동; H=48 m';
const J=JSON.stringify;

test('붙여넣기 — 용량부하 한 줄 형식이 6칸에 들어간다', ()=>{
  const app=load();
  const r=app.run(`parseReceived(${J(PASTE)})`);
  assert.deepEqual(r.vals,{pump:'2s',flow:235,volume:12,effective:9.6,compart:'auto',head:48});
  assert.deepEqual(r.unknown,[]); assert.deepEqual(r.errors,[]);
  app.run(`setPumpMode('1'); applyReceived(${J(PASTE)})`);
  assert.deepEqual(app.run('[S.pump.count,S.pump.set,S.pump.flow,S.tank.volume,S.tank.effective,S.tank.compart,S.pump.head]'),[2,true,235,12,9.6,'auto',48]);
  assert.equal(app.run('tankCompart()'),2);   // 12 ㎥ > 5 → 2칸
});

// 용량부하(hvac-calc 81be929) 「한 줄로 복사」 실제 출력 — pumpTxt '1대 (단독)'|'2대 (1대 예비, SET)'|'3대 (단독)', 숫자는 소수 1자리·쉼표 없음, 값 없으면 「—」
test('붙여넣기 — 용량부하 실제 출력 문자열(띄어쓰기 포함)을 그대로 읽는다', ()=>{
  const app=load();
  const REAL='펌프=2대 (1대 예비, SET); Q=235 L/min; 총용량=12 ㎥; 유효=9.6 ㎥; 칸=자동; H=48 m';
  let r=app.run(`parseReceived(${J(REAL)})`);
  assert.deepEqual(r.vals,{pump:'2s',flow:235,volume:12,effective:9.6,compart:'auto',head:48});
  assert.deepEqual([r.unknown,r.errors],[[],[]]);
  // 띄어쓰기 차이 허용 — 붙임·여러 칸·전각 아닌 공백 변형
  for(const v of ['펌프=2대(1대 예비,SET);Q=235L/min;총용량=12㎥;유효=9.6㎥;칸=자동;H=48m',
                  '펌프 = 2대  (1대  예비 ,  SET) ;  Q = 235  L/min ;총용량 =12 ㎥;  유효= 9.6 ㎥ ; 칸 = 자동 ; H = 48 m ']){
    assert.deepEqual(app.run(`parseReceived(${J(v)})`).vals,{pump:'2s',flow:235,volume:12,effective:9.6,compart:'auto',head:48});
  }
  // 1대·3대, 소수 1자리
  r=app.run(`parseReceived(${J('펌프=1대 (단독); Q=187.5 L/min; 총용량=4.8 ㎥; 유효=3.8 ㎥; 칸=자동; H=36.2 m')})`);
  assert.deepEqual(r.vals,{pump:'1',flow:187.5,volume:4.8,effective:3.8,compart:'auto',head:36.2});
  assert.equal(app.run(`parseReceived(${J('펌프=3대 (단독)')}).vals.pump`),'3');
  // 물탱크 미계산 「—」 → 그 칸은 그대로, 확인 목록에 남김
  r=app.run(`parseReceived(${J('펌프=2대 (1대 예비, SET); Q=235 L/min; 총용량=— ㎥; 유효=— ㎥; 칸=자동; H=48 m')})`);
  assert.deepEqual(r.vals,{pump:'2s',flow:235,compart:'auto',head:48});
  assert.equal(r.errors.length,2); assert.match(r.errors[0],/총용량 값 없음/);
  app.run(`S.tank.volume=20; applyReceived(${J('총용량=— ㎥')})`);
  assert.equal(app.run('S.tank.volume'),20);
  assert.ok(app.run('allChecks()').some(x=>x.lv==='c'&&/총용량 값 없음/.test(x.msg)));
});

test('붙여넣기 — 변형(줄바꿈·공백·㎥/h·칸 숫자·단독)과 실패사례', ()=>{
  const app=load();
  let r=app.run(`parseReceived(${J('펌프 = 3대 (단독)\nQ = 18 ㎥/h\n칸=2\n유효용량 = 8')})`);
  assert.equal(r.vals.pump,'3'); assert.equal(r.vals.flow,300); assert.equal(r.vals.compart,2); assert.equal(r.vals.effective,8);
  r=app.run(`parseReceived(${J('펌프=2대(단독); Q=abc; 칸=9; 온도=20; 그냥문장')})`);
  assert.equal(r.vals.pump,'2'); assert.equal(r.vals.flow,undefined);
  assert.equal(r.errors.length,2); assert.deepEqual(r.unknown,['온도=20','그냥문장']);
  // 읽지 못한 항목은 칸을 바꾸지 않고 확인 목록에 남는다
  app.run(`S.pump.flow=300; applyReceived(${J('Q=abc; 온도=20')})`);
  assert.equal(app.run('S.pump.flow'),300);
  const chk=app.run('allChecks()').filter(x=>/붙여넣기/.test(x.msg));
  assert.equal(chk.length,2); assert.ok(chk.every(x=>x.lv==='c'&&x.to==='sec2'));
});

test('기본 입상관 — 1개·전 층·층 주관 모든 층 같음, 층수 바꾸면 따라간다', ()=>{
  const app=load();
  let g=app.run('S.groups');
  assert.equal(g.length,1); assert.equal(g[0].allFloors,true); assert.equal(g[0].floorSame,true);
  app.run(`setBuilding('floors',8)`);
  g=app.run('S.groups[0]');
  assert.deepEqual([g.fromFloor,g.toFloor],[1,8]);
  assert.deepEqual(g.floorPipes.map(x=>x.floorNo),[1,2,3,4,5,6,7,8]);
  assert.ok(g.floorPipes.every(x=>x.pipe==='40A'&&x.qty===1));
  assert.equal(app.run('calcValves().warnings').filter(w=>/층 차단밸브 0개/.test(w)).length,0);
});

// 8층·층고 3.5·P_max 8 kgf/cm²(785 kPa): 1~7층 ≥ 550 (7층 = 8−2.1 = 5.9 → 579 kPa, 8층 545 kPa)
function base8(app){ app.run(`S.building.floors=8; S.building.floorHeight=3.5; S.pump.pressure=7; S.pump.pressureSet=true; S.pump.pressureMax=8; renderAll();`); }

test('550 kPa 이상 층 → 위반 띠와 「저층 존 나누기」, 누르면 A안으로 나눈다', ()=>{
  const app=load(); base8(app);
  app.run('renderSettings()');
  let st=app.els.settingsPanel.innerHTML;
  assert.match(st,/1~7층 유량 0 최대압 550 kPa 이상/); assert.match(st,/저층 존 나누기 ▸/);
  assert.ok(app.run('allChecks()').some(x=>x.lv==='v'&&/≥ 550/.test(x.msg)));
  const gid=app.run('S.groups[0].id');
  app.run(`switchTab(1); splitZoneA('${gid}')`);
  const gs=app.run('S.groups');
  assert.equal(gs.length,2);
  assert.deepEqual([gs[0].name,gs[0].fromFloor,gs[0].toFloor,gs[0].prv,gs[0].zoneRole],['입상관 1 저층 존',1,7,true,'low']);
  assert.deepEqual([gs[1].name,gs[1].fromFloor,gs[1].toFloor,gs[1].prv,gs[1].zoneRole],['입상관 1 고층 존',8,8,false,'high']);
  assert.equal(app.run('S.groups.filter(zoneNeeds).length'),0);
  st=app.els.settingsPanel.innerHTML;
  assert.match(st,/모든 층 550 kPa 미만 ✓/); assert.match(st,/B안\(층 분기 PRV\)으로 바꾸기/); assert.match(st,/존 경계층/);
  // 층 주관은 두 존에 나뉘어 합계 8개 그대로
  const r=app.run('calcValves()');
  assert.equal(r.list.filter(i=>/층 주관/.test(i.pos)&&i.name==='볼밸브').reduce((s,i)=>s+i.qty,0),8);
  assert.equal(r.summary['감압밸브'],1);
});

test('B안 전환 → 한 입상관 + 1~7층 층 분기 PRV, 경계층 조정, A안으로 되돌리기', ()=>{
  const app=load(); base8(app);
  const gid=app.run('S.groups[0].id');
  app.run(`splitZoneA('${gid}'); zoneToB('${gid}')`);
  let gs=app.run('S.groups');
  assert.equal(gs.length,1); assert.equal(gs[0].zonePlan,'B'); assert.equal(gs[0].prv,false);
  assert.deepEqual(gs[0].floorPipes.filter(x=>x.prv).map(x=>x.floorNo),[1,2,3,4,5,6,7]);
  assert.equal(app.run('calcValves().summary["감압밸브"]'),7);
  assert.equal(app.run('S.groups.filter(zoneNeeds).length'),0);
  // 경계층 ▼ — 6층까지만 층 분기 PRV → 7층(579 kPa) 미해결로 위반이 다시 뜬다
  app.run(`zoneShift('${gid}',-1)`);
  assert.deepEqual(app.run('S.groups[0].floorPipes.filter(x=>x.prv).map(x=>x.floorNo)'),[1,2,3,4,5,6]);
  assert.equal(app.run('S.groups.filter(zoneNeeds).length'),1);
  app.run(`zoneShift('${gid}',1)`);
  // A안으로 되돌리기
  app.run(`zoneToA('${gid}')`);
  gs=app.run('S.groups');
  assert.equal(gs.length,2); assert.deepEqual([gs[0].toFloor,gs[1].fromFloor],[7,8]);
  assert.equal(app.run('S.groups[1].floorPipes.some(x=>x.prv)'),false);
  // A안 경계층 ▲ — 고층 존이 한 층은 남아야 하므로 7 유지, ▼▼ 이면 5
  app.run(`zoneShift('${gs[1].id}',1)`);
  assert.deepEqual(app.run('[S.groups[0].toFloor,S.groups[1].fromFloor]'),[7,8]);
  app.run(`zoneShift('${gs[1].id}',-2)`);
  assert.deepEqual(app.run('[S.groups[0].toFloor,S.groups[1].fromFloor]'),[5,6]);
  assert.equal(app.run('S.groups.filter(zoneNeeds).length'),1);   // 6·7층이 고층 존에서 550 이상 → 다시 위반
  assert.equal(app.run('S.groups.reduce((s,g)=>s+g.floorPipes.length,0)'),8);
});

test('전 층 과압이면 나누지 않고 그 입상관에 PRV 세트', ()=>{
  const app=load(); app.run(`S.building.floors=3; S.building.floorHeight=3; S.pump.pressure=8; S.pump.pressureSet=true; S.pump.pressureMax=9; renderAll();`);
  const gid=app.run('S.groups[0].id');
  app.run(`splitZoneA('${gid}')`);
  assert.equal(app.run('S.groups.length'),1); assert.equal(app.run('S.groups[0].prv'),true);
});

test('확인 목록 분류 — 위반·확인·참고, 이동 대상', ()=>{
  const app=load();
  const L=m=>app.run(`[warnLevel(${J(m)}),warnTarget(${J(m)})]`);
  assert.deepEqual(L('입상관 1: 층 차단밸브 0개 — KDS 31 30 15:2026 4.11(3) 「수직관에 연결된 각 층 급수관」에는 차단밸브를 설치해야 합니다. 층 주관(층별 볼밸브)을 입력하세요.'),['v','sec3']);
  assert.deepEqual(L('펌프 1대(단독) — KDS 31 30 15:2026 4.6.2(2) 「펌프는 2 대 이상으로 하여야 한다」. 예비 없이 설계하는 근거를 기록하세요.'),['v','sec2']);
  assert.deepEqual(L('오버플로관: O.F 65A — 표 4.12-1 판정 보류(최대 급수량 미입력) · 인입 50A +1단계 65A 중 큰 값. — 최대 급수량(L/s)을 입력하세요.'),['c','sec4']);
  assert.deepEqual(L('LCV 바이패스는 평상시 닫힘(NC)입니다 — 열어두면 저수조 과수위·월류로 이어집니다.'),['n','sec4']);
});

test('화면 개편은 계산·산출을 바꾸지 않는다 — 탭을 그려도 같은 목록, 옛 입상관은 그대로', ()=>{
  const app=load();
  app.run(`S.building.floors=8; S.pump.pressure=7; S.pump.pressureSet=true; S.pump.pressureMax=8;
    S.groups=[{id:'g1',name:'저층',pipe:'65A',prv:true,fromFloor:1,toFloor:3,flowLpm:300,horizLen:30,reqKPa:100,floorPipes:[],zones:[{name:'화장실',pipe:'40A',fvCnt:4}]},
              {id:'g2',name:'고층',pipe:'50A',prv:false,fromFloor:4,toFloor:8,flowLpm:250,horizLen:30,reqKPa:100,floorPipes:[],zones:[]}];`);
  const a=app.run('calcValves()');
  for(let i=0;i<5;i++) app.run(`switchTab(${i})`);
  const b=app.run('calcValves()');
  assert.deepEqual(a.summary,b.summary); assert.deepEqual(a.list,b.list);
  assert.deepEqual(app.run('S.groups.map(g=>g.floorPipes.length)'),[0,0]);   // floorSame 없는 옛 입상관은 층 주관을 건드리지 않는다
});
