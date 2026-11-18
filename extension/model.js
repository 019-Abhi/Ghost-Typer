import { sensitiveField } from './safety.js';
export const VERSION = 2;
export const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const byteLength = value => new TextEncoder().encode(value).length;
export const COLORS = ['violet', 'blue', 'rose', 'amber', 'green', 'slate'];
const templates = [
  ['Personal', 'violet', [
    ['Full name', ['name', 'your name', 'applicant name'], 'name'],
    ['First name', ['given name', 'forename'], 'given-name'],
    ['Last name', ['surname', 'family name'], 'family-name']
  ]],
  ['Contact', 'blue', [
    ['Email', ['email address', 'contact email', 'e-mail'], 'email'],
    ['Phone', ['phone number', 'telephone', 'mobile', 'mobile number'], 'tel'],
    ['Website', ['personal website', 'portfolio', 'portfolio url'], 'url']
  ]],
  ['Address', 'rose', [
    ['Street address', ['address', 'address line 1', 'street'], 'address-line1'],
    ['Apartment / suite', ['address line 2', 'apartment', 'suite'], 'address-line2'],
    ['City', ['town', 'city town'], 'address-level2'],
    ['State / province', ['state', 'province', 'region'], 'address-level1'],
    ['Postal code', ['zip', 'zip code', 'postcode', 'pin code', 'pincode'], 'postal-code'],
    ['Country', ['country name'], 'country-name']
  ]],
  ['Education', 'amber', [
    ['University', ['college', 'university name', 'school name', 'institution'], ''],
    ['Degree', ['qualification', 'highest qualification'], ''],
    ['Field of study', ['major', 'specialization'], ''],
    ['Graduation year', ['year of graduation', 'passing year'], '']
  ]],
  ['Employment', 'green', [
    ['Company', ['current company', 'employer', 'organization'], 'organization'],
    ['Job title', ['current job title', 'designation', 'position'], 'organization-title'],
    ['Years of experience', ['total experience', 'work experience'], '']
  ]]
];

export function initialLibrary() {
  const groups = [], fields = [];
  for (const [name, color, items] of templates) {
    const group = { id: crypto.randomUUID(), name, color };
    groups.push(group);
    for (const [label, aliases, autocomplete] of items) {
      fields.push({ id: crypto.randomUUID(), groupId: group.id, label, aliases, autocomplete, value: '', kind: 'text' });
    }
  }
  return { version: VERSION, revision: 0, groups, fields };
}

function string(value, label, max = 300) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}

export function validateLibrary(input) {
  if (!input || input.version !== VERSION || !Array.isArray(input.groups) || !Array.isArray(input.fields)) {
    throw new Error('This is not a supported Ghost Typer backup.');
  }
  if (input.groups.length > 100 || input.fields.length > 1000) throw new Error('Limit: 100 groups and 1,000 fields.');
  const ids = new Set(), names = new Set();
  const groups = input.groups.map(g => {
    const id = string(g.id, 'group ID', 80), name = string(g.name, 'group name', 60).trim();
    if (!id || id === 'all' || !name || ids.has(id) || names.has(name.toLowerCase())) throw new Error('Groups need unique IDs and names.');
    ids.add(id); names.add(name.toLowerCase());
    return { id, name, color: COLORS.includes(g.color) ? g.color : 'violet' };
  });
  const fieldIds = new Set();
  const fields = input.fields.map(f => {
    const id = string(f.id, 'field ID', 80), label = string(f.label, 'field name', 120).trim();
    if (!id || !label || fieldIds.has(id)) throw new Error('Fields need names and unique IDs.');
    fieldIds.add(id);
    if (!Array.isArray(f.aliases) || f.aliases.length > 30) throw new Error('Use at most 30 aliases per field.');
    const groupId = string(f.groupId ?? '', 'group ID', 80);
    if (groupId && !ids.has(groupId)) throw new Error('A field refers to a missing group.');
    return {
      id, label, groupId,
      aliases: [...new Set(f.aliases.map(a => string(a, 'alias', 120).trim()).filter(Boolean))],
      autocomplete: string(f.autocomplete ?? '', 'autocomplete', 50),
      value: string(f.value, 'field value', 10000),
      kind: f.kind === 'boolean' ? 'boolean' : 'text'
    };
  });
  if (fields.some(f => f.kind === 'boolean' && !['', 'true', 'false'].includes(f.value))) {
    throw new Error('Checkbox values must be true or false.');
  }
  const library = { version: VERSION, revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0, groups, fields };
  if (byteLength(JSON.stringify(library)) > MAX_LIBRARY_BYTES || byteLength(JSON.stringify(library, null, 2)) > MAX_BACKUP_BYTES) {
    throw new Error('Your library is too large. Keep saved data below 8 MB; export a backup before removing unused fields.');
  }
  return library;
}

export function migrateLibrary(input) {
  // Version 2 keeps every version 1 field/value; it adds stricter mutation and size rules.
  if (input?.version === 1) return validateLibrary({ ...input, version: VERSION });
  return validateLibrary(input);
}

export function serializeBackup(input) {
  const { revision, ...backup } = migrateLibrary(input);
  return JSON.stringify(backup, null, 2);
}

function checkExpected(current, expected) {
  if (expected === undefined) throw new Error('Reopen the editor before saving this change.');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  if (JSON.stringify(canonical(current ?? null)) !== JSON.stringify(canonical(expected))) {
    throw new Error('This item changed or was deleted in another window. Your draft is kept. Close and reopen the editor to review the latest version.');
  }
}

export function applyMutation(library, action) {
  const next = structuredClone(library);
  if (action.type === 'saveField') {
    const index = next.fields.findIndex(f => f.id === action.field.id);
    checkExpected(next.fields[index], action.expected);
    if (action.field.value && sensitiveField(action.field)) throw new Error('Ghost Typer is for ordinary form details. Passwords, payment details, identity numbers, and consent fields cannot be saved for filling.');
    if (index < 0) next.fields.push(action.field); else next.fields[index] = action.field;
  } else if (action.type === 'deleteField') {
    checkExpected(next.fields.find(f => f.id === action.id), action.expected);
    next.fields = next.fields.filter(f => f.id !== action.id);
  } else if (action.type === 'saveGroup') {
    const index = next.groups.findIndex(g => g.id === action.group.id);
    checkExpected(next.groups[index], action.expected);
    if (index < 0) next.groups.push(action.group); else next.groups[index] = action.group;
  } else if (action.type === 'deleteGroup') {
    checkExpected(next.groups.find(g => g.id === action.id), action.expected);
    next.groups = next.groups.filter(g => g.id !== action.id);
    next.fields = next.fields.map(f => f.groupId === action.id ? { ...f, groupId: '' } : f);
  } else throw new Error('Unknown change.');
  next.revision++;
  return validateLibrary(next);
}
