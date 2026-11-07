import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const voiceFile = fileURLToPath(new URL('../public/voice.js', import.meta.url));
const source=fs.readFileSync(new URL('../public/home.js',import.meta.url),'utf8').replace(/\r\n/g, '\n').replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({defer=false,available=true,memoryReady=true,deny=false,resumeBlocked=false,resumeReject=false,deferResume=false,deferEars=false,locationSearch='',deferNavigationSpeech=false,deferMenu=false}={}) {
  const nodes={live:{textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}},listen:{textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}}};
  const events={},domEvents={},said=[],saidOptions=[],destinations=[],echoCalls=[],listeners=[],order=[],streams=[],permissionsQueue=[],speechQueue=[],menuQueue=[],earcons=[];
  let permissions=0,stops=0,now=1000,timerId=0,finishResume,finishEars;
  const timers=new Map(),shared=loadVoice(voiceFile).voice;
  const resumeGate=new Promise(resolve=>{finishResume=resolve;}),earsGate=new Promise(resolve=>{finishEars=resolve;});
  const audio={state:'suspended',resume(){order.push('resume');if(resumeReject)return Promise.reject(Error('NotAllowedError'));if(deferResume)return resumeGate;if(!resumeBlocked)this.state='running';return Promise.resolve();}};
  const voice={seq:0,ctx:null,micOpen:false,init(){},unlock(){order.push('unlock');this.unlocked=true;this.ctx ||= audio;Promise.resolve(this.ctx.resume()).catch(()=>{});},
    say(t,opts){this.seq++;said.push(t);saidOptions.push(opts);order.push('speech');if(deferMenu&&/^You are on Nib Home/.test(t))return new Promise(r=>menuQueue.push(r));return deferNavigationSpeech&&/^Opening/.test(t)?new Promise(r=>speechQueue.push(r)):Promise.resolve();},
    earcon(up){earcons.push(up);},wake:shared.wake.bind(shared),prefetch(){},navigation:shared.navigation.bind(shared),echoSnapshot:()=>({active:true,recent:['menu']}),
    echo(text,captured){echoCalls.push([text,captured]);return captured?.echo===true;},stop(){this.seq++;}};
  const context={voice,MIC:{},window:{},URLSearchParams,location:{search:locationSearch,set href(v){destinations.push(v);}},
    navigator:{mediaDevices:available?{getUserMedia(){permissions++;order.push('permission');const track={stop(){stops++;}};const mic={getTracks:()=>[track]};streams.push(mic);
      if(defer)return new Promise((resolve,reject)=>permissionsQueue.push({resolve,reject,mic}));
      return deny?Promise.reject(Object.assign(Error('denied'),{name:'NotAllowedError'})):Promise.resolve(mic);}}:undefined},
    performance:{now:()=>now},document:{hidden:false,documentElement:{dataset:{memoryReady:String(memoryReady)}},getElementById:id=>nodes[id],addEventListener(k,fn){domEvents[k]=fn;}},
    addEventListener(k,fn){events[k]=fn;},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);},
    makeEars(options){order.push('ears');const ears={options,stream:null,stopped:false,async start(s){this.stream=s;if(deferEars)await earsGate;return this;},stop(){this.stopped=true;this.stream=null;}};listeners.push(ears);return ears;}};
  vm.createContext(context);vm.runInContext(source+'\nthis.startHome=start;this.goHome=go;this.initialHomeStartup=starting;',context);
  return{context,voice,nodes,said,saidOptions,destinations,echoCalls,events,domEvents,listeners,order,streams,audio,earcons,finishMenu:()=>menuQueue.shift()?.(),ready:context.initialHomeStartup||Promise.resolve(),
    get mic(){return streams.at(-1);},release(index=0){const [pending]=permissionsQueue.splice(index,1);pending.resolve(pending.mic);},rejectPermission(index=0){permissionsQueue.splice(index,1)[0].reject(Error('denied late'));},
    resumeAudio(){audio.state='running';finishResume();},finishEars,finishSpeech:()=>speechQueue.shift()?.(),permissions:()=>permissions,stops:()=>stops,at:time=>{now=time;},
    async advance(ms){now+=ms;for(const[id,t]of[...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();}};
}
test('simultaneous Home starts share one microphone request and expose actual listening state',async()=>{
  const f=fixture({defer:true});const a=f.context.startHome(),b=f.context.startHome();assert.equal(a,b);assert.equal(f.permissions(),1);
  f.release();await a;assert.equal(f.listeners.length,1);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.match(f.nodes.live.textContent,/Listening/);
  await f.context.startHome();assert.equal(f.permissions(),1);
});
test('leaving while permission is pending releases the late stream without starting it',async()=>{
  const f=fixture({defer:true});const a=f.context.startHome();f.events.pagehide();f.release();await a;
  assert.equal(f.stops(),1);assert.equal(f.listeners.length,0);assert.equal(f.voice.micOpen,false);
});
test('page exit stops active borrowed microphone tracks and the listener',async()=>{
  const f=fixture();await f.context.startHome();f.events.pagehide();assert.equal(f.stops(),1);assert.equal(f.listeners[0].stopped,true);assert.equal(f.voice.micOpen,false);
});
test('Home passes immutable onset echo evidence to the shared filter at delayed delivery',async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options,token=options.onCapture();
  f.voice.echoSnapshot=()=>({active:false});options.onText('old speech',token);
  assert.equal(f.echoCalls.at(-1)[1],token.echo);
});
for(const [destination,path]of [['paper','paper.html'],['around','around.html'],['memory','memory.html']])test(`exact shared parser route ${destination} opens only its same-origin page`,async()=>{
  const f=fixture();await f.context.startHome();f.voice.navigation=()=>destination;
  f.context.window.nibHome.handle('recognized destination');await flush();assert.deepEqual(f.destinations,[path]);assert.equal(f.stops(),1);assert.equal(f.listeners[0].stopped,true);
});
test('unrecognized and embedded conversational phrases cannot navigate',async()=>{
  const f=fixture();for(const phrase of ['paper on a table','I remember a room','please look at this','what does this form say'])assert.equal(f.context.window.nibHome.handle(phrase),null);
  await flush();assert.deepEqual(f.destinations,[]);
});
test('Home never treats a shared parser value as an arbitrary URL',async()=>{
  const f=fixture();f.voice.navigation=()=> 'https://example.com';f.context.window.nibHome.handle('input');await flush();assert.deepEqual(f.destinations,[]);
});
test('help repeats the menu while retaining Home',async()=>{
  const f=fixture();assert.equal(f.context.window.nibHome.handle('Hey Nib, help.'),'menu');await flush();assert.deepEqual(f.destinations,[]);assert.match(f.said[0],/Nib Home/);
});
test('microphone-unavailable browser keeps the mode cards/keyboard available',async()=>{
  const f=fixture({available:false});await f.context.startHome();assert.equal(f.permissions(),0);assert.match(f.nodes.live.textContent,/Voice input is unavailable/);assert.equal(f.voice.micOpen,false);
});
test('a pending listening token is invalid after navigation',async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options,token=options.onCapture();assert.equal(options.isCurrent(token),true);
  f.context.goHome('paper');assert.equal(options.isCurrent(token),false);await flush();assert.deepEqual(f.destinations,['paper.html']);
});

