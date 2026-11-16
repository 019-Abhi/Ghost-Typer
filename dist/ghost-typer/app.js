import { COLORS, validateLibrary } from './model.js';

const $ = (s, root = document) => root.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  folder: '<path d="M3 7V5h6l2 3h10v12H3Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 9h10M7 13h10M7 17h5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0m2 2 2-2a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.folder}</svg>`;
const iconButton = (name, action, label, extra = '') => `<button class="icon-button ${name === 'trash' ? 'remove' : ''}" data-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${extra}>${icon(name)}</button>`;
const popup = document.body.classList.contains('popup');
let data, group = 'all', search = '', tab = 'fields', review = null, result = null, busy = false, error = '';
const app = $('#app'), dialog = $('#dialog');
const scrollPositions = new Map();
let renderedView = null, renderedBusy = false, dialogScroll = null;
function scrollTargets() {
  const targets = new Map([['document', document.scrollingElement]]);
  for (const selector of ['.popup-content', '.group-chips', '.group-nav', '.sidebar']) {
    const node = $(selector); if (node) targets.set(selector, node);
  }
  for (const row of app.querySelectorAll('.review-row')) {
    targets.set(`answer:${$('input[data-match]', row).dataset.match}`, $('.review-value', row));
  }
  return targets;
}
function captureScroll() {
  return new Map([...scrollTargets()].map(([key, node]) => [key, { left: node.scrollLeft, top: node.scrollTop }]));
}
function restoreScroll(positions) {
  if (!positions) return;
  for (const [key, node] of scrollTargets()) {
    const position = positions.get(key);
    if (position) node.scrollTo({ ...position, behavior: 'instant' });
  }
}
dialog.addEventListener('close', () => {
  // Closing a native dialog can restore focus and move the page. Restore after that,
  // including when the action was cancelled with Escape or the close button.
  restoreScroll(dialogScroll);
  dialogScroll = null;
});
let toastTimer;
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3500);
}
async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Could not connect to Ghost Typer. Reload the extension and try again.');
  return response.data;
}
const groupFor = id => data.groups.find(g => g.id === id) || { id: '', name: 'Ungrouped', color: 'slate' };
const filledCount = () => data.fields.filter(f => f.value !== '').length;
function groupButtons(chips = false) {
  const items = [{ id: 'all', name: 'All fields', color: 'violet' }, ...data.groups, { id: '', name: 'Ungrouped', color: 'slate' }];
  return items.map(g => `<button class="${chips ? '' : 'group-button'} ${group === g.id ? 'active' : ''}" data-action="group" data-id="${escape(g.id)}" aria-pressed="${group === g.id}">
    ${g.id === 'all' ? icon('grid') : `<span class="group-dot ${g.color}"></span>`}${escape(g.name)}
    ${chips ? '' : `<span class="count">${g.id === 'all' ? data.fields.length : data.fields.filter(f => f.groupId === g.id).length}</span>`}</button>`).join('');
}
function header() {
  return `<header class="topbar"><div class="brand"><img src="icons/ghost.svg" alt=""><div><div class="brand-name">Ghost Typer</div><div class="brand-sub">A little less typing. A lot more you.</div></div></div>
    <div class="header-actions"><span class="pill"><span class="dot"></span>Local only</span>${popup ? iconButton('external', 'manager', 'Open field manager') : '<span class="eyebrow">YOUR FORM COMPANION</span>'}</div></header>`;
}
function toolbar() {
  return `<div class="toolbar"><label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Search your fields…" aria-label="Search fields" value="${escape(search)}"></label>
    ${popup ? `<button class="primary" data-action="addField">${icon('plus')}Add field</button>` : `<span class="field-total">${filledCount()} of ${data.fields.length} fields ready</span>`}</div>`;
}
function fieldCard(f) {
  return `<article class="field-card"><div class="field-top"><span class="field-label">${escape(f.label)}</span><div class="field-actions">${iconButton('trash', 'deleteField', `Delete ${f.label}`, `data-id="${escape(f.id)}"`)}</div></div>
    <button type="button" class="field-value ${f.value === '' ? 'empty' : ''}" data-action="editField" data-id="${escape(f.id)}" aria-label="${escape(`Edit ${f.label}`)}" title="${escape(f.value ? `${f.value} — Click to edit` : 'Click to add a value')}">${f.value === '' ? 'Add a value to get started' : escape(f.kind === 'boolean' ? (f.value === 'true' ? 'Checked' : 'Unchecked') : f.value)}</button>
    <div class="field-bottom">${icon('link')}<span>${f.aliases.length ? `Also matches ${escape(f.aliases.slice(0, 2).join(', '))}` : 'Matches by field name'}</span></div></article>`;
}
function sections() {
  const filtered = data.fields.filter(f => (group === 'all' || f.groupId === group) && [f.label, f.value, ...f.aliases].some(v => v.toLowerCase().includes(search.toLowerCase())));
  const groups = [...data.groups, { id: '', name: 'Ungrouped', color: 'slate' }].filter(g => group === 'all' || group === g.id);
  if (!filtered.length && search) return `<div class="empty-state">${icon('search')}<strong>No fields found</strong><p>Try a different name, value, or alias.</p></div>`;
  return groups.filter(g => g.id || filtered.some(f => !f.groupId) || group === '').map(g => {
    const fields = filtered.filter(f => f.groupId === g.id);
    if (search && !fields.length) return '';
    return `<section class="group-section"><div class="group-heading"><span class="group-dot ${g.color}"></span><h2>${escape(g.name)}</h2><span class="count">${fields.length}</span>
      <div class="group-tools">${g.id ? iconButton('edit', 'editGroup', `Rename ${g.name} group`, `data-id="${escape(g.id)}"`) + iconButton('trash', 'deleteGroup', `Delete ${g.name} group`, `data-id="${escape(g.id)}"`) : ''}${iconButton('plus', 'addField', `Add field to ${g.name}`, `data-group="${escape(g.id)}"`)}</div></div>
      ${fields.length ? `<div class="fields-grid">${fields.map(fieldCard).join('')}</div>` : '<div class="empty-state"><p>No fields yet. Add your first one with the + button.</p></div>'}</section>`;
  }).join('');
}
function libraryFooter() {
  return `<footer class="library-footer"><span>Your details stay in this Chrome profile.</span><div class="footer-actions"><button data-action="export">Export backup</button><button data-action="import">Import</button></div></footer>`;
}
function render() {
  if (!data) return;
  if (renderedView && !renderedBusy) scrollPositions.set(renderedView, dialogScroll || captureScroll());
  const nextView = popup ? tab : 'manager';
  if (group !== 'all' && group !== '' && !data.groups.some(g => g.id === group)) group = 'all';
  if (popup) {
    app.innerHTML = `${header()}<nav class="tabs" aria-label="Extension views"><button class="tab ${tab === 'fields' ? 'active' : ''}" data-action="tab" data-tab="fields">${icon('grid')}My fields</button><button class="tab ${tab === 'review' ? 'active' : ''}" data-action="tab" data-tab="review">${icon('scan')}Review & fill${review ? ` · ${review.matches.length}` : ''}</button></nav>
      <main class="popup-content">${error ? `<div class="error-banner" role="alert">${escape(error)}</div>` : ''}${tab === 'fields' ? toolbar() + `<nav class="group-chips" aria-label="Field groups">${groupButtons(true)}<button data-action="addGroup">${icon('plus')}New group</button></nav><div id="sections">${sections()}</div>` : renderReview()}</main>
      <footer class="popup-footer">${footerButton()}<p class="footnote">${review && tab === 'review' ? 'Only your selected values will be filled. Nothing is submitted.' : 'You review every match before anything is filled.'}</p></footer>`;
  } else {
    app.innerHTML = `${header()}<div class="workspace"><aside class="sidebar"><div class="sidebar-label">YOUR LIBRARY ${iconButton('plus', 'addGroup', 'Create group')}</div><nav class="group-nav" aria-label="Field groups">${groupButtons()}</nav><button class="text-button" style="margin:14px 12px" data-action="addGroup">${icon('plus')}Create a group</button><div class="sidebar-note">${icon('shield')}<p><strong>Yours. And only yours.</strong><br>No accounts. No cloud.<br>Just your details, saved locally.</p></div></aside>
      <main class="library-main"><div class="page-title"><div><div class="eyebrow">LESS REPETITION, MORE POSSIBILITY</div><h1>${group === 'all' ? 'Your details, remembered.' : escape(groupFor(group).name)}</h1><p class="subtitle">A home for the things you type over and over.</p></div><button class="primary" data-action="addField">${icon('plus')}Add field</button></div>
      <div class="intro-card"><div class="intro-icon">${icon('spark')}</div><div><strong>Set it once. Let your ghost do the typing.</strong><p>Save your values, open a website, then click the Ghost Typer toolbar icon.</p></div><span class="intro-step">Scan → Review → Fill</span></div>
      ${toolbar()}<div id="sections">${sections()}</div>${libraryFooter()}</main></div>`;
  }
  renderedView = nextView;
  renderedBusy = busy;
  // Temporary loading screens must not replace a view's remembered position with zero.
  if (!busy) restoreScroll(scrollPositions.get(nextView));
}
function footerButton() {
  if (busy) return '<button class="primary" disabled>Working…</button>';
  if (tab === 'review' && review) {
    const count = review.matches.filter(m => m.selected && !m.same).length;
    return `<button class="primary" data-action="fill" ${count ? '' : 'disabled'}>${icon('check')}Confirm & fill ${count ? `(${count})` : ''}</button>`;
  }
  return `<button class="primary" data-action="scan" ${filledCount() ? '' : 'disabled'}>${icon('scan')}${result ? 'Scan again' : 'Scan this page'}${icon('arrow')}</button>`;
}
function renderReview() {
  if (busy) return '<div class="loading"><div class="spinner"></div><p>Checking the page…</p></div>';
  if (result) {
    const count = result.results.filter(r => r.ok).length;
    return `<div class="scan-hero"><div class="scan-art">${icon('check')}</div><div class="eyebrow">YOU’RE IN CONTROL</div><h1>${count} ${count === 1 ? 'field' : 'fields'} filled.</h1><p>Review your form on the website.<br>Ghost Typer never submits it for you.</p><ul class="result-list">${result.results.map(r => `<li><span class="${r.ok ? 'ok' : 'failed'}">${icon(r.ok ? 'check' : 'close')}</span><span>${escape(result.matches.find(m => m.id === r.id)?.label || 'Field')}${r.ok ? '' : `<br>${escape(r.reason)}`}</span></li>`).join('')}</ul></div>`;
  }
  if (!review) return `<div class="scan-hero"><div class="scan-art">${icon('scan')}</div><div class="eyebrow">A SECOND PAIR OF HANDS</div><h1>You approve. Ghost types.</h1><p>Find the fields your saved details belong in. Nothing changes until you say so.</p><div class="step-list"><div class="step-item"><span class="step-number">01</span>Scan the form on your current page</div><div class="step-item"><span class="step-number">02</span>Review the matches and exact values</div><div class="step-item"><span class="step-number">03</span>Confirm the fields you want to fill</div></div>${!filledCount() ? '<p>Start by saving a value in My fields.</p>' : ''}</div>`;
  const excluded = Object.values(review.counts).reduce((a, b) => a + b, 0) + review.skipped;
  return `<div class="review-intro"><div class="site-label">${icon('globe')}${escape(new URL(review.url).host)}</div><h1>Here’s what we found.</h1><p>Check the details. Choose what goes in.</p></div>
    <div class="review-summary"><span>${review.matches.length} matching ${review.matches.length === 1 ? 'field' : 'fields'}</span><button data-action="selectEmpty">Select empty fields</button><button data-action="scan">Rescan</button></div>
    ${review.matches.length ? review.matches.map(m => `<label class="review-row ${m.selected ? 'selected' : ''}"><input type="checkbox" data-match="${escape(m.id)}" ${m.selected ? 'checked' : ''} ${m.same ? 'disabled' : ''} aria-label="${escape(m.existing && !m.same ? `Replace ${m.label}` : `Fill ${m.label}`)}"><span class="review-detail"><span class="review-name">${escape(m.label)}</span><div class="review-source">${escape(groupFor(m.groupId).name)} / ${escape(m.savedLabel)}</div><div class="review-value">${escape(m.display)}</div>${m.existing ? `<div class="review-existing">${m.same ? 'Already has this value — no change needed.' : `Currently: ${escape(m.currentDisplay)}. Check to replace.`}</div>` : ''}</span></label>`).join('') : '<div class="empty-state">' + icon('search') + '<strong>No confident matches yet</strong><p>Add a matching alias to your saved field, or save a value for the website’s field name, then scan again.</p></div>'}
    <p class="review-note">${excluded ? `${excluded} controls skipped (empty saved answers, no clear match, unsupported, or protected). ` : ''}${review.counts.ambiguous ? `${review.counts.ambiguous} ambiguous matches were left out. ` : ''}${review.inaccessibleFrames ? 'Some embedded forms could not be accessed. ' : ''}${review.truncated ? 'Only the first 2,000 controls were scanned. ' : ''}Filled values are visible to this website’s scripts.</p>`;
}

