export const VERSION = 1;
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
    if (!id || !name || ids.has(id) || names.has(name.toLowerCase())) throw new Error('Groups need unique IDs and names.');
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
  return { version: VERSION, revision: Number.isSafeInteger(input.revision) ? input.revision : 0, groups, fields };
}

export function applyMutation(library, action) {
  const next = structuredClone(library);
  if (action.type === 'saveField') {
    const index = next.fields.findIndex(f => f.id === action.field.id);
    if (index < 0) next.fields.push(action.field); else next.fields[index] = action.field;
  } else if (action.type === 'deleteField') {
    next.fields = next.fields.filter(f => f.id !== action.id);
  } else if (action.type === 'saveGroup') {
    const index = next.groups.findIndex(g => g.id === action.group.id);
    if (index < 0) next.groups.push(action.group); else next.groups[index] = action.group;
  } else if (action.type === 'deleteGroup') {
    next.groups = next.groups.filter(g => g.id !== action.id);
    next.fields = next.fields.map(f => f.groupId === action.id ? { ...f, groupId: '' } : f);
  } else throw new Error('Unknown change.');
  next.revision++;
  return validateLibrary(next);
}
