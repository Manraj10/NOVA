// Extract and execute the actual Memory routers + shared wake/navigation/echo.
// Network, speech, DOM, microphone and time are inert mocks. No paid calls.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../public/memory/app.js', import.meta.url), 'utf8');
const speech = fs.readFileSync(new URL('../public/voice.js', import.meta.url), 'utf8');
const fn = name => app.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
const declaration = name => app.match(new RegExp(`^(?:let|const) ${name} = .*;$`, 'm'))?.[0] || '';
const methods = ['echoSnapshot', 'echo', 'wake', 'navigation'].map(name => {
  const method = speech.match(new RegExp(`  ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\},`));
  assert(method, `actual shared voice.${name}`); return method[0];
});
const constants = speech.match(/^const (?:NAME|HEY|WAKE|BARE) = .*;$/gm);
const lines = app.match(/const L = \{[\s\S]*?\n\};/)[0];
const fixWake = app.slice(app.indexOf('const fixWake ='), app.indexOf('function heard('));
const contextHelpers = app.includes('const captureContext =') ? app.slice(app.indexOf('const captureContext ='), app.indexOf('function startEars')) : '';
const intentHelpers = app.includes('const isQuestion =') ? app.slice(app.indexOf('const isQuestion ='), app.indexOf('function commit')) : '';
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function fixture({ step = 'home', deferSpeech = false, deferStart = false } = {}) {
  let now = 5000, id = 0, factories = 0, starts = 0, earStops = 0, voiceStops = 0;
  const timers = new Map(), actions = [], says = [], callbacks = [], listeners = [], startCallbacks = [];
  const nodes = new Map(); const node = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: key !== 'start', textContent: '', value: '', setAttribute() {},
      classList: { toggle() {} }, querySelector() { return null; } });
    return nodes.get(key);
  };
  node('start').hidden = true;
  const voice = { ctx: {}, speaking: false, endedAt: -10000, recent: [], seq: 0,
    unlock() {}, earcon() {}, stop() { voiceStops++; this.seq++; },
    say(text) { says.push(text); this.seq++; return deferSpeech ? new Promise(resolve => callbacks.push(resolve)) : Promise.resolve(); },
  };
  const context = { voice, navigator: {}, location: { href: '' }, performance: { now: () => now },
    $: node, show() {}, bubble() {},
    converse: text => actions.push({ action: 'story', text }), change: text => actions.push({ action: 'edit', text }),
    describeAgain: () => actions.push({ action: 'describe' }), real: () => actions.push({ action: 'labels' }),
    setMuted() {}, openExample() {},
    makeEars(config) {
      factories++; const listener = { config, busy: false,
        start() { starts++; return deferStart ? new Promise((resolve, reject) => startCallbacks.push({ resolve, reject })) : Promise.resolve(); },
        stop() { earStops++; } };
      listeners.push(listener); return listener;
    },
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
  };
  vm.createContext(context);
  vm.runInContext(declaration('ears') + '\n' + declaration('windowUntil') + '\n' + declaration('orb') + '\n'
    + `let step=${JSON.stringify(step)},run=1,retry=null,current=${step === 'room' ? '{id:1}' : 'null'},music=null,view=null,soundTok=0,later=[],changing=false,changeTok=0;\n`
    + lines + '\n' + contextHelpers + '\n' + fixWake + '\n' + declaration('norm') + '\n' + intentHelpers + '\n'
    + constants.join('\n') + '\nObject.assign(voice,{\n' + methods.join('\n') + '\n});\n'
    + ['startEars','clearCollection','closeWindow','openWindow','heard','commit','sayAndListen','command','go','startOver','pause','confirmAndListen'].map(fn).join('\n'), context);
  context.startEars();
  return { context, actions, says, callbacks, listeners, startCallbacks,
    setStep(value) { vm.runInContext(`step=${JSON.stringify(value)};`, context); },
    nextRun() { vm.runInContext('run++;', context); },
    nextRoom() { vm.runInContext('current={id:2};', context); },
    unpause() { vm.runInContext('listeningPaused=false;', context); },
    captured: () => listeners.at(-1).config.onCapture(),
    deliver(text, token) { const c=listeners.at(-1).config; if(!c.isCurrent || c.isCurrent(token)) c.onText(text,token); },
    hear: text => context.heard(text),
    async advance(ms) {
      const end=now+ms;
      for (;;) {
        const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next) break; timers.delete(next[0]); now=next[1].at; next[1].fn(); await flush();
      }
      now=end; await flush();
    },
    counts: () => ({ factories,starts,earStops,voiceStops }),
    state: () => plain(vm.runInContext('({step,windowUntil,collected,run,later,leaving:typeof leaving!=="undefined"&&leaving,earsActive:!!ears})',context)),
  };
}

