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
  const result = applyMutation(original, { type: 'deleteGroup', id, expected: original.groups[0] });
  assert.equal(result.fields.length, original.fields.length);
  assert.equal(result.fields[0].value, 'Asha Rao');
  assert.equal(result.fields[0].groupId, '');
  assert.equal(result.revision, 1);
  assert.equal(original.groups.length, 5);
});
test('fields can move, update, and delete without affecting other records', () => {
  const original = initialLibrary(), field = { ...original.fields[0], value: 'New value', groupId: original.groups[1].id };
  const updated = applyMutation(original, { type: 'saveField', field, expected: original.fields[0] });
  assert.deepEqual(updated.fields[0], field);
  assert.equal(applyMutation(updated, { type: 'deleteField', id: field.id, expected: field }).fields.length, original.fields.length - 1);
});
test('import rejects duplicates, missing groups, oversized values, and unsupported schemas', () => {
  const base = initialLibrary();
  assert.throws(() => validateLibrary({ ...base, version: 9 }), /supported/);
  assert.throws(() => validateLibrary({ ...base, groups: [...base.groups, base.groups[0]] }), /unique/);
  assert.throws(() => validateLibrary({ ...base, fields: [{ ...base.fields[0], groupId: 'missing' }] }), /missing group/);
  assert.throws(() => validateLibrary({ ...base, fields: [{ ...base.fields[0], value: 'a'.repeat(10001) }] }), /value/);
  assert.throws(() => validateLibrary({ ...base, fields: [{ ...base.fields[0], kind: 'boolean', value: 'yes' }] }), /Checkbox/);
});

test('concurrent editors cannot overwrite changes or resurrect a deletion', () => {
  const original = initialLibrary(), old = original.fields[0];
  const first = applyMutation(original, { type: 'saveField', expected: old, field: { ...old, label: 'Legal name' } });
  assert.throws(() => applyMutation(first, { type: 'saveField', expected: old, field: { ...old, value: 'Asha' } }), /another window/);
  const deleted = applyMutation(original, { type: 'deleteField', expected: old, id: old.id });
  assert.throws(() => applyMutation(deleted, { type: 'saveField', expected: old, field: { ...old, value: 'Asha' } }), /another window/);
  assert.throws(() => applyMutation(original, { type: 'saveField', expected: null, field: old }), /another window/);
});
test('recognized sensitive answers cannot be newly saved', () => {
  const library = initialLibrary();
  for (const label of ['cardnumber', 'Password', 'CVV', 'mot de passe', 'पासवर्ड']) {
    assert.throws(() => applyMutation(library, { type: 'saveField', expected: null, field: { id: label, label, value: 'dummy', groupId: '', aliases: [], autocomplete: '', kind: 'text' } }), /ordinary form details/);
  }
});
test('large exported libraries round-trip including Unicode; old schemas migrate without losing values', async () => {
  const { migrateLibrary, serializeBackup, MAX_BACKUP_BYTES, byteLength, VERSION } = await import('../extension/model.js');
  const library = initialLibrary();
  library.fields = Array.from({ length: 600 }, (_, i) => ({ ...library.fields[0], id: `f-${i}`, value: 'a'.repeat(9000) }));
  const backup = serializeBackup(library);
  assert(byteLength(backup) > 5 * 1024 * 1024);
  assert(byteLength(backup) <= MAX_BACKUP_BYTES);
  assert.deepEqual(migrateLibrary(JSON.parse(backup)).fields, library.fields);
  const legacy = initialLibrary(); legacy.version = 1; legacy.fields[0].value = 'अभिजीत 🧑🏽‍💻';
  const upgraded = migrateLibrary(legacy);
  assert.equal(upgraded.version, VERSION); assert.deepEqual(upgraded.fields, legacy.fields);
  library.fields.forEach(f => { f.value = '界'.repeat(9000); });
  assert.throws(() => validateLibrary(library), /too large/);
});
