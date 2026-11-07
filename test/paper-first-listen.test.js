// Actual completion hook, voice lifecycle and Paper command receivers. No API or device access.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {loadVoice}=createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fn=name=>{const m=source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));assert(m,name);return m[0];};
const hook=source.match(/^voice\.onEnd = \(\) => \{[\s\S]*?^\};/m)?.[0];assert(hook);
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
async function fixture(t){
 const h=loadVoice(fileURLToPath(new URL('../public/voice.js',import.meta.url)));h.voice.init();h.voice.ctx=new h.context.window.AudioContext();h.voice.unlocked=true;
 const marks=[],questions=[],destinations=[],earcons=[],configs=[];
 const field={label:'Name'},S={epoch:1,lang:'en',mode:'guide',fields:[field],i:0,words:[{classList:{add:v=>marks.push('+'+v),remove:v=>marks.push('-'+v)}}]};
 const app={dataset:{}},talk={live:null,auto:0};
 Object.assign(h.context,{S,app,talk,URLSearchParams,location:{search:'',assign:p=>destinations.push(p)},
  $:()=>({setAttribute(){}}),renderSessionContext(){},setCue(){},showHeard(){},buzz(){},
  say:(...args)=>h.voice.say(...args),t:()=>({heardNothing:'Please ask again.'}),
  answer:q=>questions.push(q),finishWriting(){},keep(){},redo(){},repeat(){},skip(){},
  makeEars(config){configs.push(config);const controller={stream:{},start:async()=>controller,stop(){this.stream=null;},hasPending:()=>false};return controller;}});
 const realEarcon=h.voice.earcon.bind(h.voice);h.voice.earcon=up=>{earcons.push(up);realEarcon(up);};
 vm.runInContext(['offerAutoQuestion','startEars','awaitQuestion','gotQuestion','onVoiceCommand','talkStart','talkDone'].map(fn).join('\n')+'\n'+hook,h.context);
 await h.context.startEars();
 const arm=()=>{S.autoQuestion={epoch:S.epoch,lang:S.lang,ptt:S.earsPttGeneration||0,answer:S.answerSerial||0,wake:S.awaitQContext};};
 arm();
 t.after(()=>{S.ears?.stop();h.voice.stop({resumeEars:false});});
 return{...h,S,app,talk,marks,questions,destinations,earcons,arm,
  async complete(text='Write your name.'){h.voice.say(text);h.finishSystem();await flush();},
  deliver(text){const config=configs.at(-1),token=config.onCapture();if(config.isCurrent(token))config.onText(text,token);}};
}

for(const mode of ['guide','checkin','idle'])test(`natural ${mode} welcome completion opens exactly one existing eight-second window`,async t=>{
 const f=await fixture(t);f.S.mode=mode;await f.complete();
 assert.equal(f.S.awaitQ,8000);assert.equal(f.app.dataset.talk,'listening');assert.deepEqual(f.earcons,[true]);assert.equal(f.S.autoQuestion,null);
 assert.deepEqual(f.marks,['+said','-now']);assert.equal(f.S.words.length,0);
 f.S.awaitQ=0;f.S.awaitQContext=null;delete f.app.dataset.talk;await f.complete('Another line.');
 assert.equal(f.S.awaitQ,0);assert.deepEqual(f.earcons,[true]);
});
for(const mode of ['reading','reveal'])test(`completion during ${mode} waits for the first stable instruction`,async t=>{
 const f=await fixture(t);f.S.mode=mode;await f.complete('Reading the page.');assert.equal(f.S.awaitQ,undefined);assert(f.S.autoQuestion);
 f.S.mode='guide';await f.complete();assert.equal(f.app.dataset.talk,'listening');assert.equal(f.S.autoQuestion,null);
});
for(const change of ['pause','Ask','epoch','language','PTT','answer','wake'])test(`${change} invalidates the pending arrival window without replacing newer UI`,async t=>{
 const f=await fixture(t);
 if(change==='pause')f.S.voicePaused=true;
 if(change==='Ask')f.app.dataset.talk='thinking';
 if(change==='epoch')f.S.epoch++;
 if(change==='language')f.S.lang='es';
 if(change==='PTT')f.S.earsPttGeneration=1;
 if(change==='answer')f.S.answerSerial=1;
 if(change==='wake')f.S.awaitQContext={newer:true};
 await f.complete();assert.notEqual(f.app.dataset.talk,'listening');assert.deepEqual(f.earcons,[]);assert.equal(f.S.autoQuestion,null);
 if(change==='Ask')assert.equal(f.app.dataset.talk,'thinking');
});
test('cancelled actual speech never invokes the completion hook or opens listening',async t=>{
 const f=await fixture(t);const speech=f.voice.say('Write your name.');f.voice.stop();await speech;f.finishSystem();await flush();
 assert.equal(f.S.awaitQ,undefined);assert.deepEqual(f.earcons,[]);assert(f.S.autoQuestion);
});
test('a short direction cue does not consume the first full-instruction offer',async t=>{
 const f=await fixture(t);f.voice.say('left',{cue:true});f.finishSystem();await flush();
 assert.equal(f.S.awaitQ,undefined);assert(f.S.autoQuestion);await f.complete();assert.equal(f.app.dataset.talk,'listening');
});
test('navigation cancels the arrival offer before old speech can finish',async t=>{
 const f=await fixture(t);f.voice.say('Write your name.');f.context.onVoiceCommand('nav','home');f.finishSystem();await flush();
 assert.equal(f.S.autoQuestion,null);assert.deepEqual(f.destinations,['./']);assert.deepEqual(f.earcons,[]);
});
test('the first ordinary nonwake question reaches the actual Paper question receiver',async t=>{
 const f=await fixture(t);await f.complete();f.deliver('What does guarantor mean?');
 assert.deepEqual(f.questions,['What does guarantor mean?']);assert.equal(f.S.awaitQ,0);assert.equal(f.S.autoQuestion,null);
});
test('parse failure or lost microphone cannot open an arrival listening offer',async t=>{
 for(const why of ['error','microphone']){
  const f=await fixture(t);if(why==='error'){f.S.mode='idle';f.S.cue='error';}else f.voice.micOpen=false;
  await f.complete('Please try again.');assert.deepEqual(f.earcons,[]);assert.equal(f.S.autoQuestion,null);
 }
});

test('begin arms only after a successful automatic listener, for the read session it is about to start',async()=>{
 for(const automatic of [true,false]){
  const S={mode:'start',epoch:5,lang:'en',fields:[],i:0},nodes=new Map();
  const scope={S,app:{dataset:{}},talk:{},voice:{ctx:{state:'running',resume:async()=>{}},unlock(){},micOpen:false},
   $:id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,classList:{add(){},remove(){}},focus(){}});return nodes.get(id);},
   talkDone(){},stayAwake(){},warmVoice(){},status(){},setTimeout,clearTimeout,
   startCamera:async(_current,cleanup)=>{S.mic={getAudioTracks:()=>[{readyState:'live'}],getTracks:()=>[]};cleanup(()=>{});},
   startEars:async()=>({stream:{}}),readForm:async()=>{if(automatic)assert.equal(S.autoQuestion.epoch,6);else assert.equal(S.autoQuestion,null);S.epoch++;},
   setMode:mode=>{S.mode=mode;},cameraFail(){},say:()=>Promise.resolve(),t:()=>({})};
  vm.createContext(scope);vm.runInContext(fn('begin'),scope);await scope.begin({automatic});
  assert.equal(!!S.autoQuestion,automatic);
 }
});
