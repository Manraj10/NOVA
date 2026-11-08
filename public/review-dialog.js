// Read-only snapshot of Nib's detected fields. No camera/model access or field mutation.
// Usage: const review = makeReviewDialog(); review.open(S.fields, S.i);
// Calling open() again refreshes an already-open snapshot without moving focus.
// Optional synchronous hooks let the caller pause/resume guidance/voice:
// makeReviewDialog({ onOpen() { ... }, onClose() { ... } }).

let nextDialogId = 0;

const CSS = `
.nib-review-dialog {
  box-sizing: border-box;
  width: min(680px, calc(100vw - 24px));
  max-width: none;
  max-height: calc(100dvh - 24px);
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid #626987;
  border-radius: 16px;
  background: var(--carbon-deep, #10132f);
  color: var(--paper, #f7f6f2);
  font: 17px/1.5 var(--sans, system-ui, sans-serif);
  box-shadow: 0 24px 90px #0009;
  text-align: left;
  color-scheme: dark;
}
.nib-review-dialog *, .nib-review-dialog *::before, .nib-review-dialog *::after { box-sizing: border-box; }
.nib-review-dialog[open] { display: flex; flex-direction: column; }
.nib-review-dialog::backdrop { background: rgb(5 8 24 / 78%); }
.nib-review-dialog__header { padding: 24px 26px 18px; flex-shrink: 0; border-bottom: 1px solid #424967; }
.nib-review-dialog__eyebrow { margin: 0 0 8px; color: var(--flag, #ffe14d); font-size: 12px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.nib-review-dialog__title { margin: 0 0 8px; font-size: 32px; font-weight: 750; line-height: 1.15; letter-spacing: -.03em; overflow-wrap: anywhere; }
.nib-review-dialog__title:focus { outline: none; }
.nib-review-dialog__description { margin: 0; color: #c5cbe0; font-size: 15px; }
.nib-review-dialog__summary { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 15px 0 0; font-size: 13px; color: #dce1ef; }
.nib-review-dialog__summary-item { white-space: nowrap; }
.nib-review-dialog__summary-item[data-status="kept"] { color: #87e1b2; }
.nib-review-dialog__summary-item[data-status="review"] { color: var(--flag, #ffe14d); }
.nib-review-dialog__body { flex: 1 1 auto; min-height: 0; padding: 0 26px; overflow-y: auto; overscroll-behavior: contain; scrollbar-color: #777f9e #1a1f4e; }
.nib-review-dialog__body:focus-visible { outline: 2px solid var(--flag, #ffe14d); outline-offset: -4px; }
.nib-review-dialog__list { margin: 0; padding: 0; list-style: none; }
.nib-review-dialog__field { margin: 0; padding: 20px 0; border-bottom: 1px solid #424967; }
.nib-review-dialog__field:last-child { border-bottom: 0; }
.nib-review-dialog__field-head { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 4px 12px; align-items: start; }
.nib-review-dialog__number { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid #77819f; border-radius: 50%; color: #c8d0e5; font-size: 13px; font-variant-numeric: tabular-nums; }
.nib-review-dialog__field[data-status="kept"] .nib-review-dialog__number { border-color: #579d77; color: #87e1b2; }
.nib-review-dialog__field[data-status="review"] .nib-review-dialog__number { border-color: #b8a442; color: var(--flag, #ffe14d); }
.nib-review-dialog__label { margin: 0; padding-top: 1px; font-size: 19px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.nib-review-dialog__tags { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 3px; }
.nib-review-dialog__status { font-size: 12px; font-weight: 700; line-height: 1.4; color: #c1c9de; }
.nib-review-dialog__field[data-status="kept"] .nib-review-dialog__status { color: #87e1b2; }
.nib-review-dialog__field[data-status="review"] .nib-review-dialog__status { color: var(--flag, #ffe14d); }
.nib-review-dialog__current { border: 1px solid #8c8044; background: #38341e; border-radius: 4px; padding: 2px 6px; color: var(--flag, #ffe14d); font-size: 11px; line-height: 1.5; }
.nib-review-dialog__reading { margin: 13px 0 0 42px; padding: 12px 14px; background: #222846; border: 1px solid #434b6b; border-radius: 7px; }
.nib-review-dialog__reading-label { margin: 0 0 5px; font-size: 12px; line-height: 1.5; font-weight: 650; color: #c3cbe0; }
.nib-review-dialog__answer { margin: 0; font-size: 18px; line-height: 1.5; color: var(--paper, #f7f6f2); white-space: pre-wrap; overflow-wrap: anywhere; }
.nib-review-dialog__hint { margin: 11px 0 0 42px; color: #c0c8df; font-size: 13px; line-height: 1.55; }
.nib-review-dialog__empty { padding: 28px 0; }
.nib-review-dialog__empty h3 { margin: 0 0 10px; font-size: 22px; }
.nib-review-dialog__empty p { margin: 0; color: #c5cbe0; font-size: 16px; }
.nib-review-dialog__footer { flex-shrink: 0; padding: 16px 26px 22px; padding-bottom: max(22px, env(safe-area-inset-bottom)); border-top: 1px solid #424967; background: var(--carbon-deep, #10132f); }
.nib-review-dialog__note { margin: 0 0 13px; color: #bdc6dc; font-size: 12px; line-height: 1.5; }
.nib-review-dialog__close { display: flex; align-items: center; justify-content: center; min-height: 64px; width: 100%; padding: 14px 20px; border: 1px solid var(--flag, #ffe14d); border-radius: 8px; background: var(--flag, #ffe14d); color: #10132f; font: 750 18px/1.3 var(--sans, system-ui, sans-serif); cursor: pointer; touch-action: manipulation; }
.nib-review-dialog__close:focus-visible { outline: 3px solid var(--paper, #f7f6f2); outline-offset: 4px; }
@media (max-width: 480px) {
  .nib-review-dialog { width: calc(100vw - 20px); max-height: calc(100dvh - 20px); border-radius: 12px; }
  .nib-review-dialog__header { padding: 20px 19px 16px; }
  .nib-review-dialog__title { font-size: 28px; }
  .nib-review-dialog__description { font-size: 14px; }
  .nib-review-dialog__body { padding: 0 19px; }
  .nib-review-dialog__field { padding: 18px 0; }
  .nib-review-dialog__field-head { column-gap: 10px; grid-template-columns: 28px minmax(0, 1fr); }
  .nib-review-dialog__number { width: 28px; height: 28px; }
  .nib-review-dialog__label { font-size: 18px; }
  .nib-review-dialog__reading { margin-left: 0; }
  .nib-review-dialog__hint { margin-left: 0; }
  .nib-review-dialog__footer { padding: 15px 19px max(18px, env(safe-area-inset-bottom)); }
}
`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fieldState(field) {
  if (field.skipped) return 'skipped';
  // Redo clears answer/review in app.js but can leave an old legible=false.
  // An old legibility result without a reading must not flag the fresh field.
  if (field.review || (field.legible === false && field.answer)) return 'review';
  return field.done ? 'kept' : 'pending';
}

