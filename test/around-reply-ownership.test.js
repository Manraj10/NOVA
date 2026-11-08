// Real reply/tell/news/queue handlers and real shared voice promise cancellation.
// Browser audio, clocks, DOM and network are inert; no camera/model calls.
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { loadVoice }=createRequire(import.meta.url)('./helpers/voice-mocks.cjs');
const source=fs.readFileSync(new URL('../public/around-app.js', import.meta.url),'utf8');
const handler=name=>{const m=source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));assert(m,name);return m[0];};
const wrapper=source.slice(source.indexOf('const reply ='),source.indexOf('async function askAbout('));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t) {
 const h=loadVoice(fileURLToPath(new URL('../public/voice.js', import.meta.url))),c=h.context;
 h.voice.init(); h.voice.cloud=false;
 Object.assign(c,{$:()=>({textContent:''}),countText:()=>'',aroundStub:{summary:()=> 'First summary.'},Date:{now:()=>100000+h.now}});
 vm.runInContext("let heading=0,running=true,gen=1,scene='A classroom.',askUntil=0,asking=false,talking=false,holdNews=0;const queue=[],around=aroundStub;\n"+wrapper+'\n'
  +['tellAll','tellScene','command','newsHeld','news','speakQueue'].map(handler).join('\n')
  +'\nthis.snapshot=()=>({talking,held:newsHeld(),queued:queue.length});',c);
 t.after(()=>h.voice.stop({resumeEars:false})); return {...h,c};
}
test('a canceled summary cannot release the newer summary to ordinary news', async t=>{
 const f=fixture(t); f.c.tellAll(); assert.equal(f.system.at(-1).text,'First summary.');
 f.c.command('describe'); // Real command -> tellScene -> stop resolves the previous voice promise.
 assert.equal(f.system.at(-1).text,'Right now: a classroom.');
 await flush(); assert.equal(f.voice.speaking,true);
 const ownedBeforeNews=f.c.snapshot().talking;
 f.c.news({say:['ORDINARY NEWS MUST WAIT'],hazard:false}); await flush();
 assert.deepEqual(f.system.map(line=>line.text), ['First summary.','Right now: a classroom.'], 'ordinary news must not interrupt the newer summary');
 assert.equal(ownedBeforeNews,true,'old finally must not clear the newer summary owner');
 f.finishSystem(); await flush(); assert.equal(f.c.snapshot().talking,false);
});
test('a current hazard still interrupts the owned summary', async t=>{
 const f=fixture(t); f.c.tellAll();
 f.c.news({say:['CURRENT HAZARD'],hazard:true}); await flush();
 assert(f.system.some(line=>line.text==='CURRENT HAZARD'));
});
