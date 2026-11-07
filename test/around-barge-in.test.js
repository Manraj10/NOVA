// Actual Around handlers + shared voice parser/echo + real VAD/FIFO. No network/audio/device calls.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {loadVoice}=createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const source=fs.readFileSync(process.env.AROUND_APP_SOURCE || new URL('../public/around-app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const earsSource=fs.readFileSync(new URL('../public/ears.js',import.meta.url),'utf8').replace(/^export /gm,'');
const handler=name=>{const m=source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));assert(m,`actual ${name}`);return m[0];};
const flush=()=>new Promise(r=>setImmediate(r));
async function fixture(t){
 const h=loadVoice(fileURLToPath(new URL('../public/voice.js',import.meta.url))),c=h.context,v=h.voice,processors=[],requests=[],spoken=[],effects=[];
 const node=()=>({connect(n){return n;},disconnect(){}});
 v.ctx={sampleRate:16000,destination:{},resume:async()=>{},createMediaStreamSource:node,createScriptProcessor(){const p=node();processors.push(p);return p;},createGain:()=>({...node(),gain:{value:1}})};
 v.say=function(text){this.stop({resumeEars:false});this.recent.push(text);spoken.push(text);return Promise.resolve();};
 v.earcon=()=>{};v.beep=()=>effects.push('beep');v.speaking=true;v.recent=['A previous automatic scene description.'];
 Object.assign(c,{Date:{now:()=>100000+h.now},document:{hidden:false},location:{href:'https://nib.test/around.html'},snap:()=> 'mock-image',video:{videoWidth:512},
 $:()=>({textContent:''}),sleep:()=>new Promise(()=>{}),chips:()=>effects.push('chips'),countText:()=>'',stairsAlarm:()=>{effects.push('stairs');v.stop();},placeLine:()=> 'A place.',crowdLine:()=> 'Two people.',
 aroundStub:{world:[],people:()=>0,summary:()=> 'Current summary.',update:()=>{effects.push('update');return{say:['Fresh ordinary news.'],hazard:false};}},
 fetch(url,init){return new Promise((resolve,reject)=>requests.push({url,init,resolve,reject}));}});
 vm.runInContext(earsSource+"\nlet heading=0,running=true,gen=1,eyes=null,scene='',lastErrorSaid=0,askUntil=0,asking=false,talking=false,holdNews=0,place='',placeVote='',seen=[],fov=60,earsRef=null;const LOOK='Let me look.',queue=[],LOCAL_NAMES=new Set(),around=aroundStub;const reply=text=>{talking=true;return voice.say(text).finally(()=>{talking=false;});};\n"
 +['startEars','command','askAbout','look','news','speakQueue','whereAmI','tellAll','tellScene','loop'].map(handler).join('\n')
 +(source.includes('function newsHeld(')?'\n'+handler('newsHeld'):'')+'\nthis.state=()=>({asking,running,gen,scene,askUntil,place,queued:queue.length});this.change=code=>eval(code);',c);
 const mic={getTracks:()=>[]};await c.startEars(mic);
 const feed=level=>processors[0].onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(level)}});
 const phrase=()=>{for(let i=0;i<3;i++)feed(.1);for(let i=0;i<6;i++)feed(0);};
 const respond=async(index,payload,status=200)=>{requests[index].resolve({ok:status===200,json:async()=>payload});await flush();};
 const hear=async text=>{const n=requests.length;phrase();assert.equal(requests[n].url,'/api/hear');await respond(n,{text});};
 t.after(()=>c.change('earsRef?.stop();askAbout.current?.controller.abort()'));
 return{c,v,requests,spoken,effects,hear,respond,advance:async ms=>{await h.advance(ms);await flush();},change:s=>c.change(s),state:()=>c.state()};
}
test('fresh question still speaks its response',async t=>{const f=await fixture(t),p=f.c.askAbout('Where is the door?');await f.respond(0,{say:'The door is ahead.'});await p;assert.deepEqual(f.spoken,['Let me look.','The door is ahead.']);assert.equal(f.state().asking,false);});
test('actual VAD wake and follow-up supersede a pending question',async t=>{const f=await fixture(t),old=f.c.askAbout('First question?');await f.hear('Hey Nib');await f.hear('What is that chair?');const qs=f.requests.filter(r=>r.url==='api/around-ask');assert.equal(qs.length,2);assert.equal(qs[0].init.signal.aborted,true);await f.respond(f.requests.indexOf(qs[0]),{say:'OLD'});await old;assert.equal(f.state().asking,true);await f.respond(f.requests.indexOf(qs[1]),{say:'NEW'});await flush();assert(!f.spoken.includes('OLD'));assert.equal(f.spoken.at(-1),'NEW');assert.equal(f.state().asking,false);});
for(const action of ['stop','home','help','whats around me','describe'])test(`actual VAD ${action} invalidates an old answer`,async t=>{const f=await fixture(t),p=f.c.askAbout('First question?');await f.hear('Hey Nib, '+action);await f.respond(0,{say:'STALE ANSWER'});await p;assert(!f.spoken.includes('STALE ANSWER'));});
test('late model error after Stop stays silent',async t=>{const f=await fixture(t),p=f.c.askAbout('First question?');await f.hear('Hey Nib, stop');const last=f.spoken.at(-1);f.requests[0].reject(Error('offline'));await p;assert.equal(f.spoken.at(-1),last);});
test('bare wake holds ordinary look/place/news speech; fresh data may update quietly',async t=>{const f=await fixture(t),look=f.c.look(1);await f.hear('Nib');const n=f.spoken.length;await f.respond(0,{scene:'A classroom.',place:'classroom',items:[]});f.c.news(await look);f.c.whereAmI({place:'classroom',items:[]});await flush();assert.equal(f.spoken.length,n);assert.equal(f.state().place,'');assert(f.effects.includes('update'));});
test('queued nonurgent speech cannot resume through a listening window',async t=>{const f=await fixture(t);await f.hear('Nib');f.change("queue.push({text:'OLD QUEUED NEWS',at:Date.now()});");await f.c.speakQueue();assert(!f.spoken.includes('OLD QUEUED NEWS'));});
test('a current stairs warning still interrupts the listening window',async t=>{const f=await fixture(t);await f.hear('Nib');const p=f.c.look(1),i=f.requests.length-1;await f.respond(i,{items:[{name:'stairs',steps:2}],place:'hall'});await p;assert(f.effects.includes('stairs'));});
test('a current urgent hazard still cuts through listening',async t=>{const f=await fixture(t);await f.hear('Nib');f.c.news({say:['CURRENT HAZARD'],hazard:true});await flush();assert(f.effects.includes('beep'));assert(f.spoken.includes('CURRENT HAZARD'));});
for(const reason of ['hidden','generation','age','turn','heading-loss'])test(`late ${reason} frame cannot update memory, place, chips or stairs`,async t=>{const f=await fixture(t),p=f.c.look(1);if(reason==='hidden')f.c.document.hidden=true;if(reason==='generation')f.change('gen++');if(reason==='age')await f.advance(7000);if(reason==='turn')f.change('heading=180');if(reason==='heading-loss')f.change('heading=null');await f.respond(0,{scene:'OLD SCENE',place:'hall',items:[{name:'stairs',steps:2}]});const out=await p;assert.deepEqual(Array.from(out.say),[]);assert.deepEqual(f.effects,[]);assert.equal(f.state().scene,'');});
for(const reason of ['hidden','generation','age','turn','heading-loss'])test(`old question response after ${reason} stays silent`,async t=>{const f=await fixture(t),p=f.c.askAbout('What is ahead?');if(reason==='hidden')f.c.document.hidden=true;if(reason==='generation')f.change('gen++');if(reason==='age')await f.advance(7000);if(reason==='turn')f.change('heading=180');if(reason==='heading-loss')f.change('heading=null');await f.respond(0,{say:'OLD ANSWER'});await p;assert(!f.spoken.includes('OLD ANSWER'));});
test('watcher aborts stopped question and clears asking even if network ignores abort',async t=>{const f=await fixture(t);f.c.askAbout('What is ahead?');await f.hear('Nib');await f.advance(210);assert(f.requests[0].init.signal.aborted);assert.equal(f.state().asking,false);});
test('paused question is allowed without restarting the camera loop',async t=>{const f=await fixture(t);f.change('running=false');const p=f.c.askAbout('What is on the table?');await f.respond(0,{say:'A cup.'});await p;assert.equal(f.spoken.at(-1),'A cup.');assert.equal(f.state().running,false);});

test('validated reply keeps its conversational turn while its own audio is still playing',async t=>{
 const f=await fixture(t),say=f.v.say;let finish;
 f.v.say=function(text){say.call(this,text);return text==='LONG ANSWER'?new Promise(r=>{finish=r;}):Promise.resolve();};
 const question=f.c.askAbout('What is ahead?');await f.respond(0,{say:'LONG ANSWER'});
 assert.equal(f.state().asking,true);await f.advance(250);
 assert.equal(f.state().asking,true,'its own reply seq must not look like a newer interruption');
 f.c.news({say:['NEWS MUST WAIT'],hazard:false});await flush();assert(!f.spoken.includes('NEWS MUST WAIT'));
 finish();await question;assert.equal(f.state().asking,false);
});
