// AlyBrowser Extension — Content Script
// Runs in isolated world, invisible to page JavaScript

let refMap = new Map();
let refCounter = 0;

// Signal readiness to background
chrome.runtime.sendMessage({ type: 'contentReady' });

// Command handler
chrome.runtime.onMessage.addListener((cmd, sender, sendResponse) => {
  (async () => {
    try {
      const result = await handleCommand(cmd);
      sendResponse({ result });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep channel open for async
});

async function handleCommand(cmd) {
  switch (cmd.action) {
    case 'snapshot': return buildSnapshot();
    case 'click': return handleClick(cmd.params.ref);
    case 'type': return handleType(cmd.params);
    case 'select': return handleSelect(cmd.params);
    case 'hover': return handleHover(cmd.params.ref);
    case 'scrollBy': return handleScroll(cmd.params);
    case 'waitForSelector': return handleWaitForSelector(cmd.params);
    case 'waitForStable': return handleWaitForStable(cmd.params);
    case 'upload': return handleUpload(cmd.params);
    case 'getHTML': return document.documentElement?.outerHTML || '';
    default: throw new Error(`Unknown content action: ${cmd.action}`);
  }
}

// ── Snapshot (Accessibility-like tree) ───────────────────────

let snapshotInProgress = false;

function buildSnapshot() {
  // Guard against concurrent snapshot requests overwriting refMap mid-walk
  if (snapshotInProgress) {
    throw new Error('Snapshot already in progress');
  }
  snapshotInProgress = true;
  try {
    refMap = new Map();
    refCounter = 0;

    const title = document.title;
    const lines = [`[RootWebArea] "${title}"`];
    walkDOM(document.body, 1, lines);
    return lines.join('\n');
  } finally {
    snapshotInProgress = false;
  }
}

function walkDOM(node, depth, lines) {
  if (!node?.children) return;

  for (const el of node.children) {
    if (!el.tagName) continue;

    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta', 'template', 'svg', 'path', 'br', 'hr'].includes(tag)) continue;
    if (!isVisible(el)) continue;

    const role = getRole(el);
    const interactive = isInteractive(el);
    const indent = '  '.repeat(depth);

    if (interactive) {
      const ref = assignRef(el);
      const label = getLabel(el);
      const labelStr = label ? ` "${label}"` : '';
      lines.push(`${indent}[${role || tag}] ${ref}${labelStr}`);
      walkDOM(el, depth + 1, lines);
    } else if (role) {
      const label = getLabel(el);
      const show = ['heading', 'img', 'region', 'navigation', 'banner', 'contentinfo', 'main', 'complementary'].includes(role);
      const labelStr = show && label ? ` "${label}"` : '';
      lines.push(`${indent}[${role}]${labelStr}`);
      walkDOM(el, depth + 1, lines);
    } else {
      const text = getDirectText(el);
      if (text && el.children.length === 0) {
        lines.push(`${indent}[StaticText] "${text}"`);
      } else {
        walkDOM(el, depth, lines);
      }
    }

    // Traverse into open Shadow DOM (closed shadow roots return null)
    if (el.shadowRoot) {
      walkDOM(el.shadowRoot, depth + 1, lines);
    }
  }
}

function assignRef(el) {
  const ref = `@e${refCounter++}`;
  refMap.set(ref, el);
  return ref;
}

function isInteractive(el) {
  const tag = el.tagName?.toLowerCase();
  if (['a', 'button', 'input', 'textarea', 'select', 'summary'].includes(tag)) return true;
  const role = el.getAttribute('role');
  if (role && ['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio',
    'switch', 'slider', 'textbox', 'combobox', 'option', 'treeitem',
    'menuitemcheckbox', 'menuitemradio', 'searchbox',
    'spinbutton', 'scrollbar'].includes(role)) return true;
  if (el.onclick || el.getAttribute('onclick')) return true;
  const ti = el.getAttribute('tabindex');
  if (ti !== null && ti !== '-1') return true;
  if (el.getAttribute('contenteditable') === 'true') return true;
  return false;
}

function getRole(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  const tag = el.tagName?.toLowerCase();
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['submit', 'button', 'reset'].includes(type)) return 'button';
    if (type === 'search') return 'searchbox';
    return 'textbox';
  }

  const map = {
    a: 'link', button: 'button', select: 'combobox',
    textarea: 'textbox', img: 'img', video: 'video', audio: 'audio',
    h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading',
    nav: 'navigation', main: 'main', form: 'form',
    table: 'table', ul: 'list', ol: 'list', li: 'listitem',
    section: 'region', article: 'article', aside: 'complementary',
    footer: 'contentinfo', header: 'banner', dialog: 'dialog',
    details: 'group', summary: 'button', label: 'label',
    fieldset: 'group', legend: 'legend', figure: 'figure',
    figcaption: 'caption', p: 'paragraph',
  };
  return map[tag] || null;
}

const MAX_VALUE_LENGTH = 100;
const MAX_LABEL_LENGTH = 120;

function getLabel(el) {
  const tag = el.tagName?.toLowerCase();
  const parts = [];

  // Value display for form elements
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      parts.push(el.checked ? 'checked' : 'unchecked');
    } else if (type === 'password') {
      // Never expose password values in snapshots
      parts.push(el.value ? '••••••••' : '');
    } else if (el.value) {
      parts.push(el.value.substring(0, MAX_VALUE_LENGTH));
    }
  } else if (tag === 'textarea' && el.value) {
    parts.push(el.value.substring(0, MAX_VALUE_LENGTH));
  } else if (tag === 'select') {
    const selected = el.options?.[el.selectedIndex];
    if (selected) parts.push(selected.text?.substring(0, MAX_VALUE_LENGTH) || el.value);
  }

  // State indicators
  const states = [];
  if (el.disabled) states.push('disabled');
  if (el.readOnly) states.push('readonly');
  if (el.required || el.getAttribute('aria-required') === 'true') states.push('required');
  if (el.getAttribute('aria-invalid') === 'true') states.push('invalid');
  if (states.length) parts.push(`[${states.join(',')}]`);

  // If we have parts, return them
  if (parts.length) return parts.join(' ');

  // Fallback to text labels
  return (
    el.getAttribute('aria-label')?.substring(0, MAX_LABEL_LENGTH) ||
    el.getAttribute('alt')?.substring(0, MAX_LABEL_LENGTH) ||
    el.getAttribute('title')?.substring(0, MAX_LABEL_LENGTH) ||
    el.getAttribute('placeholder')?.substring(0, MAX_LABEL_LENGTH) ||
    el.textContent?.trim().substring(0, MAX_LABEL_LENGTH) ||
    ''
  );
}

