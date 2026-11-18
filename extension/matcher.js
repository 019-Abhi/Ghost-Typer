import { normalize, isSensitive, sensitiveField } from './safety.js';
export { normalize, isSensitive } from './safety.js';

function prepare(fields) {
  const exact = new Map(), compact = new Map(), autocomplete = new Map();
  const add = (index, key, field) => { if (!index.has(key)) index.set(key, new Set()); index.get(key).add(field); };
  for (const field of fields.filter(f => f.value !== '' && !sensitiveField(f))) {
    for (const label of [field.label, ...field.aliases].map(normalize)) { add(exact, label, field); add(compact, label.replaceAll(' ', ''), field); }
    if (field.autocomplete) add(autocomplete, field.autocomplete, field);
  }
  return { exact, compact, autocomplete };
}
function matchPrepared(descriptor, prepared) {
  if (isSensitive(descriptor)) return { status: 'sensitive' };
  const signals = descriptor.signals.map(normalize).filter(Boolean);
  const scoped = (descriptor.contextSignals || []).map(normalize);
  const candidates = new Map();
  const collect = (index, key, score) => {
    for (const field of index.get(key) || []) {
      if ((candidates.get(field)?.score || 0) < score) candidates.set(field, { field, score, scoped: score === 125 });
    }
  };
  collect(prepared.autocomplete, descriptor.autocomplete, 110);
  if (descriptor.autocomplete === 'country') collect(prepared.autocomplete, 'country-name', 105);
  for (const signal of signals) { collect(prepared.exact, signal, 100); collect(prepared.compact, signal.replaceAll(' ', ''), 90); }
  for (const signal of scoped) collect(prepared.exact, signal, 125);
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: 'unmatched' };
  if (ranked[1] && ranked[0].score - ranked[1].score < 15) return { status: 'ambiguous' };
  return { status: 'matched', ...ranked[0] };
}
export const matchField = (descriptor, fields) => matchPrepared(descriptor, prepare(fields));
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function proposedValue(descriptor, field) {
  if (sensitiveField(field) || isSensitive(descriptor)) return null;
  if (descriptor.type === 'checkbox') {
    if (field.kind !== 'boolean') return null;
    return { value: field.value === 'true', display: field.value === 'true' ? 'Checked' : 'Unchecked' };
  }
  if (descriptor.options) {
    const values = descriptor.type === 'select-multiple' ? field.value.split('\n').map(v => v.trim()).filter(Boolean) : [field.value];
    const options = [];
    for (const value of values) {
      const wanted = normalize(value);
      const matches = descriptor.options.filter(o => !o.disabled && (normalize(o.label) === wanted || normalize(o.value) === wanted));
      if (matches.length !== 1 || options.some(o => o.value === matches[0].value)) return null;
      options.push(matches[0]);
    }
    if (!options.length) return null;
    if (descriptor.type === 'select-multiple') {
      const sorted = descriptor.options.filter(o => options.some(selected => selected.value === o.value));
      return { value: sorted.map(o => o.value), display: sorted.map(o => o.label).join('\n') };
    }
    return { value: options[0].value, display: options[0].label };
  }
  if (field.kind === 'boolean') return null;
  if (descriptor.type === 'number' && !/^-?(?:\d+\.?\d*|\.\d+)$/.test(field.value)) return null;
  if (descriptor.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(field.value)) return null;
  return { value: field.value, display: field.value };
}

export function makeMatch(descriptor, field, manual = false) {
  const proposal = proposedValue(descriptor, field);
  if (!proposal) return null;
  const existing = descriptor.type === 'checkbox' ? descriptor.current === true
    : Array.isArray(descriptor.current) ? descriptor.current.length > 0 : descriptor.current !== '';
  const same = sameValue(descriptor.current, proposal.value);
  return {
    id: descriptor.id, fieldId: field.id, label: descriptor.label, context: descriptor.context || '', contextKey: descriptor.contextKey || '',
    savedLabel: field.label, groupId: field.groupId, value: proposal.value, display: proposal.display,
    current: descriptor.current, currentDisplay: descriptor.currentDisplay, existing, same, manual,
    selected: !manual && !existing && !same, caution: manual ? 'Manually mapped. Select this row to approve it.' : ''
  };
}

export function createReview(descriptors, fields) {
  const matches = [], skipped = [], prepared = prepare(fields);
  const counts = { unmatched: 0, sensitive: 0, ambiguous: 0, incompatible: 0 };
  const reasons = {
    unmatched: 'No saved field with a value matches this label.',
    ambiguous: 'More than one saved field matches. Choose the intended field.',
    incompatible: 'The saved answer does not match this control’s type or available options.',
    sensitive: 'Protected field. Ghost Typer will not fill this control.'
  };
  for (const descriptor of descriptors) {
    const found = matchPrepared(descriptor, prepared);
    const match = found.status === 'matched' ? makeMatch(descriptor, found.field) : null;
    if (!match) {
      const status = found.status === 'matched' ? 'incompatible' : found.status;
      counts[status]++;
      skipped.push({ id: descriptor.id, label: descriptor.label, context: descriptor.context || '', reason: reasons[status], canMap: status !== 'sensitive' });
      continue;
    }
    if (!found.scoped && /\b(emergency|reference|referee|spouse|parent|guardian|beneficiary|previous|former|billing|shipping)\b/.test(normalize(descriptor.context))) {
      match.selected = false;
      match.caution = 'Check this person or address section before selecting.';
    }
    match.scoped = found.scoped;
    matches.push(match);
  }
  const contextsByField = new Map();
  for (const match of matches) {
    const contexts = contextsByField.get(match.fieldId) || new Set();
    contexts.add(match.contextKey || normalize(match.context)); contextsByField.set(match.fieldId, contexts);
  }
  for (const match of matches) {
    if (!match.scoped && contextsByField.get(match.fieldId).size > 1) {
      match.selected = false;
      match.caution = 'This saved answer matches several sections. Select only the intended ones.';
    }
  }
  return { matches, counts, skipped };
}
