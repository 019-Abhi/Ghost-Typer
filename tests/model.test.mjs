import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLibrary, applyMutation, validateLibrary } from '../extension/model.js';

test('starter groups contain only empty answers', () => {
  const library = initialLibrary();
  assert.deepEqual(library.groups.map(g => g.name), ['Personal', 'Contact', 'Address', 'Education', 'Employment']);
  assert(library.fields.every(f => f.value === ''));
  assert.deepEqual(validateLibrary(library), library);
});
test('group deletion preserves every field and value', () => {
  const original = initialLibrary(), id = original.groups[0].id;
  original.fields[0].value = 'Asha Rao';
  const result = applyMutation(original, { type: 'deleteGroup', id });
  assert.equal(result.fields.length, original.fields.length);
  assert.equal(result.fields[0].value, 'Asha Rao');
  assert.equal(result.fields[0].groupId, '');
  assert.equal(result.revision, 1);
  assert.equal(original.groups.length, 5);
});
test('fields can move, update, and delete without affecting other records', () => {
  const original = initialLibrary(), field = { ...original.fields[0], value: 'New value', groupId: original.groups[1].id };
  const updated = applyMutation(original, { type: 'saveField', field });
  assert.deepEqual(updated.fields[0], field);
  assert.equal(applyMutation(updated, { type: 'deleteField', id: field.id }).fields.length, original.fields.length - 1);
});
test('import rejects duplicates, missing groups, oversized values, and unsupported schemas', () => {
  const base = initialLibrary();
  assert.throws(() => validateLibrary({ ...base, version: 9 }), /supported/);
  assert.throws(() => validateLibrary({ ...base, groups: [...base.groups, base.groups[0]] }), /unique/);
  assert.throws(() => validateLibrary({ ...base, fields: [{ ...base.fields[0], groupId: 'missing' }] }), /missing group/);
  assert.throws(() => validateLibrary({ ...base, fields: [{ ...base.fields[0], value: 'a'.repeat(10001) }] }), /value/);
  assert.throws(() => validateLibrary({ ...base, fields: [{ ...base.fields[0], kind: 'boolean', value: 'yes' }] }), /Checkbox/);
});