function getDirectText(el) {
  let t = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) t += n.textContent;
  }
  return t.trim().substring(0, 200) || null;
}

function isVisible(el) {
  try {
    if (el.hidden) return false;
    // checkVisibility() is a native C++ call — replaces getComputedStyle for
    // display:none, visibility:hidden, and opacity:0 in a single fast check.
    // Available in Chrome 105+ (AlyBrowser always uses modern Chrome).
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    // Zero-size check: skip elements with no layout dimensions unless positioned
    // (fixed/absolute/sticky can be interactive at 0×0).
    // Only calls getComputedStyle in the rare zero-size case.
    if (!el.offsetWidth && !el.offsetHeight) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'absolute' && pos !== 'sticky') return false;
    }
    return true;
  } catch { return true; }
}

// ── Interaction Handlers ─────────────────────────────────────

function handleClick(ref) {
  const el = refMap.get(ref);
  if (!el) throw new Error(`Element ${ref} not found — page may have changed. Call browser_snapshot to get fresh ref IDs.`);

  el.scrollIntoView({ block: 'center', behavior: 'instant' });

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  // composed: true allows events to cross Shadow DOM boundaries
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };

  el.dispatchEvent(new PointerEvent('pointerover', opts));
  el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
  el.focus?.();
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));

  return { ok: true };
}