test('current home description starts a story',async()=>{const f=fixture();f.hear('Hey Nib, my grandmothers kitchen');await f.advance(2500);assert.equal(f.actions[0]?.action,'story');});
test('current room correction edits that room',async()=>{const f=fixture({step:'room'});f.hear('Hey Nib, the window was on the left');await f.advance(2500);assert.deepEqual(f.actions,[{action:'edit',text:'the window was on the left'}]);});
test('typed story and explicit room correction still work',()=>{const a=fixture();a.context.heard('a small kitchen',{typed:true});assert.equal(a.actions[0]?.action,'story');const b=fixture({step:'room'});b.context.heard('add a red chair',{typed:true});assert.equal(b.actions[0]?.action,'edit');});
test('one listener remains shared across repeated start attempts',()=>{const f=fixture();f.context.startEars();f.context.startEars();assert.equal(f.counts().factories,1);assert.equal(f.counts().starts,1);});
test('bare wake opens a window and current follow-up works',async()=>{const f=fixture({step:'room'});f.hear('Nib');const token=f.captured();f.deliver('describe the room',token);assert.equal(f.actions[0]?.action,'describe');});

for(const change of ['setStep','nextRun','nextRoom'])test(`captured speech is rejected after ${change}`,async()=>{const f=fixture({step:change==='nextRoom'?'room':'home'});f.hear('Nib');const token=f.captured();if(change==='setStep')f.setStep('room');else f[change]();f.deliver('the window was on the left',token);await f.advance(3000);assert.deepEqual(f.actions,[]);});
test('collected story cannot commit as an edit after the stage changes',async()=>{const f=fixture();f.hear('Hey Nib, my grandmothers kitchen');f.setStep('room');await f.advance(3000);assert.deepEqual(f.actions,[]);assert.equal(f.state().collected,'');});
test('collected correction cannot target a different current room',async()=>{const f=fixture({step:'room'});f.hear('Hey Nib, move the radio left');f.nextRoom();await f.advance(3000);assert.deepEqual(f.actions,[]);});
test('timely speech onset survives a late ASR response across the wake deadline',async()=>{const f=fixture();f.hear('Nib');await f.advance(8500);const token=f.captured();await f.advance(1000);f.deliver('There was a red radio',token);await f.advance(2500);assert.deepEqual(f.actions,[{action:'story',text:'There was a red radio'}]);});
test('already-captured follow-up survives delayed wake transcription',async()=>{const f=fixture();const wake=f.captured();await f.advance(1000);const follow=f.captured();await f.advance(4000);f.deliver('Nib',wake);f.deliver('my grandmothers kitchen',follow);await f.advance(2500);assert.equal(f.actions[0]?.action,'story');});
test('inline wake also preserves follow-up captured before its delayed delivery',async()=>{const f=fixture();const first=f.captured();await f.advance(1000);const follow=f.captured();await f.advance(4000);f.deliver('Hey Nib, my grandmothers kitchen',first);f.deliver('There was a red radio',follow);await f.advance(2500);assert.match(f.actions[0]?.text||'',/kitchen There was a red radio/);});
test('speech started after the wake deadline is ignored',async()=>{const f=fixture();f.hear('Nib');await f.advance(9100);const token=f.captured();f.deliver('a red radio',token);await f.advance(2500);assert.deepEqual(f.actions,[]);});
test('late ASR grace is bounded to ten extra seconds',async()=>{const f=fixture();f.hear('Nib');await f.advance(8500);const token=f.captured();await f.advance(11000);f.deliver('a red radio',token);await f.advance(2500);assert.deepEqual(f.actions,[]);});

