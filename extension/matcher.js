export function normalize(value = '') {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function isSensitive(descriptor) {
  const text = normalize([descriptor.type, descriptor.autocomplete, ...descriptor.signals].join(' '));
  return /\b(password|passwd|passcode|cvv|cvc|ccv|ssn|social security|otp|one time|verification code|security code|captcha|credit card|debit card|card number|cardholder|card holder|expiry|expiration|iban|bank account|routing number|aadhaar|aadhar|passport|tax id|pan number|pan card)\b/.test(text)
    || /\bcc (number|name|exp|csc|type|given|family|additional)\b/.test(text)
    || /\b(agree|agreement|consent|terms|privacy policy|certify|accept terms)\b/.test(text);
}

export function matchField(descriptor, fields) {
  if (isSensitive(descriptor)) return { status: 'sensitive' };
  const strongSignals = descriptor.signals.map(normalize).filter(Boolean);
  const compact = s => s.replaceAll(' ', '');
  const ranked = fields.filter(f => f.value !== '').map(field => {
    const labels = [field.label, ...field.aliases].map(normalize);
    let score = 0;
    if (field.autocomplete && descriptor.autocomplete === field.autocomplete) score = 110;
    if (field.autocomplete === 'country-name' && descriptor.autocomplete === 'country') score = 105;
    for (const signal of strongSignals) {
      if (labels.includes(signal)) score = Math.max(score, 100);
      else if (labels.some(label => compact(label) === compact(signal))) score = Math.max(score, 90);
    }
    return { field, score };
  }).filter(r => r.score >= 90).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: 'unmatched' };
  if (ranked[1] && ranked[0].score - ranked[1].score < 15) return { status: 'ambiguous' };
  return { status: 'matched', field: ranked[0].field };
}

export function proposedValue(descriptor, field) {
  if (descriptor.type === 'checkbox') {
    if (field.kind !== 'boolean') return null;
    return { value: field.value === 'true', display: field.value === 'true' ? 'Checked' : 'Unchecked' };
  }
  if (descriptor.options) {
    const wanted = normalize(field.value);
    const matches = descriptor.options.filter(o => !o.disabled && (normalize(o.label) === wanted || normalize(o.value) === wanted));
    if (matches.length !== 1) return null;
    return { value: matches[0].value, display: matches[0].label };
  }
  if (field.kind === 'boolean') return null;
  if (descriptor.type === 'number' && !/^-?(?:\d+\.?\d*|\.\d+)$/.test(field.value)) return null;
  if (descriptor.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(field.value)) return null;
  return { value: field.value, display: field.value };
}

export function createReview(descriptors, fields) {
  const matches = [], counts = { unmatched: 0, sensitive: 0, ambiguous: 0, incompatible: 0 };
  for (const descriptor of descriptors) {
    const match = matchField(descriptor, fields);
    if (match.status !== 'matched') { counts[match.status]++; continue; }
    const proposal = proposedValue(descriptor, match.field);
    if (!proposal) { counts.incompatible++; continue; }
    // Native checkboxes have no "empty" state; only an already checked one needs replacement consent.
    const existing = descriptor.type === 'checkbox' ? descriptor.current === true : descriptor.current !== '';
    matches.push({
      id: descriptor.id, fieldId: match.field.id, label: descriptor.label,
      savedLabel: match.field.label, groupId: match.field.groupId,
      value: proposal.value, display: proposal.display,
      current: descriptor.current, currentDisplay: descriptor.currentDisplay,
      existing, same: descriptor.current === proposal.value,
      selected: !existing && descriptor.current !== proposal.value
    });
  }
  return { matches, counts };
}
