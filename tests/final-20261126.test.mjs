// 2026-11-26 사용자 최종 수정 회귀 시험 — 실행: node --test tests/final-20261126.test.mjs
//   차단밸브 50A 이하 볼 · 65A 이상 BF / 펌프관경 = 메인 / 인입관 자동(÷8 h, 1.5 m/s, 최소 20A) / 오버플로 자동
//   PRV 바이패스 글로브 1(기본 있음) / 마찰손실·기계실 물량·목표압력·토출압 삭제 / 존별 설정압 범위 / 층 주관 ↔ 화장실 묶기
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const src=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function load(saved=null){
  const el=()=>({innerHTML:'',value:'',addEventListener(){},classList:{toggle(){}},click(){}});
  const els={};
  const ctx={console,Math,JSON,Date,URL:{createObjectURL(){return ''},revokeObjectURL(){}},Blob:function(){},setTimeout,alert(){},
    localStorage:{getItem(){return saved},setItem(){},removeItem(){}},
    document:{getElementById:id=>els[id]||(els[id]=el()),querySelectorAll:()=>[],createElement:el}};
  ctx.window={addEventListener(){},print(){}};
  vm.createContext(ctx); vm.runInContext(src,ctx);
  return {ctx,els,run:code=>{const v=vm.runInContext(code,ctx);return v===undefined?undefined:JSON.parse(JSON.stringify(v));}};
}
const live=r=>r.list.filter(i=>i.grade!=='EXCLUDED');

test('차단밸브 — 50A 이하 볼 · 65A 이상 버터플라이, 펌프·유량계·PRV 앞뒤도 같은 규칙(게이트 없음)', ()=>{
  const app=load();
  assert.equal(app.run(`shutoffType('50A')`),'볼밸브');
  assert.equal(app.run(`shutoffType('65A')`),'버터플라이밸브');
  app.run(`S.pump.mainPipe='100A'; S.groups[0].prv=true; S.groups[0].pipe='100A';`);
  const r=app.run('calcValves()');
  assert.equal(r.summary['게이트밸브'],0);
  for(const pos of ['펌프 흡입측','펌프 토출측','메인 수직관','입상관 1 PRV 입구','입상관 1 PRV 출구','저수조 출구'])
    assert.ok(live(r).some(i=>i.pos===pos&&i.name==='버터플라이밸브'),pos);
  assert.match(live(r).find(i=>i.pos==='메인 수직관'&&i.name==='버터플라이밸브').spec,/레버식/);
  app.run(`S.pump.mainPipe='125A';`);
  assert.match(live(app.run('calcValves()')).find(i=>i.pos==='펌프 흡입측'&&i.name==='버터플라이밸브').spec,/기어식/);
  // 고가수조식 인입·출구도 같은 규칙
  app.run(`setSystem('gravity'); S.pump.inletPipe='40A';`);
  const g=live(app.run('calcValves()'));
  assert.equal(g.find(i=>i.pos==='고가수조 인입').name,'볼밸브');
  assert.equal(g.find(i=>i.pos==='고가수조 출구').name,'버터플라이밸브');
});

test('저수조 출구 · 펌프 흡입 · 토출 관경 = 메인관(위생배관 MAIN)', ()=>{
  const app=load(); app.run(`S.pump.mainPipe='80A';`);
  const r=live(app.run('calcValves()'));
  for(const pos of ['저수조 출구','펌프 흡입측','펌프 토출측']) for(const i of r.filter(x=>x.pos===pos)) assert.equal(i.pipe,'80A',pos+' '+i.name);
  app.run('renderDiagram()');
  assert.doesNotMatch(app.els.diagramPanel.innerHTML,/65A/);
});

test('인입관 자동 — 유효용량 ÷ 8 h, 1.5 m/s 이하 최소 관경, 최소 20A, 협의값 고르면 그 값', ()=>{
  const app=load();
  const cases=[[4.5,'20A'],[8.8,'20A'],[15,'20A'],[16,'25A'],[25,'25A'],[26,'32A'],[42,'32A'],[57,'40A'],[94,'50A'],[100,'65A'],[200,'80A'],[300,'100A']];
  for(const [v,p] of cases){ app.run(`S.tank.effective=${v}; S.pump.inletPipe='auto';`); assert.equal(app.run('inletPipeOf()'),p,v+'㎥'); }
  // 유효용량이 없으면 총용량
  app.run(`S.tank.effective=0; S.tank.volume=30;`); assert.equal(app.run('inletPipeOf()'),'32A');
  app.run(`S.pump.inletPipe='50A';`); assert.equal(app.run('inletPipeOf()'),'50A');
  // 인입부 품목·오버플로가 따라간다
  app.run(`S.pump.inletPipe='auto'; S.tank.effective=20;`);
  const r=app.run('calcValves()');
  assert.ok(live(r).filter(i=>i.pos==='수도 인입부'&&i.name!=='수격방지기').every(i=>i.pipe==='25A'));
  assert.equal(r.list.find(i=>i.pos==='저수조 오버플로').pipe,'50A');
  assert.ok(app.run('allChecks()').some(x=>/인입관 자동 25A/.test(x.msg)));
});