test('Memory is explicitly unavailable until the shared runtime is mounted',async()=>{
  const f=fixture({memoryReady:false});await f.ready;f.voice.navigation=()=> 'memory';
  f.context.window.nibHome.handle('Memory');await flush();assert.deepEqual(f.destinations,[]);assert.match(f.nodes.live.textContent,/still on Nib Home/);
});
test('restoring Home from browser history resets leaving and can navigate again',async()=>{
  const f=fixture();await f.ready;f.context.goHome('paper');await flush();assert.deepEqual(f.destinations,['paper.html']);
  f.events.pagehide();f.events.pageshow({persisted:true});await flush();assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');
  f.context.goHome('around');await flush();assert.deepEqual(f.destinations,['paper.html','around.html']);
});

test('bare Nib interrupts the menu and exposes listening without navigating',async()=>{
  const f=fixture();await f.context.startHome();let stopped=0;f.voice.stop=()=>{stopped++;};f.voice.wake=()=>({rest:''});
  assert.equal(f.context.window.nibHome.handle('Nib'),'listening');assert.equal(stopped,1);assert.match(f.nodes.live.textContent,/listening/);assert.deepEqual(f.destinations,[]);
});
test('a fresh exact destination after the wake cue works through the interrupted menu tail',async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options;
  f.voice.wake=text=>text==='Hey Nib'?{rest:''}:null;
  options.onText('Hey Nib',options.onCapture());
  f.voice.navigation=text=>text==='Paper'?'paper':null;
  options.onText('Paper',{...options.onCapture(),echo:{echo:true}});await flush();assert.deepEqual(f.destinations,['paper.html']);
});
test('an unknown explicit wake question gets a spoken Home menu rather than silence',async()=>{
  const f=fixture();f.voice.wake=()=>({rest:'what can I do here'});
  assert.equal(f.context.window.nibHome.handle('Hey Nib what can I do here'),'menu');assert.match(f.said.at(-1),/Nib Home/);
});

