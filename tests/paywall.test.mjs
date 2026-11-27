// 2026-11-27 유료화 (웹앱_유료화_기준.md, CH-20261127-02) 회귀 시험 — 실행: node --test tests/paywall.test.mjs
//   auth.js 는 위생배관 앱(v5)과 같은 파일. 백엔드(license.gs) 시험은 위생배관 저장소에 있다.
//   가짜 구글 로그인·가짜 서버로 자동 체험 · 배너 · 만료 결제 안내 · 신청·피드백 본문 · 이메일이 URL 에 안 실림
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const AUTH=fs.readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const HTML=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

// ── auth.js 화면 흐름 (가짜 DOM) ──
function loadAuth(serverReplies){
  const els={}, fetches=[];
  const el=(id)=>{ const e={id, style:{}, _html:'', className:'', value:'', checked:false, textContent:'', children:[],
    set innerHTML(v){ this._html=v; }, get innerHTML(){ return this._html; },
    appendChild(c){ this.children.push(c); }, addEventListener(){}, remove(){ delete els[this.id]; } }; return e; };
  els['auth-gate']=el('auth-gate'); els['app-content']=el('app-content'); els['app-content'].style.display='none';
  let cb=null;
  // 등록된 요소 안의 html 에 그 id 가 있으면 그때 요소를 만든다 (입력칸·버튼 상자)
  const doc={ getElementById:id=>{ if(els[id]) return els[id]; for(const k of Object.keys(els)) if(els[k]._html&&els[k]._html.includes(`id="${id}"`)) return (els[id]=el(id)); return null; },
    getElementsByName:()=>[],
    createElement:()=>{ const e=el(''); return new Proxy(e,{ set(t,k,v){ t[k]=v; if(k==='id') els[v]=t; return true; } }); },
    head:{appendChild(){}}, body:{ insertBefore:(n)=>{ els[n.id]=n; }, appendChild:(n)=>{ if(n.id) els[n.id]=n; }, firstChild:null }, referrer:'' };
  const replies=serverReplies.slice();
  const ctx={ console, document:doc, location:{reload(){},search:''}, URLSearchParams, URL, alert(m){ throw new Error('alert: '+m); },
    navigator:{clipboard:{writeText:()=>Promise.resolve()}}, setTimeout:()=>0,
    atob:(b)=>Buffer.from(b,'base64').toString('binary'), escape, decodeURIComponent,
    google:{accounts:{id:{ initialize:(o)=>{cb=o.callback;}, renderButton(){}, disableAutoSelect(){} }}},
    fetch:(url,opt)=>{ fetches.push({url,opt}); const r=replies.shift(); return Promise.resolve({ok:true,text:()=>Promise.resolve(JSON.stringify(r))}); } };
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(AUTH,ctx);
  vm.runInContext(`MEPAuth.init({clientId:'c',apiUrl:'https://script.google.com/x',appId:'valve',appName:'밸브 계통도 계산서',trialDays:7,bonusDays:7,priceSingle:40000,priceBundle:0,bankInfo:'카카오뱅크 3333-07-0554442 (최일권)'})`,ctx);
  const jwt='h.'+Buffer.from(JSON.stringify({email:'u@x.com'})).toString('base64')+'.s';
  const settle=async()=>{ for(let i=0;i<12;i++) await new Promise(r=>setImmediate(r)); };
  const click=async(label)=>{ const b=els['mep-modal-actions'].children.find(x=>x.textContent.includes(label)); assert.ok(b,label); b.onclick(); await settle(); };
  return {els, fetches, run:c=>vm.runInContext(c,ctx), login:async()=>{ cb({credential:jwt}); await settle(); }, click, settle};
}
const bodies=a=>a.fetches.map(f=>JSON.parse(f.opt.body));

test('auth.js — 처음 로그인: 버튼 없이 체험 발급 → 계산 화면 + 배너, 이메일은 URL 에 없음', async ()=>{
  const a=loadAuth([{ok:true,approved:false,status:'none',trialAvailable:true},{ok:true,approved:true,status:'trial',daysLeft:7,expires:'2026-12-03'}]);
  assert.match(a.els['auth-gate'].innerHTML,/7일 무료/); assert.match(a.els['auth-gate'].innerHTML,/40,000원/);
  await a.login();
  assert.deepEqual(bodies(a).map(b=>b.action),['check','trial']);
  assert.equal(a.els['app-content'].style.display,'block'); assert.equal(a.els['auth-gate'].style.display,'none');
  const b=a.els['mep-banner'].innerHTML;
  assert.match(b,/무료 체험 <b>7일 남음<\/b>/); assert.match(b,/피드백 내면 7일 연장/); assert.match(b,/평생이용권 결제 안내/);
  for(const f of a.fetches){ assert.ok(!f.url.includes('u@x.com')); assert.ok(!f.url.includes('?')); }
});

test('auth.js — 결제한 사람은 배너 없음, 피드백 연장을 쓴 사람은 「적용됨」', async ()=>{
  let a=loadAuth([{ok:true,approved:true,status:'paid',daysLeft:null}]); await a.login();
  assert.equal(a.els['app-content'].style.display,'block'); assert.equal(a.els['mep-banner'],undefined);
  a=loadAuth([{ok:true,approved:true,status:'trial',daysLeft:3,feedbackDone:true,expires:'2026-12-01'}]); await a.login();
  assert.match(a.els['mep-banner'].innerHTML,/피드백 연장 적용됨/); assert.match(a.els['mep-banner'].innerHTML,/2026-12-01까지/);
});

