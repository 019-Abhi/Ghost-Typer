import { initialLibrary, validateLibrary, applyMutation } from './model.js';
import { createReview } from './matcher.js';
import { pageAgent } from './page-agent.js';

let queue = Promise.resolve();
function serial(fn) {
  const job = queue.then(fn, fn);
  queue = job.catch(() => {});
  return job;
}
async function library() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const saved = (await chrome.storage.local.get('library')).library;
  if (saved) return validateLibrary(saved);
  const initial = initialLibrary();
  await chrome.storage.local.set({ library: initial });
  return initial;
}
chrome.runtime.onInstalled.addListener(() => { serial(library).catch(console.error); });

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) {
    throw new Error('Open a regular website, then click the Ghost Typer toolbar icon to scan it. Chrome settings, the Web Store, PDFs, and extension pages cannot be filled.');
  }
  return tab;
}
async function handle(message) {
  if (message.type === 'getLibrary') return library();
  if (message.type === 'mutate') {
    const next = applyMutation(await library(), message.action);
    await chrome.storage.local.set({ library: next });
    await chrome.storage.session.remove('review');
    return next;
  }
  if (message.type === 'import') {
    const next = validateLibrary(message.library);
    next.revision = (await library()).revision + 1;
    await chrome.storage.local.set({ library: next });
    await chrome.storage.session.remove('review');
    return next;
  }
  if (message.type === 'scan') {
    await chrome.storage.session.remove('review');
    const saved = await library();
    if (!saved.fields.some(f => f.value !== '')) throw new Error('Save a value in at least one field before scanning.');
    const tab = await activeTab(), token = crypto.randomUUID();
    let result;
    try {
      [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageAgent, args: ['scan', { token }] });
    } catch { throw new Error('Chrome could not access this page. Click the toolbar icon on a regular website and try again.'); }
    if (!result?.result) throw new Error('The page could not be scanned. Try reloading it.');
    const page = result.result, review = createReview(page.descriptors, saved.fields);
    const session = {
      token, tabId: tab.id, documentId: result.documentId, url: page.url, title: page.title,
      revision: saved.revision, at: Date.now(), ...review,
      skipped: page.skipped, inaccessibleFrames: page.inaccessibleFrames, truncated: page.truncated
    };
    await chrome.storage.session.set({ review: session });
    return session;
  }
  if (message.type === 'getReview') {
    const session = (await chrome.storage.session.get('review')).review;
    if (!session || Date.now() - session.at > 10 * 60 * 1000) return null;
    try {
      const tab = await activeTab();
      return session.tabId === tab.id && session.url === tab.url ? session : null;
    } catch { return null; }
  }
  if (message.type === 'fill') {
    const session = (await chrome.storage.session.get('review')).review;
    if (!session || session.token !== message.token || Date.now() - session.at > 10 * 60 * 1000) throw new Error('Scan this page again to get a fresh review.');
    const tab = await activeTab();
    if (tab.id !== session.tabId || tab.url !== session.url) throw new Error('The active page changed. Scan it again before filling.');
    if ((await library()).revision !== session.revision) throw new Error('Your saved fields changed. Scan again to review the new values.');
    if (!Array.isArray(message.items) || !message.items.length) throw new Error('Choose at least one field to fill.');
    const selected = new Map(message.items.map(item => [item.id, item]));
    const items = session.matches.filter(m => selected.has(m.id) && !m.same).map(m => ({
      id: m.id, value: m.value, overwrite: selected.get(m.id).overwrite === true
    }));
    if (!items.length) throw new Error('No valid fields selected. Scan again.');
    // Consume before filling. Retrying cannot replay an already confirmed operation.
    await chrome.storage.session.remove('review');
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: session.tabId, documentIds: [session.documentId] },
        func: pageAgent, args: ['fill', { token: session.token, items }]
      });
      if (!result?.result) throw new Error('Page changed');
      return { ...result.result, matches: session.matches };
    } catch { throw new Error('The page changed or is no longer accessible. Scan again before filling.'); }
  }
  throw new Error('Unknown request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our popup and manager can request reads or changes, never website scripts.
  const allowed = ['popup.html', 'options.html'].map(path => chrome.runtime.getURL(path));
  if (sender.id !== chrome.runtime.id || !allowed.some(url => sender.url?.split('?')[0] === url)) return false;
  serial(() => handle(message)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message || 'Something went wrong.' }));
  return true;
});