for (const wake of ['Nib','Hey Nib']) for (const [command,path] of [['open Paper','paper.html'],['go to Around me','around.html'],['switch to Memory','memory.html']]) test(`actual shared parser routes ${wake}, ${command} from Home`,async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options;
  options.onText(`${wake}, ${command}`,options.onCapture());await flush();assert.deepEqual(f.destinations,[path]);
});
for (const wake of ['Nib','Hey Nib']) test(`${wake} followed by help uses the shared parser and leaves the microphone active`,async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options;
  options.onText(wake,options.onCapture());options.onText('help',options.onCapture());
  assert.match(f.said.at(-1),/Nib Home/);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.equal(f.listeners[0].stopped,false);
});
test('a timely captured follow-up survives slow ASR beyond the listening deadline',async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options;
  options.onText('Nib',options.onCapture());f.at(8500);const token={...options.onCapture(),echo:{echo:true}};
  f.at(10500);options.onText('Memory',token);await flush();assert.deepEqual(f.destinations,['memory.html']);
});
test('a command already captured after Nib is not lost while wake transcription finishes',async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options;
  const wake=options.onCapture();f.at(1300);const command={...options.onCapture(),echo:{echo:true}};
  f.at(2000);options.onText('Nib',wake);options.onText('Paper',command);
  await flush();assert.deepEqual(f.destinations,['paper.html']);
});
test('an after-deadline acoustic echo cannot use the earlier wake bypass',async()=>{
  const f=fixture();await f.context.startHome();const options=f.listeners[0].options;
  options.onText('Nib',options.onCapture());f.at(9500);options.onText('Paper',{...options.onCapture(),echo:{echo:true}});
  await flush();assert.deepEqual(f.destinations,[]);
});
for (const command of ['stop','Nib, stop','Hey Nib, stop speaking']) test(`${command} stops Home speech while keeping voice commands available`,async()=>{
  const f=fixture();await f.context.startHome();let stopped=0;f.voice.stop=()=>{stopped++;};
  f.listeners[0].options.onText(command,f.listeners[0].options.onCapture());
  assert.equal(stopped,1);assert.match(f.nodes.live.textContent,/Speech stopped/);assert.equal(f.listeners[0].stopped,false);
});