test('PRV 바이패스 — 기본 있음, 샘플대로 글로브 1개(NC), 계통도에도 글로브만', ()=>{
  const app=load(); app.run(`S.groups[0].prv=true; S.groups[0].pipe='65A';`);
  assert.equal(app.run('S.inlet.prvBypass'),true);
  const bp=app.run('calcValves()').list.filter(i=>i.pos==='입상관 1 바이패스');
  assert.equal(bp.length,1); assert.equal(bp[0].name,'글로브밸브'); assert.equal(bp[0].qty,1); assert.equal(bp[0].state,'NC');
  app.run('renderDiagram()');
  assert.match(app.els.diagramPanel.innerHTML,/>바이패스</);
  // 옛 저장본(바이패스 제외·인입 50A 예제값)은 한 번만 새 기본으로
  const old=load(JSON.stringify({projectName:'x',pump:{count:2,set:true,pressure:7,flow:300,mainPipe:'100A',pumpPipe:'65A',inletPipe:'50A'},
    building:{floors:5,floorHeight:3.5,targetPressure:3,prvPressure:2.5,tankHeight:3},inlet:{prvBypass:false},groups:[]}));
  assert.equal(old.run('S.inlet.prvBypass'),true); assert.equal(old.run('S.pump.inletPipe'),'auto');
  old.run(`S.inlet.prvBypass=false; normalizeState();`); assert.equal(old.run('S.inlet.prvBypass'),false);   // 두 번째부터는 사용자 값 유지
});

test('삭제 — 마찰손실 검토 · 기계실 물량 · 설계 목표압력 · 토출압 · 버터플라이 시작 · 최대 급수량 · 「회사 표준」', ()=>{
  const app=load(); app.run(`S.pump.pressureMax=8; S.groups[0].prv=true;`);
  for(let i=0;i<5;i++) app.run(`switchTab(${i})`);
  const st=app.els.settingsPanel.innerHTML, vl=app.els.valvePanel.innerHTML;
  assert.doesNotMatch(st,/마찰손실 검토|기계실 물량|설계 목표압력|토출압 P<sub>op|버터플라이 시작|최대 급수량|흐린 칸 = 회사 표준|인입부 · 밸브 세트 — 회사 표준|펌프 접속 관경/);
  assert.doesNotMatch(vl,/기계실 물량/);
  for(const f of ['groupFriction','calcMR','mrHTML','frictionHTML','floorTableHTML']) assert.equal(app.run(`typeof ${f}`),'undefined',f);
});

test('감압 설정압 — 존별 입력(kPa), 범위 = 높이차 + 말단 필요압 ~ 550 kPa(최저층), 범위 밖이면 위반', ()=>{
  const app=load();
  app.run(`S.building.floors=8; S.building.floorHeight=3.5; S.pump.pressureMax=8; renderAll(); splitZoneA(S.groups[0].id);`);
  const low=app.run(`S.groups.find(g=>g.zoneRole==='low')`);
  assert.ok(low.prv);
  const pr=app.run(`prvRange(S.groups.find(g=>g.zoneRole==='low'))`);
  assert.ok(Math.abs(pr.lowKPa-((low.toFloor-1)*3.5*9.81+100))<0.01); assert.equal(pr.upKPa,550);
  // 미입력 → 확인 목록 「입력하세요」, 하한값으로 표시
  assert.ok(app.run('allChecks()').some(x=>x.lv==='c'&&/설정압 미입력/.test(x.msg)));
  app.run(`setGroupPrvKPa(S.groups.find(g=>g.zoneRole==='low').id,'350');`);
  assert.ok(Math.abs(app.run(`S.groups.find(g=>g.zoneRole==='low').prvSet`)*98.0665-350)<1e-6);
  assert.ok(!app.run('allChecks()').some(x=>/설정압 미입력/.test(x.msg)));
  // 하한 미만 → 위반
  app.run(`setGroupPrvKPa(S.groups.find(g=>g.zoneRole==='low').id,'150');`);
  assert.ok(app.run('allChecks()').some(x=>x.lv==='v'&&/하한/.test(x.msg)));
  app.run('renderSettings()');
  assert.match(app.els.settingsPanel.innerHTML,/감압 설정압 kPa[\s\S]*?범위 \d+ ~ 550 kPa 미만/);
});

