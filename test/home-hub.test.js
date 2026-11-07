import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/home.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({defer=false,available=true,memoryReady=true}={}) {
  const nodes={live:{textContent:''},listen:{textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}}};
  const events={},domEvents={},said=[],destinations=[],echoCalls=[],listeners=[];
  let permissions=0,release,stops=0;
  const mic={getTracks:()=>[{stop(){stops++;}}]};
  const voice={ctx:{},micOpen:false,init(){},unlock(){},say(t){said.push(t);return Promise.resolve();},
    prefetch(){},navigation:()=>null,echoSnapshot:()=>({active:true,recent:['menu']}),
    echo(text,captured){echoCalls.push([text,captured]);return captured?.echo===true;},stop(){}};
  const context={voice,MIC:{},window:{},location:{set href(v){destinations.push(v);}},
    navigator:{mediaDevices:available?{getUserMedia(){permissions++;return defer?new Promise(r=>{release=r;}):Promise.resolve(mic);}}:undefined},
    document:{documentElement:{dataset:{memoryReady:String(memoryReady)}},getElementById:id=>nodes[id],addEventListener(k,fn){domEvents[k]=fn;}},
    addEventListener(k,fn){events[k]=fn;},setTimeout:()=>1,
    makeEars(options){const ears={options,stream:null,stopped:false,start(s){this.stream=s;return Promise.resolve(this);},stop(){this.stopped=true;}};listeners.push(ears);return ears;}};
  vm.createContext(context);vm.runInContext(source+'\nthis.startHome=start;this.goHome=go;',context);
  return{context,voice,nodes,said,destinations,echoCalls,events,domEvents,listeners,mic,release:()=>release(mic),permissions:()=>permissions,stops:()=>stops};
}
test('simultaneous Home starts share one microphone request and expose actual listening state',async()=>{
  const f=fixture({defer:true});const a=f.context.startHome(),b=f.context.startHome();assert.equal(a,b);assert.equal(f.permissions(),1);
  f.release();await a;assert.equal(f.listeners.length,1);assert.equal(f.nodes.listen.attrs['aria-pressed'],'true');assert.match(f.nodes.live.textContent,/Listening/);
  await f.context.startHome();assert.equal(f.permissions(),1);
});
test('leaving while permission is pending releases the late stream without starting it',async()=>{
  const f=fixture({defer:true});const a=f.context.startHome();f.events.pagehide();f.release();await a;
  assert.equal(f.stops(),1);assert.equal(f.listeners[0].stream,null);assert.equal(f.voice.micOpen,false);
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
  const f=fixture({memoryReady:false});f.voice.navigation=()=> 'memory';
  f.context.window.nibHome.handle('Memory');await flush();assert.deepEqual(f.destinations,[]);assert.match(f.nodes.live.textContent,/still on Nib Home/);
});
test('restoring Home from browser history resets leaving and can navigate again',async()=>{
  const f=fixture();f.context.goHome('paper');await flush();assert.deepEqual(f.destinations,['paper.html']);
  f.events.pageshow({persisted:true});assert.match(f.nodes.live.textContent,/back on Nib Home/);
  f.context.goHome('around');await flush();assert.deepEqual(f.destinations,['paper.html','around.html']);
});