function handleType(params) {
  let el = refMap.get(params.ref);
  if (!el) throw new Error(`Element ${params.ref} not found — page may have changed. Call browser_snapshot to get fresh ref IDs.`);

  // ── Special key sequences: {Enter}, {Tab}, {Escape}, {Backspace} ──
  const keyMatch = params.text.match(/^\{(\w+)\}$/);
  if (keyMatch) {
    const key = keyMatch[1];
    const keyMap = { Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Space: ' ', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp' };
    const keyValue = keyMap[key] || key;
    const opts = { key: keyValue, code: key, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    return { ok: true };
  }

  // If ref points to a wrapper, find the actual input/textarea inside
  const tag = el.tagName?.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') {
    const child = el.querySelector('input, textarea, [contenteditable="true"]');
    if (child) el = child;
  }

  // ── ContentEditable path (div[contenteditable], etc.) ──
  if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus();

    if (params.clear) {
      // Clear with Selection API (select() doesn't exist on divs)
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      sel.deleteFromDocument();
    } else {
      // Move cursor to end for appending
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }

    // Insert text via execCommand — triggers framework's input listeners
    document.execCommand('insertText', false, params.text);

    // Ensure framework detects the change
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: params.text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.textContent };
  }

  // ── Regular input/textarea path ──

  // Reject if element is not a text input
  if (!('value' in el) && !el.isContentEditable) {
    throw new Error(`Element ${params.ref} is not a text input. Call browser_snapshot to get fresh ref IDs and target the correct input element.`);
  }

  // Focus the element with full event sequence
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  // Clear existing content
  if (params.clear) {
    el.select?.();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  }

  // Use execCommand('insertText') — closest to real user typing
  const ok = document.execCommand('insertText', false, params.text);

  // If execCommand fails, fall back to native setter
  if (!ok) {
    const newValue = params.clear ? params.text : (el.value || '') + params.text;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, newValue);
    } else {
      el.value = newValue;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: params.text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return { ok: true, value: el.value };
}

function handleSelect(params) {
  const el = refMap.get(params.ref);
  if (!el) throw new Error(`Element ${params.ref} not found — page may have changed. Call browser_snapshot to get fresh ref IDs.`);

  el.value = params.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const selected = el.options?.[el.selectedIndex];
  return { ok: true, value: el.value, text: selected?.text };
}

function handleHover(ref) {
  const el = refMap.get(ref);
  if (!el) throw new Error(`Element ${ref} not found.`);

  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };

  el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mousemove', opts));

  return { ok: true };
}

function handleScroll(params) {
  window.scrollBy(params.x || 0, params.y || 0);
  return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY };
}

async function handleWaitForSelector(params) {
  const { selector, timeout = 30000, hidden = false } = params;

  if (hidden) {
    // Wait for selector to DISAPPEAR
    if (!document.querySelector(selector)) return { ok: true };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for "${selector}" to disappear`));
      }, timeout);

      const observer = new MutationObserver(() => {
        if (!document.querySelector(selector)) {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ ok: true });
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'disabled'],
      });
    });
  }

  // Wait for selector to APPEAR
  if (document.querySelector(selector)) return { ok: true };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for: ${selector}`));
    }, timeout);

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve({ ok: true });
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled'],
    });
  });
}

function handleUpload(params) {
  const { ref, fileName, mimeType, dataBase64 } = params;

  // Find the file input element
  let el = ref ? refMap.get(ref) : null;
  if (!el) {
    // Try to find any file input on the page
    el = document.querySelector('input[type="file"]');
  }
  if (!el || el.tagName?.toLowerCase() !== 'input' || el.type !== 'file') {
    throw new Error(`Element ${ref || 'auto'} is not a file input. Call browser_snapshot to find an input[type=file].`);
  }

  // Decode base64 to binary
  const binaryStr = atob(dataBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Create File object and inject via DataTransfer
  const file = new File([bytes], fileName, { type: mimeType || 'application/octet-stream' });
  const dt = new DataTransfer();
  dt.items.add(file);
  el.files = dt.files;

  // Dispatch events that frameworks listen for
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));

  return { ok: true, fileName, size: bytes.length };
}

async function handleWaitForStable(params) {
  const { timeout = 30000, stableMs = 1000 } = params || {};

  return new Promise((resolve, reject) => {
    let debounceTimer = null;

    const timeoutTimer = setTimeout(() => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      reject(new Error('Timeout waiting for DOM to stabilize'));
    }, timeout);

    const settled = () => {
      observer.disconnect();
      clearTimeout(timeoutTimer);
      resolve({ ok: true });
    };

    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(settled, stableMs);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    // Start initial timer — if DOM is already stable, resolve after stableMs
    debounceTimer = setTimeout(settled, stableMs);
  });
}
