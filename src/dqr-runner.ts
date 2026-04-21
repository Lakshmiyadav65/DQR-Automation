import type { Locator, Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { log } from './logger.js';
import { fillPanel, type FillReport } from './panel-filler.js';
import {
  cardContainers,
  cardContainersCssFallback,
  collapsedCategoryToggles,
  dataPointsHeading,
  dqiCounterText,
  firstVisible,
  openPanel,
  panelCloseButton,
  pendingBadge,
  sanitizeFilename,
  saveProgressButton,
  sidebarNavItem,
} from './selectors.js';

export interface RunOptions {
  dryRun: boolean;
  only?: string;
  skipSave: boolean;
  artifactsDir: string;
  maxCardAttempts: number;
  /** When true, assume the user has already navigated to the DQR page (manual mode). */
  skipSidebarNav?: boolean;
}

export interface CardFailure {
  card: string;
  reason: string;
}

export interface RunSummary {
  total: number;
  succeeded: number;
  failed: CardFailure[];
  durationSec: number;
  saved: boolean | null;
}

export async function runDqr(page: Page, opts: RunOptions): Promise<RunSummary> {
  const started = Date.now();
  await fs.mkdir(opts.artifactsDir, { recursive: true });

  if (!opts.skipSidebarNav) {
    await navigateToDqr(page);
  } else {
    log.info('Skipping sidebar navigation (manual mode — assuming you are on the DQR page)');
  }
  await expandAllCategories(page);
  await scrollListToLoadAll(page);

  const cards = await collectCards(page);
  log.ok(`Discovered ${cards.length} cards`);

  const filtered = opts.only
    ? cards.filter((c) => c.title.toLowerCase() === opts.only!.toLowerCase())
    : cards;

  if (opts.only && filtered.length === 0) {
    log.warn(`--only "${opts.only}" matched no cards. Available titles:`);
    for (const c of cards) log.warn(`  - ${c.title}`);
  }

  const summary: RunSummary = {
    total: filtered.length,
    succeeded: 0,
    failed: [],
    durationSec: 0,
    saved: null,
  };

  let i = 0;
  for (const entry of filtered) {
    i++;
    log.step(i, filtered.length, `Card: ${entry.title}`);
    let lastErr: string | null = null;

    for (let attempt = 1; attempt <= opts.maxCardAttempts; attempt++) {
      try {
        await processCard(page, entry, opts);
        summary.succeeded++;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = (e as Error).message;
        log.warn(`Attempt ${attempt}/${opts.maxCardAttempts} failed: ${lastErr}`);
        await tryClosePanel(page).catch(() => {});
        if (attempt < opts.maxCardAttempts) {
          await page.waitForTimeout(500); // narrow retry backoff
        }
      }
    }

    if (lastErr) {
      await captureArtifacts(page, entry.title, opts.artifactsDir).catch(() => {});
      summary.failed.push({ card: entry.title, reason: lastErr });
      log.err(`Gave up on "${entry.title}": ${lastErr}`);
    }
  }

  // Save Progress (end of run)
  if (!opts.skipSave && !opts.dryRun) {
    summary.saved = await clickSaveProgress(page).catch((e) => {
      log.err(`Save Progress failed: ${(e as Error).message}`);
      return false;
    });
  } else {
    log.info(opts.skipSave ? 'Skipping Save Progress (--skip-save)' : 'Skipping Save Progress (--dry-run)');
  }

  summary.durationSec = Math.round((Date.now() - started) / 10) / 100;

  const summaryPath = path.join(opts.artifactsDir, 'run-summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  log.info(`Wrote summary: ${summaryPath}`);

  return summary;
}

// ─── Navigation ─────────────────────────────────────────────────────────

/**
 * Manual-mode entry point: park the browser open and wait for the user to
 * click the injected "START AUTOMATION" button. Returns the page where the
 * button was clicked, so the caller knows which tab to drive.
 *
 * The button is injected into every page in the context (idempotent) and
 * re-injected after navigations. When clicked, it calls the
 * `context.exposeBinding` channel `__dqrStart`, resolving this promise.
 */
export async function waitForUserStart(page: Page, timeoutMs = 30 * 60_000): Promise<Page> {
  const context = page.context();

  log.banner('Ready — click the big GREEN "START AUTOMATION" button in the browser');
  log.info('  1. Log in and navigate to Data Quality Rating yourself (browser is yours)');
  log.info('  2. When you see all the DQR cards on screen, click the green button');
  log.info('     (it floats at the bottom-right corner)');
  log.info('  3. Automation clicks each card, fills every dropdown, closes, and saves');
  log.info('  (Ctrl+C in this terminal to abort)');

  let clickedPage: Page | null = null;
  try {
    await context.exposeBinding('__dqrStart', (source) => {
      clickedPage = source.page;
    });
  } catch (e) {
    // Binding already exists — fine, leftover from an earlier call.
    log.debug(`exposeBinding: ${(e as Error).message}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (!clickedPage && Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());
    if (pages.length === 0) {
      throw new Error('All browser windows closed before the START button was clicked.');
    }
    for (const p of pages) {
      await installStartButton(p).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!clickedPage) {
    throw new Error(
      `Timed out after ${Math.round(timeoutMs / 60_000)}min waiting for the START button.`,
    );
  }

  const chosen: Page = clickedPage;
  await chosen.bringToFront().catch(() => {});
  await chosen.evaluate(() => document.getElementById('__dqr_start_btn')?.remove()).catch(() => {});
  log.ok(`START clicked on ${chosen.url()} — running automation.`);
  return chosen;
}

/**
 * Idempotently inject the floating START button into a page. If the button
 * is already present (same element id), this is a no-op.
 */
async function installStartButton(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    if (document.getElementById('__dqr_start_btn')) return;
    if (!document.body) return;

    const btn = document.createElement('button');
    btn.id = '__dqr_start_btn';
    btn.type = 'button';
    btn.textContent = 'START AUTOMATION';

    const base = '#16a34a';
    const hover = '#15803d';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      padding: '18px 32px',
      background: base,
      color: '#ffffff',
      fontSize: '18px',
      fontWeight: '700',
      letterSpacing: '0.05em',
      border: '3px solid #ffffff',
      borderRadius: '12px',
      cursor: 'pointer',
      boxShadow: '0 10px 32px rgba(22, 163, 74, 0.55), 0 0 0 4px rgba(22, 163, 74, 0.25)',
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = hover;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = base;
    });
    btn.addEventListener('click', () => {
      btn.textContent = 'STARTING...';
      btn.style.background = '#6b7280';
      btn.style.cursor = 'default';
      (btn as HTMLButtonElement).disabled = true;
      const fn = (window as unknown as Record<string, unknown>)['__dqrStart'];
      if (typeof fn === 'function') (fn as () => void)();
    });

    document.body.appendChild(btn);
  });
}

async function navigateToDqr(page: Page): Promise<void> {
  log.info('Opening Data Quality Rating section');
  const nav = await firstVisible(
    sidebarNavItem(page, /data\s*quality\s*rating/i),
    'sidebar: Data Quality Rating',
    8_000,
  );
  if (!nav) {
    throw new Error(
      'Could not find the "Data Quality Rating" sidebar item. Update selectors.ts → sidebarNavItem.',
    );
  }
  await nav.loc.click();

  const heading = await firstVisible(dataPointsHeading(page), 'heading: Data Points', 15_000);
  if (!heading) {
    throw new Error('The "Data Points" heading never appeared after navigation.');
  }
  log.ok('On DQR page');
}

async function expandAllCategories(page: Page): Promise<void> {
  // Loop until nothing collapsed remains (bounded), since expanding one row
  // can reveal more collapsed rows below it.
  for (let pass = 0; pass < 6; pass++) {
    const toggles = collapsedCategoryToggles(page);
    const count = await toggles.count();
    if (count === 0) break;
    log.debug(`Expanding ${count} collapsed section(s) (pass ${pass + 1})`);
    for (let i = 0; i < count; i++) {
      const t = toggles.nth(i);
      const visible = await t.isVisible().catch(() => false);
      if (!visible) continue;
      await t.click({ trial: false }).catch(() => {});
    }
  }
}

async function scrollListToLoadAll(page: Page): Promise<void> {
  // Drive down the scrollable container until the number of DQI counters
  // stops growing. If we can't find a dedicated scroll container, we just
  // scroll the page itself.
  const counter = () => page.getByText(/\d+\/5\s*DQIs/i).count();
  let lastCount = -1;
  for (let pass = 0; pass < 30; pass++) {
    const c = await counter();
    if (c === lastCount && c > 0) break;
    lastCount = c;
    await page.evaluate(() => {
      // Find the deepest scrollable container and scroll it to bottom.
      const scrollables: Element[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const s = getComputedStyle(el);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 4
        ) {
          scrollables.push(el);
        }
      });
      if (scrollables.length) {
        for (const el of scrollables) (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    });
    await page.waitForTimeout(250); // lazy-load settle — narrow scope
  }
  log.debug(`Loaded ${lastCount} card counters`);
}

// ─── Card discovery ─────────────────────────────────────────────────────

interface CardEntry {
  title: string;
  locator: Locator;
}

async function collectCards(page: Page): Promise<CardEntry[]> {
  // Primary: xpath helper. If the XPath engine rejects the regex function
  // on this Chromium build, fall back to the pure-CSS locator.
  let primary: Locator;
  let primaryCount = 0;
  try {
    primary = cardContainers(page);
    primaryCount = await primary.count();
  } catch {
    primaryCount = 0;
  }

  const locator = primaryCount > 0 ? primary! : cardContainersCssFallback(page);
  const total = primaryCount > 0 ? primaryCount : await locator.count();
  if (total === 0) {
    throw new Error(
      'No DQR cards found. The card container selector needs updating — see selectors.ts → cardContainers.',
    );
  }

  const entries: CardEntry[] = [];
  const seenTitles = new Set<string>();

  for (let i = 0; i < total; i++) {
    const card = locator.nth(i);
    const title = await extractCardTitle(card);
    if (!title) continue;
    // A card may be matched by both xpath strategies — dedupe by title.
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);
    entries.push({ title, locator: card });
  }

  return entries;
}

async function extractCardTitle(card: Locator): Promise<string> {
  // Try role=heading first, then any h1..h6, then the first meaningful text node.
  const heading = await card
    .getByRole('heading')
    .first()
    .innerText()
    .catch(() => '');
  if (heading.trim()) return heading.trim();

  const hTag = await card.locator('h1, h2, h3, h4, h5, h6').first().innerText().catch(() => '');
  if (hTag.trim()) return hTag.trim();

  const text = (await card.innerText().catch(() => '')) || '';
  // Strip the "X/5 DQIs" and status suffix/prefix; the remaining first line is usually the title.
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^\d+\/5\s*DQIs$/i.test(l))
    .filter((l) => !/^(pending|completed|in progress)$/i.test(l));
  return lines[0] ?? '';
}

// ─── Per-card flow ──────────────────────────────────────────────────────

async function processCard(page: Page, entry: CardEntry, opts: RunOptions): Promise<void> {
  await entry.locator.scrollIntoViewIfNeeded();
  await entry.locator.click();

  const panelMatch = await firstVisible(openPanel(page, entry.title), `panel:${entry.title}`, 8_000);
  if (!panelMatch) {
    throw new Error('Side panel did not open (or its heading did not match the card title).');
  }
  const panel = panelMatch.loc;

  const report = await fillPanel(page, panel, { dryRun: opts.dryRun });
  log.info(
    `  fields=${report.discovered} filled=${report.filled} skipped=${report.skipped.length}` +
      (report.actions.length ? ` actions[0]="${report.actions[0]}"` : ''),
  );
  if (process.env.DEBUG) {
    for (const a of report.actions) log.debug(`    ${a}`);
    for (const s of report.skipped) log.debug(`    skip ${s.what}: ${s.why}`);
  }

  // Close the panel.
  await closePanel(page, panel);

  // Verify completion (only when not in dry-run).
  if (!opts.dryRun) {
    const ok = await verifyCardComplete(entry);
    if (!ok) {
      throw new Error('Card still shows as incomplete after filling (counter != 5/5 and Pending badge still visible).');
    }
  }
}

async function closePanel(page: Page, panel: Locator): Promise<void> {
  const closeMatch = await firstVisible(panelCloseButton(panel), 'panel close', 2_000);
  if (closeMatch) {
    await closeMatch.loc.click().catch(() => {});
  } else {
    // Fallback: press Escape.
    await page.keyboard.press('Escape').catch(() => {});
  }
  await panel.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

async function tryClosePanel(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first();
  if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
    await closePanel(page, dialog);
  }
}

async function verifyCardComplete(entry: CardEntry): Promise<boolean> {
  // Re-read the card's DQI counter + badge from the now-closed state.
  try {
    const counterText = (await dqiCounterText(entry.locator).innerText().catch(() => '')).trim();
    if (/^5\/5\s*DQIs$/i.test(counterText)) return true;

    const pendingVisible = await pendingBadge(entry.locator)
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!pendingVisible && counterText !== '' && !/^0\/5/.test(counterText)) return true;
  } catch {
    // If we can't re-read the card (it may have re-rendered), treat as success.
    return true;
  }
  return false;
}

// ─── Save Progress ──────────────────────────────────────────────────────

async function clickSaveProgress(page: Page): Promise<boolean> {
  log.banner('Saving progress');
  const btn = await firstVisible(saveProgressButton(page), 'Save Progress', 5_000);
  if (!btn) {
    throw new Error('Save Progress button not found.');
  }

  const responsePromise = page.waitForResponse(
    (r) => r.request().method() !== 'GET' && r.status() >= 200 && r.status() < 300,
    { timeout: 15_000 },
  ).catch(() => null);

  await btn.loc.click();

  const [response, toastAppeared] = await Promise.all([
    responsePromise,
    page
      .getByText(/(saved|success|progress (saved|updated))/i)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false),
  ]);

  if (response) log.ok(`Save request: ${response.request().method()} ${response.url()} → ${response.status()}`);
  if (toastAppeared) log.ok('Save success indicator visible');
  if (!response && !toastAppeared) {
    log.warn('No explicit success signal observed — verify manually.');
    return false;
  }
  return true;
}

// ─── Artifacts ──────────────────────────────────────────────────────────

async function captureArtifacts(page: Page, cardTitle: string, dir: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${sanitizeFilename(cardTitle)}-${stamp}`;
  const png = path.join(dir, `${base}.png`);
  const html = path.join(dir, `${base}.html`);

  await page.screenshot({ path: png, fullPage: true }).catch(() => {});

  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first();
  const panelHtml = await dialog.evaluate((el) => (el as HTMLElement).outerHTML).catch(() => '');
  await fs.writeFile(html, panelHtml || '<!-- panel not open at capture time -->');
  log.info(`Artifacts: ${png}, ${html}`);
}
