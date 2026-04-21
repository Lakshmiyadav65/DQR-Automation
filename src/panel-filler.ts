import type { Locator, Page } from '@playwright/test';
import { log } from './logger.js';
import { isPlaceholderLabel } from './selectors.js';

export interface FillOptions {
  dryRun: boolean;
}

export interface FillReport {
  discovered: number;
  filled: number;
  skipped: Array<{ what: string; why: string }>;
  actions: string[];
}

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Fill every form control inside an open side panel. The caller is expected
 * to have already opened the panel and passed in its Locator. This function
 * does NOT close the panel.
 */
export async function fillPanel(
  page: Page,
  panel: Locator,
  opts: FillOptions,
): Promise<FillReport> {
  const report: FillReport = { discovered: 0, filled: 0, skipped: [], actions: [] };

  await fillNativeSelects(panel, opts, report);
  await fillCustomDropdowns(page, panel, opts, report);
  await fillTextLikeInputs(panel, opts, report);
  await fillRadioGroups(panel, opts, report);
  await fillCheckboxes(panel, opts, report);

  return report;
}

// ─── Native <select> ─────────────────────────────────────────────────────

async function fillNativeSelects(panel: Locator, opts: FillOptions, r: FillReport): Promise<void> {
  const selects = await panel.locator('select').all();
  for (const sel of selects) {
    r.discovered++;
    const label = await resolveFieldLabel(panel, sel);

    const already = await sel.evaluate((el) => (el as HTMLSelectElement).value);
    if (already && already.trim() !== '') {
      r.skipped.push({ what: `select[${label}]`, why: `already set to "${already}"` });
      continue;
    }

    const options = await sel.locator('option').evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).map((o) => ({
        value: o.value,
        text: (o.textContent || '').trim(),
        disabled: o.disabled,
      })),
    );
    const valid = options.filter(
      (o) => !o.disabled && o.value !== '' && !isPlaceholderLabel(o.text),
    );

    if (valid.length === 0) {
      r.skipped.push({ what: `select[${label}]`, why: 'no non-placeholder options' });
      continue;
    }

    const pick = rand(valid);
    if (opts.dryRun) {
      r.actions.push(`[dry] select[${label}] → "${pick.text}"`);
    } else {
      await sel.selectOption(pick.value);
      r.actions.push(`select[${label}] → "${pick.text}"`);
      r.filled++;
    }
  }
}

// ─── Custom dropdowns (React-style) ──────────────────────────────────────

