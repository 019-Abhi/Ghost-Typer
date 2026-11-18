// Self-contained for Chrome's isolated-world scripting API. Policy is data, never evaluated code.
export async function pageAgent(operation, payload) {
  const KEY = '__ghostTyperReviewV2';
  if (operation === 'clear') {
    if (!payload.token || globalThis[KEY]?.token === payload.token) {
      clearTimeout(globalThis[KEY]?.timer); delete globalThis[KEY];
    }
    return { cleared: true };
  }
  const policy = payload.policy;
  if (!policy?.words || !policy?.compact) throw new Error('Missing safety policy. Reload Ghost Typer.');
  const normalize = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const wordRule = new RegExp(policy.words, 'u'), compactRule = new RegExp(policy.compact, 'u');
  const sensitive = values => values.filter(Boolean).some(value => { const text = normalize(value); return wordRule.test(text) || compactRule.test(text.replaceAll(' ', '')); });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const text = node => {
    if (!node) return '';
    // Walk text nodes instead of cloning whole subtrees and form values.
    const walker = node.ownerDocument.createTreeWalker(node, 4); let result = '', count = 0, child;
    while ((child = walker.nextNode()) && count++ < 200 && result.length < 500) {
      if (!child.parentElement?.closest('input,select,textarea,button,script,style')) result += `${child.textContent} `;
    }
    return result.replace(/\s+/g, ' ').trim().slice(0, 500);
  };
  const collect = () => {
    const controls = [], visited = new Set(); let nodes = 0, inaccessibleFrames = 0, truncated = false;
    const started = performance.now();
    function walk(root) {
      if (!root || visited.has(root)) return;
      visited.add(root);
      const doc = root.nodeType === 9 ? root : root.ownerDocument;
      const walker = doc.createTreeWalker(root, 1); let element;
      while ((element = walker.nextNode())) {
        if (++nodes > policy.maxNodes || controls.length >= policy.maxControls || performance.now() - started > policy.maxScanMs) { truncated = true; return; }
        if (element.matches('input,textarea,select,[role="combobox"],[role="listbox"],[contenteditable="true"],[role="textbox"]')) controls.push(element);
        if (element.shadowRoot) walk(element.shadowRoot);
        if (element.tagName === 'IFRAME') {
          try { if (element.contentDocument) walk(element.contentDocument); else inaccessibleFrames++; }
          catch { inaccessibleFrames++; }
        }
        if (truncated) return;
      }
    }
    walk(document); return { controls, inaccessibleFrames, truncated };
  };
  const visible = el => {
    if (!el?.isConnected || el.closest('[inert],[aria-hidden="true"]')) return false;
    const win = el.ownerDocument.defaultView;
    if (!win || !el.getClientRects().length) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const style = win.getComputedStyle(el);
    if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const frame = win.frameElement; return !frame || visible(frame);
  };
  const labelFor = el => {
    if (!el) return '';
    const root = el.getRootNode();
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(root.getElementById?.(id))).filter(Boolean).join(' ');
    return (labelledBy || el.getAttribute('aria-label') || [...(el.labels || [])].map(text).join(' ')).slice(0, 500);
  };
  const sectionFor = el => el.closest('fieldset,[role="group"],[role="radiogroup"]');
  const headingFor = el => {
    let parent = el.parentElement;
    for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
      let sibling = parent.previousElementSibling, hops = 0;
      while (sibling && hops++ < 6) { if (sibling.matches('h1,h2,h3,h4,h5,h6')) return text(sibling); sibling = sibling.previousElementSibling; }
      if (parent === el.form) break;
    }
    return '';
  };
  const metadata = (el, elements) => {
    const native = el.matches('input,textarea,select');
    const type = el.tagName === 'SELECT' ? (el.multiple ? 'select-multiple' : 'select') : el.tagName === 'TEXTAREA' ? 'textarea' : native ? el.type : 'custom';
    const section = sectionFor(el);
    const sectionName = text(section?.querySelector(':scope > legend')) || labelFor(section) || headingFor(el);
    const autocompleteTokens = (el.autocomplete || '').split(/\s+/).filter(Boolean);
    const autocomplete = autocompleteTokens.at(-1) || '';
    const scope = autocompleteTokens.slice(0, -1).filter(token => token !== 'on' && token !== 'off').join(' ');
    const formName = labelFor(el.form) || el.form?.getAttribute('name') || (el.form ? `Form ${[...el.ownerDocument.forms].indexOf(el.form) + 1}` : 'Page');
    const frameName = el.ownerDocument.defaultView.frameElement?.getAttribute('title') || '';
    const context = [...new Set([frameName, formName, sectionName, scope].filter(Boolean))].join(' › ');
    const label = (type === 'radio' ? sectionName || labelFor(el) || el.name : labelFor(el)) || el.getAttribute('placeholder') || el.name || el.id || 'Unlabeled field';
    const signals = [label, el.name || '', el.id, el.getAttribute('placeholder') || ''];
    const contextSignals = [sectionName, scope].filter(Boolean).map(part => `${part} ${label}`);
    let options;
    if (type.startsWith('select')) options = [...el.options].slice(0, 2000).map(o => ({ value: o.value, label: o.label, disabled: o.disabled || !!o.closest('optgroup[disabled]') }));
    if (type === 'radio') options = elements.map(r => ({ value: r.value, label: labelFor(r) || r.value, disabled: !eligible(r) }));
    return { type, label, signals, context, contextSignals, autocomplete, autocompleteTokens, sensitive: sensitive([type, context, autocomplete, ...signals]), options };
  };
  const currentValue = (el, elements) => el.type === 'checkbox' ? el.checked : el.type === 'radio' ? (elements.find(r => r.checked)?.value ?? '')
    : el.tagName === 'SELECT' && el.multiple ? [...el.selectedOptions].map(o => o.value) : el.value;
  const displayValue = (el, elements) => el.type === 'checkbox' ? (el.checked ? 'Checked' : 'Unchecked')
    : el.type === 'radio' ? (labelFor(elements.find(r => r.checked)) || currentValue(el, elements))
    : el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.label).join(', ') : el.value;
  const eligible = el => visible(el) && !el.disabled && !el.matches(':disabled') && !el.readOnly
    && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && ['text', 'email', 'tel', 'url', 'number', 'date', 'checkbox', 'radio'].includes(el.type)))
    && !el.closest('[role="search"]');
  const radioIndex = controls => {
    const roots = new Map();
    for (const el of controls) if (el.type === 'radio' && el.name) {
      const root = el.getRootNode(); if (!roots.has(root)) roots.set(root, new Map());
      const forms = roots.get(root); if (!forms.has(el.form)) forms.set(el.form, new Map());
      const names = forms.get(el.form); if (!names.has(el.name)) names.set(el.name, []); names.get(el.name).push(el);
    }
    return el => el.type === 'radio' && el.name ? roots.get(el.getRootNode())?.get(el.form)?.get(el.name) || [] : [el];
  };
  if (operation === 'scan') {
    const { controls, inaccessibleFrames, truncated: traversalTruncated } = collect();
    const descriptors = [], diagnostics = [], entries = new Map(), seen = new Set(), groupFor = radioIndex(controls);
    const identities = new Map(); const identity = ref => { if (!identities.has(ref)) identities.set(ref, identities.size + 1); return identities.get(ref); };
    let truncated = traversalTruncated; const started = performance.now();
    for (const el of controls) {
      if (performance.now() - started > policy.maxScanMs) { truncated = true; break; }
      if (seen.has(el)) continue;
      const elements = groupFor(el); elements.forEach(e => seen.add(e));
      const meta = metadata(el, elements), id = crypto.randomUUID();
      if (meta.sensitive) { diagnostics.push({ id, label: 'Protected field', context: '', reason: 'Sensitive or consent control; never read or filled.', canMap: false }); continue; }
      if (!eligible(el)) {
        const reason = !visible(el) ? 'Hidden control; left untouched.' : el.disabled || el.matches(':disabled') || el.readOnly ? 'Disabled or read-only control.'
          : 'This custom control or input type needs manual entry.';
        diagnostics.push({ id, label: meta.label, context: meta.context, reason, canMap: false }); continue;
      }
      const current = currentValue(el, elements);
      if (JSON.stringify(current).length > 20000 || (meta.options || []).reduce((size, option) => size + option.value.length + option.label.length, 0) > 200000) {
        diagnostics.push({ id, label: meta.label, context: meta.context, reason: 'The current answer or option list is too large to review safely. Use manual entry.', canMap: false }); continue;
      }
      entries.set(id, { el, elements, signature: JSON.stringify(meta), current, form: el.form, root: el.getRootNode(), section: sectionFor(el), documentUrl: el.ownerDocument.URL });
      descriptors.push({ ...meta, id, current, currentDisplay: displayValue(el, elements), contextKey: `${identity(el.getRootNode())}:${identity(el.form)}:${identity(sectionFor(el))}:${normalize(meta.context)}` });
    }
    clearTimeout(globalThis[KEY]?.timer);
    const snapshot = { token: payload.token, url: location.href, entries, at: Date.now() };
    snapshot.timer = setTimeout(() => { if (globalThis[KEY] === snapshot) delete globalThis[KEY]; }, policy.reviewLifetimeMs);
    globalThis[KEY] = snapshot;
    return { descriptors, diagnostics, skipped: diagnostics.length, inaccessibleFrames, truncated, url: location.href, title: document.title };
  }
  if (operation === 'fill') {
    const snapshot = globalThis[KEY]; clearTimeout(snapshot?.timer); delete globalThis[KEY];
    if (!snapshot || snapshot.token !== payload.token || snapshot.url !== location.href || Date.now() - snapshot.at > policy.reviewLifetimeMs) throw new Error('The review expired or the page changed. Scan again.');
    const results = [], applied = [], started = performance.now();
    const stateUnchanged = saved => saved.el.isConnected && saved.el.form === saved.form && saved.el.getRootNode() === saved.root
      && sectionFor(saved.el) === saved.section && saved.el.ownerDocument.URL === saved.documentUrl;
    for (const request of payload.items) {
      const saved = snapshot.entries.get(request.id);
      if (location.href !== snapshot.url || performance.now() - started > policy.maxFillMs) { results.push({ id: request.id, ok: false, reason: 'Page changed or fill time limit reached. Scan again.' }); continue; }
      if (!saved) { results.push({ id: request.id, ok: false, reason: 'Field no longer available.' }); continue; }
      const { el, elements } = saved;
      const currentGroup = el.type === 'radio' && el.name ? [...el.getRootNode().querySelectorAll('input')].filter(r => r.type === 'radio' && r.name === el.name && r.form === el.form) : [el];
      const membershipSame = currentGroup.length === elements.length && currentGroup.every((e, i) => e === elements[i]);
      if (!stateUnchanged(saved) || !membershipSame || !eligible(el) || JSON.stringify(metadata(el, currentGroup)) !== saved.signature || !same(currentValue(el, currentGroup), saved.current)) {
        results.push({ id: request.id, ok: false, reason: 'Field, section, or options changed since scanning. Scan again.' }); continue;
      }
      const existing = el.type === 'checkbox' ? saved.current === true : Array.isArray(saved.current) ? saved.current.length > 0 : saved.current !== '';
      if (existing && !request.overwrite) { results.push({ id: request.id, ok: false, reason: 'Existing value preserved.' }); continue; }
      let target = el;
      try {
        const win = el.ownerDocument.defaultView;
        if (el.type === 'radio' || el.type === 'checkbox') {
          if (el.type === 'checkbox' && typeof request.value !== 'boolean') throw new Error('Invalid checkbox value.');
          target = el.type === 'radio' ? elements.find(r => r.value === request.value && eligible(r)) : el;
          if (!target) throw new Error('Option unavailable.');
          if (el.type === 'radio' ? !target.checked : target.checked !== request.value) win.HTMLElement.prototype.click.call(target);
        } else if (el.tagName === 'SELECT' && el.multiple) {
          if (!Array.isArray(request.value)) throw new Error('Invalid multiple-selection value.');
          const options = [...el.options];
          if (request.value.some(value => !options.some(o => o.value === value && !o.disabled && !o.closest('optgroup[disabled]')))) throw new Error('An option is unavailable.');
          for (const option of options) Object.getOwnPropertyDescriptor(win.HTMLOptionElement.prototype, 'selected').set.call(option, request.value.includes(option.value));
          el.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
        } else {
          const probe = el.cloneNode(true); probe.value = request.value;
          if (probe.value !== request.value || !probe.checkValidity() || (el.maxLength > 0 && request.value.length > el.maxLength)) throw new Error('Value does not meet this field’s format or constraints.');
          const proto = el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, request.value);
          el.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
          el.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        applied.push({ request, saved, target });
      } catch (error) { results.push({ id: request.id, ok: false, reason: error.message }); }
    }
    // Check the batch after framework handlers and deferred validation have run.
    if (applied.length) await new Promise(resolve => setTimeout(resolve, policy.settleMs));
    for (const { request, saved, target } of applied) {
      const ok = location.href === snapshot.url && stateUnchanged(saved) && target.isConnected && same(currentValue(saved.el, saved.elements), request.value);
      results.push({ id: request.id, ok, ...(ok ? {} : { reason: 'Website changed or did not retain the value. Check the form and scan again.' }) });
    }
    return { results, verification: 'Values were checked after page updates. The website may still validate or change them later.' };
  }
  throw new Error('Unknown page operation.');
}
