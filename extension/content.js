(() => {
  if (window.__dqrAutomationLoaded) return;
  window.__dqrAutomationLoaded = true;

  // ─── State ──────────────────────────────────────────────────────────
  let isRunning = false;
  let cancelRequested = false;

  // ─── Message handling ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') {
      sendResponse({ ok: false, error: 'Bad message' });
      return false;
    }

    if (msg.type === 'status') {
      sendResponse({ ok: true, running: isRunning });
      return false;
    }

    if (msg.type === 'stop') {
      cancelRequested = true;
      setStatus('Stop requested. Finishing current card…');
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'start') {
      if (isRunning) {
        sendResponse({ ok: false, error: 'A run is already in progress.' });
        return false;
      }
      isRunning = true;
      cancelRequested = false;
      showOverlay();
      setStatus('Starting…');
      runAutomation(msg.options || {})
        .then((summary) => {
          finishOverlay(summary);
          isRunning = false;
        })
        .catch((err) => {
          setStatus('Error: ' + (err && err.message ? err.message : String(err)));
          const stopBtn = document.getElementById('__dqr_overlay_stop');
          if (stopBtn) {
            stopBtn.textContent = 'CLOSE';
            stopBtn.style.background = '#64748b';
            stopBtn.onclick = () => document.getElementById('__dqr_overlay')?.remove();
          }
          isRunning = false;
        });
      sendResponse({ ok: true });
      return false;
    }

    sendResponse({ ok: false, error: 'Unknown message type: ' + msg.type });
    return false;
  });

  // ─── Overlay UI ─────────────────────────────────────────────────────
  function showOverlay() {
    if (document.getElementById('__dqr_overlay')) return;

    const style = document.createElement('style');
    style.id = '__dqr_overlay_styles';
    style.textContent = `
      #__dqr_overlay {
        position: fixed !important;
        top: 16px !important;
        right: 16px !important;
        width: 340px !important;
        background: #0f172a !important;
        color: #f1f5f9 !important;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important;
        padding: 14px 16px !important;
        border-radius: 12px !important;
        box-shadow: 0 20px 50px rgba(0,0,0,0.55) !important;
        z-index: 2147483647 !important;
        border: 1px solid #1e293b !important;
        line-height: 1.4 !important;
      }
      #__dqr_overlay_header {
        font-size: 14px !important; font-weight: 700 !important;
        color: #22c55e !important; margin-bottom: 10px !important;
        display: flex !important; justify-content: space-between !important;
      }
      #__dqr_overlay_status {
        margin-bottom: 10px !important; color: #e2e8f0 !important;
        max-height: 60px !important; overflow: hidden !important;
      }
      #__dqr_overlay_bar {
        height: 8px !important; background: #1e293b !important;
        border-radius: 4px !important; overflow: hidden !important; margin-bottom: 6px !important;
      }
      #__dqr_overlay_fill {
        height: 100% !important; background: #22c55e !important;
        width: 0% !important; transition: width 0.25s ease !important;
      }
      #__dqr_overlay_counters {
        font-size: 11px !important; color: #94a3b8 !important; margin-bottom: 12px !important;
      }
      #__dqr_overlay_stop {
        width: 100% !important; padding: 8px 12px !important;
        background: #ef4444 !important; color: white !important;
        border: none !important; border-radius: 6px !important;
        font-weight: 700 !important; cursor: pointer !important;
        font-family: inherit !important; font-size: 12px !important;
        letter-spacing: 0.04em !important;
      }
      #__dqr_overlay_stop:hover { background: #dc2626 !important; }
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = '__dqr_overlay';
    el.innerHTML = `
      <div id="__dqr_overlay_header"><span>DQR Automation</span><span id="__dqr_overlay_ver">●</span></div>
      <div id="__dqr_overlay_status">Initializing…</div>
      <div id="__dqr_overlay_bar"><div id="__dqr_overlay_fill"></div></div>
      <div id="__dqr_overlay_counters">0 / 0 cards</div>
      <button id="__dqr_overlay_stop">STOP</button>
    `;
    document.documentElement.appendChild(el);

    document.getElementById('__dqr_overlay_stop').addEventListener('click', () => {
      cancelRequested = true;
      setStatus('Stop requested. Finishing current card…');
    });
  }

  function setStatus(message) {
    const el = document.getElementById('__dqr_overlay_status');
    if (el) el.textContent = message;
  }

  function setProgress(done, total) {
    const fill = document.getElementById('__dqr_overlay_fill');
    const counters = document.getElementById('__dqr_overlay_counters');
    if (fill) fill.style.width = (total ? (done / total) * 100 : 0) + '%';
    if (counters) counters.textContent = `${done} / ${total} cards`;
  }

  function finishOverlay(summary) {
    const failCount = summary.failed.length;
    setStatus(
      `Done. Filled ${summary.succeeded}/${summary.total} cards` +
        (failCount ? `, ${failCount} failed (see console).` : '.'),
    );
    if (failCount) {
      console.group('DQR Automation failures');
      summary.failed.forEach((f) => console.warn(`${f.card}: ${f.reason}`));
      console.groupEnd();
    }
    const stopBtn = document.getElementById('__dqr_overlay_stop');
    if (stopBtn) {
      stopBtn.textContent = 'CLOSE';
      stopBtn.style.background = failCount ? '#f59e0b' : '#22c55e';
      stopBtn.style.color = failCount ? '#1f2937' : '#052e16';
      stopBtn.onclick = () => document.getElementById('__dqr_overlay')?.remove();
    }
  }

  // ─── Utilities ──────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const PLACEHOLDER_RX =
    /^\s*(select(ing)?(\s+[\w-]+)?|choose(\s+[\w-]+)?|-{2,}|please\s+select|pick\s+an?\s+option|none|n\/a|--)\s*\.{0,3}\s*$/i;

  function isPlaceholder(s) {
    if (!s) return true;
    const t = ('' + s).trim();
    return t === '' || PLACEHOLDER_RX.test(t);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    return true;
  }

  async function waitFor(fn, { timeout = 5000, interval = 120 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (cancelRequested) throw new Error('Cancelled');
      try {
        const r = await fn();
        if (r) return r;
      } catch {}
      await sleep(interval);
    }
    return null;
  }

  // React-controlled inputs need the native value setter to notify React.
  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireInputChange(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function labelOf(el) {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy.split(/\s+/)[0]);
      if (ref && ref.textContent && ref.textContent.trim()) return ref.textContent.trim();
    }
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.textContent && lbl.textContent.trim()) return lbl.textContent.trim();
      } catch {}
    }
    let walker = el.parentElement;
    while (walker && walker.tagName !== 'LABEL') walker = walker.parentElement;
    if (walker && walker.textContent) return walker.textContent.trim();
    const container = el.closest && el.closest('div, fieldset, section');
    if (container) {
      const lbl = container.querySelector('label');
      if (lbl && lbl.textContent && lbl.textContent.trim()) return lbl.textContent.trim();
    }
    return (
      (el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('name'))) ||
      '(unlabeled)'
    );
  }

  // ─── Card discovery ─────────────────────────────────────────────────
  function normalizeText(s) {
    return (s || '').replace(/[\s ]+/g, ' ').trim();
  }

  function stripCounterAndStatus(text) {
    return (text || '')
      .replace(/\d+\s*\/\s*5\s*DQIs?/gi, '')
      .replace(/\b(Pending|Completed|In Progress|Done)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findCards() {
    // Step 1: find leaves whose flattened text contains "N/5 DQIs" but no
    // descendant's does. These are the smallest counter-bearing elements.
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const leaves = [];
    for (const el of all) {
      const text = normalizeText(el.textContent);
      if (!/\d+\/5\s*DQIs/i.test(text)) continue;
      let hasMatchingChild = false;
      for (const child of el.children) {
        if (/\d+\/5\s*DQIs/i.test(normalizeText(child.textContent))) {
          hasMatchingChild = true;
          break;
        }
      }
      if (!hasMatchingChild) leaves.push(el);
    }

    console.log(`[DQR] ${leaves.length} leaf element(s) contain "N/5 DQIs"`);

    const cards = [];
    const seen = new WeakSet();

    for (const leaf of leaves) {
      // Walk UP until the ancestor has substantial NON-counter/NON-status
      // text (that's the card's title area). Prefer the first card-sized
      // ancestor (height 40–400px, narrower than the full viewport).
      let el = leaf;
      let chosen = null;

      for (let depth = 0; depth < 15; depth++) {
        const parent = el.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        el = parent;
        const text = normalizeText(el.textContent);
        if (!/\d+\/5\s*DQIs/i.test(text)) break; // walked past the card
        const extra = stripCounterAndStatus(text);
        if (extra.length < 3) continue; // still nothing but counter+badge

        // We found an ancestor with extra text — it has at least the title.
        chosen = el;
        const rect = el.getBoundingClientRect();
        const cardSized =
          rect.width > 100 &&
          rect.height > 40 &&
          rect.height < 400 &&
          rect.width < window.innerWidth * 0.85;
        if (cardSized) break; // card-shaped: stop. Else keep climbing.
      }

      if (!chosen) {
        console.log('[DQR] Could not find card container for leaf:', leaf);
        continue;
      }
      if (seen.has(chosen)) continue;
      seen.add(chosen);

      const title = extractCardTitle(chosen);
      if (!title || /^\d+\s*\/\s*5/.test(title) || /^(Pending|Completed|In Progress|Done)$/i.test(title)) {
        console.log(`[DQR] Skipping card with unusable title "${title}"`, chosen);
        continue;
      }
      cards.push({ element: chosen, title });
    }

    console.log(
      `[DQR] Identified ${cards.length} card(s): ${cards.map((c) => c.title).join(' | ')}`,
    );
    return cards;
  }

  function extractCardTitle(card) {
    // 1) Explicit heading tag wins if present.
    const h = card.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (h) {
      const t = (h.textContent || '').trim();
      if (t && !/^\d+\s*\/\s*5/.test(t)) return t;
    }

    // 2) Pick the leaf-text element with the LARGEST font-size — that's
    //    almost always the title in a card design.
    const candidates = [];
    for (const el of card.querySelectorAll('*')) {
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.nodeValue || '').trim() !== '',
      );
      if (!hasDirectText) continue;
      const text = normalizeText(el.textContent);
      if (!text) continue;
      if (/^\d+\s*\/\s*5/i.test(text)) continue; // counter
      if (/^(Pending|Completed|In Progress|Done)$/i.test(text)) continue; // badge
      const fontSize = parseFloat(getComputedStyle(el).fontSize || '0');
      if (!fontSize) continue;
      candidates.push({ el, text, fontSize });
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.fontSize - a.fontSize);
      return candidates[0].text;
    }

    // 3) Last resort: the first non-counter/non-badge line of textContent.
    const lines = (card.textContent || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^\d+\s*\/\s*5/i.test(l))
      .filter((l) => !/^(Pending|Completed|In Progress|Done)$/i.test(l));
    return lines[0] || '';
  }

  // ─── Expand / load ──────────────────────────────────────────────────
  async function expandAllCategories() {
    for (let pass = 0; pass < 6; pass++) {
      if (cancelRequested) return;
      const toggles = Array.from(document.querySelectorAll('[aria-expanded="false"]')).filter(
        (el) => isVisible(el) && !/save\s+progress/i.test(el.textContent || ''),
      );
      if (toggles.length === 0) break;
      for (const t of toggles) {
        try { t.click(); } catch {}
        await sleep(40);
      }
      await sleep(180);
    }
  }

  async function scrollToLoadAll() {
    // Count distinct card leaves (same logic as findCards) so we can tell
    // when the virtualized list has no more cards to reveal.
    const countLeaves = () => {
      let n = 0;
      for (const el of document.body ? document.body.querySelectorAll('*') : []) {
        const t = normalizeText(el.textContent);
        if (!/\d+\/5\s*DQIs/i.test(t)) continue;
        let hasMatchingChild = false;
        for (const c of el.children) {
          if (/\d+\/5\s*DQIs/i.test(normalizeText(c.textContent))) {
            hasMatchingChild = true;
            break;
          }
        }
        if (!hasMatchingChild) n++;
      }
      return n;
    };

    let last = -1;
    for (let i = 0; i < 30; i++) {
      if (cancelRequested) return;
      const c = countLeaves();
      if (c === last && c > 0) break;
      last = c;
      document.querySelectorAll('*').forEach((el) => {
        const s = getComputedStyle(el);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 4
        ) {
          el.scrollTop = el.scrollHeight;
        }
      });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(280);
    }
    console.log(`[DQR] scrollToLoadAll finished with ${last} visible counters`);
  }

  // ─── Panel open/close ───────────────────────────────────────────────
  async function openCardPanel(card) {
    // Re-resolve element if it has become detached during re-renders.
    if (!document.documentElement.contains(card.element)) {
      const fresh = findCards().find((c) => c.title === card.title);
      if (!fresh) throw new Error('Card detached and could not be re-found');
      card.element = fresh.element;
    }
    try {
      card.element.scrollIntoView({ block: 'center' });
    } catch {}
    await sleep(80);
    card.element.click();

    const panel = await waitFor(
      () => {
        const dialogs = Array.from(
          document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
        ).filter(isVisible);
        // Prefer one whose heading text contains the card title.
        for (const d of dialogs) {
          const h = d.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
          const text = (h ? h.textContent : d.textContent) || '';
          if (text.includes(card.title)) return d;
        }
        return dialogs[dialogs.length - 1] || null;
      },
      { timeout: 5000 },
    );
    return panel;
  }

  function findCloseButton(panel) {
    // 1. ARIA-labelled close (most reliable when present).
    const labelled =
      panel.querySelector('[aria-label*="close" i]') ||
      panel.querySelector('button[title*="close" i]');
    if (labelled && isVisible(labelled)) return labelled;

    const buttons = Array.from(panel.querySelectorAll('button')).filter(isVisible);
    if (buttons.length === 0) return null;

    // 2. Obvious X/× text.
    const textX = buttons.find((b) => {
      const t = (b.textContent || '').trim();
      return t === '×' || t === 'X' || t === '✕' || /^close$/i.test(t);
    });
    if (textX) return textX;

    // 3. Geometric heuristic: the button closest to the panel's top-right
    //    corner, within the panel's first 80px of vertical space. Slide-in
    //    dialogs always place the close X there.
    const panelRect = panel.getBoundingClientRect();
    const topRight = { x: panelRect.right, y: panelRect.top };
    const header = buttons.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.top - panelRect.top < 80;
    });
    const pool = header.length ? header : buttons;
    let best = null;
    let bestDist = Infinity;
    for (const b of pool) {
      const r = b.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const dist = Math.hypot(cx - topRight.x, cy - topRight.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
  }

  function getScrollableInside(container) {
    // Deepest scrollable element inside `container`, else `container` if it
    // scrolls itself, else null. Used to trigger lazy renders.
    let best = null;
    for (const el of container.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 4
      ) {
        best = el;
      }
    }
    if (best) return best;
    const cs = getComputedStyle(container);
    if (
      (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
      container.scrollHeight > container.clientHeight + 4
    ) {
      return container;
    }
    return null;
  }

  async function sweepPanelScroll(panel) {
    const sc = getScrollableInside(panel);
    if (!sc) return;
    sc.scrollTop = sc.scrollHeight;
    await sleep(180);
    sc.scrollTop = 0;
    await sleep(120);
  }

  async function closePanel(panel) {
    if (!panel || !document.documentElement.contains(panel)) return;

    const closeBtn = findCloseButton(panel);
    if (closeBtn) {
      try { closeBtn.click(); } catch {}
    } else {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      );
    }

    await waitFor(() => !isVisible(panel) || !document.documentElement.contains(panel), {
      timeout: 3500,
    });
  }

  async function tryCloseAnyPanel() {
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
    ).filter(isVisible);
    for (const d of dialogs) {
      try { await closePanel(d); } catch {}
    }
  }

  // ─── Filling ────────────────────────────────────────────────────────
  async function fillPanel(panel, opts) {
    let filled = 0;

    filled += await fillNativeSelects(panel, opts);
    if (cancelRequested) return filled;
    filled += await fillCustomDropdowns(panel, opts);
    if (cancelRequested) return filled;
    filled += await fillTextInputs(panel, opts);
    if (cancelRequested) return filled;
    filled += await fillRadioGroups(panel, opts);
    if (cancelRequested) return filled;
    filled += await fillCheckboxes(panel, opts);

    return filled;
  }

  async function fillNativeSelects(panel, opts) {
    let n = 0;
    const selects = Array.from(panel.querySelectorAll('select')).filter(isVisible);
    for (const sel of selects) {
      if (cancelRequested) return n;
      if (sel.disabled) continue;
      if (sel.value && sel.value !== '') continue;
      const options = Array.from(sel.options).filter(
        (o) => !o.disabled && o.value !== '' && !isPlaceholder(o.textContent || ''),
      );
      if (options.length === 0) continue;
      const pick = rand(options);
      if (opts.dryRun) { n++; continue; }
      setNativeValue(sel, pick.value);
      fireInputChange(sel);
      n++;
      await sleep(30);
    }
    return n;
  }

  async function fillCustomDropdowns(panel, opts) {
    let n = 0;

    const triggerSelectors = [
      '[role="combobox"]:not(select)',
      'button[aria-haspopup="listbox"]',
      'button[aria-haspopup="menu"]',
      '[role="button"][aria-haspopup]',
    ].join(', ');
    const triggers = Array.from(panel.querySelectorAll(triggerSelectors)).filter(isVisible);

    // Placeholder-text catchers for triggers that lack ARIA.
    const placeholderTriggers = Array.from(
      panel.querySelectorAll('div, button, [tabindex="0"]'),
    ).filter((el) => {
      if (!isVisible(el)) return false;
      const text = (el.textContent || '').trim();
      return (
        /^select\s+classification$/i.test(text) ||
        /^select\s+[a-z ]+$/i.test(text) ||
        /^choose\s*\.{0,3}$/i.test(text)
      );
    });

    const seen = new Set();
    const all = [...triggers, ...placeholderTriggers].filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    for (const trigger of all) {
      if (cancelRequested) return n;
      if (!document.documentElement.contains(trigger)) continue;

      const current = (trigger.textContent || '').trim();
      if (current && !isPlaceholder(current)) continue;

      if (opts.dryRun) { n++; continue; }

      try { trigger.scrollIntoView({ block: 'center' }); } catch {}
      await sleep(40);
      try { trigger.click(); } catch { continue; }

      const listbox = await waitFor(
        () => {
          const lists = Array.from(
            document.querySelectorAll(
              '[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]',
            ),
          ).filter(isVisible);
          return lists[lists.length - 1] || null;
        },
        { timeout: 2500 },
      );

      if (!listbox) {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        continue;
      }

      const options = Array.from(
        listbox.querySelectorAll('[role="option"], [role="menuitem"], li, button'),
      )
        .filter(isVisible)
        .map((el) => ({ el, text: (el.textContent || '').trim() }))
        .filter((o) => o.text && !isPlaceholder(o.text));

      if (options.length === 0) {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        continue;
      }

      const pick = rand(options);
      try {
        pick.el.click();
        n++;
      } catch {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }
      await sleep(120);
    }

    return n;
  }

  async function fillTextInputs(panel, opts) {
    let n = 0;
    const inputs = Array.from(
      panel.querySelectorAll(
        [
          'input[type="text"]',
          'input[type="search"]',
          'input[type="email"]',
          'input[type="tel"]',
          'input[type="url"]',
          'input[type="number"]',
          'input[type="date"]',
          'input[type="datetime-local"]',
          'input[type="month"]',
          'input[type="time"]',
          'input:not([type])',
          'textarea',
        ].join(', '),
      ),
    ).filter(isVisible);

    for (const inp of inputs) {
      if (cancelRequested) return n;
      if (inp.readOnly || inp.disabled) continue;
      if (inp.value && String(inp.value).trim() !== '') continue;

      const type = (inp.type || 'text').toLowerCase();
      const label = labelOf(inp);
      const value = valueForInput(type, label);

      if (opts.dryRun) { n++; continue; }
      try {
        inp.focus();
        setNativeValue(inp, value);
        fireInputChange(inp);
        inp.blur();
        n++;
      } catch {}
    }
    return n;
  }

  function valueForInput(type, label) {
    const l = (label || '').toLowerCase();
    if (type === 'date') return new Date().toISOString().slice(0, 10);
    if (type === 'datetime-local') return new Date().toISOString().slice(0, 16);
    if (type === 'month') return new Date().toISOString().slice(0, 7);
    if (type === 'time') return '12:00';
    if (type === 'number') {
      if (/year/.test(l)) return '2024';
      if (/percent|%|ratio|share/.test(l)) return '100';
      return String(randInt(1, 100));
    }
    if (/year/.test(l)) return '2024';
    if (/percent|%|ratio|share/.test(l)) return '100';
    if (/email/.test(l)) return 'qa@example.com';
    if (/url|website|link/.test(l)) return 'https://example.com';
    if (/comment|notes?|descr|remark|justif/.test(l)) return 'N/A';
    return 'N/A';
  }

  async function fillRadioGroups(panel, opts) {
    let n = 0;

    const radios = Array.from(panel.querySelectorAll('input[type="radio"]')).filter(isVisible);
    const groups = new Map();
    for (const r of radios) {
      const name = r.name || '__unnamed__';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    for (const [, members] of groups) {
      if (cancelRequested) return n;
      if (members.some((m) => m.checked)) continue;
      const pick = rand(members);
      if (opts.dryRun) { n++; continue; }
      try {
        pick.click();
        fireInputChange(pick);
        n++;
      } catch {}
    }

    const ariaGroups = Array.from(panel.querySelectorAll('[role="radiogroup"]')).filter(isVisible);
    for (const g of ariaGroups) {
      if (cancelRequested) return n;
      const options = Array.from(g.querySelectorAll('[role="radio"]')).filter(isVisible);
      if (options.length === 0) continue;
      if (options.some((o) => o.getAttribute('aria-checked') === 'true')) continue;
      const pick = rand(options);
      if (opts.dryRun) { n++; continue; }
      try { pick.click(); n++; } catch {}
    }

    return n;
  }

  async function fillCheckboxes(panel, opts) {
    let n = 0;
    const boxes = Array.from(panel.querySelectorAll('input[type="checkbox"]')).filter(isVisible);
    for (const b of boxes) {
      if (cancelRequested) return n;
      if (b.disabled) continue;
      const shouldCheck = Math.random() < 0.5;
      if (b.checked === shouldCheck) continue;
      if (opts.dryRun) { n++; continue; }
      try { b.click(); n++; } catch {}
    }
    return n;
  }

  // ─── Verification + main runner ─────────────────────────────────────
  function cardLooksComplete(cardEl) {
    if (!cardEl || !document.documentElement.contains(cardEl)) return true; // treat re-render as OK
    const text = normalizeText(cardEl.textContent);
    if (/5\/5\s*DQIs/i.test(text)) return true;
    if (!/Pending/i.test(text)) return true;
    return false;
  }

  async function runAutomation(options) {
    setStatus('Expanding categories…');
    await expandAllCategories();

    setStatus('Loading all cards…');
    await scrollToLoadAll();

    let cards = findCards();
    if (options.only) {
      const needle = options.only.toLowerCase();
      cards = cards.filter((c) => c.title.toLowerCase() === needle);
      if (cards.length === 0) {
        throw new Error(`No card matched "--only ${options.only}"`);
      }
    }

    if (cards.length === 0) {
      throw new Error('No DQR cards found. Are you on the DQR view with cards visible?');
    }

    setStatus(`Found ${cards.length} cards.`);
    setProgress(0, cards.length);

    const summary = { total: cards.length, succeeded: 0, failed: [] };

    for (let i = 0; i < cards.length; i++) {
      if (cancelRequested) break;
      const card = cards[i];
      setStatus(`[${i + 1}/${cards.length}] ${card.title}`);

      let ok = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3 && !cancelRequested; attempt++) {
        try {
          const panel = await openCardPanel(card);
          if (!panel) throw new Error('Panel did not open');
          await sleep(350);

          // Multi-pass: cascading selects (e.g. Level-2 Classification)
          // appear only AFTER their Level-1 parent is chosen. Keep filling
          // (and scrolling the panel between passes to trigger lazy renders)
          // until a pass fills nothing new.
          let totalFilled = 0;
          for (let pass = 0; pass < 8; pass++) {
            if (cancelRequested) break;
            await sweepPanelScroll(panel);
            const filledThisPass = await fillPanel(panel, options);
            console.log(
              `[DQR] ${card.title} — pass ${pass + 1}: filled ${filledThisPass} new field(s)`,
            );
            totalFilled += filledThisPass;
            if (filledThisPass === 0) break;
            await sleep(450); // allow conditional fields to render
          }

          // Final sweep to bottom so anything that still depends on scroll
          // position gets a fair chance.
          await sweepPanelScroll(panel);
          const finalPass = await fillPanel(panel, options);
          if (finalPass > 0) {
            totalFilled += finalPass;
            console.log(`[DQR] ${card.title} — final sweep: filled ${finalPass} more`);
          }

          await sleep(200);
          await closePanel(panel);
          await sleep(250);

          if (options.dryRun) { ok = true; break; }
          // Accept success if the card's DQI counter advanced OR we filled at
          // least some fields — otherwise retry (app may have been mid-render).
          if (cardLooksComplete(card.element) || totalFilled >= 1) { ok = true; break; }
          lastErr = new Error(`No fields were fillable on attempt ${attempt}`);
        } catch (e) {
          lastErr = e;
        }
        await tryCloseAnyPanel();
        await sleep(400);
      }

      if (ok) summary.succeeded++;
      else
        summary.failed.push({
          card: card.title,
          reason: (lastErr && lastErr.message) || 'unknown',
        });

      setProgress(i + 1, cards.length);
    }

    if (!cancelRequested && !options.skipSave && !options.dryRun) {
      setStatus('Clicking "Save Progress"…');
      const saveBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => isVisible(b) && /save\s+progress/i.test(b.textContent || ''),
      );
      if (saveBtn) {
        try { saveBtn.click(); } catch {}
        await sleep(2000);
      }
    }

    return summary;
  }
})();
