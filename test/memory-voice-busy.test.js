import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { fixture } = createRequire(import.meta.url)('./helpers/memory-voice.cjs');

async function use(t){const f=await fixture();t.after(()=>f.close());return f;}

test('inline building wake interrupts actual assistant speech and acknowledges before collection commits',async t=>{
 const f=await use(t);f.voice.say('Got it. Building your room. It takes about half a minute.');const before=f.voice.seq;
 f.phrase();await f.respond(0,'Hey Nib, add a red chair');
 assert.equal(f.voice.speaking,false);assert(f.voice.seq>before);assert.deepEqual(f.earcons,[true]);
 assert.equal(f.state().collected,'add a red chair');assert.deepEqual(f.state().later,[]);
 await f.tick(2200);assert.deepEqual(f.state().later,['add a red chair']);assert(f.system.some(u=>u.text==='Got it. I’ll add that.'));
 assert.equal(f.voice.micOpen,true);assert.equal(f.sessions.at(-1),'play-and-record');
});
test('bare wake during actual assistant speech keeps its next captured change',async t=>{
 const f=await use(t);f.voice.say('Got it. Building your room.');f.phrase();await f.respond(0,'Hey Nib');
 assert.equal(f.voice.speaking,false);assert.deepEqual(f.earcons,[true]);
 f.phrase();await f.respond(1,'add a red chair');await f.tick(2200);assert.deepEqual(f.state().later,['add a red chair']);
});
test('FIFO follow-up captured before wake acknowledgement survives a late ASR response',async t=>{
 const f=await use(t);f.phrase();f.phrase();assert.equal(f.requests.length,1);
 await f.tick(4000);await f.respond(0,'Hey Nib');assert.equal(f.requests.length,2);
 await f.tick(9500);await f.respond(1,'add a red chair');await f.tick(2200);
 assert.deepEqual(f.state().later,['add a red chair']);assert(!f.events.some(e=>e.type==='nib:voice-drop'));
});
test('bare wake captured building still opens a current window when its own room becomes ready',async t=>{
 const f=await use(t);f.phrase();f.enter();await f.respond(0,'Hey Nib');
 assert(f.state().windowUntil>f.now);assert.deepEqual(f.earcons,[true]);
});
test('explicit edit captured building reaches that same logical room after it becomes ready',async t=>{
 const f=await use(t);f.phrase();f.enter();await f.respond(0,'Hey Nib, add a red chair');await f.tick(2200);
 assert.deepEqual(f.actions,[{action:'edit',text:'add a red chair'}]);assert.deepEqual(f.earcons,[true,false]); // Latest orb closes after commit.
});
test('collected explicit edit keeps its logical build target through the image transition',async t=>{
 const f=await use(t);f.phrase();await f.respond(0,'Hey Nib, add a red chair');f.enter();await f.tick(2200);
 assert.deepEqual(f.actions,[{action:'edit',text:'add a red chair'}]);
});
test('wake and queued follow-up captured building both survive the same generated room transition',async t=>{
 const f=await use(t);f.phrase();f.phrase();f.enter();await f.respond(0,'Hey Nib');await f.respond(1,'add a red chair');await f.tick(2200);
 assert.deepEqual(f.actions,[{action:'edit',text:'add a red chair'}]);
});
test('explicit named correction survives a same-sid image replacement',async t=>{
 const f=await use(t);f.enter();f.phrase();f.newRevision();await f.respond(0,'Hey Nib, move the radio to the left');await f.tick(2200);
 assert.deepEqual(f.actions,[{action:'edit',text:'move the radio to the left'}]);
});
test('ambiguous relative correction across an image replacement acknowledges and asks again',async t=>{
 const f=await use(t);f.enter();f.phrase();f.newRevision();await f.respond(0,'Hey Nib, make it red');await f.tick(2200);
 assert.deepEqual(f.actions,[]);assert(f.system.some(u=>u.text.includes('Please repeat the change')));assert(f.state().windowUntil>f.now);
});
test('an old memory never lends its edit to a different run',async t=>{
 const f=await use(t);f.phrase();f.newMemory();await f.respond(0,'Hey Nib, add a red chair');await f.tick(2200);
 assert.deepEqual(f.actions,[]);assert(f.system.some(u=>u.text.includes('Please repeat the change')));assert(f.state().windowUntil>f.now);
});
for(const words of ['Hey Nib, help','Hey Nib, stop','Hey Nib, how long is left?'])
test(`safe current status/control survives a building transition: ${words}`,async t=>{
 const f=await use(t);f.phrase();f.enter();await f.respond(0,words);await f.tick(2200);
 assert.deepEqual(f.actions,[]);assert.deepEqual(f.state().later,[]);assert(f.system.length>0||words.endsWith('stop'));
 if(words.includes('long'))assert(f.system.some(u=>u.text.includes('Your room is ready')));
});
test('exact global navigation survives a building transition but closes actual ears',async t=>{
 const f=await use(t);f.phrase();f.enter();await f.respond(0,'Hey Nib, home');await f.tick(2600);
 assert.equal(f.context.location.href,'../');assert.deepEqual(f.actions,[]);assert.equal(f.voice.micOpen,false);
});
test('captured assistant command echo cannot become a room correction',async t=>{
 const f=await use(t);f.voice.say('Hey Nib, add a red chair');f.phrase();await f.respond(0,'Hey Nib, add a red chair');await f.tick(2200);
 assert.deepEqual(f.actions,[]);assert.deepEqual(f.state().later,[]);assert.deepEqual(f.earcons,[]);
});
test('mixed assistant+human synthetic transcript does not trigger an embedded wake',async t=>{
 const f=await use(t);f.voice.say('Building your room.');f.phrase();await f.respond(0,'Building your room. Hey Nib, add a red chair');await f.tick(2200);
 assert.deepEqual(f.actions,[]);assert.deepEqual(f.state().later,[]);
});


