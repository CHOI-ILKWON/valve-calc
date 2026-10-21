// PRV 존 구성 (명세 7.5, 2026-10-20) 회귀 시험 — 실행: node --test tests/
// index.html 의 본 스크립트를 DOM 스텁 위에서 그대로 돌려 계산 함수만 검사한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const src=html.match(/<script>([\s\S]*?)<\/script>/)[1];

function load(){
  const el=()=>({innerHTML:'',value:'',addEventListener(){},classList:{toggle(){}},click(){}});
  const els={};
  const ctx={
    console,Math,JSON,Date,URL:{createObjectURL(){return ''},revokeObjectURL(){}},Blob:function(){},
    setTimeout,alert(){},
    localStorage:{getItem(){return null},setItem(){},removeItem(){}},
    document:{getElementById:id=>els[id]||(els[id]=el()),querySelectorAll:()=>[],createElement:el},
  };
  ctx.window={addEventListener(){},print(){}};
  vm.createContext(ctx);
  vm.runInContext(src,ctx);
  // 다른 realm 의 배열·객체를 deepEqual 로 비교하려고 JSON 으로 옮긴다
  return {ctx,els,run:code=>{const v=vm.runInContext(code,ctx);return v===undefined?undefined:JSON.parse(JSON.stringify(v));}};
}

// 4층, 층고 4 m, 토출 6 kgf/cm² — 유량 0 압력 1층 588 · 2층 549 · 3층 510 · 4층 471 kPa → 1층만 550 초과
function base(app,extra=''){
  app.run(`
    S.building.floors=4; S.building.floorHeight=4; S.pump.pressure=6; S.pump.pressureSet=true; S.pump.pressureMax=0;
    S.inlet.prvBypass=false;
    S.groups=[{id:'g1',name:'입상관 1',pipe:'50A',prv:false,fromFloor:1,toFloor:4,flowLpm:200,horizLen:20,reqKPa:100,
      floorPipes:[{id:'f1',floorNo:1,pipe:'40A',qty:1},{id:'f4',floorNo:4,pipe:'40A',qty:1}],zones:[]}];
    ${extra}`);
}
const rowsAt=(r,key)=>r.list.filter(i=>i.pos.includes(key));

test('B안 층 분기 PRV — 그룹 PRV 세트와 같은 구성·순서, 관경 = 층 분기관경', ()=>{
  const app=load(); base(app,`S.groups[0].floorPipes[0].prv=true;`);
  const r=app.run('calcValves()');
  const rows=rowsAt(r,'1층 분기');
  assert.deepEqual(rows.map(i=>i.spec),[
    '게이트밸브(입구차단)','Y형 스트레이너(시트보호)','압력계(1차압, 게이지콕 포함)','감압밸브(PRV)',
    '압력계(2차압, 게이지콕 포함)','게이트밸브(출구차단)','— 미적용 —','릴리프밸브(하류 과압 방출)']);
  for(const i of rows) assert.equal(i.pipe,'40A');
  // 바이패스 기본 제외
  const bp=rows.find(i=>i.pos.endsWith('바이패스'));
  assert.equal(bp.qty,0); assert.equal(bp.grade,app.run('GRADE.EXC'));
  // 설정압 미입력 = 감압밸브 설정압, 두 기준 함께 표시
  const prv=rows.find(i=>i.name==='감압밸브');
  assert.match(prv.note,/설정압 2\.5kgf/); assert.match(prv.note,/적정압 3/); assert.match(prv.note,/550 kPa/);
  // 층 분기 BV 바로 다음에 PRV 세트
  const iBV=r.list.findIndex(i=>i.spec==='볼밸브(1층 주관 차단)');
  assert.equal(r.list[iBV+1].pos,'입상관 1 1층 분기 PRV 입구');
  // 4층 분기에는 PRV 없음
  assert.equal(rowsAt(r,'4층 분기').length,0);
});

test('층 분기 PRV 수량이 집계(합계)에 들어간다 — qty 개소만큼', ()=>{
  const app=load(); base(app);
  const s0=app.run('calcValves().summary');
  app.run(`S.groups[0].floorPipes[0].prv=true; S.groups[0].floorPipes[0].qty=2;`);
  const s1=app.run('calcValves().summary');
  assert.equal(s1['감압밸브']-s0['감압밸브'],2);
  assert.equal(s1['게이트밸브']-s0['게이트밸브'],4);
  assert.equal(s1['Y형 스트레이너']-s0['Y형 스트레이너'],2);
  assert.equal(s1['압력계']-s0['압력계'],4);
  assert.equal(s1['릴리프밸브']-s0['릴리프밸브'],2);   // 1층 상류 6.0 > 적정압 3.0
});

test('바이패스 「설치」면 층 분기 PRV 에도 바이패스 행이 붙는다', ()=>{
  const app=load(); base(app,`S.groups[0].floorPipes[0].prv=true; S.inlet.prvBypass=true;`);
  const r=app.run('calcValves()');
  const bp=rowsAt(r,'1층 분기 바이패스');
  assert.equal(bp.length,2); assert.equal(bp[0].qty,2); assert.equal(bp[1].name,'글로브밸브');
  assert.equal(bp[0].state,'NC');
});

