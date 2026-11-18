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

test('repeated names in different sections require individual confirmation', () => {
  const descriptors = [descriptor(['Name'], { id: 'self', context: 'Your details', contextKey: 'one' }), descriptor(['Name'], { id: 'other', context: 'Emergency contact', contextKey: 'two' })];
  const { matches } = createReview(descriptors, [field('Full name', 'Asha', ['Name'])]);
  assert.equal(matches.length, 2); assert(matches.every(m => !m.selected && m.caution));
});
test('explicit contextual aliases beat generic labels and protect alternate addresses', () => {
  const fields = [field('Full name', 'Asha', ['Name']), field('Emergency contact name', 'Raj')];
  const d = descriptor(['Name'], { context: 'Emergency contact', contextSignals: ['Emergency contact Name'], contextKey: 'emergency' });
  assert.equal(matchField(d, fields).field.value, 'Raj');
  assert.equal(createReview([descriptor(['Address'], {context:'shipping'})], [field('Address','42 Road')]).matches[0].selected, false);
});
test('compact sensitive labels and multilingual names are blocked consistently', () => {
  for (const name of ['cardnumber','socialsecuritynumber','creditcard','mot de passe','contraseña','पासवर्ड']) {
    assert.equal(isSensitive(descriptor([name])), true, name);
    assert.equal(createReview([descriptor([name])], [field(name,'dummy')]).matches.length, 0);
  }
});
test('multi-select values map in option order and skipped controls explain ambiguity', () => {
  const d = descriptor(['Skills'], { type:'select-multiple', current:[], options:[{label:'JavaScript',value:'js'},{label:'Python',value:'py'}] });
  assert.deepEqual(proposedValue(d, field('Skills','Python\nJavaScript')), {value:['js','py'],display:'JavaScript\nPython'});
  const review = createReview([descriptor(['Email'])], [field('Email','a'),field('Other email','b',['Email'])]);
  assert.equal(review.skipped[0].canMap,true); assert.match(review.skipped[0].reason,/More than one/);
});