async function fillCustomDropdowns(
  page: Page,
  panel: Locator,
  opts: FillOptions,
  r: FillReport,
): Promise<void> {
  // Triggers: role=combobox that is not a native select, or buttons with
  // aria-haspopup=listbox/menu, or divs tagged as buttons that still show
  // the placeholder text.
  const triggerLoc = panel.locator(
    [
      '[role="combobox"]:not(select)',
      'button[aria-haspopup="listbox"]',
      'button[aria-haspopup="menu"]',
      '[role="button"][aria-haspopup]',
    ].join(', '),
  );
  // A second pass catches placeholder-style triggers that don't carry ARIA.
  const placeholderTriggers = panel
    .locator('[tabindex="0"], div, button')
    .filter({ hasText: /^\s*(select\s+classification|select\s+[a-z ]+|choose[ .]*)\s*$/i });

  const triggers = [
    ...(await triggerLoc.all()),
    ...(await placeholderTriggers.all()),
  ];

  // De-dupe by element handle identity.
  const seen = new Set<string>();
  const unique: Locator[] = [];
  for (const t of triggers) {
    const key = await t
      .evaluate((el) => (el as HTMLElement).outerHTML.slice(0, 120))
      .catch(() => Math.random().toString(36));
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }

  for (const trigger of unique) {
    r.discovered++;
    const label = await resolveFieldLabel(panel, trigger);

    // If the trigger already shows a non-placeholder value, skip.
    const current = (await trigger.innerText().catch(() => '')).trim();
    if (current && !isPlaceholderLabel(current)) {
      r.skipped.push({ what: `dropdown[${label}]`, why: `already "${current.slice(0, 40)}"` });
      continue;
    }

    if (opts.dryRun) {
      r.actions.push(`[dry] dropdown[${label}] → (would open and pick a random option)`);
      continue;
    }

    try {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
    } catch (e) {
      r.skipped.push({ what: `dropdown[${label}]`, why: `could not open: ${(e as Error).message}` });
      continue;
    }

    // Options may render in a portal at <body> root, so we query the page.
    const listbox = page
      .locator('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]')
      .filter({ hasText: /.+/ })
      .last();

    const opened = await listbox.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
    if (!opened) {
      r.skipped.push({ what: `dropdown[${label}]`, why: 'options popup did not appear' });
      await page.keyboard.press('Escape').catch(() => {});
      continue;
    }

    const options = await listbox.locator('[role="option"], [role="menuitem"], li, button').all();
    const candidates: Array<{ loc: Locator; text: string }> = [];
    for (const opt of options) {
      const visible = await opt.isVisible().catch(() => false);
      if (!visible) continue;
      const text = (await opt.innerText().catch(() => '')).trim();
      if (!text || isPlaceholderLabel(text)) continue;
      candidates.push({ loc: opt, text });
    }

    if (candidates.length === 0) {
      r.skipped.push({ what: `dropdown[${label}]`, why: 'no valid options in popup' });
      await page.keyboard.press('Escape').catch(() => {});
      continue;
    }

    const pick = rand(candidates);
    try {
      await pick.loc.click();
      r.actions.push(`dropdown[${label}] → "${pick.text}"`);
      r.filled++;
    } catch (e) {
      r.skipped.push({ what: `dropdown[${label}]`, why: `click failed: ${(e as Error).message}` });
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

// ─── Text / textarea / number / date inputs ──────────────────────────────

async function fillTextLikeInputs(panel: Locator, opts: FillOptions, r: FillReport): Promise<void> {
  const inputs = await panel
    .locator(
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
    )
    .all();

  for (const input of inputs) {
    r.discovered++;
    const label = await resolveFieldLabel(panel, input);
    const type = (await input.getAttribute('type'))?.toLowerCase() ?? 'text';

    const readonly = await input.evaluate(
      (el) => (el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled,
    );
    if (readonly) {
      r.skipped.push({ what: `input[${label}]`, why: 'readonly/disabled' });
      continue;
    }

    const current = await input.inputValue().catch(() => '');
    if (current && current.trim() !== '') {
      r.skipped.push({ what: `input[${label}]`, why: `already "${current.slice(0, 40)}"` });
      continue;
    }

    const value = valueForInput(type, label);

    if (opts.dryRun) {
      r.actions.push(`[dry] ${type}[${label}] → "${value}"`);
      continue;
    }
    try {
      await input.fill(value);
      r.actions.push(`${type}[${label}] → "${value}"`);
      r.filled++;
    } catch (e) {
      r.skipped.push({ what: `input[${label}]`, why: `fill failed: ${(e as Error).message}` });
    }
  }
}

function valueForInput(type: string, label: string): string {
  const l = label.toLowerCase();
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

// ─── Radio groups ────────────────────────────────────────────────────────

async function fillRadioGroups(panel: Locator, opts: FillOptions, r: FillReport): Promise<void> {
  const radios = await panel.locator('input[type="radio"]').all();
  // Group by `name`, falling back to grouping by their common fieldset.
  const groups = new Map<string, Locator[]>();
  for (const radio of radios) {
    const name = (await radio.getAttribute('name')) || '__unnamed__';
    const list = groups.get(name) ?? [];
    list.push(radio);
    groups.set(name, list);
  }

  for (const [name, members] of groups) {
    r.discovered++;
    // If any member is already checked, skip this group.
    let anyChecked = false;
    for (const m of members) {
      if (await m.isChecked().catch(() => false)) {
        anyChecked = true;
        break;
      }
    }
    if (anyChecked) {
      r.skipped.push({ what: `radio[${name}]`, why: 'already has a selection' });
      continue;
    }

    const pick = rand(members);
    const pickLabel = await resolveFieldLabel(panel, pick);

    if (opts.dryRun) {
      r.actions.push(`[dry] radio[${name}] → "${pickLabel}"`);
      continue;
    }
    try {
      await pick.check({ force: true });
      r.actions.push(`radio[${name}] → "${pickLabel}"`);
      r.filled++;
    } catch (e) {
      r.skipped.push({ what: `radio[${name}]`, why: `check failed: ${(e as Error).message}` });
    }
  }

  // Also handle ARIA radiogroups that don't use native inputs.
  const ariaGroups = await panel.locator('[role="radiogroup"]').all();
  for (const group of ariaGroups) {
    const options = await group.locator('[role="radio"]').all();
    if (options.length === 0) continue;
    r.discovered++;

    let anyChecked = false;
    for (const o of options) {
      const state = await o.getAttribute('aria-checked');
      if (state === 'true') {
        anyChecked = true;
        break;
      }
    }
    if (anyChecked) {
      r.skipped.push({ what: `aria-radiogroup`, why: 'already has selection' });
      continue;
    }

    const pick = rand(options);
    const pickLabel = (await pick.innerText().catch(() => '')).trim() || '(unlabeled)';
    if (opts.dryRun) {
      r.actions.push(`[dry] aria-radio → "${pickLabel}"`);
      continue;
    }
    try {
      await pick.click();
      r.actions.push(`aria-radio → "${pickLabel}"`);
      r.filled++;
    } catch (e) {
      r.skipped.push({ what: `aria-radio`, why: (e as Error).message });
    }
  }
}

// ─── Checkboxes ──────────────────────────────────────────────────────────

async function fillCheckboxes(panel: Locator, opts: FillOptions, r: FillReport): Promise<void> {
  const boxes = await panel.locator('input[type="checkbox"]').all();
  for (const box of boxes) {
    r.discovered++;
    const label = await resolveFieldLabel(panel, box);
    const already = await box.isChecked().catch(() => false);
    const shouldCheck = Math.random() < 0.5;

    if (already === shouldCheck) {
      r.skipped.push({ what: `checkbox[${label}]`, why: `already ${already ? 'checked' : 'unchecked'}` });
      continue;
    }

    if (opts.dryRun) {
      r.actions.push(`[dry] checkbox[${label}] → ${shouldCheck ? 'check' : 'uncheck'}`);
      continue;
    }
    try {
      if (shouldCheck) await box.check({ force: true });
      else await box.uncheck({ force: true });
      r.actions.push(`checkbox[${label}] → ${shouldCheck ? 'checked' : 'unchecked'}`);
      r.filled++;
    } catch (e) {
      r.skipped.push({ what: `checkbox[${label}]`, why: (e as Error).message });
    }
  }
}

// ─── Label resolution ────────────────────────────────────────────────────

async function resolveFieldLabel(panel: Locator, control: Locator): Promise<string> {
  // 1. aria-label
  const aria = await control.getAttribute('aria-label').catch(() => null);
  if (aria && aria.trim()) return aria.trim();

  // 2. aria-labelledby
  const labelledBy = await control.getAttribute('aria-labelledby').catch(() => null);
  if (labelledBy) {
    const text = await panel
      .locator(`#${cssEscapeId(labelledBy.split(/\s+/)[0]!)}`)
      .innerText()
      .catch(() => '');
    if (text.trim()) return text.trim();
  }

  // 3. <label for=id>
  const id = await control.getAttribute('id').catch(() => null);
  if (id) {
    const labelText = await panel
      .locator(`label[for="${cssEscapeId(id)}"]`)
      .first()
      .innerText()
      .catch(() => '');
    if (labelText.trim()) return labelText.trim();
  }

  // 4. Enclosing <label>
  const wrappedLabel = await control
    .evaluate((el) => {
      let n: HTMLElement | null = el as HTMLElement;
      while (n && n.tagName !== 'LABEL') n = n.parentElement;
      return n ? (n.innerText || '').trim() : '';
    })
    .catch(() => '');
  if (wrappedLabel) return wrappedLabel;

  // 5. Nearest preceding text node / sibling label element.
  const siblingLabel = await control
    .evaluate((el) => {
      const walker = (el as HTMLElement).closest('div, fieldset, section');
      if (!walker) return '';
      const candidates = walker.querySelectorAll('label, .label, [class*="label" i]');
      for (const c of Array.from(candidates)) {
        const t = (c as HTMLElement).innerText?.trim();
        if (t) return t;
      }
      return '';
    })
    .catch(() => '');
  if (siblingLabel) return siblingLabel;

  // 6. Placeholder / name as last resort.
  const placeholder = await control.getAttribute('placeholder').catch(() => null);
  if (placeholder && placeholder.trim()) return placeholder.trim();
  const name = await control.getAttribute('name').catch(() => null);
  if (name) return name;
  return '(unlabeled)';
}

function cssEscapeId(id: string): string {
  return id.replace(/(["\\])/g, '\\$1');
}