test('그룹 PRV 세트 행은 리팩터링 전과 같다 (위치·규격·비고)', ()=>{
  const app=load(); base(app,`S.groups[0].prv=true;`);
  const r=app.run('calcValves()');
  const rows=r.list.filter(i=>/^입상관 1 (PRV|바이패스)/.test(i.pos));
  assert.deepEqual(rows.map(i=>[i.pos,i.spec,i.qty,i.note]),[
    ['입상관 1 PRV 입구','게이트밸브(입구차단)',1,'PRV 입구'],
    ['입상관 1 PRV','Y형 스트레이너(시트보호)',1,'감압밸브 전'],
    ['입상관 1 PRV','압력계(1차압, 게이지콕 포함)',1,'PRV 전'],
    ['입상관 1 PRV','감압밸브(PRV)',1,'설정압 2.5kgf/cm²'],
    ['입상관 1 PRV','압력계(2차압, 게이지콕 포함)',1,'PRV 후'],
    ['입상관 1 PRV 출구','게이트밸브(출구차단)',1,'PRV 출구'],
    ['입상관 1 바이패스','— 미적용 —',0,''],
    ['입상관 1 PRV 하류','릴리프밸브(하류 과압 방출)',1,'PRV 고장 시 하류 보호 — 상류 6.0 > 적정압 3 kgf/cm²'],
  ]);
});

test('실패사례: 저층·고층 혼재 + 저층 550 kPa 초과 + PRV 없음 → A안/B안 제안', ()=>{
  const app=load(); base(app);
  const z=app.run(`groupZoneCheck(S.groups[0])`);
  assert.equal(z.state,'mixed'); assert.deepEqual(z.uncovered,[1]);
  assert.ok(z.loKPa>550); assert.equal(z.prelim,true);   // P_max 미입력 → 예비
  const w=app.run('calcValves().warnings').filter(x=>x.startsWith('입상관 1:'));
  assert.ok(w.some(x=>/A안/.test(x)&&/B안/.test(x)&&/시작점 PRV 1개로는/.test(x)&&/예비/.test(x)));
});

test('실패사례: 시작점 PRV 1개로 혼재 그룹 — 최상층 말단 부족이면 해결 불가 표시', ()=>{
  const app=load();
  // 2차 2.5 kgf → 1층 유량 0 = 245 kPa (≤550) 이지만 4층 말단 = 2.5 − 1.2 − 마찰 < 100 kPa
  base(app,`S.groups[0].prv=true;`);
  const z=app.run(`groupZoneCheck(S.groups[0])`);
  assert.equal(z.state,'riserMixed');
  assert.match(z.msg,/최상층 말단/); assert.match(z.msg,/A안/);
  // 2차압을 올려 최상층을 맞추면 저층이 550 초과 → 역시 해결 불가
  app.run(`S.building.prvPressure=6`);
  const z2=app.run(`groupZoneCheck(S.groups[0])`);
  assert.equal(z2.state,'riserMixed'); assert.deepEqual(z2.uncovered,[1]);
});

test('B안 적용 — 저층 과압 층이 모두 층 분기 PRV 로 덮이면 해결(경고 없음)', ()=>{
  const app=load(); base(app,`S.groups[0].floorPipes[0].prv=true;`);
  const z=app.run(`groupZoneCheck(S.groups[0])`);
  assert.equal(z.state,'solved'); assert.equal(z.msg,'');
  assert.deepEqual(z.floorPrv,[1]);
});

test('실패사례: 층 분기 PRV 2차압을 550 kPa 넘게 설정하면 미해결', ()=>{
  const app=load(); base(app,`S.groups[0].floorPipes[0].prv=true; S.groups[0].floorPipes[0].prvSet=6;`);
  const z=app.run(`groupZoneCheck(S.groups[0])`);
  assert.equal(z.state,'mixed'); assert.deepEqual(z.uncovered,[1]);
});

test('P_max 입력 시 최대압은 정지양정 기준(예비 아님), 마찰을 빼지 않는다', ()=>{
  const app=load(); base(app,`S.pump.pressureMax=5.5; S.groups[0].fromFloor=2; S.groups[0].toFloor=4;`);
  const z=app.run(`groupZoneCheck(S.groups[0])`);
  // 2층: 5.5 − 0.4 = 5.1 kgf = 500 kPa ≤ 550 → 감압 불필요 (토출압 6 이면 2층 549 — 경계)
  assert.equal(z.prelim,false); assert.equal(z.need,false); assert.equal(z.state,'ok');
  assert.ok(Math.abs(z.loKPa-5.1*98.0665)<0.01);
});

test('단일층 그룹 과압 → 존별 PRV 1세트 안내 (혼재 아님)', ()=>{
  const app=load(); base(app,`S.groups[0].fromFloor=1; S.groups[0].toFloor=1;`);
  const z=app.run(`groupZoneCheck(S.groups[0])`);
  assert.equal(z.state,'single'); assert.doesNotMatch(z.msg,/A안/);
  app.run(`S.groups[0].prv=true;`);
  assert.equal(app.run(`groupZoneCheck(S.groups[0])`).state,'solved');
});

test('담당층 미지정이면 판정하지 않는다', ()=>{
  const app=load(); base(app,`S.groups[0].fromFloor=null; S.groups[0].toFloor=null;`);
  assert.equal(app.run(`groupZoneCheck(S.groups[0])`),null);
});

test('화면 렌더 — 설정·계통도·목록에 층 분기 PRV 가 나타나고 오류 없음', ()=>{
  const app=load(); base(app,`S.groups[0].floorPipes[0].prv=true;`);
  app.run('renderSettings();renderDiagram();renderValveList();');
  assert.match(app.els.settingsPanel.innerHTML,/층 분기 PRV/);
  assert.match(app.els.settingsPanel.innerHTML,/정지양정 최대압/);
  assert.match(app.els.diagramPanel.innerHTML,/1층 분기 40A/);
  assert.match(app.els.diagramPanel.innerHTML,/B안 · 점검구 필수/);
  assert.match(app.els.valvePanel.innerHTML,/층 분기 PRV\(B안/);
  // 혼재 경고 박스
  base(app);
  app.run('renderSettings();');
  assert.match(app.els.settingsPanel.innerHTML,/존 판정/);
});