test('automatic arrival acquires mic before unlock/menu and becomes live without any tap',async()=>{
  const f=fixture();assert.equal(f.permissions(),1);assert.deepEqual(f.said,[]);assert.deepEqual(f.order,['permission']);
  await f.ready;assert.equal(f.listeners.length,1);assert.equal(f.listeners[0].stream,f.mic);assert.equal(f.audio.state,'running');
  assert(f.order.indexOf('permission')<f.order.indexOf('unlock'));assert(f.order.indexOf('ears')<f.order.indexOf('speech'));
  assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.match(f.said[0],/Nib Home/);
});
test('a tap overlapping automatic permission shares one request and one menu',async()=>{
  const f=fixture({defer:true});const tap=f.context.startHome();assert.equal(tap,f.ready);assert.equal(f.permissions(),1);assert.deepEqual(f.said,[]);
  f.release();await tap;assert.equal(f.listeners.length,1);assert.equal(f.said.filter(s=>/You are on Nib Home/.test(s)).length,1);
});
test('automatic permission denial stays silent and gives truthful tap fallback',async()=>{
  const f=fixture({deny:true});await f.ready;assert.equal(f.listeners.length,0);assert.deepEqual(f.said,[]);assert.equal(f.voice.micOpen,false);
  assert.equal(f.nodes.listen.attrs['aria-pressed'],'false');assert.match(f.nodes.live.textContent,/Voice input could not start.*Tap Talk to Nib/);
  assert.equal(f.nodes.live.attrs['aria-live'],'polite');
});
for(const option of ['resumeBlocked','resumeReject'])test(`${option} releases permission stream and never claims listening`,async()=>{
  const f=fixture({[option]:true});await f.ready;assert.equal(f.listeners.length,0);assert.equal(f.stops(),1);assert.deepEqual(f.said,[]);
  assert.equal(f.nodes.listen.attrs['aria-pressed'],'false');assert.match(f.nodes.live.textContent,/enable audio and voice/);
});
test('a hung resume reaches bounded tap fallback instead of holding the microphone forever',async()=>{
  const f=fixture({deferResume:true});await flush();await f.advance(801);await f.ready;
  assert.equal(f.stops(),1);assert.equal(f.nodes.listen.attrs['aria-pressed'],'false');assert.match(f.nodes.live.textContent,/enable audio/);
});
test('late permission rejection after navigation cannot overwrite or speak over the destination',async()=>{
  const f=fixture({defer:true});f.context.goHome('paper');await flush();const line=f.nodes.live.textContent;
  f.rejectPermission();await f.ready;assert.equal(f.nodes.live.textContent,line);assert.deepEqual(f.destinations,['paper.html']);
  assert.equal(f.said.length,1);assert.match(f.said[0],/Opening Trace/);
});
test('leaving while audio resume is pending stops the granted stream and suppresses late menu',async()=>{
  const f=fixture({deferResume:true});await flush();f.events.pagehide();f.resumeAudio();await f.ready;
  assert.equal(f.stops(),1);assert.deepEqual(f.said,[]);assert.equal(f.listeners.length,0);assert.equal(f.voice.micOpen,false);
});
test('leaving while listener startup is pending cancels it and its late completion',async()=>{
  const f=fixture({deferEars:true});await flush();assert.equal(f.listeners.length,1);f.events.pagehide();f.finishEars();await f.ready;
  assert.equal(f.listeners[0].stopped,true);assert.equal(f.listeners[0].stream,null);assert.equal(f.stops(),1);assert.deepEqual(f.said,[]);
});
test('active Home history return automatically restarts once, duplicate pageshow cannot request twice',async()=>{
  const f=fixture();await f.ready;f.events.pagehide();f.events.pageshow({persisted:true});f.events.pageshow({persisted:true});await flush();
  assert.equal(f.permissions(),2);assert.equal(f.listeners.length,2);assert.equal(f.listeners.filter(e=>e.stream).length,1);
  assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');
});
test('history return after denied startup does not automatically re-prompt',async()=>{
  const f=fixture({deny:true});await f.ready;f.events.pagehide();f.events.pageshow({persisted:true});await flush();assert.equal(f.permissions(),1);
});
test('a superseded navigation speech callback cannot redirect restored Home',async()=>{
  const f=fixture({deferNavigationSpeech:true});await f.ready;f.context.goHome('paper');f.events.pagehide();f.events.pageshow({persisted:true});
  f.finishSpeech();await flush();assert.deepEqual(f.destinations,[]);assert.equal(f.permissions(),2);
});
test('bot proof mode skips automatic capture while explicit tap remains available',async()=>{
  const f=fixture({locationSearch:'?bot=1'});await flush();assert.equal(f.permissions(),0);assert.deepEqual(f.said,[]);
  await f.context.startHome();assert.equal(f.permissions(),1);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');
});

