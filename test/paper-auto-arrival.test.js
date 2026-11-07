// Actual auto/begin/camera/ears handlers and actual unlock order. All permission,
// camera, audio, browser, provider and time surfaces are deterministic mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const ears=fs.readFileSync(new URL('../public/ears.js',import.meta.url),'utf8').replace(/^export /gm,'');
const speech=fs.readFileSync(new URL('../public/voice.js',import.meta.url),'utf8');
const fn=name=>{const m=source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));assert(m,name);return m[0];};
const unlock=speech.match(/  unlock\([^\n]*\) \{[\s\S]*?\n  \},/)[0];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,initial={}){
 const flags={unblock:true,...initial},order=[],requests=[],permissions=[],plays=[],processors=[],actions=[],statuses=[],says=[],timers=new Map();
 let audioLive=0,maxAudio=0,now=0,id=0;
 class Stream{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
 const track=kind=>{if(kind==='audio'){audioLive++;maxAudio=Math.max(maxAudio,audioLive);}return{kind,readyState:'live',stop(){if(this.readyState!=='ended'){this.readyState='ended';if(kind==='audio')audioLive--;}},getCapabilities:()=>({})};};
 const node=()=>({connect(next){return next;},disconnect(){}});
 const audio={sampleRate:16000,destination:{},state:flags.state??'suspended',
   resume(){order.push({event:'resume',audioLive});if(flags.unblock&&audioLive>0)this.state='running';return flags.hangResume?new Promise(()=>{}):Promise.resolve();},
   createMediaStreamSource(){if(flags.graphFail)throw Error('audio graph failed');return node();},
   createScriptProcessor(){const p=node();processors.push(p);return p;},createGain:()=>({...node(),gain:{value:1}})};
 const S={mode:'start',epoch:1,lang:'en',fields:[],i:0,sim:initial.sim||null};
 const nodes=new Map(),$=key=>{if(!nodes.has(key))nodes.set(key,{value:'',hidden:false,focus(){actions.push('focus:'+key);},setAttribute(){},classList:{add(){},remove(){}}});return nodes.get(key);};
 const video={srcObject:null,play(){order.push({event:'play',audioLive});if(flags.playFail)return Promise.reject(Error('autoplay denied'));return flags.deferPlay?new Promise(resolve=>plays.push(resolve)):Promise.resolve();}};
 const voice={ctx:null,speaking:false,heard:true,keepAwake(){},echo:()=>false,echoSnapshot:()=>({}),
   say:()=>Promise.resolve(),stop(){},earcon(){},listen(){actions.push('native-fallback');}};
 const scope={S,voice,video,PHONE:false,innerWidth:1200,innerHeight:800,MediaStream:Stream,URLSearchParams,AbortController,
   location:{search:flags.search||'',assign:path=>actions.push('nav:'+path)},app:{dataset:{}},talk:{live:null,auto:0},$,performance:{now:()=>now},
   window:{AudioContext:class{constructor(){return audio;}}},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{speak(){}},
   navigator:{audioSession:{},mediaDevices:{getUserMedia(options){requests.push(options);order.push({event:'capture',audio:!!options.audio});
     if(flags.denyCamera&&options.video)return Promise.reject(Object.assign(Error('camera denied'),{name:'NotAllowedError'}));
     if(flags.denyAudio&&options.audio)return Promise.reject(Object.assign(Error('audio denied'),{name:'NotAllowedError'}));
     const acquire=()=>new Stream([...(options.video?[track('video')]:[]),...(options.audio?[track('audio')]:[])]);
     if(flags.deferPermission){flags.deferPermission=false;return new Promise((resolve,reject)=>permissions.push({resolve:()=>resolve(acquire()),reject}));}
     return Promise.resolve(acquire());}}},
   setTimeout(fn,delay){const key=++id;timers.set(key,{fn,at:now+delay});return key;},clearTimeout:key=>timers.delete(key),
   stayAwake(){},warmVoice(){actions.push('warm');},listCameras:async()=>{},cameraFail(){actions.push('camera-error');},
   setMode:mode=>{S.mode=mode;},readForm:async()=>{actions.push('read');S.mode='guide';S.epoch++;},status:text=>statuses.push(text),
   say(text){says.push(text);return Promise.resolve();},t:()=>({noCamera:'no camera',noEars:'no ears'}),
   renderSessionContext(){},setCue(){},showHeard(){},buzz(){},
   btoa:value=>Buffer.from(value,'binary').toString('base64'),fetch(){throw Error('no transcription/model request expected');},
   finishWriting(){},keep(){},redo(){},repeat(){},skip(){},answer(){},talkStart(){},
 };
 vm.createContext(scope);
 vm.runInContext(ears+'\nObject.assign(voice,{\n'+unlock+'\n});\n'+['startCamera','begin','autoBegin','startEars','onVoiceCommand','talkDone'].map(fn).join('\n'),scope);
 t.after(async()=>{S.cameraStarting?.cancel?.();S.ears?.stop();S.earsPending?.stop();for(const t of S.mic?.getTracks()||[])t.stop();timers.clear();await flush();});
 return{scope,S,flags,requests,permissions,plays,processors,order,actions,statuses,says,audio,video,
   audioLive:()=>audioLive,maxAudio:()=>maxAudio,
   async tick(ms){now+=ms;for(const[key,timer]of[...timers])if(timer.at<=now){timers.delete(key);timer.fn();}await flush();}};
}

test('automatic arrival captures one combined microphone before unlocking audio and reading',async t=>{
 const f=fixture(t);await f.scope.autoBegin();
 assert.equal(f.requests.length,1);assert(f.requests[0].video);assert(f.requests[0].audio);
 assert(f.order.findIndex(x=>x.event==='capture')<f.order.findIndex(x=>x.event==='resume'));
 assert(f.order.filter(x=>x.event==='resume').every(x=>x.audioLive===1));
 assert.equal(f.audio.state,'running');assert.equal(f.processors.length,1);assert(f.S.ears?.stream);
 assert.deepEqual(f.actions,['warm','read']);assert.equal(f.maxAudio(),1);
});
test('auto arrival and taps while permission is pending share one attempt and one capture',async t=>{
 const f=fixture(t,{deferPermission:true});const auto=f.scope.autoBegin(),tap=f.scope.begin();
 assert.equal(auto,tap);assert.equal(f.scope.autoBegin(),auto);assert.equal(f.requests.length,1);
 f.permissions[0].resolve();await auto;assert.equal(f.processors.length,1);assert.equal(f.maxAudio(),1);
});
test('a gesture already starting the page is reused by its one automatic attempt',async t=>{
 const f=fixture(t,{deferPermission:true});const tap=f.scope.begin(),auto=f.scope.autoBegin();assert.equal(tap,auto);
 f.permissions[0].resolve();await auto;assert.equal(f.requests.length,1);assert.equal(f.maxAudio(),1);
});
for(const search of ['?sim','?bot=1','?sim&bot=1'])test(`automatic attempt does not start practice/robot URL ${search}`,async t=>{
 const f=fixture(t,{search});await f.scope.autoBegin();assert.equal(f.requests.length,0);assert.deepEqual(f.actions,[]);
});
test('active practice mode also remains behind its normal Start button',async t=>{
 const f=fixture(t,{sim:{}});await f.scope.autoBegin();assert.equal(f.requests.length,0);assert.deepEqual(f.actions,[]);
});
test('denied automatic camera permission preserves a truthful accessible tap fallback with no model work',async t=>{
 const f=fixture(t,{denyCamera:true});await f.scope.autoBegin();
 assert.equal(f.S.mode,'start');assert.equal(f.scope.app.dataset.screen,'start');assert.equal(f.audioLive(),0);
 assert(!f.actions.includes('read'));assert(!f.actions.includes('warm'));assert(!f.actions.includes('native-fallback'));
 assert.match(f.statuses.at(-1),/Tap Start reading/);assert(f.actions.includes('focus:startBtn'));
 const before=f.requests.length;await f.scope.autoBegin();assert.equal(f.requests.length,before,'automatic attempt is once only');
});
test('automatic video-only fallback does not prompt for a third microphone or read while deaf',async t=>{
 const f=fixture(t,{denyAudio:true});await f.scope.autoBegin();
 assert.equal(f.requests.length,2);assert.equal(f.processors.length,0);assert.equal(f.audioLive(),0);assert.equal(f.video.srcObject,null);
 assert(!f.actions.includes('read'));assert(!f.actions.includes('native-fallback'));assert.equal(f.S.mode,'start');
});
test('blocked audio leaves the tap fallback instead of a model reading session',async t=>{
 const f=fixture(t,{unblock:false});await f.scope.autoBegin();
 assert.equal(f.audio.state,'suspended');assert.equal(f.S.mode,'start');assert.equal(f.audioLive(),0);assert.equal(f.video.srcObject,null);
 assert(!f.actions.includes('read'));assert(!f.actions.includes('warm'));assert.equal(f.S.ears,null);
});
test('a hanging resume is bounded and cannot leave the automatic attempt stuck',async t=>{
 const f=fixture(t,{unblock:false,hangResume:true});const pending=f.scope.autoBegin();await flush();await f.tick(800);await pending;
 assert.equal(f.S.cameraStarting,null);assert.equal(f.S.mode,'start');assert.equal(f.audioLive(),0);assert(!f.actions.includes('read'));
});
test('ordinary tap after a blocked automatic attempt can unlock and start normally',async t=>{
 const f=fixture(t,{unblock:false});await f.scope.autoBegin();f.flags.unblock=true;await f.scope.begin();await flush();
 assert.equal(f.audio.state,'running');assert(f.actions.includes('read'));assert.equal(f.maxAudio(),1);assert.equal(f.audioLive(),1);
});
test('automatic audio graph failure stays retryable without adding native recognition',async t=>{
 const f=fixture(t,{graphFail:true});await f.scope.autoBegin();assert.equal(f.S.mode,'start');assert.equal(f.audioLive(),0);
 assert(!f.actions.includes('read'));assert(!f.actions.includes('native-fallback'));
 f.flags.graphFail=false;await f.scope.begin();await flush();assert(f.actions.includes('read'));assert.equal(f.maxAudio(),1);
});
test('late automatic permission grant after navigation cannot resume, listen, warm or read',async t=>{
 const f=fixture(t,{deferPermission:true});const pending=f.scope.autoBegin();f.scope.onVoiceCommand('nav','home');
 f.permissions[0].resolve();await pending;await flush();assert.equal(f.audioLive(),0);assert.equal(f.video.srcObject,null);
 assert.deepEqual(f.actions,['nav:./']);assert.equal(f.processors.length,0);
});
test('navigation during automatic video playback releases tracks and rejects the continuation',async t=>{
 const f=fixture(t,{deferPlay:true});const pending=f.scope.autoBegin();await flush();assert.equal(f.audioLive(),1);
 f.scope.onVoiceCommand('nav','home');assert.equal(f.audioLive(),0);f.plays[0]();await pending;
 assert.deepEqual(f.actions,['nav:./']);assert.equal(f.processors.length,0);assert.equal(f.video.srcObject,null);
});
test('a rejected automatic autoplay leaves the accessible tap fallback',async t=>{
 const f=fixture(t,{playFail:true});await f.scope.autoBegin();assert.equal(f.S.mode,'start');assert.equal(f.audioLive(),0);
 assert(!f.actions.includes('read'));assert.equal(f.video.srcObject,null);assert.match(f.statuses.at(-1),/Tap Start reading/);
});
test('audio-only ears resume the context again after their own permission grant',async t=>{
 const f=fixture(t,{deferPermission:true});f.scope.voice.unlock();const pending=f.scope.startEars();
 assert.equal(f.audio.state,'suspended');f.permissions[0].resolve();await pending;
 assert.equal(f.audio.state,'running');assert(f.order.some(x=>x.event==='resume'&&x.audioLive===1));assert.equal(f.processors.length,1);
});
test('module automatic invocation occurs after final UI and loop initialization',()=>{
 assert(source.lastIndexOf('autoBegin().catch')>source.lastIndexOf('requestAnimationFrame(loop);'));
 assert(source.lastIndexOf('autoBegin().catch')>source.lastIndexOf("setMode('start');"));
});
