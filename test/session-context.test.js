// Actual presentation handlers with a small DOM double, no browser or model calls.
// The double deliberately does not parse innerHTML: fixed markup is inspected as
// a string; field labels/readings must take the literal textContent path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const appURL = process.env.NIB_UI_APP_SOURCE
  ? pathToFileURL(resolve(process.env.NIB_UI_APP_SOURCE))
  : new URL('../public/app.js', import.meta.url);
const source = readFileSync(appURL, 'utf8');
function handler(name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `actual ${name} handler exists`);
  return match[0];
}

class NodeDouble {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = new Map();
    this.children = []; this.hidden = false; this._text = ''; this._html = '';
    this.style = { values: {}, setProperty(key, value) { this.values[key] = String(value); } };
  }
  set textContent(value) { this._text = String(value ?? ''); this._html = ''; this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set innerHTML(value) { this._html = String(value); this._text = ''; this.children = []; }
  get innerHTML() { return this._html; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; this._html = ''; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  toggleAttribute(key, enabled = !this.attributes.has(key)) {
    if (enabled) this.attributes.set(key, ''); else this.attributes.delete(key);
    return enabled;
  }
  hasAttribute(key) { return this.attributes.has(key); }
  querySelector(selector) {
    assert.equal(selector, '[data-state="active"]', 'unexpected selector needs an explicit DOM fixture');
    const walk = node => node.children.find(child => child.dataset.state === 'active' || walk(child));
    return walk(this) || null;
  }
  scrollIntoView() { this.scrolledIntoView = true; }
}

function fixture(overrides = {}) {
  const ids = ['sessionMode', 'sessionState', 'currentField', 'progress', 'count',
    'panelTitle', 'panelMeta', 'panelFind', 'fieldList', 'panelFoot', 'panelHud'];
  const nodes = Object.fromEntries(ids.map(id => [id, new NodeDouble()]));
  const app = new NodeDouble(), fields = [{ label: 'Full name', kind: 'text', done: false }];
  const S = { mode: 'guide', lang: 'en', sim: null, fields, i: 0, title: 'Volunteer sign-up',
    elapsed: '0:35', readSecs: 2.4, handPts: [], trackN: 0, ...overrides };
  const video = { srcObject: {} }, ambientVideo = { srcObject: video.srcObject, play: async () => {} };
  let keepCalls = 0, nextCalls = 0;
  const context = { S, app, video, ambientVideo, drift: { verified: false },
    $: id => { assert.ok(nodes[id], `unexpected DOM id ${id}`); return nodes[id]; },
    document: { createElement: tag => new NodeDouble(tag) },
    matchMedia: () => ({ matches: false }),
    KIND: { text: 'Write', date: 'Date', number: 'Number', checkbox: 'Check', signature: 'Sign' },
    keep() { keepCalls++; }, next() { nextCalls++; },
  };
  vm.createContext(context);
  vm.runInContext(handler('renderSessionContext') + '\n' + handler('renderLists') + '\n' + handler('hud'), context);
  return { S, app, nodes, context, render: () => context.renderLists(),
    commands: () => ({ keepCalls, nextCalls }) };
}

function literalNode(root, className) {
  for (const child of root.children) {
    if (child.className === className) return child;
    const found = literalNode(child, className); if (found) return found;
  }
  return null;
}

test('a proposed answer is never counted as kept or confirmed by rendering', () => {
  const field = { label: 'Full name', kind: 'text', answer: 'Alex Rivera', done: false, review: false, legible: true };
  const f = fixture({ mode: 'confirm', fields: [field] }), before = JSON.stringify(f.S.fields);
  f.render();
  assert.match(f.nodes.count.innerHTML, /<b>0<\/b>\s*\/\s*1 kept/);
  assert.equal(f.nodes.sessionState.textContent, 'Check the readback');
  assert.equal(f.nodes.fieldList.children[0].dataset.state, 'active');
  assert.equal(f.nodes.progress.children[0].dataset.state, 'active');
  assert.equal(f.app.style.values['--p'], '0');
  assert.equal(f.S.mode, 'confirm');
  assert.equal(JSON.stringify(f.S.fields), before);
  assert.deepEqual(f.commands(), { keepCalls: 0, nextCalls: 0 });
});

test('skipped entries do not inflate the kept count or progress', () => {
  const f = fixture({ fields: [
    { label: 'Name', done: true, answer: 'Alex' },
    { label: 'Phone', done: true, skipped: true },
    { label: 'Shift', done: false },
  ] });
  f.render();
  assert.match(f.nodes.count.innerHTML, /<b>1<\/b>\s*\/\s*3 kept/);
  assert.equal(f.app.style.values['--p'], String(1 / 3));
  assert.deepEqual(f.nodes.fieldList.children.map(n => n.dataset.state), ['done', 'skipped', 'todo']);
});

for (const flag of ['review', 'stale']) {
  test(`a kept entry with ${flag} remains visibly unresolved`, () => {
    const f = fixture({ mode: 'done', fields: [{ label: 'Name', done: true, answer: 'Alex', [flag]: true }] });
    f.render();
    assert.match(f.nodes.count.innerHTML, /<b>1<\/b>/);
    assert.equal(f.nodes.fieldList.children[0].dataset.state, 'review');
    assert.equal(f.nodes.progress.children[0].dataset.state, 'review');
    assert.equal(f.nodes.fieldList.children[0].dataset.flag, 'review');
    assert.match(f.nodes.panelFoot.innerHTML, /Review before you finish/);
    assert.equal(f.nodes.panelFoot.hasAttribute('data-open'), true);
    assert.doesNotMatch(f.nodes.panelFoot.innerHTML, /Completed independently|without help/);
  });
}

test('redo with stale legible=false is a new pending answer, not a kept/review entry', () => {
  const f = fixture({ mode: 'write', fields: [{ label: 'Name', done: false, answer: '', review: false, legible: false }] });
  f.render();
  assert.equal(f.nodes.fieldList.children[0].dataset.state, 'active');
  assert.equal(f.nodes.fieldList.children[0].dataset.flag, undefined);
  assert.equal(literalNode(f.nodes.fieldList.children[0], 'n').textContent, '1');
  assert.match(f.nodes.count.innerHTML, /<b>0<\/b>/);
});

test('done with a pending or skipped entry does not present a clean receipt', () => {
  for (const unresolved of [{ done: false, answer: 'Unconfirmed' }, { done: true, skipped: true }]) {
    const f = fixture({ mode: 'done', fields: [{ label: 'Name', ...unresolved }] });
    f.render();
    assert.match(f.nodes.panelFoot.innerHTML, /Review before you finish/);
    assert.match(f.nodes.count.innerHTML, /<b>0<\/b>/);
    assert.equal(f.nodes.panelFoot.hasAttribute('data-open'), true);
  }
});

test('a failed final check cannot become a clean-looking completed receipt', () => {
  const f = fixture({ mode: 'done', reviewFailed: true, fields: [{ label: 'Name', done: true, answer: 'Alex' }] });
  f.render();
  assert.match(f.nodes.panelFoot.innerHTML, /Review before you finish/);
  assert.equal(f.nodes.panelFoot.hasAttribute('data-open'), true);
  assert.match(f.nodes.panelFoot.innerHTML, /Final check caught<\/dt><dd>–<\/dd>/);
  assert.doesNotMatch(f.nodes.panelFoot.innerHTML, /Completed independently|hand (?:it|the form) in|without help/);
});

test('a clean receipt reports kept answers without asserting independence', () => {
  for (const sim of [null, {}]) {
    const f = fixture({ mode: 'done', sim, fields: [{ label: 'Name', done: true, answer: 'Alex' }] });
    f.render();
    assert.match(f.nodes.panelFoot.innerHTML, /Answers kept/);
    assert.equal(f.nodes.panelFoot.hasAttribute('data-open'), false);
    assert.doesNotMatch(f.nodes.panelFoot.innerHTML, /Completed independently|without help|verified complete/);
  }
});

test('empty/error states have finite progress and no invented kept entries', () => {
  for (const mode of ['idle', 'done']) {
    const f = fixture({ mode, fields: [], reviewFailed: mode === 'done' });
    f.app.dataset.cue = 'error'; f.render();
    assert.equal(f.nodes.count.innerHTML, '');
    assert.equal(f.app.style.values['--p'], '0');
    assert.equal(f.nodes.currentField.hidden, true);
    assert.equal(f.app.hasAttribute('data-field-active'), false);
    assert.doesNotMatch(f.nodes.panelFoot.innerHTML, /NaN|Infinity|Completed independently|without help/);
    if (mode === 'idle') assert.equal(f.nodes.panelFoot.hidden, true);
  }
});

test('Practice and Live labels remain present throughout the answer lifecycle', () => {
  for (const sim of [null, {}]) for (const mode of ['start', 'reading', 'guide', 'write', 'check', 'confirm', 'done']) {
    const f = fixture({ sim, mode }); f.render();
    assert.equal(f.nodes.sessionMode.textContent, sim ? 'Practice' : 'Live camera');
    assert.equal(f.nodes.sessionMode.dataset.kind, sim ? 'practice' : 'live');
  }
});

test('current field is shown only for an active target and find uses its own description', () => {
  const f = fixture({ mode: 'guide' }); f.render();
  assert.equal(f.nodes.currentField.textContent, '1. Full name');
  assert.equal(f.nodes.currentField.hidden, false);
  assert.equal(f.app.hasAttribute('data-field-active'), true);
  f.S.mode = 'find'; f.S.find = { q: 'Where is the event date?', label: 'Event date' }; f.render();
  assert.equal(f.nodes.currentField.textContent, 'Where is the event date?');
  f.S.mode = 'done'; f.render();
  assert.equal(f.nodes.currentField.hidden, true);
  assert.equal(f.nodes.currentField.textContent, '');
});

test('listening/thinking status does not hide the active field or change session mode', () => {
  const f = fixture({ sim: {}, mode: 'write' });
  for (const [state, expected] of [['listening', 'Listening'], ['thinking', 'Thinking']]) {
    f.app.dataset.talk = state; f.render();
    assert.equal(f.nodes.sessionState.textContent, expected);
    assert.equal(f.nodes.currentField.hidden, false);
    assert.equal(f.nodes.sessionMode.textContent, 'Practice');
    assert.equal(f.S.mode, 'write');
  }
});

test('all supported languages have a confirmation label and localized kept count', () => {
  for (const [lang, mode, confirm, kept] of [
    ['en', 'Practice', 'Check the readback', 'kept'],
    ['es', 'Práctica', 'Comprueba la lectura', 'guardados'],
    ['hi', 'अभ्यास', 'पढ़ा हुआ जाँचें', 'रखे'],
    ['zh', '练习', '请核对识别结果', '已保留'],
  ]) {
    const f = fixture({ lang, sim: {}, mode: 'confirm' }); f.render();
    assert.equal(f.nodes.sessionMode.textContent, mode);
    assert.equal(f.nodes.sessionState.textContent, confirm);
    assert.ok(f.nodes.count.innerHTML.endsWith(kept));
  }
});

test('unknown language falls back to the English confirmation meaning', () => {
  const f = fixture({ lang: 'unknown', mode: 'confirm' }); f.render();
  assert.equal(f.nodes.sessionMode.textContent, 'Live camera');
  assert.equal(f.nodes.sessionState.textContent, 'Check the readback');
});

test('unknown app state falls back without claiming completion or showing a stale field', () => {
  const f = fixture({ mode: 'future-mode' }); f.render();
  assert.equal(f.nodes.sessionState.textContent, 'Ready');
  assert.equal(f.nodes.currentField.hidden, true);
  assert.equal(f.nodes.panelFoot.hidden, true);
});

test('document/field/readback text containing markup remains literal text', () => {
  const label = '<img src=x onerror=alert(1)>', answer = '<script>alert(2)</script>';
  const f = fixture({ mode: 'confirm', title: label, fields: [{ label, answer, done: false }] });
  f.render();
  assert.equal(f.nodes.currentField.textContent, `1. ${label}`);
  assert.equal(f.nodes.currentField.innerHTML, '');
  assert.equal(f.nodes.panelTitle.textContent, label);
  assert.equal(literalNode(f.nodes.fieldList.children[0], 'f-answer').textContent, answer);
  assert.equal(literalNode(f.nodes.fieldList.children[0], 'f-answer').innerHTML, '');
  assert.ok(literalNode(f.nodes.fieldList.children[0], 'f-label').textContent.startsWith(label));
  assert.equal(literalNode(f.nodes.fieldList.children[0], 'f-label').innerHTML, '');
  assert.doesNotMatch(f.nodes.count.innerHTML + f.nodes.panelFoot.innerHTML, /<img|<script/);
});

test('HUD refresh also maintains Practice identity even with a prior AI call', () => {
  const f = fixture({ sim: {}, mode: 'confirm', lastApi: { job: 'ask', secs: 1.2 } });
  f.context.hud(1000);
  assert.equal(f.nodes.sessionMode.textContent, 'Practice');
  assert.equal(f.nodes.sessionState.textContent, 'Check the readback');
  assert.match(f.nodes.panelHud.innerHTML, /Practice/);
  assert.equal(f.S.fields[0].done, false);
});
