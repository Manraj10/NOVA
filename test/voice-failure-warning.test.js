import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const file = fileURLToPath(new URL('../public/voice.js', import.meta.url));
function setup() {
  const h = loadVoice(file, { locationSearch: '' }), listeners = new Map();
  h.context.window.addEventListener = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  };
  h.voice.init();
  return { ...h, listeners, emit: (name, detail) => listeners.get(name)?.forEach(fn => fn({ detail })) };
}
test('a hearing failure is spoken immediately with zero paid speech requests', async () => {
  const h = setup(), captions = [];
  h.voice.onCaption = text => captions.push(text);
  h.emit('nib:voice-drop', { reason: 'transcription-failed', status: 502 });
  assert.equal(h.requests.length, 0); assert.equal(h.system.length, 1);
  assert.match(h.system[0].text, /Voice input isn't working/);
  assert.equal(captions[0], h.system[0].text); assert.equal(h.voice.speaking, true);
  assert.equal(h.voice.echo(h.system[0].text, h.voice.echoSnapshot()), true);
  h.finishSystem(); await h.advance(1); assert.equal(h.voice.speaking, false);
});
test('repeated failures are bounded to one warning per 30 seconds', async () => {
  const h = setup(); h.emit('nib:voice-drop', { reason: 'transcription-failed' });
  h.emit('nib:voice-drop', { reason: 'transcription-timeout' });
  await h.advance(29999); h.emit('nib:voice-drop', { reason: 'transcription-failed' });
  assert.equal(h.system.length, 1);
  await h.advance(2); h.emit('nib:voice-drop', { reason: 'transcription-failed' });
  assert.equal(h.system.length, 2); assert.equal(h.requests.length, 0);
  h.finishSystem();
});
test('initializing a mode twice cannot install duplicate error listeners', () => {
  const h = setup(); h.voice.init();
  assert.equal(h.listeners.get('nib:voice-drop').length, 1);
  h.emit('nib:voice-drop', { reason: 'transcription-timeout' }); assert.equal(h.system.length, 1);
  h.finishSystem();
});
test('hidden or departed pages do not speak old service warnings; restored pages can report new ones', () => {
  const h = setup(); h.context.document.hidden = true;
  h.emit('nib:voice-drop', { reason: 'transcription-failed' });
  h.context.document.hidden = false; h.emit('pagehide');
  h.emit('nib:voice-drop', { reason: 'transcription-failed' }); assert.equal(h.system.length, 0);
  h.emit('pageshow'); h.emit('nib:voice-drop', { reason: 'transcription-failed' });
  assert.equal(h.system.length, 1); h.finishSystem();
});
test('unknown events are ignored and a full queue gets an honest retry prompt', () => {
  const h = setup(); h.emit('nib:voice-drop', { reason: 'aborted' }); h.emit('nib:voice-drop', {});
  assert.equal(h.system.length, 0);
  h.emit('nib:voice-drop', { reason: 'queue-full' });
  assert.match(h.system[0].text, /I missed that/); assert.equal(h.requests.length, 0); h.finishSystem();
});
test('system-only speech still cancels cleanly and does not corrupt the next cloud utterance', async () => {
  const h = setup(); const warning = h.voice.say('Voice input unavailable.', { system: true });
  const old = h.system[0]; const next = h.voice.say('Next instruction.'); await warning;
  assert.equal(h.requests.length, 1); assert.equal(JSON.parse(h.requests[0].request.body).text, 'Next instruction.');
  old.onend(); assert.equal(h.voice.speaking, true);
  await h.advance(1501); assert.equal(h.system.at(-1).text, 'Next instruction.'); h.finishSystem(); await next;
});

test('actual ears failure reaches shared speech feedback and a later phrase can recover', async () => {
  const h = setup(), heard = []; let processor;
  h.context.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
  h.context.dispatchEvent = event => h.emit(event.type, event.detail);
  const node = () => ({ connect(next) { return next; }, disconnect() {} });
  const ctx = { sampleRate: 16000, destination: {}, createMediaStreamSource: node,
    createScriptProcessor() { return processor = node(); }, createGain: () => ({ ...node(), gain: { value: 1 } }) };
  const source = fs.readFileSync(new URL('../public/ears.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  vm.runInContext(source + '\nthis.earsFactory = makeEars;', h.context);
  const ears = h.context.earsFactory({ ctx, ignore: () => false, lang: () => 'en',
    onCapture: () => ({ current: true }), onText: text => heard.push(text) });
  await ears.start({ getTracks: () => [] });
  const phrase = () => {
    const feed = level => processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(level) } });
    for (let i = 0; i < 3; i++) feed(.1);
    for (let i = 0; i < 6; i++) feed(0);
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  phrase(); h.respond(0, { error: 'private provider detail' }, 502); await flush();
  assert.equal(h.system.length, 1); assert.match(h.system[0].text, /Voice input isn't working/);
  assert.doesNotMatch(h.system[0].text, /private provider/);
  assert.deepEqual(h.requests.map(request => request.url), ['/api/hear']);
  h.finishSystem(); phrase(); h.respond(1, { text: 'Hey Nib, help' }); await flush();
  assert.deepEqual(heard, ['Hey Nib, help']); assert.equal(h.system.length, 1); ears.stop();
});