test('auth.js — 만료: 계산 화면 대신 결제 안내(40,000원 · 피드백 연장 · 다시 확인), 신청 대기 표시, 「영구 무료」 없음', async ()=>{
  const a=loadAuth([{ok:true,approved:false,status:'expired',feedbackDone:false,payPending:true,price:40000}]); await a.login();
  const g=a.els['auth-gate'].innerHTML;
  assert.equal(a.els['app-content'].style.display,'none');
  for(const t of ['무료 체험이 끝났습니다','40,000원','평생이용권 결제 안내','피드백 보내고 7일 더 쓰기','입금을 확인하고 있습니다','다시 확인','다른 계정으로']) assert.ok(g.includes(t),t);
  assert.doesNotMatch(g+HTML+AUTH,/영구 무료|무료로 계속|평생 무료/);
});

test('auth.js — 평생이용권 신청: 이 앱 40,000원·입금자명, 세금계산서 발행 안 함 안내', async ()=>{
  const a=loadAuth([{ok:true,approved:false,status:'expired',feedbackDone:true},{ok:true,received:true}]); await a.login();
  a.run('MEPAuth.openPurchase()');
  const m=a.els['mep-modal'].innerHTML;
  assert.match(m,/40,000원/); assert.match(m,/다른 앱은 따로/); assert.match(m,/3333-07-0554442/); assert.match(m,/발행해 드릴 수 없습니다/);
  a.run(`document.getElementById('mep-f-depositor').value='홍길동'`);
  await a.click('입금했습니다');
  const p=bodies(a)[1]; assert.equal(p.action,'purchase'); assert.equal(p.apps,'valve'); assert.equal(p.amount,'40000'); assert.equal(p.depositor,'홍길동');
  assert.match(a.els['auth-gate'].innerHTML,/입금을 확인하고 있습니다/);
});

test('auth.js — 만료 뒤 피드백(고객 항목)을 보내 연장되면 바로 계산 화면으로', async ()=>{
  const a=loadAuth([{ok:true,approved:false,status:'expired',feedbackDone:false},{ok:true,approved:true,status:'trial',daysLeft:7,feedbackDone:true,extendedDays:7}]); await a.login();
  a.run('MEPAuth.openProfile()');
  const m=a.els['mep-modal'].innerHTML;
  for(const id of ['mep-f-company','mep-f-years','mep-f-role','mep-f-pain','mep-f-pain-detail','mep-f-channel','mep-f-consent']) assert.ok(m.includes(`id="${id}"`),id);
  assert.match(m,/앱마다 1회/);
  a.run(`document.getElementById('mep-f-company').value='○○엔지니어링'; document.getElementById('mep-f-pain').value='계통도 작도 시간';`);
  await a.click('보내고 7일 연장');
  const p=bodies(a)[1]; assert.equal(p.action,'profile'); assert.equal(p.company,'○○엔지니어링'); assert.equal(p.pain,'계통도 작도 시간');
  assert.equal(a.els['app-content'].style.display,'block'); assert.match(a.els['mep-banner'].innerHTML,/피드백 연장 적용됨/);
});


test('index.html — 로그인 관문과 판매 설정(앱별 40,000원 · 계좌 · 같은 백엔드 주소)', ()=>{
  assert.ok(HTML.includes('<div id="auth-gate"></div>')); assert.ok(HTML.includes('src="auth.js?v=5"'));
  assert.ok(HTML.includes('<div id="app-content" style="display:none;">'));
  assert.match(HTML,/appId:\s*"valve"/); assert.match(HTML,/appName:\s*"밸브 계통도 계산서"/);
  assert.match(HTML,/priceSingle: 40000/); assert.match(HTML,/priceBundle: 0/); assert.match(HTML,/trialDays: 7, bonusDays: 7/);
  assert.match(HTML,/bankInfo:\s*"카카오뱅크 3333-07-0554442 \(최일권\)"/);
  assert.match(HTML,/AKfycbzOwmnJdBeqkH4QMdbQRagHXFnOA7sXnkQDmGeerVi4mYUF9WL_vB3C8LIq1-AZekQX/);
  assert.match(HTML,/631559035777-ara2uhplj7ds41ehfrr97cef8jlj4rip/);
  // 관문이 본문보다 앞, 앱 본문(헤더·탭·계산 스크립트) 전체가 app-content 안
  const g=HTML.indexOf('id="auth-gate"'), a=HTML.indexOf('<div id="app-content"'), e=HTML.indexOf('</div><!-- /#app-content -->');
  assert.ok(g>0&&g<a&&a<HTML.indexOf('<header>')&&HTML.indexOf('switchTab(hadSaved?1:0)')<e&&e<HTML.indexOf('</body>'));
});

test('auth.js — 위생배관 v5 와 같은 파일', ()=>{
  const sani=new URL('file:///C:/Users/800G9Win10/sanitary-pipe-calc-ch02/auth.js');
  if(!fs.existsSync(sani)) return;   // 다른 PC 에서는 건너뜀
  assert.equal(AUTH.split(String.fromCharCode(13)).join(''), fs.readFileSync(sani,'utf8').split(String.fromCharCode(13)).join(''));
});
