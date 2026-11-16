import test from 'node:test';
import assert from 'node:assert/strict';
import { matchField, createReview, isSensitive, proposedValue } from '../extension/matcher.js';

const field = (label, value, aliases = [], rest = {}) => ({ id: label, label, value, aliases, kind: 'text', groupId: '', ...rest });
const descriptor = (signals, rest = {}) => ({ id: 'input1', signals, type: 'text', label: signals[0], autocomplete: '', current: '', currentDisplay: '', ...rest });
test('exact names, aliases, camelCase, and autocomplete identify values', () => {
  const fields = [field('Email', 'a@example.com', ['email address'], { autocomplete: 'email' })];
  assert.equal(matchField(descriptor(['emailAddress']), fields).field.value, 'a@example.com');
  assert.equal(matchField(descriptor(['contact'], { autocomplete: 'email' }), fields).status, 'matched');
});
test('no substring guessing or arbitrary duplicate selection', () => {
  assert.equal(matchField(descriptor(['Previous company']), [field('Company', 'Acme')]).status, 'unmatched');
  assert.equal(matchField(descriptor(['email']), [field('Email', 'one'), field('Work email', 'two', ['email'])]).status, 'ambiguous');
  assert.equal(matchField(descriptor(['email']), [field('Email', '')]).status, 'unmatched');
});
test('sensitive and legal consent fields are excluded', () => {
  for (const name of ['password', 'creditCardNumber', 'cc-number', 'SSN', 'one-time-code', 'CVV', 'Agree to terms', 'Aadhaar', 'passport']) {
    assert.equal(isSensitive(descriptor([name])), true, name);
  }
});
test('existing values are not preselected; checkbox false is a real answer', () => {
  const fields = [field('Email', 'a@example.com')];
  const { matches } = createReview([descriptor(['Email'], { current: 'old@example.com' })], fields);
  assert.equal(matches[0].selected, false);
  assert.equal(matches[0].existing, true);
  assert.deepEqual(proposedValue(descriptor(['Newsletter'], { type: 'checkbox' }), field('Newsletter', 'false', [], { kind: 'boolean' })), { value: false, display: 'Unchecked' });
});
test('select option values and labels must map unambiguously', () => {
  const d = descriptor(['Country'], { options: [{ label: 'India', value: 'IN', disabled: false }] });
  assert.deepEqual(proposedValue(d, field('Country', 'India')), { value: 'IN', display: 'India' });
  assert.equal(proposedValue(d, field('Country', 'France')), null);
  d.options.push({ label: 'India', value: 'other', disabled: false });
  assert.equal(proposedValue(d, field('Country', 'India')), null);
});
