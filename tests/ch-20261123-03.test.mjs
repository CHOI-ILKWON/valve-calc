// CH-20261123-03 (2026-11-23) 법정·국가 기준 일괄 반영 회귀 시험 — 실행: node --test tests/ch-20261123-03.test.mjs
// 1-3 존 판정 ≥550 · 1-4 칩·릴리프 550 · 1-5 needsPRV 삭제 · 1-6 흡입 PG 제거 · 2-6 130 kPa
// 2-7 층 차단밸브 경고 · 2-8 오버플로 관경 · 2-14 DCV 필수 · U2 펌프 1대 경고 · U4 LCV 형식
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
  return {ctx,els,run:code=>{const v=vm.runInContext(code,ctx);return v===undefined?undefined:JSON.parse(JSON.stringify(v));}};
}
const live=r=>r.list.filter(i=>i.grade!=='EXCLUDED');

// 층고 4 m, P_max 를 직접 넣어 1층 유량 0 압력을 정확히 맞춘다
function base(app,extra=''){
  app.run(`
    S.building.floors=4; S.building.floorHeight=4; S.pump.pressure=6; S.pump.pressureSet=true; S.pump.pressureMax=0;
    S.groups=[{id:'g1',name:'입상관 1',pipe:'50A',prv:false,fromFloor:1,toFloor:4,flowLpm:200,horizLen:20,reqKPa:100,
      floorPipes:[{id:'f1',floorNo:1,pipe:'40A',qty:1}],zones:[]}];
    ${extra}`);
}

test('1-3 존 판정 — 유량 0 최대압이 정확히 550 kPa 이면 감압 대상(≥)', ()=>{
  const app=load(); base(app,`S.pump.pressureMax=550/KGF2KPA;`);
  const z=app.run('groupZoneCheck(S.groups[0])');
  assert.equal(Math.round(z.loKPa),550);
  assert.equal(z.need,true);
  assert.deepEqual(z.over,[1]);
  // 549 kPa 면 감압 대상 아님
  app.run(`S.pump.pressureMax=549/KGF2KPA;`);
  assert.equal(app.run('groupZoneCheck(S.groups[0])').need,false);
});

test('1-4 PRV 하류 릴리프 — targetPressure 가 아니라 상류 유량 0 최대압 ≥ 550 kPa', ()=>{
  const app=load();
  // 상류 4.0 kgf/cm² ≈ 392 kPa: 종전(> targetPressure 3.0)이면 릴리프가 붙었지만 이제는 붙지 않는다
  base(app,`S.pump.pressure=4; S.groups[0].prv=true;`);
  let r=app.run('calcValves()');
  assert.equal(r.summary['릴리프밸브'],0);
  // 상류 6.0 kgf/cm² ≈ 588 kPa ≥ 550 → 릴리프 1
  base(app,`S.groups[0].prv=true;`);
  r=app.run('calcValves()');
  assert.equal(r.summary['릴리프밸브'],1);
  // targetPressure 를 바꿔도 결과가 같다 (참고값)
  app.run(`S.building.targetPressure=9;`);
  assert.equal(app.run('calcValves()').summary['릴리프밸브'],1);
});

test('1-4 층별 표·입상관 칩 — 550 kPa 기준, targetPressure 와 무관', ()=>{
  const app=load(); base(app,`S.pump.pressure=4; S.building.targetPressure=3;`);
  app.run('renderSettings()');
  const h=app.els.settingsPanel?.innerHTML||Object.values(app.els).map(e=>e.innerHTML).join('');
  assert.doesNotMatch(h,/감압필요 ▶ PRV/);      // 392 kPa < 550
  assert.doesNotMatch(h,/PRV 권장/);
  assert.match(h,/설계 목표압력/);
  base(app,`S.pump.pressure=6;`);
  app.run('renderSettings()');
  const h2=Object.values(app.els).map(e=>e.innerHTML).join('');
  assert.match(h2,/감압필요 ▶ PRV/);           // 1층 588 kPa
  assert.match(h2,/PRV 권장/);
});

test('1-5 needsPRV 삭제', ()=>{
  const app=load();
  assert.equal(app.run('typeof needsPRV'),'undefined');
});