/**
 * Native modal review of the existing field truth. Status precedence is
 * skipped > review/illegible > done (kept) > pending. An answer alone never
 * means kept. Rows are text, not field-navigation controls.
 * Hooks run once per open/close, not on snapshot refresh; this module never
 * mutates app state. close() and destroy() invoke onClose synchronously.
 * @param {{onOpen?: Function, onClose?: Function}} [options]
 * @returns {{open(fields: Array, currentIndex: number): void, close(): void, destroy(): void}}
 */
export function makeReviewDialog({ onOpen, onClose } = {}) {
  const id = `nib-review-dialog-${++nextDialogId}`;
  const style = element('style');
  style.textContent = CSS;
  document.head.append(style);

  const dialog = element('dialog', 'nib-review-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-description`);
  const header = element('header', 'nib-review-dialog__header');
  const eyebrow = element('p', 'nib-review-dialog__eyebrow', 'Read-only review');
  const title = element('h2', 'nib-review-dialog__title', 'Review your form');
  title.id = `${id}-title`;
  title.tabIndex = -1;
  const description = element('p', 'nib-review-dialog__description');
  description.id = `${id}-description`;
  const summary = element('p', 'nib-review-dialog__summary');
  header.append(eyebrow, title, description, summary);

  const body = element('div', 'nib-review-dialog__body');
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', 'Scrollable field details');
  const list = element('ol', 'nib-review-dialog__list');
  list.setAttribute('aria-label', 'Detected fields');
  list.setAttribute('role', 'list');
  body.append(list);

  const footer = element('footer', 'nib-review-dialog__footer');
  const note = element('p', 'nib-review-dialog__note', 'This list reflects detected fields. It does not certify that the whole document is complete.');
  const closeButton = element('button', 'nib-review-dialog__close', 'Close review');
  closeButton.type = 'button';
  footer.append(note, closeButton);
  dialog.append(header, body, footer);
  document.body.append(dialog);

  let opener = null;
  let destroyed = false;
  let sessionActive = false;

  function restoreFocus() {
    const target = opener;
    opener = null;
    if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  function close() {
    if (!destroyed && dialog.open) {
      dialog.close();
      finishClose();
    }
  }

  function finishClose() {
    if (!sessionActive || dialog.open) return;
    sessionActive = false;
    try { if (typeof onClose === 'function') onClose(); }
    finally { restoreFocus(); }
  }

  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', finishClose);
  // Keep the app's global Space/Enter/R/S and press-to-talk handlers out of
  // a read-only modal. Native Tab, Escape, scrolling and button actions remain.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click']) {
    dialog.addEventListener(type, event => event.stopPropagation());
  }

  function open(fields, currentIndex = -1) {
    if (destroyed) return;
    const wasOpen = dialog.open;
    if (!wasOpen) opener = document.activeElement;
    const records = Array.isArray(fields) ? fields : [];
    const counts = { kept: 0, review: 0, skipped: 0, pending: 0 };
    list.replaceChildren();
    summary.replaceChildren();
    description.textContent = `${records.length} detected ${records.length === 1 ? 'field' : 'fields'}. Readings remain proposed until you keep them.`;

    records.forEach((record, index) => {
      const field = record && typeof record === 'object' ? record : {};
      const state = fieldState(field);
      counts[state] += 1;
      const row = element('li', 'nib-review-dialog__field');
      row.dataset.status = state;
      const head = element('div', 'nib-review-dialog__field-head');
      const number = element('span', 'nib-review-dialog__number', String(index + 1));
      number.setAttribute('aria-hidden', 'true');
      const label = element('h3', 'nib-review-dialog__label', field.label == null || field.label === '' ? `Field ${index + 1}` : String(field.label));
      const tags = element('div', 'nib-review-dialog__tags');
      const status = element('span', 'nib-review-dialog__status', { skipped: 'Skipped', review: 'Needs another look', kept: 'Kept', pending: 'Pending' }[state]);
      tags.append(status);
      if (index === currentIndex) tags.append(element('span', 'nib-review-dialog__current', 'Current field'));
      head.append(number, label, tags);
      row.append(head);

      const answer = field.answer == null ? '' : String(field.answer);
      if (answer) {
        const reading = element('dl', 'nib-review-dialog__reading');
        const readingLabel = state === 'skipped' ? 'Reading on skipped field' : field.done ? (state === 'review' ? 'Kept reading · needs review' : 'Kept reading') : 'Proposed reading · not kept';
        reading.append(element('dt', 'nib-review-dialog__reading-label', readingLabel), element('dd', 'nib-review-dialog__answer', answer));
        row.append(reading);
      }

      let hint = '';
      if (state === 'skipped') hint = 'This field was skipped; it is not a kept entry.';
      else if (state === 'review') hint = field.done ? 'You kept this reading, but it is still flagged for another look.' : answer ? 'This reading is unclear and has not been kept.' : 'This field is flagged for another look and has no kept entry.';
      else if (state === 'pending') hint = answer ? 'Waiting for your decision. This reading has not been kept.' : 'No kept entry yet.';
      else if (!answer) hint = 'Kept status is recorded; no text reading is available.';
      if (hint) row.append(element('p', 'nib-review-dialog__hint', hint));
      list.append(row);
    });

    if (!records.length) {
      const empty = element('div', 'nib-review-dialog__empty');
      empty.append(element('h3', '', 'No detected fields yet'), element('p', '', 'Read a form first, then open review to see its detected fields.'));
      body.replaceChildren(empty);
    } else if (list.parentElement !== body) body.replaceChildren(list);

    for (const [state, count] of Object.entries(counts)) {
      const words = { kept: 'kept', review: count === 1 ? 'needs review' : 'need review', skipped: 'skipped', pending: 'pending' };
      const item = element('span', 'nib-review-dialog__summary-item', `${count} ${words[state]}`);
      item.dataset.status = state;
      summary.append(item);
    }
    if (!wasOpen) {
      dialog.showModal();
      sessionActive = true;
      body.scrollTop = 0;
      try { if (typeof onOpen === 'function') onOpen(); }
      finally { title.focus({ preventScroll: true }); }
    }
  }

  function destroy() {
    if (destroyed) return;
    try {
      close();
      finishClose();
    } finally {
      dialog.removeEventListener('close', finishClose);
      closeButton.removeEventListener('click', close);
      dialog.remove();
      style.remove();
      destroyed = true;
    }
  }

  return { open, close, destroy };
}