test('command-only confirmation window ignores unaddressed descriptive room edits', async t => {
  const f = await use(t); f.enter();
  f.context.openWindow(10000, false, false);
  f.phrase(); await f.respond(0, 'the window was on the left'); await f.tick(2200);
  assert.deepEqual(f.actions, []); assert.equal(f.state().collected, '');
});
test('command-only confirmation window accepts an explicitly addressed room correction', async t => {
  const f = await use(t); f.enter();
  f.context.openWindow(10000, false, false);
  f.phrase(); await f.respond(0, 'Hey Nib, move the radio left'); await f.tick(2200);
  assert.deepEqual(f.actions, [{ action:'edit', text:'move the radio left' }]);
});
test('real room entry retains an explicit same-build correction already being collected', async t => {
  const f = await use(t);
  f.phrase(); await f.respond(0, 'Hey Nib, add a red chair');
  assert.equal(f.state().collected, 'add a red chair');
  f.enter(); await f.tick(2200);
  assert.deepEqual(f.actions, [{ action:'edit', text:'add a red chair' }]);
});
test('real room entry drops an ambiguous collected correction', async t => {
  const f = await use(t);
  f.phrase(); await f.respond(0, 'Hey Nib, make it red');
  f.enter(); await f.tick(2200);
  assert.deepEqual(f.actions, []); assert.equal(f.state().collected, '');
});
test('wake acknowledged before real room entry retains its already captured named follow-up', async t => {
  const f = await use(t);
  f.phrase(); await f.respond(0, 'Hey Nib');
  f.phrase(); f.enter(); await f.respond(1, 'add a red chair'); await f.tick(2200);
  assert.deepEqual(f.actions, [{ action:'edit', text:'add a red chair' }]);
});


for (const sentence of ['make it darker', 'can you add a red radio'])
test(`owner room-edit policy stays active without a wake or open window: ${sentence}`, async t => {
  const f = await use(t); f.enter(); f.context.closeWindow();
  f.phrase(); await f.respond(0, sentence); await f.tick(2200);
  assert.deepEqual(f.actions, [{ action:'edit', text:sentence }]);
});
test('held auto-unlock microphone is reused and stopped when Memory navigates to Around', async t => {
  const f = await fixture({ heldMic:true }); t.after(()=>f.close());
  assert.equal(f.micCalls(), 0, 'ears must reuse the held microphone');
  f.phrase(); await f.respond(0, 'Hey Nib, open Around me');
  assert.equal(f.voice.micOpen, false);
  assert.equal(f.track.stops, 1, 'navigation retires the externally owned held stream');
  await f.tick(2600);
  assert.equal(f.context.location.href, '../around.html');
  assert.deepEqual(f.actions, []);
});
test('late auto-unlock permission is retired after navigation instead of starting another listener', async t => {
  const f = await use(t); let resolve;
  f.context.$('start').hidden = false;
  f.voice.autoUnlock = () => new Promise(yes => { resolve = yes; });
  const pending = f.context.autoStart();
  f.context.go('around');
  const lateTrack = { stops:0, stop(){ this.stops++; } };
  resolve({ getTracks:()=>[lateTrack] }); await pending;
  assert.equal(lateTrack.stops, 1);
  await f.tick(2600);
  assert.equal(f.context.location.href, '../around.html');
});

