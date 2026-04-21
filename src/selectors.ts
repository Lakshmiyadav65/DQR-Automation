import type { Locator, Page } from '@playwright/test';
import { log } from './logger.js';

/**
 * Centralized selector helpers. Every function here returns a Locator (not a
 * resolved element) so the caller can decide how to wait. Most helpers try a
 * sequence of strategies (role → label → text → testid → CSS) and log which
 * one matched, so when the app changes we can see exactly what gave way.
 *
 * When the app re-skins and selectors break: run
 *   npx playwright codegen <DQR_URL>
 * against the live app, then update the candidate lists below.
 */

const PLACEHOLDER_RX =
  /^\s*(select(ing)?(\s+[\w-]+)?|choose(\s+[\w-]+)?|-{2,}|please\s+select|pick\s+an?\s+option|none|n\/a|--)\s*\.{0,3}\s*$/i;

export function isPlaceholderLabel(label: string | null | undefined): boolean {
  if (!label) return true;
  const trimmed = label.trim();
  if (trimmed === '') return true;
  if (PLACEHOLDER_RX.test(trimmed)) return true;
  return false;
}

/**
 * Try a list of locator candidates, returning the first one that resolves to
 * at least one visible element. `label` is used only for debug logging.
 */
export async function firstVisible(
  candidates: Array<{ name: string; loc: Locator }>,
  label: string,
  timeoutMs = 2_000,
): Promise<{ name: string; loc: Locator } | null> {
  for (const candidate of candidates) {
    try {
      const first = candidate.loc.first();
      await first.waitFor({ state: 'visible', timeout: timeoutMs });
      log.debug(`${label}: matched via "${candidate.name}"`);
      return { name: candidate.name, loc: first };
    } catch {
      // try next strategy
    }
  }
  log.debug(`${label}: no strategy matched`);
  return null;
}

// ─── Login ───────────────────────────────────────────────────────────────

export function emailInput(page: Page): Array<{ name: string; loc: Locator }> {
  return [
    { name: 'role=textbox name=/email|user/i', loc: page.getByRole('textbox', { name: /email|user(name)?/i }) },
    { name: 'label=/email|user/i', loc: page.getByLabel(/email|user(name)?/i) },
    { name: 'placeholder=/email|user/i', loc: page.getByPlaceholder(/email|user(name)?/i) },
    { name: 'input[type=email]', loc: page.locator('input[type="email"]') },
    { name: 'input[name*=email i]', loc: page.locator('input[name*="email" i], input[name*="user" i]') },
  ];
}

export function passwordInput(page: Page): Array<{ name: string; loc: Locator }> {
  return [
    { name: 'role=textbox name=/password/i', loc: page.getByRole('textbox', { name: /password/i }) },
    { name: 'label=/password/i', loc: page.getByLabel(/password/i) },
    { name: 'placeholder=/password/i', loc: page.getByPlaceholder(/password/i) },
    { name: 'input[type=password]', loc: page.locator('input[type="password"]') },
  ];
}

export function submitButton(page: Page): Array<{ name: string; loc: Locator }> {
  return [
    { name: 'role=button name=/sign in|log ?in|continue/i', loc: page.getByRole('button', { name: /sign\s*in|log\s*in|continue|submit/i }) },
    { name: 'text=/sign in|login/i', loc: page.getByText(/^(sign\s*in|log\s*in|continue|submit)$/i) },
    { name: 'button[type=submit]', loc: page.locator('button[type="submit"]') },
  ];
}

/**
 * Heuristics that something surprising is in the login path (SSO bounce,
 * second-factor challenge, etc.). We fail loudly rather than guessing.
 */
export function twoFactorOrSsoSignals(page: Page): Locator {
  return page
    .getByText(/(two[-\s]?factor|2fa|verification code|one[-\s]?time|authenticator|mfa|sso|single sign[-\s]?on|microsoft|okta|azure|google\s+sign)/i)
    .first();
}

// ─── Sidebar / navigation ────────────────────────────────────────────────

export function sidebarNavItem(page: Page, text: RegExp): Array<{ name: string; loc: Locator }> {
  return [
    { name: `role=link name=${text}`, loc: page.getByRole('link', { name: text }) },
    { name: `role=button name=${text}`, loc: page.getByRole('button', { name: text }) },
    { name: `role=menuitem name=${text}`, loc: page.getByRole('menuitem', { name: text }) },
    { name: `nav >> getByText(${text})`, loc: page.locator('nav, [role="navigation"], aside').getByText(text) },
    { name: `getByText(${text})`, loc: page.getByText(text) },
  ];
}

