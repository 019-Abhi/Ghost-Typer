// This self-contained function runs in Chrome's isolated world, never in the page's JS context.
export async function pageAgent(operation, payload) {
  const KEY = '__ghostTyperReviewV1';
  const normalize = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const forbidden = /\b(password|passwd|passcode|cvv|cvc|ccv|ssn|social security|otp|one time|verification code|security code|captcha|credit card|debit card|card number|cardholder|card holder|expiry|expiration|iban|bank account|routing number|aadhaar|aadhar|passport|tax id|pan number|pan card|agree|agreement|consent|terms|privacy policy|certify)\b|\bcc (number|name|exp|csc|type|given|family|additional)\b/;
  const text = node => {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll?.('input,select,textarea,button,script,style').forEach(child => child.remove());
    return (copy.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  };
  const allControls = () => {
    const controls = [], visited = new Set(); let inaccessibleFrames = 0;
    function walk(root) {
      if (!root || visited.has(root)) return;
      visited.add(root);
      for (const element of root.querySelectorAll('*')) {
        if (element.matches('input,textarea,select')) controls.push(element);
        if (element.shadowRoot) walk(element.shadowRoot);
        if (element.tagName === 'IFRAME') {
          try { if (element.contentDocument) walk(element.contentDocument); else inaccessibleFrames++; }
          catch { inaccessibleFrames++; }
        }
      }
    }
    walk(document);
    return { controls, inaccessibleFrames };
  };
  const visible = el => {
    if (!el.isConnected || el.disabled || el.matches(':disabled') || el.readOnly || el.closest('[inert],[aria-hidden="true"]')) return false;
    const win = el.ownerDocument.defaultView;
    if (!win || !el.getClientRects().length) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const style = win.getComputedStyle(el);
    if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const frame = win.frameElement;
    return !frame || visible(frame);
  };
  const accessibleLabel = el => {
    const root = el.getRootNode();
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => text(root.getElementById?.(id))).filter(Boolean).join(' ');
    return labelledBy || el.getAttribute('aria-label') || [...(el.labels || [])].map(text).join(' ');
  };
  const metadata = (el, elements) => {
    const type = el.tagName === 'SELECT' ? (el.multiple ? 'select-multiple' : 'select') : el.tagName === 'TEXTAREA' ? 'textarea' : el.type;
    const legend = text(el.closest('fieldset')?.querySelector('legend'));
    const label = type === 'radio' ? legend || el.getAttribute('aria-label') || el.name : accessibleLabel(el);
    const signals = [label, el.name, el.id, el.getAttribute('placeholder') || ''];
    const autocomplete = (el.autocomplete || '').split(/\s+/).filter(Boolean).at(-1) || '';
    const sensitive = forbidden.test(normalize([type, autocomplete, ...signals, legend].join(' ')));
    let options;
    if (type === 'select') options = [...el.options].map(o => ({ value: o.value, label: o.label, disabled: o.disabled || !!o.closest('optgroup[disabled]') }));
    if (type === 'radio') options = elements.map(r => ({ value: r.value, label: accessibleLabel(r) || r.value, disabled: !visible(r) }));
    return { type, label: label || el.getAttribute('placeholder') || el.name || el.id || 'Unlabeled field', signals, autocomplete, sensitive, options };
  };
  const currentValue = (el, elements) => el.type === 'checkbox' ? el.checked
    : el.type === 'radio' ? (elements.find(r => r.checked)?.value ?? '') : el.value;
  const displayValue = (el, elements) => el.type === 'checkbox' ? (el.checked ? 'Checked' : 'Unchecked')
    : el.type === 'radio' ? (accessibleLabel(elements.find(r => r.checked) || el) || currentValue(el, elements))
    : el.tagName === 'SELECT' ? (el.selectedOptions[0]?.label || el.value) : el.value;
  const eligible = el => visible(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'SELECT' && !el.multiple)
    || (el.tagName === 'INPUT' && ['text', 'email', 'tel', 'url', 'number', 'date', 'checkbox', 'radio'].includes(el.type)))
    && !el.closest('[role="search"]');

  if (operation === 'scan') {
    const { controls, inaccessibleFrames } = allControls();
    const descriptors = [], entries = new Map(), seen = new Set(); let skipped = 0;
    for (const el of controls.slice(0, 2000)) {
      if (seen.has(el)) continue;
      if (!eligible(el)) { skipped++; continue; }
      const elements = el.type === 'radio' && el.name ? controls.filter(r => r.type === 'radio' && r.name === el.name && r.form === el.form && r.getRootNode() === el.getRootNode()) : [el];
      elements.forEach(e => seen.add(e));
      const meta = metadata(el, elements);
      // Never read a sensitive field's current value, even for preview.
      if (meta.sensitive) { skipped++; continue; }
      const id = crypto.randomUUID(), current = currentValue(el, elements);
      entries.set(id, { el, elements, signature: JSON.stringify(meta), current });
      descriptors.push({ ...meta, id, current, currentDisplay: displayValue(el, elements) });
    }
    globalThis[KEY] = { token: payload.token, url: location.href, entries, at: Date.now() };
    return { descriptors, skipped, inaccessibleFrames, truncated: controls.length > 2000, url: location.href, title: document.title };
  }

  if (operation === 'fill') {
    const snapshot = globalThis[KEY];
    delete globalThis[KEY];
    if (!snapshot || snapshot.token !== payload.token || snapshot.url !== location.href || Date.now() - snapshot.at > 10 * 60 * 1000) {
      throw new Error('This review has expired or the page changed. Scan the page again.');
    }
    const liveControls = new Set(allControls().controls), results = [];
    for (const request of payload.items) {
      const saved = snapshot.entries.get(request.id);
      if (!saved) { results.push({ id: request.id, ok: false, reason: 'Field no longer available' }); continue; }
      const { el, elements } = saved;
      if (!elements.every(e => liveControls.has(e)) || !eligible(el) || metadata(el, elements).sensitive
        || JSON.stringify(metadata(el, elements)) !== saved.signature || currentValue(el, elements) !== saved.current) {
        results.push({ id: request.id, ok: false, reason: 'Field changed since scanning; scan again' }); continue;
      }
      const existing = el.type === 'checkbox' ? saved.current === true : saved.current !== '';
      if (existing && !request.overwrite) { results.push({ id: request.id, ok: false, reason: 'Existing value preserved' }); continue; }
      let target = el;
      try {
        const win = el.ownerDocument.defaultView;
        if (el.type === 'radio') {
          target = elements.find(r => r.value === request.value && eligible(r));
          if (!target) throw new Error('Option unavailable');
          Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'checked').set.call(target, true);
        } else if (el.type === 'checkbox') {
          if (typeof request.value !== 'boolean') throw new Error('Invalid checkbox value');
          Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'checked').set.call(el, request.value);
        } else {
          const probe = el.cloneNode(true);
          probe.value = request.value;
          if (probe.value !== request.value || !probe.checkValidity() || (el.maxLength > 0 && request.value.length > el.maxLength)) {
            throw new Error('Value does not meet this field’s format or constraints');
          }
          const proto = el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, request.value);
        }
        target.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
        target.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
        await new Promise(resolve => setTimeout(resolve, 30));
        if (!target.isConnected || currentValue(el, elements) !== request.value) throw new Error('Website did not retain the value');
        results.push({ id: request.id, ok: true });
      } catch (error) { results.push({ id: request.id, ok: false, reason: error.message }); }
    }
    return { results };
  }
  throw new Error('Unknown page operation.');
}