test('navigation cancels ears and collection immediately, before its speech finishes',async()=>{const f=fixture({deferSpeech:true});f.hear('Hey Nib, my grandmothers kitchen');const old=f.captured();f.hear('home');assert.equal(f.state().leaving,true);assert.equal(f.state().earsActive,false);assert.equal(f.counts().earStops,1);assert.equal(f.listeners[0].config.isCurrent(old),false);f.deliver('add a chair',old);await f.advance(3000);assert.deepEqual(f.actions,[]);assert.equal(f.context.location.href,'../');f.context.startEars();assert.equal(f.counts().factories,1);});

for(const text of ['how long is left?','what is taking so long?','help','can you tell me a joke?'])test(`building question is not queued as a room edit: ${text}`,async()=>{const f=fixture({step:'building'});f.hear(`Hey Nib, ${text}`);await f.advance(2500);assert.deepEqual(f.state().later,[]);assert.equal(f.actions.length,0);assert(f.says.length>0);assert(!f.says.includes('Got it. I’ll add that.'));});
test('building explicit edit is queued and acknowledged',async()=>{const f=fixture({step:'building'});f.hear('Hey Nib, add a red chair');await f.advance(2500);assert.deepEqual(f.state().later,['add a red chair']);assert(f.says.includes('Got it. I’ll add that.'));});
test('building ambiguous statement asks for an explicit change',async()=>{const f=fixture({step:'building'});f.hear('Hey Nib, I am getting impatient');await f.advance(2500);assert.deepEqual(f.state().later,[]);assert.match(f.says[0]||'',/To add a detail/);});
test('room question cannot be sent to the image edit API',async()=>{const f=fixture({step:'room'});f.hear('Hey Nib, how was this made?');await f.advance(2500);assert.deepEqual(f.actions,[]);assert(f.says.length>0);});
test('start over invalidates collected and captured old content; a fresh story works',async()=>{const f=fixture();f.hear('Hey Nib, old kitchen');const old=f.captured();f.context.startOver();f.deliver('old radio',old);await f.advance(3000);assert.deepEqual(f.actions,[]);f.hear('Hey Nib, my new kitchen');await f.advance(2500);assert.equal(f.actions[0]?.text,'my new kitchen');});
test('pausing cancels collection and rejects the old audio context',async()=>{const f=fixture();f.hear('Hey Nib, old kitchen');const old=f.captured();f.context.pause();f.deliver('old radio',old);await f.advance(3000);assert.deepEqual(f.actions,[]);assert.equal(f.state().windowUntil,0);assert.equal(f.state().earsActive,false);});
test('a stale startup failure cannot clear a newer listener',async()=>{const f=fixture({deferStart:true});f.context.pause();f.unpause();f.context.startEars();assert.equal(f.counts().factories,2);f.startCallbacks[0].reject(Error('late denied'));await flush();assert.equal(f.state().earsActive,true);assert.equal(f.context.voice.micOpen,true);f.startCallbacks[1].resolve();await flush();});
test('a previous room acknowledgement cannot open listening in a new run',async()=>{const f=fixture({step:'room',deferSpeech:true});f.hear('Hey Nib, yes');f.nextRun();f.setStep('home');f.callbacks[0]();await flush();assert.equal(f.state().windowUntil,0);});
test('captured assistant speech is still blocked by the actual echo guard',async()=>{const f=fixture({step:'room'});f.context.voice.speaking=true;f.context.voice.recent=['Hey Nib, add a red chair'];const token=f.captured();f.context.voice.speaking=false;f.deliver('Hey Nib, add a red chair',token);await f.advance(2500);assert.deepEqual(f.actions,[]);});
