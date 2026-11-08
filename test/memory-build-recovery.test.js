import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(new URL('../public/memory/app.js',import.meta.url),'utf8');
const fn=name=>{const m=source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));assert(m,name);return m[0];};
const {loadVoice}=createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const router=loadVoice(fileURLToPath(new URL('../public/voice.js',import.meta.url))).voice;
const flush=()=>new Promise(r=>setImmediate(r));
function fixture({hangImage=false,rejectImage=false}={}){let now=0,id=0;const timers=new Map(),intervals=new Map(),requests=[],spoken=[],stages=[],entered=[],nodes=new Map(),destinations=[],imageLoads=[],bubbles=[];
 const $=key=>{if(!nodes.has(key))nodes.set(key,{hidden:false,textContent:'',value:'',innerHTML:'',src:'',setAttribute(){},style:{},classList:{toggle(){}}});return nodes.get(key);};
 const context={AbortController,console:{warn(){}},run:1,step:'home',later:[],current:null,window:{},retry:null,performance:{now:()=>now},MUSIC:/music/i,
  document:{hidden:false},collected:'',windowUntil:0,leaving:false,listeningPaused:false,listenGeneration:0,changeTok:0,soundTok:0,changing:false,ears:null,autoMic:null,music:null,view:null,
  location:{set href(url){destinations.push(url);}},clearCollection(){},
  $,show(){},bubble:(who,text)=>{const el={setAttribute(){},style:{}};bubbles.push({who,text,el});return el;},voice:{seq:0,speaking:false,say(text){spoken.push(text);this.seq++;return Promise.resolve();},stop(){this.seq++;}},
  setTimeout(fn,ms){const key=++id;timers.set(key,{fn,at:now+ms});return key;},clearTimeout:key=>timers.delete(key),
  setInterval(fn,ms){const key=++id;intervals.set(key,{fn,at:now+ms,ms});return key;},clearInterval:key=>intervals.delete(key),
  steps:()=>{const owner=context.run;return{tick(){stages.push(['tick',owner]);$('clock').textContent=`Build ${owner}`;},go:k=>stages.push(['go',k,owner]),done:k=>stages.push(['done',k,owner]),bad:(k,msg)=>stages.push(['bad',k,msg,owner]),finish:()=>stages.push(['finish',owner]),fail:()=>stages.push(['fail',owner])};},
  load:image=>rejectImage?Promise.reject(Error('Image failed')):hangImage?new Promise((resolve,reject)=>imageLoads.push({image,resolve,reject})):Promise.resolve({src:image}),shrink:()=> 'mock-jpeg',paintBack:()=>new Promise(()=>{}),fillBehind(){},makeLoop:()=>({loop:{},L:1,s:0,w:1}),placeholderBack:()=>({}),equirect:()=>({}),tagsFrom:()=>[],startSound(){},
  enter:room=>entered.push(room),sayAndListen:text=>spoken.push(text),
  fetch(url,init){return new Promise((resolve,reject)=>requests.push({url,init,resolve,reject}));},
 };
 vm.createContext(context);vm.runInContext(source.match(/const L = \{[\s\S]*?\n\};/)[0]+'\n'+['api','loadFrontImage','build','converse','command','go'].map(fn).join('\n'),context);
 const request=name=>requests.filter(r=>r.url.endsWith('/'+name)).at(-1);
 const respond=async(name,value,ok=true)=>{request(name).resolve({ok,json:async()=>value});await flush();};
 return{context,requests,spoken,stages,entered,$,request,respond,destinations,imageLoads,bubbles,timerCount:()=>timers.size+intervals.size,activeIntervals:()=>intervals.size,
 async advance(ms){const end=now+ms;for(;;){const next=[...[...timers].map(([key,t])=>({key,t,interval:false})),...[...intervals].map(([key,t])=>({key,t,interval:true}))].filter(v=>v.t.at<=end).sort((a,b)=>a.t.at-b.t.at)[0];if(!next)break;now=next.t.at;if(next.interval)next.t.at+=next.t.ms;else timers.delete(next.key);next.t.fn();await flush();}now=end;await flush();}};
}
for(const [stage,ms] of Object.entries({ask:22000,spec:30000,scene:70000,back:70000,fix:70000,labels:50000,sound:125000}))test(`${stage} deadline permits its server budget, then aborts even an uncooperative fetch`,async()=>{
 const f=fixture(),p=f.context.api(stage,{}),rejected=assert.rejects(p,e=>e.name==='TimeoutError'&&e.message.includes(stage));
 await f.advance(ms-1);assert.equal(f.request(stage).init.signal.aborted,false);await f.advance(1);await rejected;
 assert.equal(f.request(stage).init.signal.aborted,true);assert.equal(f.timerCount(),0);
 // A response arriving after the local rejection cannot turn it into success.
 await f.respond(stage,{late:true});await flush();assert.equal(f.timerCount(),0);
});
test('deadline covers hung JSON parsing after HTTP headers arrive',async()=>{
 const f=fixture(),p=f.context.api('spec',{});let body;f.request('spec').resolve({ok:true,json:()=>new Promise(r=>{body=r;})});await flush();
 const rejected=assert.rejects(p,e=>e.name==='TimeoutError');await f.advance(30000);await rejected;assert(f.request('spec').init.signal.aborted);
 body({late:true});await flush();assert.equal(f.timerCount(),0);
});
test('normal JSON response cleans its deadline and remains usable',async()=>{const f=fixture(),p=f.context.api('spec',{});await f.respond('spec',{title:'Living room'});assert.equal((await p).title,'Living room');assert.equal(f.timerCount(),0);});
test('HTTP failure stays readable and clears its timer',async()=>{const f=fixture(),p=f.context.api('scene',{}),rejected=assert.rejects(p,/No picture credit/);await f.respond('scene',{error:'No picture credit'},false);await rejected;assert.equal(f.timerCount(),0);});
test('scene timeout speaks retry, successful retry enters once, old response cannot revive',async()=>{
 const f=fixture(),p=f.context.build('The living room where we watched basketball.',1);await f.respond('spec',{memory:'living room',title:'Living room'});const old=f.request('scene');
 await f.advance(70000);await p;assert(f.spoken.includes('I couldn’t finish the room. Say try again or Home.'));assert.equal(typeof f.context.retry,'function');assert.equal(f.entered.length,0);
 const retry=f.context.command('try again');assert.equal(typeof retry,'function');retry();await flush();assert.equal(f.context.run,2);
 await f.respond('scene',{image:'new-front'});await f.respond('spec',{memory:'living room',title:'Living room'});await f.respond('labels',{title:'Living room',elements:[]});await flush();assert.equal(f.entered.length,1);assert.equal(f.entered[0].sid,2);
 old.resolve({ok:true,json:async()=>({image:'late-old-front'})});await flush();assert.equal(f.entered.length,1);assert.equal(f.entered[0].front.src,'new-front');
});
test('scene timeout leaves actual Home navigation usable and old completion stays inert',async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});const old=f.request('scene');await f.advance(70000);await p;
 const destination=router.navigation('Hey Nib, can you go home');assert.equal(destination,'home');f.context.go(destination);await flush();assert.deepEqual(f.destinations,['../']);
 old.resolve({ok:true,json:async()=>({image:'old-front'})});await flush();assert.equal(f.entered.length,0);assert.equal(f.context.step,'leaving');
});
for(const stage of ['spec','labels'])test(`${stage} timeout falls back instead of blocking room entry`,async()=>{
 const f=fixture(),p=f.context.build('A living room during a basketball game.',1);
 await f.respond('scene',{image:'front'});
 if(stage==='spec')await f.advance(30000);else await f.respond('spec',{memory:'a living room'});
 if(stage==='labels')await f.advance(50000);else await f.respond('labels',{title:'Living room',elements:[]});
 await p;assert.equal(f.entered.length,1);
});

