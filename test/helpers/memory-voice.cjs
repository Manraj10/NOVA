// Actual Memory router, actual ears VAD/FIFO and actual voice echo/cancellation.
// Only audio frames, browser surfaces, HTTP replies and room changes are mocked.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadVoice } = require('./voice-mocks.cjs');
const publicDir = path.resolve(__dirname, '../../public');
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture({ heldMic = false, graphReject = false, startListener = true } = {}){
  const app=read('memory/app.js');
  const fn=name=>app.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0]||'';
  const decl=name=>app.match(new RegExp(`^(?:let|const) ${name} = .*;$`,'m'))?.[0]||'';
  const h=loadVoice(path.join(publicDir, 'voice.js'));
  h.voice.init();h.voice.micOpen=false;h.voice.cloud=false;h.voice.unlocked=true;h.voice.ctx=new h.context.window.AudioContext();h.voice.ctx.sampleRate=16000;
  const processors=[],actions=[],events=[],earcons=[];
  const earcon=h.voice.earcon.bind(h.voice);h.voice.earcon=up=>{earcons.push(up);return earcon(up);};
  const node=()=>({connect(next){return next;},disconnect(){}});
  h.voice.ctx.createMediaStreamSource=()=>{ if(graphReject) throw Error('mock audio graph rejected'); return node(); };
  h.voice.ctx.createScriptProcessor=()=>{const p=node();processors.push(p);return p;};
  let micCalls = 0;
  const track = { readyState:'live', stops:0, stop(){ this.stops++; this.readyState='ended'; } };
  const stream={getTracks:()=>[track]};h.context.navigator.mediaDevices={getUserMedia:async()=>{ micCalls++; return stream; }};
  h.context.CustomEvent=class{constructor(type,{detail}){this.type=type;this.detail=detail;}};
  h.context.dispatchEvent=event=>events.push({type:event.type,detail:plain(event.detail)});
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',value:'',setAttribute(){},focus(){},classList:{toggle(){}},querySelector:()=>null});return nodes.get(id);};
  Object.assign(h.context,{$,show(){},bubble(){},
    converse:text=>actions.push({action:'story',text}),change:text=>actions.push({action:'edit',text}),
    describeAgain:()=>actions.push({action:'describe'}),real(){},setMuted(){},openExample(){},location:{href:''},
    ctx:()=>h.voice.ctx, shown:false, tiltWanted:false,
    makeRoom:()=>({tags:[],face(){},destroy(){},tiltOff(){}}), startSound:async()=>{},
    sleep:()=>new Promise(()=>{}), warmDepth:async()=>{}, params:{has:()=>false} }); // Hold rendering narration after the real entry guard; no sound/model calls.
  const contextHelpers=app.includes('const captureContext =')?app.slice(app.indexOf('const captureContext ='),app.indexOf('function startEars')):'';
  const intentHelpers=app.includes('const isQuestion =')?app.slice(app.indexOf('const isQuestion ='),app.indexOf('function commit')):'';
  const fixWake=app.slice(app.indexOf('const fixWake ='),app.indexOf('function heard('));
  vm.runInContext(read('ears.js').replace(/^export /gm,'')+'\n'+decl('ears')+'\n'+decl('windowUntil')+'\n'+decl('orb')+'\n'+decl('greeted')
    +"\nlet step='building',run=1,retry=null,current=null,music=null,view=null,soundTok=0,later=[],changing=false,changeTok=0;\n"
    +app.match(/const L = \{[\s\S]*?\n\};/)[0]+'\n'+contextHelpers+'\n'+fixWake+'\n'+decl('norm')+'\n'+intentHelpers+'\n'
    +['startEars','clearCollection','closeWindow','openWindow','heard','commit','sayAndListen','command','go','startOver','prepareRoomEntry','enter','autoStart','pause','begin'].map(fn).join('\n'),h.context);
  if (heldMic) { h.context.fixtureMic = stream; vm.runInContext('autoMic=fixtureMic;', h.context); }
  if (startListener) h.context.startEars();
  await flush();await h.advance(1000);
  const phrase=()=>{for(const level of [.1,.1,.1,0,0,0,0,0,0])processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(2048).fill(level)}});};
  const respond=async(index,text)=>{h.respond(index,{text});await flush();};
  return{...h,actions,events,earcons,phrase,respond,track,micCalls:()=>micCalls,
    listenerState:()=>plain(vm.runInContext('({micDenied,hasAutoMic:!!autoMic,hasEars:!!ears})',h.context)),
    async tick(ms){await h.advance(ms);await flush();},
    enter(){vm.runInContext("enter({sid:run,title:'Test room',describe:''});",h.context);},
    newRevision(){vm.runInContext("current={sid:run,revision:2};",h.context);},
    newMemory(){vm.runInContext("run++;step='room';current={sid:run};",h.context);},
    state:()=>plain(vm.runInContext('({step,run,windowUntil,collected,later,busy:ears?.busy})',h.context)),
    close(){vm.runInContext('ears?.stop();',h.context);h.voice.stop({resumeEars:false});}};
}

module.exports = { fixture };