test('1-6 펌프 흡입측 압력계 없음 — 토출측만', ()=>{
  const app=load(); base(app);
  const r=app.run('calcValves()');
  assert.equal(live(r).filter(i=>i.pos==='펌프 흡입측'&&i.name==='압력계').length,0);
  assert.equal(r.list.filter(i=>i.pos==='펌프 흡입측'&&i.name==='압력계'&&i.grade==='EXCLUDED').length,1);
  assert.equal(live(r).filter(i=>i.pos==='펌프 토출측'&&i.name==='압력계').length,1);
  assert.doesNotMatch(JSON.stringify(r.list),/흡입압과의 차/);
});

test('2-6 최저 필요압 130 kPa 선택지 — 말단 판정에 쓰인다', ()=>{
  const app=load();
  assert.ok(app.run('REQ_OPTS').some(([v,l])=>v===130&&/혼합밸브/.test(l)));
  base(app,`S.groups[0].reqKPa=130;`);
  assert.equal(app.run('groupFriction(S.groups[0]).req'),130);
  assert.equal(app.run('floorReqKPa(2)'),130);
});

test('2-7 실패사례: 층 주관 미입력 → KDS 4.11(3) 층 차단밸브 경고, 입력하면 사라짐', ()=>{
  const app=load(); base(app,`S.groups[0].floorPipes=[];`);
  let w=app.run('calcValves().warnings').join('\n');
  assert.match(w,/입상관 1: 층 차단밸브 0개 — KDS 31 30 15:2026 4\.11\(3\)/);
  base(app);
  w=app.run('calcValves().warnings').join('\n');
  assert.doesNotMatch(w,/층 차단밸브 0개/);
});

test('2-8 오버플로 관경 — 표 4.12-1 과 인입관+1단계 중 큰 값', ()=>{
  const app=load();
  app.run(`S.pump.inletPipe='50A'; S.tank.inflowLps=0;`);
  let o=app.run('overflowSize()');
  assert.equal(o.byInlet,65); assert.equal(o.byTable,null); assert.equal(o.dn,65);   // 유량 미입력 — 인입관 기준만
  app.run(`S.tank.inflowLps=2;`);  o=app.run('overflowSize()'); assert.equal(o.byTable,50); assert.equal(o.dn,65);
  app.run(`S.tank.inflowLps=10;`); o=app.run('overflowSize()'); assert.equal(o.byTable,80); assert.equal(o.dn,80);
  app.run(`S.tank.inflowLps=3;`);  assert.equal(app.run('overflowSize()').byTable,65);  // 경계는 큰 관경(안전측)
  app.run(`S.tank.inflowLps=70;`); assert.equal(app.run('overflowSize()').byTable,200);
  app.run(`S.pump.inletPipe='80A'; S.tank.inflowLps=2;`); assert.equal(app.run('overflowSize()').dn,100);
  base(app,`S.pump.inletPipe='50A'; S.tank.inflowLps=10;`);
  const r=app.run('calcValves()');
  assert.match(r.warnings.join('\n'),/오버플로관: O\.F 80A .*150 mm 이상.*방충망/);
  assert.equal(r.list.find(i=>i.pos==='저수조 오버플로').pipe,'80A');
});

test('2-14 계량기 후단 DCV 필수 — 자유낙수여도, 옛 저장값 dcv=off 여도 적용', ()=>{
  const app=load(); base(app,`S.inlet.tankInlet='airgap'; S.inlet.dcv='off';`);
  const r=app.run('calcValves()');
  const d=live(r).filter(i=>i.pos==='수도 인입부'&&i.name==='더블체크밸브');
  assert.equal(d.length,1); assert.equal(d[0].grade,'DEFAULT'); assert.match(d[0].cond,/별표 5\] 3\.1\(5\)/);
  // 순서: 계량기 뒤
  const pos=r.list.filter(i=>i.pos==='수도 인입부').map(i=>i.name);
  assert.ok(pos.indexOf('수도계량기')<pos.indexOf('더블체크밸브'));
  assert.equal(r.summary['더블체크밸브'],1);
});

test('2-14 후속: 고가수조식 — 인입부 구성이 없으므로 계량기 후단 DCV 별도 확인 경고', ()=>{
  const app=load(); base(app,`setSystem('gravity');`);
  assert.match(app.run('calcValves().warnings').join('|'),/계량기 후단 역류방지밸브\(더블체크밸브\) 필요 — 인입부 별도 확인/);
  app.run(`setSystem('booster');`);
  assert.doesNotMatch(app.run('calcValves().warnings').join('|'),/인입부 별도 확인/);
});