test('front image decode/load timeout recovers instead of staying Building after the API finished',async()=>{
 const f=fixture({hangImage:true}),p=f.context.build('A living room.',1);
 await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'stalled-image'});await f.advance(15000);await p;
 assert(f.stages.some(x=>x[0]==='fail'));assert.equal(typeof f.context.retry,'function');assert.equal(f.entered.length,0);
 assert(f.spoken.includes('I couldn’t finish the room. Say try again or Home.'));assert.equal(f.timerCount(),0);
});
test('late front image from a failed attempt cannot replace a successful retry',async()=>{
 const f=fixture({hangImage:true}),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'old-image'});
 await f.advance(15000);await p;f.context.load=async src=>({src});f.context.command('try again')();
 await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'new-image'});await f.respond('labels',{title:'Living room',elements:[]});
 assert.equal(f.entered.length,1);f.imageLoads[0].resolve({src:'late-old-image'});await flush();
 assert.equal(f.entered.length,1);assert.equal(f.entered[0].front.src,'new-image');
});
test('a failed front image reports failure immediately and offers retry',async()=>{
 const f=fixture({rejectImage:true}),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'bad'});await p;
 assert(f.stages.some(x=>x[0]==='fail'));assert.equal(typeof f.context.retry,'function');assert.equal(f.timerCount(),0);
});
test('labels timeout enters with an explicit spoken unavailable-description fallback',async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'front'});
 await f.advance(50000);await p;assert.equal(f.entered.length,1);
 assert.match(f.entered[0].narration,/spoken description was unavailable/);assert.equal(f.entered[0].describe,'');
 assert(!/left|right|ahead|behind/i.test(f.entered[0].narration));
});
test('progress describes the current stage instead of claiming the room is almost ready',async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'front'});
 await f.advance(17000);assert(f.spoken.includes('The picture is ready. I’m adding its spoken description.'));
 assert(!f.spoken.some(s=>/Almost there|half a minute/.test(s)));await f.respond('labels',{title:'Living room',elements:[]});await p;assert.equal(f.timerCount(),0);
});
test('progress yields to a current listening window and collection',async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);f.context.windowUntil=20000;await f.advance(17000);assert.deepEqual(f.spoken,[]);
 f.context.windowUntil=0;f.context.collected='a user correction';await f.advance(20000);assert.deepEqual(f.spoken,[]);
 await f.respond('scene',{image:'front'});await f.respond('labels',{title:'Living room',elements:[]});await p;
});
test('leaving during a pending image never enters its late room',async()=>{
 const f=fixture({hangImage:true}),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.respond('scene',{image:'old-image'});
 f.context.go(router.navigation('Hey Nib, go home'));await flush();f.imageLoads[0].resolve({src:'old-image'});await p;
 assert.deepEqual(f.destinations,['../']);assert.equal(f.entered.length,0);assert.equal(f.context.step,'leaving');await f.advance(2500);assert.equal(f.timerCount(),0);
});
test('hidden-page build failure updates retry state without resuming speech',async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});f.context.document.hidden=true;
 await f.advance(70000);await p;assert(f.stages.some(x=>x[0]==='fail'));assert.equal(typeof f.context.retry,'function');assert.deepEqual(f.spoken,[]);
});
test('actual step UI failure clears active spinners and labels the build as stopped',()=>{
 const stageNodes=new Map(),head={textContent:''},li={textContent:'',append(){}},clock={textContent:''};
 const ol={className:'',set innerHTML(value){for(const match of value.matchAll(/data-k="([^"]+)"/g))stageNodes.set(match[1],{className:'',stamp:{textContent:''},querySelector(){return this.stamp;}});},
  querySelector(selector){return stageNodes.get(selector.match(/data-k="([^"]+)"/)[1]);},querySelectorAll(){return [...stageNodes.values()].filter(e=>e.className==='go');}};
 const c={document:{createElement:tag=>tag==='span'?head:ol},bubble:()=>li,$:()=>clock,performance:{now:()=>0}};vm.createContext(c);
 vm.runInContext(source.match(/^const STEPS = .*;$/m)[0]+'\n'+fn('steps'),c);const st=c.steps();st.go('spec');st.go('scene');st.fail();
 assert.equal(head.textContent,'Build stopped. Say try again or Home.');assert.equal(clock.textContent,'Build stopped');
 assert.equal(stageNodes.get('spec').className,'bad');assert.equal(stageNodes.get('scene').className,'bad');
 assert.equal(stageNodes.get('scene').stamp.textContent,'not finished');
});

test('status after failure offers retry or Home instead of pretending generation continues',async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.advance(70000);await p;
 f.context.command('how long is left')();assert.equal(f.spoken.at(-1),'I couldn’t finish the room. Say try again or Home.');
});
for(const key of ['Enter',' '])test(`failed-room retry is keyboard accessible with ${key===' '?'Space':key}`,async()=>{
 const f=fixture(),p=f.context.build('A living room.',1);await f.respond('spec',{memory:'living room'});await f.advance(70000);await p;
 const action=f.bubbles.at(-1).el;let prevented=false;action.onkeydown({key,repeat:false,preventDefault(){prevented=true;}});
 assert(prevented);assert.equal(f.context.run,2);assert.equal(action.onclick,null);assert.equal(action.onkeydown,null);
});

test('superseded actual build interval clears itself and old spec/scene cannot touch the newer clock or stages',async()=>{
 const f=fixture(),old=f.context.build('Old room.',1),oldSpec=f.request('spec'),oldScene=f.request('scene');
 await f.advance(250);assert.equal(f.$('clock').textContent,'Build 1');
 f.context.run=2;const newer=f.context.build('New room.',2);await f.advance(250);
 assert.equal(f.activeIntervals(),1);assert.equal(f.$('clock').textContent,'Build 2');
 const before=f.stages.length;oldSpec.resolve({ok:true,json:async()=>({memory:'old room'})});oldScene.resolve({ok:true,json:async()=>({image:'old-image'})});await old;
 assert.equal(f.$('clock').textContent,'Build 2');assert(!f.stages.slice(before).some(row=>row[0]==='done'&&row.at(-1)===1));
 assert.equal(f.$('waitimg').src,'');assert.equal(f.requests.filter(r=>r.url.endsWith('/labels')).length,0);
 await f.respond('spec',{memory:'new room'});await f.respond('scene',{image:'new-image'});await f.respond('labels',{title:'New room',elements:[]});await newer;
 assert.equal(f.entered.length,1);assert.equal(f.entered[0].sid,2);assert.equal(f.activeIntervals(),0);
});
test('living-room Warriors versus Cavaliers Game7 2016 memory reaches the normal room path unchanged',async()=>{
 const memory='I remember our living room in2016, watching Warriors versus Cavaliers Game7 with my family. The television was in front of the couch, the curtains were closed, and a bowl of popcorn sat on the coffee table.';
 const f=fixture(),p=f.context.build(memory,1);
 for(const stage of ['spec','scene'])assert.equal(JSON.parse(f.request(stage).init.body).memory,memory);
 await f.respond('spec',{memory,title:'Family living room'});await f.respond('scene',{image:'imagined-living-room'});
 await f.respond('labels',{title:'Family living room',narration:'You are back in the family living room.',describe:'A television faces the couch.',elements:[]});await p;
 assert.equal(f.entered.length,1);assert.equal(f.entered[0].spec.memory,memory);assert.equal(f.entered[0].front.src,'imagined-living-room');assert.equal(f.context.retry,null);
});
