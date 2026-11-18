import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SAFETY_POLICY } from '../extension/safety.js';
import { pageAgent } from '../extension/page-agent.js';
import { createReview } from '../extension/matcher.js';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, 'test-results'); await mkdir(artifacts, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), 'ghost-typer-test-'));
const addon = path.join(temp, 'extension'); await cp(path.join(root, 'dist/ghost-typer'), addon, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(addon, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting', 'alarms']);
assert.equal(manifest.host_permissions, undefined);
// Headless browsers cannot click Chrome's toolbar to grant activeTab. ONLY this temporary
// test copy gets loopback access; the packaged extension retains activeTab-only permissions.
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(path.join(addon, 'manifest.json'), JSON.stringify(manifest));
const formHTML = await readFile(path.join(root, 'demo/form.html'));
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(formHTML); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
let context;
let assertions = 0;
const pass = message => { assertions++; console.log(`✓ ${message}`); };
try {
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true,
    executablePath: process.env.GHOST_TYPER_CHROMIUM || undefined,
    args: [`--disable-extensions-except=${addon}`, `--load-extension=${addon}`],
    viewport: { width: 1320, height: 980 }
  });
  let worker = context.serviceWorkers()[0]; if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const manager = await context.newPage();
  const errors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  manager.on('pageerror', e => errors.push(e.message));
  await manager.goto(`chrome-extension://${id}/options.html`);
  await manager.getByRole('heading', { name: 'Your details, remembered.' }).waitFor();
  assert.equal(await manager.locator('.field-card').count(), 19);
  pass('Extension loads with five starter groups and 19 empty fields');
  await manager.getByRole('button', { name: 'Create a group', exact: true }).click();
  await manager.getByLabel('Group name').fill('Applications');
  await manager.getByRole('button', { name: 'Create group', exact: true }).last().click();
  await manager.getByRole('button', { name: 'Rename Applications group' }).click();
  await manager.getByLabel('Group name').fill('My applications');
  await manager.getByRole('button', { name: 'Save changes', exact: true }).click();
  await manager.getByRole('button', { name: 'Add field to My applications' }).click();
  await manager.getByLabel('Field name', { exact: true }).fill('About me');
  await manager.getByRole('textbox', { name: 'Value', exact: false }).fill('I build useful things.');
  await manager.getByRole('button', { name: 'Add field', exact: true }).last().click();
  await manager.getByText('I build useful things.', { exact: true }).click();
  await manager.getByRole('textbox', { name: 'Value', exact: false }).fill('I build thoughtful software.');
  await manager.getByRole('button', { name: 'Save changes', exact: true }).click();
  pass('Groups and field values can be created, renamed, and edited through the UI');
  await manager.getByRole('button', { name: 'Delete My applications group', exact: true }).click();
  await manager.getByRole('button', { name: 'Delete group', exact: true }).click();
  const getLibrary = () => manager.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'getLibrary' })).data);
  let library = await getLibrary();
  assert.equal(library.fields.find(f => f.label === 'About me').groupId, '');
  assert.equal(library.fields.find(f => f.label === 'About me').value, 'I build thoughtful software.');
  pass('Deleting a group moves fields and their values to Ungrouped');
  const values = { 'Full name': 'Asha Rao', Email: 'asha@example.com', Phone: '+91 98765 43210', Website: 'https://example.com', 'Street address': '42 Garden Road', City: 'Bengaluru', Country: 'India', 'Postal code': '560001', University: 'Example University', Degree: 'Bachelor of Technology', Company: 'Acme Studio', 'Years of experience': '5', 'Graduation year': '2020' };
  for (const [label, value] of Object.entries(values)) {
    const field = { ...library.fields.find(f => f.label === label), value };
    assert(field.id);
    const response = await manager.evaluate(async field => chrome.runtime.sendMessage({ type: 'mutate', action: { type: 'saveField', field, expected: (await chrome.runtime.sendMessage({type:'getLibrary'})).data.fields.find(f=>f.id===field.id) } }), field);
    assert(response.ok, response.error);
  }
  for (const f of [
    { label: 'Newsletter', value: 'true', kind: 'boolean' },
    { label: 'Work preference', value: 'Remote' },
    { label: 'Password', value: 'DO-NOT-FILL' },
    { label: 'Credit card number', value: 'DO-NOT-FILL' },
    { label: 'One-time code', value: '123456' },
    { label: 'I agree to the terms', value: 'true', kind: 'boolean' }
  ]) {
    const response = await manager.evaluate(async f => chrome.runtime.sendMessage({ type: 'mutate', action: { type: 'saveField', expected: null, field: { id: crypto.randomUUID(), groupId: '', aliases: [], autocomplete: '', kind: 'text', ...f } } }), f);
    assert.equal(response.ok, ['Newsletter', 'Work preference'].includes(f.label), response.error);
  }
  await manager.reload();
  await manager.getByText('asha@example.com', { exact: true }).waitFor();
  pass('Saved values persist when the manager is reopened');
  await manager.screenshot({ path: path.join(artifacts, 'manager.png'), fullPage: true });
  const page = await context.newPage(); await page.goto(address);
  const popup = await context.newPage(); await popup.setViewportSize({ width: 460, height: 590 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole('button', { name: 'Scan this page', exact: true }).waitFor();
  assert.equal(await popup.locator('.tabs button').first().getAttribute('data-tab'), 'review');
  assert.equal(await popup.locator('.tabs .active').getAttribute('data-tab'), 'review');
  await popup.screenshot({ path: path.join(artifacts, 'popup.png') });
  await page.bringToFront();
  await popup.getByRole('button', { name: 'Scan this page', exact: true }).click();
  await popup.getByRole('heading', { name: 'Here’s what we found.' }).waitFor();
  assert.equal(await page.locator('[name=fullName]').first().inputValue(), '');
  assert.equal(await page.locator('[name=email]').first().inputValue(), '');
  const review = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'getReview' })).data);
  assert.equal(review.matches.length, 15, JSON.stringify(review.matches.map(m => ({ label: m.label, saved: m.savedLabel }))));
  assert.equal(review.matches.find(m => m.savedLabel === 'Company').selected, false);
  assert(review.matches.every(m => !['Password', 'Credit card number', 'One-time code', 'I agree to the terms'].includes(m.savedLabel)));
  pass('Scanning never changes inputs; review contains exact proposals and skips protected fields');
  await popup.screenshot({ path: path.join(artifacts, 'review.png') });
  await popup.getByRole('checkbox', { name: 'Fill Email address', exact: true }).uncheck();
  await popup.locator('#allow-http').check();
  await popup.getByRole('button', { name: /Confirm & fill/ }).click();
  await popup.getByRole('heading', { name: /fields filled/ }).waitFor();
  assert.equal(await page.locator('[name=fullName]').first().inputValue(), 'Asha Rao');
  assert.equal(await page.locator('[name=email]').first().inputValue(), '');
  assert.equal(await page.locator('[name=country]').inputValue(), 'IN');
  assert.equal(await page.locator('[name=company]').inputValue(), 'Existing company — preserve me');
  assert.equal(await page.locator('[name=newsletter]').isChecked(), true);
  assert.equal(await page.locator('[name=workPreference][value=remote]').isChecked(), true);
  assert.equal(await page.locator('[name=password]').inputValue(), '');
  assert.equal(await page.locator('[name=cardNumber]').inputValue(), '');
  assert.equal(await page.locator('[name=otp]').inputValue(), '');
  assert.equal(await page.locator('[name=terms]').isChecked(), false);
  assert.equal(await page.locator('#status').textContent(), 'Not submitted.');
  pass('Confirmation fills only selected fields, including dropdowns/radios/checkboxes, without submitting');
  // Deliberately replace the existing company only after selecting its replacement checkbox.
  await popup.getByRole('button', { name: 'Scan again', exact: true }).click();
  await popup.getByRole('checkbox', { name: 'Replace Company', exact: true }).check();
  await popup.locator('#allow-http').check();
  await popup.getByRole('button', { name: /Confirm & fill/ }).click();
  await popup.getByRole('heading', { name: /fields filled/ }).waitFor();
  assert.equal(await page.locator('[name=company]').inputValue(), 'Acme Studio');
  pass('Existing values are replaced only after explicitly selecting them');
  await popup.getByRole('button', { name: 'Scan again', exact: true }).click();
  await popup.getByRole('heading', { name: 'Here’s what we found.' }).waitFor();
  assert.equal(await popup.locator('.review-row input:enabled').count(), 0);
  assert.equal(await popup.getByRole('button', { name: 'Scan again', exact: true }).isEnabled(), true);
  await page.locator('[name=city]').fill('Mysuru');
  await popup.getByRole('button', { name: 'Scan again', exact: true }).click();
  const firstRow = popup.locator('.review-row').first();
  await firstRow.getByRole('checkbox', { name: 'Replace City', exact: true }).waitFor();
  assert.equal(await firstRow.getByRole('checkbox').isEnabled(), true);
  await firstRow.getByRole('checkbox').check();
  await firstRow.getByRole('checkbox').uncheck();
  assert.equal(await popup.getByRole('button', { name: 'Scan again', exact: true }).isEnabled(), true);
  await firstRow.getByRole('checkbox').check();
  await popup.locator('#allow-http').check();
  await popup.getByRole('button', { name: /Confirm & fill/ }).click();
  await popup.getByRole('heading', { name: '1 field filled.' }).waitFor();
  assert.equal(await page.locator('[name=city]').inputValue(), 'Bengaluru');
  pass('Review opens first; completed reviews can rescan and changed fields appear first for replacement');
  // Stale input, navigation, and library revisions must invalidate or skip a review.
  await page.locator('[name=email]').first().fill('');
  await popup.getByRole('button', { name: 'Scan again', exact: true }).click();
  await popup.getByRole('heading', { name: 'Here’s what we found.' }).waitFor();
  await page.locator('[name=email]').first().fill('changed@example.com');
  await popup.locator('#allow-http').check();
  await popup.getByRole('button', { name: /Confirm & fill/ }).click();
  await popup.getByRole('heading', { name: '0 fields filled.' }).waitFor();
  assert.equal(await page.locator('[name=email]').first().inputValue(), 'changed@example.com');
  pass('A website value changed after scanning is preserved');
  await page.getByRole('button', { name: 'Add a dynamic field' }).click();
  await popup.getByRole('button', { name: 'Scan again', exact: true }).click();
  await popup.getByRole('checkbox', { name: 'Fill Graduation year', exact: true }).waitFor();
  const stale = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'getReview' })).data);
  await page.reload();
  const denied = await popup.evaluate(async review => chrome.runtime.sendMessage({ type: 'fill', token: review.token, allowInsecure: true, items: review.matches.filter(m => m.selected).map(m => ({ id: m.id })) }), stale);
  assert.equal(denied.ok, false);
  assert.equal(await page.locator('[name=fullName]').first().inputValue(), '');
  pass('Dynamic fields are found on rescan; navigation invalidates a previous review');
  // Direct DOM fixture exercises traversal and native event behavior independently of messaging.
  const fixture = await context.newPage(); await fixture.goto(address + '/fixture');
  await fixture.setContent(`<label>Full name<input id="name"></label><div id="shadow"></div><iframe id="frame"></iframe><label style="opacity:0">Email<input id="hidden-email"></label><input type="text" name="password" value="secret"><div id="events"></div>`);
  await fixture.evaluate(() => {
    document.querySelector('#shadow').attachShadow({ mode: 'open' }).innerHTML = '<label>Email<input id="email" type="email"></label>';
    document.querySelector('#frame').contentDocument.body.innerHTML = '<label>City<input name="city"></label>';
    document.querySelector('#name').addEventListener('input', () => document.querySelector('#events').textContent += 'input ');
    document.querySelector('#name').addEventListener('change', () => document.querySelector('#events').textContent += 'change');
  });
  // evaluate only accepts one argument, so invoke the serialized self-contained page function.
  const runAgent = (operation, payload) => fixture.evaluate(({ source, operation, payload }) => (0, eval)(`(${source})`)(operation, payload), { source: pageAgent.toString(), operation, payload: { ...payload, policy: SAFETY_POLICY } });
  const snapshot = await runAgent('scan', { token: 'fixture' });
  assert.equal(snapshot.descriptors.length, 3);
  const matches = createReview(snapshot.descriptors, (await getLibrary()).fields).matches;
  const applied = await runAgent('fill', { token: 'fixture', items: matches.map(m => ({ id: m.id, value: m.value, overwrite: false })) });
  assert(applied.results.every(r => r.ok));
  assert.equal(await fixture.locator('#events').textContent(), 'input change');
  assert.equal(await fixture.locator('#shadow input').inputValue(), 'asha@example.com');
  assert.equal(await fixture.frameLocator('#frame').locator('[name=city]').inputValue(), 'Bengaluru');
  pass('Open shadow roots, same-origin frames, hidden exclusions, and native input/change events work');
  await assert.rejects(runAgent('fill', { token: 'fixture', items: [] }), /expired|changed/);
  pass('A completed confirmation cannot be replayed');
  await manager.bringToFront();
  await manager.getByRole('button', { name: 'Delete About me', exact: true }).click();
  await manager.getByRole('button', { name: 'Delete field', exact: true }).click();
  assert(!(await getLibrary()).fields.some(f => f.label === 'About me'));
  pass('Deleting a field removes its saved answer');
  assert.deepEqual(errors, []);
  console.log(`\n${assertions} browser checks passed. Screenshots: test-results/`);
} finally {
  await context?.close(); await new Promise(resolve => server.close(resolve));
}
