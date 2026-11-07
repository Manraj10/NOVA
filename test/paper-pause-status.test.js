import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const render = source.match(/function renderSessionContext\([^\n]*\) \{[\s\S]*?\n\}/)?.[0]; assert(render);
function fixture(lang) {
  const nodes = Object.fromEntries(['sessionMode', 'sessionState', 'currentField'].map(id => [id, { textContent: '', dataset: {} }]));
  const context = { S: { lang, mode: 'guide', fields: [{ label: 'Name' }], i: 0 },
    app: { dataset: { talk: 'paused' }, toggleAttribute() {} }, $: id => nodes[id] };
  vm.createContext(context); vm.runInContext(render, context); return { context, nodes };
}
test('guidance pause has a clear status in all four supported interface languages', () => {
  for (const [lang, text] of [['en', 'Guidance paused'], ['es', 'Guía en pausa'], ['hi', 'मार्गदर्शन रुका हुआ है'], ['zh', '引导已暂停']]) {
    const f = fixture(lang); f.context.renderSessionContext(); assert.equal(f.nodes.sessionState.textContent, text);
  }
});
test('resuming restores the ordinary field instruction status', () => {
  const f = fixture('en'); f.context.renderSessionContext(); delete f.context.app.dataset.talk;
  f.context.renderSessionContext(); assert.equal(f.nodes.sessionState.textContent, 'Follow the directions');
  assert.equal(f.nodes.currentField.textContent, '1. Name');
});