test('late grant from an older history generation cannot stop the newer active stream',async()=>{
  const f=fixture({defer:true}),old=f.ready;f.events.pagehide();f.events.pageshow({persisted:true});const current=f.context.startHome();
  f.release(1);await current;const active=f.listeners[0].stream;f.release(0);await old;
  assert.equal(f.listeners.length,1);assert.equal(f.listeners[0].stream,active);assert.equal(f.voice.micOpen,true);
  assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.equal(f.stops(),1);
});
test('late rejection from an older generation cannot replace the newer listening state',async()=>{
  const f=fixture({defer:true}),old=f.ready;f.events.pagehide();f.events.pageshow({persisted:true});const current=f.context.startHome();
  f.release(1);await current;f.rejectPermission(0);await old;
  assert.equal(f.listeners.length,1);assert.equal(f.voice.micOpen,true);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.match(f.nodes.live.textContent,/Listening/);
});
test('active history return waits until visible before trying automatic capture',async()=>{
  const f=fixture();await f.ready;f.events.pagehide();f.context.document.hidden=true;f.events.pageshow({persisted:true});await flush();assert.equal(f.permissions(),1);
  f.context.document.hidden=false;f.domEvents.visibilitychange();await flush();assert.equal(f.permissions(),2);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');
});
test('a blocked automatic audio unlock can retry successfully from a real tap',async()=>{
  const f=fixture({resumeBlocked:true});await f.ready;assert.equal(f.voice.unlocked,false);assert.equal(f.stops(),1);
  f.audio.state='running';await f.context.startHome();assert.equal(f.permissions(),2);assert.equal(f.listeners.length,1);
  assert.equal(f.voice.unlocked,true);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.equal(f.said.length,1);
});

test('a manual microphone failure is spoken with system voice when audio is available',async()=>{
  const f=fixture({deny:true,locationSearch:'?bot'});await f.context.startHome();
  assert.match(f.said.at(-1),/Voice input could not start/);
  assert.equal(f.saidOptions.at(-1).system,true);
  assert.equal(f.nodes.live.attrs['aria-live'],'off');
  assert.equal(f.nodes.listen.attrs['aria-pressed'],'false');
});

test('a timely general Home question still gets the overview when transcription is slow',async()=>{
  const f=fixture();await f.ready;const options=f.listeners[0].options;
  options.onText('Hey Nib',options.onCapture());f.at(8500);const question=options.onCapture();
  f.at(10500);options.onText('what can this app help me with?',question);
  assert.match(f.said.at(-1),/Trace/);assert.deepEqual(f.destinations,[]);
});

test('finished first greeting opens a choice/question window without needing Nib',async()=>{
  const f=fixture({deferMenu:true});await f.ready;assert.deepEqual(f.earcons,[]);
  f.finishMenu();await flush();assert.deepEqual(f.earcons,[true]);
  const options=f.listeners[0].options;options.onText('what can this app help me with?',options.onCapture());
  assert.match(f.said.at(-1),/Trace/);assert.match(f.said.at(-1),/Memory/);assert.deepEqual(f.destinations,[]);
});
test('cancelled greeting completion cannot reopen the initial listening window',async()=>{
  const f=fixture({deferMenu:true});await f.ready;f.voice.stop();f.finishMenu();await flush();
  assert.deepEqual(f.earcons,[]);const before=f.said.length;const options=f.listeners[0].options;
  options.onText('what can this app help me with?',options.onCapture());assert.equal(f.said.length,before);
});
test('an old greeting cannot overwrite a newer bare Nib listening intent',async()=>{
  const f=fixture({deferMenu:true});await f.ready;f.at(2000);const options=f.listeners[0].options;
  options.onText('Nib',options.onCapture());const message=f.nodes.live.textContent;
  f.at(3000);f.finishMenu();await flush();assert.equal(f.nodes.live.textContent,message);assert.deepEqual(f.earcons,[true]);
});
test('navigation while greeting is pending cannot reopen or replace destination feedback',async()=>{
  const f=fixture({deferMenu:true});await f.ready;f.context.goHome('paper');const message=f.nodes.live.textContent;
  f.finishMenu();await flush();assert.equal(f.nodes.live.textContent,message);assert.deepEqual(f.earcons,[]);assert.deepEqual(f.destinations,['paper.html']);
});