// ─── DQR page ────────────────────────────────────────────────────────────

export function dataPointsHeading(page: Page): Array<{ name: string; loc: Locator }> {
  return [
    { name: 'role=heading name=/data points/i', loc: page.getByRole('heading', { name: /data points/i }) },
    { name: 'text=/data points \\(\\d+ total\\)/i', loc: page.getByText(/data points\s*\(\d+\s*total\)/i) },
    { name: 'text=/data points/i', loc: page.getByText(/^\s*data points\s*$/i) },
  ];
}

export function saveProgressButton(page: Page): Array<{ name: string; loc: Locator }> {
  return [
    { name: 'role=button name=/save progress/i', loc: page.getByRole('button', { name: /save\s+progress/i }) },
    { name: 'text=Save Progress', loc: page.getByText(/^\s*save\s+progress\s*$/i) },
  ];
}

/**
 * Category rows that can be expanded/collapsed. These are the section headers
 * like "Product Details", "Production Site Details", "Products Manufactured".
 * We look for rows with an aria-expanded toggle or a chevron icon.
 */
export function collapsedCategoryToggles(page: Page): Locator {
  return page
    .locator('[aria-expanded="false"]')
    .filter({ hasNotText: /save progress/i });
}

/**
 * Every card has a "N/5 DQIs" counter. We locate the counter text, then
 * walk up to the clickable card container. Returns a Locator that may
 * resolve to all DQR cards at once (use .all() / .nth()).
 *
 * Strategy: find the text node "N/5 DQIs", climb to the nearest ancestor
 * that is interactive (button, role=button, tabindex, onclick) OR the
 * nearest <div> that also contains status text ("Pending" / "Completed").
 */
export function cardContainers(page: Page): Locator {
  return page.locator(
    [
      // Preferred: the counter text's nearest interactive ancestor.
      'xpath=//*[matches(normalize-space(.), "^\\d+/5 DQIs$", "i")]/ancestor::*[self::button or @role="button" or @tabindex="0" or @onclick][1]',
      // Fallback: a div that contains both the counter and a status badge.
      'xpath=//div[.//*[matches(normalize-space(.), "^\\d+/5 DQIs$", "i")]][.//*[matches(normalize-space(.), "^(Pending|Completed|In Progress)$", "i")]]',
    ].join(' | '),
  );
}

/**
 * Non-xpath fallback for engines where xpath `matches()` is unavailable.
 * Playwright supports `text=/regex/` and `:has()` pseudo — we combine them.
 */
export function cardContainersCssFallback(page: Page): Locator {
  return page.locator(
    'div:has(> *:text-matches("\\\\d+/5 DQIs", "i")):has(*:text-matches("^(Pending|Completed|In Progress)$", "i"))',
  );
}

export function dqiCounterText(card: Locator): Locator {
  return card.getByText(/\d+\/5\s*DQIs/i).first();
}

export function pendingBadge(card: Locator): Locator {
  return card.getByText(/^\s*pending\s*$/i).first();
}

// ─── Side panel ──────────────────────────────────────────────────────────

export function openPanel(page: Page, title: string): Array<{ name: string; loc: Locator }> {
  const titleRx = new RegExp(`^\\s*${escapeRegex(title)}\\s*$`, 'i');
  return [
    { name: `role=dialog hasText=${title}`, loc: page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: titleRx }) }) },
    { name: `role=dialog name=${title}`, loc: page.getByRole('dialog', { name: titleRx }) },
    { name: `[role=dialog] hasText=${title}`, loc: page.locator('[role="dialog"], [aria-modal="true"]').filter({ hasText: titleRx }) },
    { name: 'last visible dialog', loc: page.locator('[role="dialog"], [aria-modal="true"]') },
  ];
}

export function panelCloseButton(panel: Locator): Array<{ name: string; loc: Locator }> {
  return [
    { name: 'role=button name=/close/i', loc: panel.getByRole('button', { name: /close|dismiss/i }) },
    { name: 'aria-label=/close/i', loc: panel.locator('[aria-label*="close" i]') },
    { name: 'button with X icon', loc: panel.locator('button:has(svg)').filter({ hasText: /^\s*[x✕×]?\s*$/ }).last() },
    { name: 'last button in panel header', loc: panel.locator('header button, [class*="header" i] button').last() },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeFilename(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'unnamed';
}