function showDialog(title, subtitle, body, submitText = 'Save', onSubmit, danger = false) {
  dialogScroll = captureScroll();
  dialog.innerHTML = `<form><div class="dialog-head"><h2>${escape(title)}</h2>${iconButton('close', 'closeDialog', 'Close dialog')}</div><p class="dialog-subtitle">${escape(subtitle)}</p>${body}<div class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="secondary" data-action="closeDialog">Cancel</button><button type="submit" class="${danger ? 'danger-button' : 'primary'}">${escape(submitText)}</button></div></form>`;
  // Non-submit buttons must never implicitly submit a dialog form.
  dialog.querySelectorAll('button[data-action]').forEach(b => b.type = 'button');
  $('form', dialog).onsubmit = async event => {
    event.preventDefault(); const button = $('button[type="submit"]', dialog); button.disabled = true;
    try { await onSubmit(new FormData(event.currentTarget)); dialog.close(); }
    catch (e) { $('.dialog-error', dialog).textContent = e.message; }
    finally { button.disabled = false; }
  };
  dialog.showModal();
  const focus = $('input:not([type="radio"]),textarea,select', dialog); if (focus) focus.focus({ preventScroll: true });
}
async function mutate(action, message) {
  data = await send('mutate', { action }); review = null; result = null; render(); toast(message);
}
function editField(id, selectedGroup) {
  const field = data.fields.find(f => f.id === id) || { id: crypto.randomUUID(), label: '', value: '', aliases: [], autocomplete: '', kind: 'text', groupId: selectedGroup ?? (group === 'all' ? data.groups[0]?.id || '' : group) };
  showDialog(id ? 'Edit field' : 'A new detail to remember', 'Give it a name, a value, and a place in your library.',
    `<label class="form-field">Field name<input name="label" required maxlength="120" value="${escape(field.label)}" placeholder="e.g. University"></label>
    <div class="form-row"><label class="form-field">Group<select name="groupId">${data.groups.map(g => `<option value="${escape(g.id)}" ${g.id === field.groupId ? 'selected' : ''}>${escape(g.name)}</option>`).join('')}<option value="" ${!field.groupId ? 'selected' : ''}>Ungrouped</option></select></label>
    <label class="form-field">Answer type<select name="kind"><option value="text" ${field.kind === 'text' ? 'selected' : ''}>Text / option</option><option value="boolean" ${field.kind === 'boolean' ? 'selected' : ''}>Checkbox</option></select></label></div>
    <label class="form-field" id="valueContainer">Value${valueInput(field.kind, field.value)}</label>
    <label class="form-field">Also known as <span class="muted">(optional)</span><input name="aliases" maxlength="3500" value="${escape(field.aliases.join(', '))}" placeholder="College, Institution, University name"><span class="hint">Separate alternative field labels with commas. Exact aliases make matching more reliable.</span></label>`,
    id ? 'Save changes' : 'Add field', async form => {
      const label = form.get('label').trim();
      await mutate({ type: 'saveField', field: { ...field, label, value: form.get('value'), kind: form.get('kind'), groupId: form.get('groupId'), aliases: form.get('aliases').split(',').map(v => v.trim()).filter(Boolean), autocomplete: label === field.label ? field.autocomplete : '' } }, id ? 'Field updated' : 'Field added');
    });
  $('select[name="kind"]', dialog).onchange = event => { $('#valueContainer', dialog).innerHTML = `Value${valueInput(event.target.value, '')}`; };
  if (id) $('[name="value"]', dialog).focus({ preventScroll: true });
}
function valueInput(kind, value) {
  return kind === 'boolean' ? `<select name="value"><option value="">Not set</option><option value="true" ${value === 'true' ? 'selected' : ''}>Checked</option><option value="false" ${value === 'false' ? 'selected' : ''}>Unchecked</option></select>`
    : `<textarea name="value" maxlength="10000" placeholder="The answer you want to reuse…">${escape(value)}</textarea><span class="hint">Leave blank to skip this field. For dropdowns or radio buttons, enter the option’s label.</span>`;
}
function editGroup(id) {
  const existing = data.groups.find(g => g.id === id), g = existing || { id: crypto.randomUUID(), name: '', color: COLORS[data.groups.length % COLORS.length] };
  showDialog(existing ? 'Edit group' : 'Make a little room', 'Organize your fields in a way that makes sense to you.',
    `<label class="form-field">Group name<input name="name" required maxlength="60" value="${escape(g.name)}" placeholder="e.g. Education"></label><div class="form-field">Color<div class="color-options">${COLORS.map(c => `<label class="color-choice ${c}"><input type="radio" name="color" value="${c}" ${g.color === c ? 'checked' : ''} aria-label="${c}"><span></span></label>`).join('')}</div></div>`,
    existing ? 'Save changes' : 'Create group', async form => {
      await mutate({ type: 'saveGroup', group: { id: g.id, name: form.get('name').trim(), color: form.get('color') } }, existing ? 'Group updated' : 'Group created');
    });
}
function deleteField(id) {
  const f = data.fields.find(f => f.id === id); if (!f) return;
  showDialog('Delete this field?', 'This removes the field and its saved value.', `<p class="confirm-copy">${escape(f.label)} will be removed from your library. This cannot be undone.</p>`, 'Delete field', () => mutate({ type: 'deleteField', id }, 'Field deleted'), true);
}
function deleteGroup(id) {
  const g = data.groups.find(g => g.id === id); if (!g) return;
  showDialog('Delete this group?', 'Your fields and saved values will be kept.', `<p class="confirm-copy">Delete “${escape(g.name)}”? Its ${data.fields.filter(f => f.groupId === id).length} fields will move to Ungrouped.</p>`, 'Delete group', () => mutate({ type: 'deleteGroup', id }, 'Group deleted; fields moved to Ungrouped'), true);
}
async function scan() {
  if (busy) return;
  busy = true; tab = 'review'; review = null; result = null; error = ''; render();
  try { review = await send('scan'); }
  catch (e) { error = e.message; }
  finally { busy = false; render(); }
}
async function fill() {
  if (!review || busy) return;
  const items = review.matches.filter(m => m.selected && !m.same).map(m => ({ id: m.id, overwrite: m.existing }));
  if (!items.length) return;
  busy = true; error = ''; render();
  try { result = await send('fill', { token: review.token, items }); review = null; }
  catch (e) { error = e.message; review = null; }
  finally { busy = false; render(); }
}
function exportBackup() {
  const { revision, ...backup } = data;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `ghost-typer-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); toast('Backup exported. It contains readable personal data.');
}
function importBackup() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    try {
      const file = input.files[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) throw new Error('Backup must be smaller than 5 MB.');
      let parsed; try { parsed = JSON.parse(await file.text()); } catch { throw new Error('The file is not valid JSON.'); }
      const imported = validateLibrary(parsed);
      showDialog('Replace your library?', 'Review this backup before importing. Existing fields and groups will be replaced.',
        `<p class="confirm-copy">Import ${imported.fields.length} fields in ${imported.groups.length} groups.<br>Your current ${data.fields.length} fields in ${data.groups.length} groups will be replaced. Export a backup first if you want to keep them.</p>`, 'Replace & import', async () => {
          data = await send('import', { library: imported }); review = null; result = null; group = 'all'; render(); toast('Backup imported');
        });
    } catch (e) { toast(e.message); }
  };
  input.click();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'closeDialog') dialog.close();
    else if (action === 'addField') editField(null, button.dataset.group);
    else if (action === 'editField') editField(button.dataset.id);
    else if (action === 'deleteField') deleteField(button.dataset.id);
    else if (action === 'addGroup') editGroup();
    else if (action === 'editGroup') editGroup(button.dataset.id);
    else if (action === 'deleteGroup') deleteGroup(button.dataset.id);
    else if (action === 'group') { group = button.dataset.id; render(); }
    else if (action === 'tab') { if (!busy) { tab = button.dataset.tab; render(); } }
    else if (action === 'manager') await chrome.runtime.openOptionsPage();
    else if (action === 'scan') await scan();
    else if (action === 'fill') await fill();
    else if (action === 'selectEmpty' && review) { review.matches.forEach(m => { m.selected = !m.existing && !m.same; }); render(); }
    else if (action === 'export') exportBackup();
    else if (action === 'import') importBackup();
  } catch (e) { toast(e.message); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    const position = captureScroll();
    search = event.target.value; $('#sections').innerHTML = sections();
    restoreScroll(position);
  }
});
document.addEventListener('change', event => {
  const id = event.target.dataset.match;
  if (id && review) {
    const match = review.matches.find(m => m.id === id); if (!match) return;
    match.selected = event.target.checked;
    event.target.closest('.review-row').classList.toggle('selected', match.selected);
    $('.popup-footer').innerHTML = footerButton() + '<p class="footnote">Only your selected values will be filled. Nothing is submitted.</p>';
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.library && data) {
    data = validateLibrary(changes.library.newValue); review = null; result = null;
    if (!dialog.open) render();
  }
});
try {
  data = await send('getLibrary');
  if (popup) { review = await send('getReview'); if (review) tab = 'review'; }
  render();
} catch (e) {
  app.innerHTML = `<main style="padding:24px"><h1>Ghost Typer</h1><div class="error-banner">${escape(e.message)}</div></main>`;
}
