import { initialLibrary, migrateLibrary, applyMutation } from './model.js';
import { createReview, makeMatch } from './matcher.js';
import { SAFETY_POLICY } from './safety.js';
import { pageAgent } from './page-agent.js';

let queue = Promise.resolve();
const serial = fn => { const job = queue.then(fn, fn); queue = job.catch(() => {}); return job; };
const reviewKey = tabId => `review:${tabId}`;
const alarmName = tabId => `expire-review:${tabId}`;
const publicReview = ({ descriptors, ...review }) => review;
async function ready() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
async function library() {
  const raw = (await chrome.storage.local.get('library')).library;
  if (raw === undefined) {
    const initial = initialLibrary(); await chrome.storage.local.set({ library: initial }); return initial;
  }
  try {
    const saved = migrateLibrary(raw);
    if (raw.version !== saved.version) await chrome.storage.local.set({ library: saved });
    return saved;
  } catch (cause) {
    const error = new Error(`Your saved library needs attention: ${cause.message} Export it before resetting or restoring a backup.`);
    error.code = 'RECOVERY_REQUIRED'; throw error;
  }
}
async function discardReview(review) {
  if (!review) return;
  await chrome.storage.session.remove(reviewKey(review.tabId));
  await chrome.alarms.clear(alarmName(review.tabId));
  try {
    await chrome.scripting.executeScript({ target: { tabId: review.tabId, documentIds: [review.documentId] }, func: pageAgent, args: ['clear', { token: review.token }] });
  } catch { /* The document or temporary site permission may already be gone. */ }
}
async function clearReviews() {
  const session = await chrome.storage.session.get(null);
  for (const [key, review] of Object.entries(session)) if (key.startsWith('review:')) await discardReview(review);
  await chrome.storage.session.remove(Object.keys(session).filter(key => key.startsWith('receipt:')));
  await chrome.storage.session.remove('review'); // Legacy single-review key.
}
async function cleanupExpired() {
  const session = await chrome.storage.session.get(null);
  for (const [key, review] of Object.entries(session)) if (key.startsWith('review:') && Date.now() - review.at >= SAFETY_POLICY.reviewLifetimeMs) await discardReview(review);
  await chrome.storage.session.remove(Object.entries(session).filter(([key, receipt]) => key.startsWith('receipt:') && Date.now() - receipt.at >= SAFETY_POLICY.reviewLifetimeMs).map(([key]) => key));
}
chrome.runtime.onInstalled.addListener(() => { serial(async () => { await ready(); await clearReviews(); await library(); }).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { serial(async () => { await ready(); await cleanupExpired(); }).catch(() => {}); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith('expire-review:')) serial(async () => {
    const key = reviewKey(Number(alarm.name.split(':')[1]));
    const review = (await chrome.storage.session.get(key))[key];
    if (review && Date.now() - review.at >= SAFETY_POLICY.reviewLifetimeMs) await discardReview(review);
    await cleanupExpired();
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  serial(async () => { await chrome.storage.session.remove([reviewKey(tabId), `receipt:${tabId}`]); await chrome.alarms.clear(alarmName(tabId)); }).catch(() => {});
});
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('Open a regular website, then click the Ghost Typer toolbar icon to scan it. Browser settings, the Web Store, PDFs, and extension pages cannot be filled.');
  return tab;
}
async function currentReview(token) {
  const tab = await activeTab();
  const session = (await chrome.storage.session.get(reviewKey(tab.id)))[reviewKey(tab.id)];
  if (!session || (token && session.token !== token) || Date.now() - session.at >= SAFETY_POLICY.reviewLifetimeMs) throw new Error('Scan this page again to get a fresh review.');
  if (tab.url !== session.url) throw new Error('The page changed. Scan again.');
  if ((await library()).revision !== session.revision) throw new Error('Saved fields changed. Scan again to review the new values.');
  return session;
}
async function storeLibrary(saved) {
  try { await chrome.storage.local.set({ library: saved }); }
  catch { throw new Error('Chrome could not save your library. Export a backup and free some space; your previous saved data has not been replaced.'); }
  await clearReviews(); return saved;
}
async function handle(message) {
  await ready(); await cleanupExpired();
  if (message.type === 'getLibrary') return library();
  if (message.type === 'getRecovery') return (await chrome.storage.local.get('library')).library ?? null;
  if (message.type === 'resetLibrary') return storeLibrary(initialLibrary());
  if (message.type === 'mutate') return storeLibrary(applyMutation(await library(), message.action));
  if (message.type === 'import') {
    const next = migrateLibrary(message.library), raw = (await chrome.storage.local.get('library')).library;
    if (message.expectedRevision !== undefined && message.expectedRevision !== raw?.revision) throw new Error('Your library changed while this backup preview was open. Preview the import again.');
    next.revision = (Number.isSafeInteger(raw?.revision) ? raw.revision : 0) + 1;
    return storeLibrary(next);
  }
  if (message.type === 'scan') {
    const saved = await library(), tab = await activeTab();
    if (!saved.fields.some(f => f.value !== '')) throw new Error('Save a value in My fields before scanning.');
    await discardReview((await chrome.storage.session.get(reviewKey(tab.id)))[reviewKey(tab.id)]);
    await chrome.storage.session.remove(`receipt:${tab.id}`);
    const token = crypto.randomUUID(); let result;
    try { [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageAgent, args: ['scan', { token, policy: SAFETY_POLICY }] }); }
    catch { throw new Error('Chrome could not access this page. Click the toolbar icon on a regular website and try again.'); }
    if (!result?.result) throw new Error('The page could not be scanned. Try reloading it.');
    const page = result.result, review = createReview(page.descriptors, saved.fields);
    const session = {
      token, tabId: tab.id, documentId: result.documentId, url: page.url, title: page.title,
      revision: saved.revision, at: Date.now(), ...review, descriptors: page.descriptors,
      skipped: [...review.skipped, ...page.diagnostics], inaccessibleFrames: page.inaccessibleFrames, truncated: page.truncated
    };
    try { await chrome.storage.session.set({ [reviewKey(tab.id)]: session }); }
    catch { throw new Error('This review is too large to keep. Use a smaller form or shorter saved values and scan again.'); }
    await chrome.alarms.create(alarmName(tab.id), { when: session.at + SAFETY_POLICY.reviewLifetimeMs });
    return publicReview(session);
  }
  if (message.type === 'getReview') {
    try { return publicReview(await currentReview()); } catch { return null; }
  }
  if (message.type === 'selectReview') {
    const session = await currentReview(message.token);
    const selected = new Set(message.ids || []);
    session.matches.forEach(m => { m.selected = !m.same && selected.has(m.id); });
    await chrome.storage.session.set({ [reviewKey(session.tabId)]: session }); return true;
  }
  if (message.type === 'mapField') {
    const session = await currentReview(message.token);
    const descriptor = session.descriptors.find(d => d.id === message.id);
    const field = (await library()).fields.find(f => f.id === message.fieldId && f.value !== '');
    const match = descriptor && field && makeMatch(descriptor, field, true);
    if (!match) throw new Error('This saved value cannot fill that control. Check the answer type and available options.');
    session.matches = [...session.matches.filter(m => m.id !== message.id), match];
    session.skipped = session.skipped.filter(s => s.id !== message.id);
    await chrome.storage.session.set({ [reviewKey(session.tabId)]: session }); return publicReview(session);
  }
  if (message.type === 'fill') {
    const session = await currentReview(message.token);
    if (new URL(session.url).protocol === 'http:' && message.allowInsecure !== true) throw new Error('Review the HTTP warning before filling this unencrypted page.');
    if (!Array.isArray(message.items) || !message.items.length) throw new Error('Choose at least one field to fill.');
    const selected = new Map(message.items.map(item => [item.id, item]));
    const items = session.matches.filter(m => selected.has(m.id) && !m.same).map(m => ({ id: m.id, value: m.value, overwrite: selected.get(m.id).overwrite === true }));
    if (!items.length) throw new Error('No valid fields selected. Scan again.');
    await chrome.storage.session.remove(reviewKey(session.tabId)); await chrome.alarms.clear(alarmName(session.tabId));
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: session.tabId, documentIds: [session.documentId] }, func: pageAgent, args: ['fill', { token: session.token, items, policy: SAFETY_POLICY }] });
      if (!result?.result) throw new Error('Page changed');
      // Keep a receipt so closing the popup during filling does not lose the outcome.
      const receipt = { ...result.result, matches: session.matches, url: session.url, tabId: session.tabId, at: Date.now() };
      await chrome.storage.session.set({ [`receipt:${session.tabId}`]: receipt });
      await chrome.alarms.create(alarmName(session.tabId), { when: receipt.at + SAFETY_POLICY.reviewLifetimeMs });
      return receipt;
    } catch { throw new Error('The page changed or is no longer accessible. Check any inserted values and scan again.'); }
  }
  if (message.type === 'getReceipt') {
    try {
      const tab = await activeTab(), receipt = (await chrome.storage.session.get(`receipt:${tab.id}`))[`receipt:${tab.id}`];
      return receipt && receipt.url === tab.url && Date.now() - receipt.at < SAFETY_POLICY.reviewLifetimeMs ? receipt : null;
    } catch { return null; }
  }
  throw new Error('Unknown request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const allowed = ['popup.html', 'options.html'].map(path => chrome.runtime.getURL(path));
  if (sender.id !== chrome.runtime.id || !allowed.some(url => sender.url?.split('?')[0] === url)) return false;
  serial(() => handle(message)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message || 'Something went wrong.', code: error.code }));
  return true;
});
