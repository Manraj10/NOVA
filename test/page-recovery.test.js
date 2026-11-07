import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const code=src.match(/async function pageMoved\(resume\) \{[\s\S]*?\n\}/)[0];
function setup(o={}) {
  const calls=[],shots=[],spoken=[];
  const S={mode:'guide',epoch:1,i:1,lang:'en',reviewed:true,tip:{x:.3,y:.4},tipSeen:99,fields:[
    {label:'Name',x0:.1,y0:.2,x1:.6,y1:.24,done:true,answer:'Alex'},
    {label:'Email',x0:.1,y0:.4,x1:.65,y1:.44,done:false,answer:'pending',needsReview:true}],...o.state};
  const model={xx:1,xy:0,yx:0,yy:1,tx:12,ty:6,w:1200,h:900,analysisScale:3.75}; let fits=0;
  const ctx={S,performance:{now:()=>100},drift:{
    relocation:s=>{calls.push(['fit',s.img]);return o.models ? o.models[fits++] ?? null : {...model};},
    capture:(s,r,m)=>{calls.push(['capture',s.img,r,m]);return o.capture!==false;}},
    snapshot:(_,s)=>{const canvas={id:shots.length};shots.push(canvas);Object.assign(s,{canvas,w:1200,h:900});return'image';},
    handRects:()=>[{x0:.7,y0:.6,x1:.9,y1:.9}],readback:{hide(){}},setMode:m=>{S.mode=m;},renderLists(){},
    say:async x=>{spoken.push(x);if(o.cancelSay){S.epoch++;S.mode='idle';}},
    wait:async()=>{if(o.cancelWait){S.epoch++;S.mode='idle';}},t:()=>({moved:'Rereading.',noLock:'No lock.'}),
    api:async(route,body)=>{calls.push([route,body]);return{fields:S.fields.map(f=>({...f}))};},
    warmVoice(){},captureDrift(){S.driftOn=true;},activate:i=>{calls.push(['activate',i]);S.mode='guide';},
    review:()=>calls.push(['review']),finishWriting:()=>calls.push(['finishWriting']),setCue(){},speakErr(e){throw e;}};
  vm.createContext(ctx);vm.runInContext(`${code};this.run=pageMoved;`,ctx);
  return{S,calls,shots,spoken,model,run:ctx.run};
}
const parses=c=>c.calls.filter(x=>x[0]==='/api/parse').length;
test('coherent movement remaps locally; preserves place, kept and proposed answers; masks hands on exact final frame',async()=>{
  const c=setup();await c.run();assert.equal(parses(c),0);assert.equal(c.S.mode,'guide');assert.equal(c.S.i,1);
  assert.equal(c.S.fields[0].done,true);assert.equal(c.S.fields[0].answer,'Alex');assert.equal(c.S.fields[1].done,false);
  assert.equal(c.S.fields[1].answer,'pending');assert.equal(c.S.fields[1].needsReview,true);
  assert.ok(Math.abs(c.S.fields[1].x0-.11)<1e-12);assert.ok(Math.abs(c.S.fields[1].y0-(.4+6/900))<1e-12);
  assert.equal(c.S.reviewed,false);assert.equal(c.S.tip,null);assert.equal(c.S.tipSeen,0);assert.equal(c.spoken.join(' '),'The page moved. I adjusted.');
  const capture=c.calls.find(x=>x[0]==='capture');assert.equal(capture[1],c.shots[1]);assert.equal(capture[3].length,1);
});
test('find target and its return mode survive correction',async()=>{
  const c=setup({state:{mode:'find',find:{label:'Total',x0:.2,y0:.6,x1:.4,y1:.65,back:'write',q:'total'}}});await c.run();
  assert.equal(parses(c),0);assert.equal(c.S.mode,'find');assert.equal(c.S.find.back,'write');assert.equal(c.S.find.q,'total');assert.ok(Math.abs(c.S.find.x0-.21)<1e-12);
});
test('writing checkpoint resumes same field readback without accepting it',async()=>{
  const c=setup({state:{mode:'read'}});await c.run('read');assert.equal(parses(c),0);assert.equal(c.S.i,1);assert.equal(c.S.mode,'write');
  assert.ok(c.calls.some(x=>x[0]==='finishWriting'));assert.equal(c.S.fields[1].done,false);
});
test('unknown registration falls back to one parse',async()=>{const c=setup({models:[null,null,null,null]});await c.run();assert.equal(parses(c),1);assert.ok(!c.calls.some(x=>x[0]==='capture'));});
test('failed recapture restores old coordinates before fallback',async()=>{const c=setup({capture:false});await c.run();assert.equal(parses(c),1);assert.equal(c.S.fields[1].x0,.1);assert.equal(c.S.fields[0].answer,'Alex');});
test('out-of-frame geometry is rejected, never clamped into validity',async()=>{const m={...setup().model,tx:1100};const c=setup({models:[m,m]});await c.run();assert.equal(parses(c),1);assert.ok(!c.calls.some(x=>x[0]==='capture'));});
test('requires two agreeing observations and captures only their final fitted frame',async()=>{
  const a=setup().model,b={...a,tx:24},c=setup({models:[a,b,b]});await c.run();assert.equal(parses(c),0);assert.equal(c.shots.length,3);
  assert.equal(c.calls.find(x=>x[0]==='capture')[1],c.shots[2]);assert.ok(Math.abs(c.S.fields[1].x0-.12)<1e-12);
});
for(const key of ['cancelWait','cancelSay'])test(`a newer epoch during ${key} cannot resume old guidance`,async()=>{const c=setup({[key]:true});await c.run();assert.equal(parses(c),0);assert.equal(c.S.mode,'idle');});
test('stale field geometry remains unknown',async()=>{const c=setup();c.S.fields.push({label:'Old',done:true,answer:'kept',stale:true});await c.run();assert.equal(parses(c),0);assert.equal(c.S.fields[2].x0,undefined);assert.equal(c.S.fields[2].stale,true);});
test('repeated rotation and inverse rotation do not inflate field boxes',async()=>{
  const a=Math.cos(Math.PI/180),b=Math.sin(Math.PI/180),m=setup().model;
  const forward={...m,xx:a,xy:-b,yx:b,yy:a,tx:0,ty:0},back={...m,xx:a,xy:b,yx:-b,yy:a,tx:0,ty:0};
  let fields=setup().S.fields;const original=JSON.parse(JSON.stringify(fields));
  for(let i=0;i<4;i++)for(const model of [forward,back]){const c=setup({models:[model,model],state:{fields}});await c.run();assert.equal(parses(c),0);fields=c.S.fields;}
  for(let i=0;i<fields.length;i++)for(const k of ['x0','y0','x1','y1'])assert.ok(Math.abs(fields[i][k]-original[i][k])<1e-12,`${i}.${k}`);
});