test('U2 펌프 1대(단독) — 선택은 되고 KDS 4.6.2(2) 경고', ()=>{
  const app=load(); base(app,`setPumpMode('1');`);
  assert.equal(app.run('S.pump.count'),1);
  assert.match(app.run('calcValves().warnings').join('\n'),/펌프 1대\(단독\) — KDS 31 30 15:2026 4\.6\.2\(2\)/);
  app.run(`setPumpMode('2s');`);
  assert.doesNotMatch(app.run('calcValves().warnings').join('\n'),/4\.6\.2\(2\)/);
});

test('U4 LCV 형식 — 전동·전자식이면 LCV 세트 수격방지기 1, 볼탭식이면 제외', ()=>{
  const app=load(); base(app);
  let r=app.run('calcValves()');
  assert.equal(app.run('S.inlet.lcvType'),'balltap');
  assert.equal(live(r).filter(i=>i.pos==='LCV 세트'&&i.name==='수격방지기').length,0);
  const n0=r.summary['수격방지기'];
  app.run(`S.inlet.lcvType='electric';`);
  r=app.run('calcValves()');
  const w=live(r).filter(i=>i.pos==='LCV 세트'&&i.name==='수격방지기');
  assert.equal(w.length,1); assert.equal(w[0].pipe,'20A'); assert.match(w[0].cond,/KDS 31 30 15 4\.8/);
  assert.equal(r.summary['수격방지기'],n0+1);
  assert.match(live(r).find(i=>i.name==='수위조절밸브(LCV)').spec,/전동·전자식/);
});

test('화면 렌더 — 설정·계통도·목록 오류 없음 (전동 LCV·펌프 1대·층 주관 없음)', ()=>{
  const app=load(); base(app,`S.inlet.lcvType='electric'; setPumpMode('1'); S.groups[0].floorPipes=[]; S.tank.inflowLps=5;`);
  for(let i=0;i<4;i++) app.run(`switchTab(${i})`);
  const all=Object.values(app.els).map(e=>e.innerHTML).join('');
  assert.match(all,/LCV 형식/);
  assert.match(all,/최대 급수량/);
  assert.doesNotMatch(all,/undefined|NaN/);
});

// CH-20261123-06 — 앱 간 값 옮기기 표기 (앱간_값옮기기_표기기준.md 2.2·2.4·3절)
test('CH-06 받는 칸 출처 표시 · kPa 환산 · 안내 탭 순서표(④ 굵게)', ()=>{
  const app=load(); base(app,`S.pump.pressure=7; S.pump.pressureMax=8; S.building.prvPressure=2.5;`);
  app.run('renderSettings(); renderHelp();');
  const st=app.els.settingsPanel.innerHTML, hp=app.els.helpPanel.innerHTML;
  // 용량부하 상자 번호 순서 ①유효용량 ②칸 수 ③펌프 구성 ④Q, 카탈로그 P_op·P_max
  for(const t of ['← 용량부하 ①','← 용량부하 ②','← 용량부하 ③','← 용량부하 ④','← 카탈로그(P_op)','← 카탈로그(P_max)']) assert.ok(st.includes(t),t);
  assert.match(st,/토출압 P<sub>op<\/sub>[\s\S]*= 686 kPa[\s\S]*← 카탈로그\(P_op\)/);
  assert.match(st,/최대압 P<sub>max<\/sub>[\s\S]*= 785 kPa[\s\S]*← 카탈로그\(P_max\)/);
  assert.match(st,/감압밸브 설정압[\s\S]*?= 245 kPa/);
  assert.match(hp,/앱 간 값 옮기기 순서/);
  assert.match(hp,/<tr style="font-weight:700"><td><strong>④<\/strong><\/td><td><strong>밸브<\/strong>/);
  assert.equal((hp.match(/font-weight:700"><td>/g)||[]).length,1);   // 굵게는 ④ 한 줄만
  // 자동 채움 없음 — 표시만
  app.run(`S.pump.pressureMax=0; renderSettings();`);
  assert.match(app.els.settingsPanel.innerHTML,/최대압 P<sub>max<\/sub>[\s\S]*?= — kPa/);
});
