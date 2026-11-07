import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { loadVoice } = createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const source = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const actual = source.match(/async function loadHands\([^\n]*\) \{[\s\S]*?\n\}/)?.[0];
assert(actual);
function fixture() {
  const statuses = [], context = { status:text=>statuses.push(text), MP:'unused', MODEL:'unused' };
  vm.createContext(context);vm.runInContext('let hands=null;\n'+actual+'\nthis.getHands=()=>hands;',context);
  return {context,statuses};
}
test('a stalled tracking bundle is not a static dependency of voice startup', async()=>{
  assert(![...source.matchAll(/^import .*from ['"]([^'"]+)['"]/gm)].some(match=>/^https?:/.test(match[1])));
  const f=fixture();let resolve;const pending=f.context.loadHands(()=>new Promise(r=>{resolve=r;}));
  const h=loadVoice(fileURLToPath(new URL('../public/voice.js',import.meta.url))),commands=[];
  h.voice.onCommand=(...args)=>commands.push(args);h.voice.handle('Hey Nib, go home');
  assert.deepEqual(commands,[['nav','home']]);
  assert.equal(f.statuses.at(-1),'Loading hand tracking…');
  const tracker={};resolve({FilesetResolver:{forVisionTasks:async()=>({})},HandLandmarker:{createFromOptions:async()=>tracker}});
  await pending;assert.equal(f.context.getHands(),tracker);
});
test('an unavailable tracking bundle reports failure without rejecting the local controller',async()=>{
  const f=fixture();await f.context.loadHands(async()=>{throw Error('CDN unavailable');});
  assert.equal(f.context.getHands(),null);assert.match(f.statuses.at(-1),/Hand tracking could not load/);
});