test('navigation during pending transcription retires held mic and prevents the late phrase editing a room', async t => {
  const f = await fixture({ heldMic:true }); t.after(()=>f.close());
  f.phrase(); assert.equal(f.requests.length, 1);
  f.context.heard('Hey Nib, open Around me');
  assert.equal(f.track.stops, 1); assert.equal(f.voice.micOpen, false);
  await f.respond(0, 'Hey Nib, add a red chair'); await f.tick(2600);
  assert.deepEqual(f.actions, []); assert.deepEqual(f.state().later, []);
  assert.equal(f.context.location.href, '../around.html');
});


test('audio graph rejection releases the held auto-unlock mic before reporting no listener', async t => {
  const f = await fixture({ heldMic:true, graphReject:true }); t.after(()=>f.close());
  assert.equal(f.micCalls(), 0, 'the failure used the borrowed held microphone');
  assert.equal(f.voice.micOpen, false);
  assert.deepEqual(f.listenerState(), {micDenied:true, hasAutoMic:false, hasEars:false});
  assert.equal(f.track.stops, 1); assert.equal(f.track.readyState, 'ended');
  assert(f.system.some(line=>line.text.includes('Allow the microphone')));
});


const grant = () => { const track={stops:0,stop(){this.stops++;}}; return {track,stream:{getTracks:()=>[track]}}; };
async function pendingUnlock(t) {
  const f=await fixture({startListener:false}); t.after(()=>f.close());
  f.context.$('start').hidden=false;
  const resolves=[];
  f.context.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>resolves.push(resolve));
  return {f,resolves};
}
test('auto-start never opens a microphone while the document is hidden', async t => {
  const f=await fixture({startListener:false}); t.after(()=>f.close());
  f.context.$('start').hidden=false; f.context.document.hidden=true;
  await f.context.autoStart();
  assert.equal(f.micCalls(),0); assert.equal(f.listenerState().hasEars,false);
  assert.equal(f.voice.micOpen,false);
});
test('a grant arriving after the document becomes hidden is stopped and clears the capture flag', async t => {
  const {f,resolves}=await pendingUnlock(t), late=grant();
  const pending=f.context.autoStart(); assert.equal(resolves.length,1);
  f.context.document.hidden=true; resolves[0](late.stream); await pending;
  assert.equal(late.track.stops,1); assert.equal(f.listenerState().hasEars,false);
  assert.equal(f.listenerState().hasAutoMic,false); assert.equal(f.voice.micOpen,false);
});
test('pagehide at the visible start screen invalidates a pending real auto-unlock', async t => {
  const {f,resolves}=await pendingUnlock(t), late=grant();
  const pending=f.context.autoStart(); f.context.pause();
  resolves[0](late.stream); await pending;
  assert.equal(late.track.stops,1); assert.equal(f.listenerState().hasEars,false);
  assert.equal(f.voice.micOpen,false);
});
test('discarding an old grant leaves the newer tap-started listener and mic flag active', async t => {
  const {f,resolves}=await pendingUnlock(t), old=grant(), current=grant();
  const pending=f.context.autoStart(); f.context.pause();
  f.context.begin(); // Actual tap handler must reset listeningPaused before starting ears.
  assert.equal(resolves.length,2);
  resolves[1](current.stream); await f.tick(0);
  assert.equal(f.listenerState().hasEars,true); assert.equal(f.voice.micOpen,true);
  resolves[0](old.stream); await pending;
  assert.equal(old.track.stops,1); assert.equal(current.track.stops,0);
  assert.equal(f.listenerState().hasEars,true); assert.equal(f.voice.micOpen,true);
});