test('층 주관 ↔ 화장실 — 1층 a·b, 4층 a 가 그 층 주관 아래로 묶인다(목록·계통도·존 나누기)', ()=>{
  const app=load();
  app.run(`S.building.floors=5; renderAll(); const g=S.groups[0];
    g.zones=[{name:'화장실a',pipe:'40A',floorNo:1},{name:'화장실b',pipe:'40A',floorNo:1},{name:'4층 화장실a',pipe:'32A',floorNo:4},{name:'미지정',pipe:'25A',floorNo:null}];`);
  const r=app.run('calcValves()');
  const pos=r.list.map(i=>i.pos);
  const i1=pos.indexOf('입상관 1 1층 주관'), i2=pos.indexOf('입상관 1 2층 주관');
  assert.equal(pos[i1+1],'입상관 1 1층 > 화장실a'); assert.equal(pos[i1+2],'입상관 1 1층 > 화장실b'); assert.ok(i2>i1+2);
  assert.equal(pos[pos.indexOf('입상관 1 4층 주관')+1],'입상관 1 4층 > 4층 화장실a');
  assert.ok(pos.indexOf('입상관 1 > 미지정')>pos.indexOf('입상관 1 5층 주관'));
  assert.equal(r.summary['볼밸브']-0>=5+4,true);
  assert.ok(app.run('allChecks()').some(x=>/화장실 1개 층 미지정/.test(x.msg)));
  const lines=app.run('groupBoxLines(S.groups[0])');
  assert.ok(lines.some(t=>/^1층 BV 40A — 화장실a·화장실b/.test(t)));
  assert.ok(lines.some(t=>/^4층 BV/.test(t)));
  assert.ok(lines.some(t=>/그 밖의 층 주관 BV × 3/.test(t)));
  assert.ok(lines.some(t=>/층 미지정 화장실 BV × 1/.test(t)));
  // 존 나누기 — 화장실도 층대로 저층/고층으로 간다
  app.run(`S.pump.pressureMax=7; renderAll(); splitZoneA(S.groups[0].id,2);`);
  const lo=app.run(`S.groups.find(g=>g.zoneRole==='low')`), hi=app.run(`S.groups.find(g=>g.zoneRole==='high')`);
  assert.deepEqual(lo.zones.map(z=>z.name),['화장실a','화장실b']);
  assert.deepEqual(hi.zones.map(z=>z.name),['4층 화장실a','미지정']);
  app.run(`zoneShift(S.groups.find(g=>g.zoneRole==='high').id,2);`);   // 경계 4층으로
  assert.deepEqual(app.run(`S.groups.find(g=>g.zoneRole==='low').zones.map(z=>z.name)`),['화장실a','화장실b','4층 화장실a']);
});

test('위생배관 연동 — 층 번호는 이름에서(순서 아님), 화장실은 floors[].zoneIds 로 층에 묶고, MAIN 관경을 메인관으로', ()=>{
  const app=load();
  const res={ruleVersion:'t',floorH:3.5,cw:{main:{cwPipe:80},risers:[{name:'R1',cwPipe:65,reqKPa:100,
    floors:[{id:'f1',name:'1층',cwPipe:40,zoneIds:['z1','z2']},{id:'f4',name:'4층',cwPipe:32,zoneIds:['z3']}],
    zones:[{id:'z1',name:'화장실a',cwPipe:32},{id:'z2',name:'화장실b',cwPipe:32},{id:'z3',name:'화장실a',cwPipe:25},{id:'z9',name:'옥상',cwPipe:20}]}]}};
  const got=app.run(`mapWaterResults(${JSON.stringify(res)})`);
  assert.equal(got.mainPipe,'80A');
  const g=got.groups[0];
  assert.deepEqual(g.floorPipes.map(f=>f.floorNo),[1,4]);   // 종전에는 1·2
  assert.equal(g.fromFloor,1); assert.equal(g.toFloor,4);
  assert.deepEqual(g.zones.map(z=>z.floorNo),[1,1,4,null]);
  assert.equal(got.noFloor,1); assert.equal(got.guessed,false);
  // 이름에 층이 없으면 순서대로 넣고 알린다
  const g2=app.run(`mapWaterResults({cw:{risers:[{name:'R',cwPipe:50,floors:[{name:'지상'},{name:'옥탑'}],zones:[]}]}})`);
  assert.equal(g2.guessed,true); assert.deepEqual(g2.groups[0].floorPipes.map(f=>f.floorNo),[1,2]);
});

test('펼친 상세는 다시 그려도 그대로, 인쇄 때는 모두 펼침', ()=>{
  const app=load();
  app.run('renderSettings()');
  assert.doesNotMatch(app.els.settingsPanel.innerHTML,/data-k="sec4" ontoggle="detTog\(this\)" open/);
  app.run(`detTog({open:true,dataset:{k:'sec4'}}); detTog({open:true,dataset:{k:'g-'+S.groups[0].id}}); setBuilding('floors',6); renderSettings();`);
  const h=app.els.settingsPanel.innerHTML;
  assert.match(h,/data-k="sec4" ontoggle="detTog\(this\)" open/);
  assert.match(h,new RegExp(`data-k="g-${app.run('S.groups[0].id')}" ontoggle="detTog\\(this\\)" open`));
  app.run(`detTog({open:false,dataset:{k:'sec4'}}); PRINT_ALL=true; renderSettings();`);
  assert.match(app.els.settingsPanel.innerHTML,/data-k="sec4" ontoggle="detTog\(this\)" open/);
  app.run(`PRINT_ALL=false; renderSettings();`);
  assert.doesNotMatch(app.els.settingsPanel.innerHTML,/data-k="sec4" ontoggle="detTog\(this\)" open/);
});
