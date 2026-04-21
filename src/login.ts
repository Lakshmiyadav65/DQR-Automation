import type { Page } from '@playwright/test';
import { log } from './logger.js';
import {
  emailInput,
  passwordInput,
  submitButton,
  twoFactorOrSsoSignals,
  firstVisible,
} from './selectors.js';

export class LoginError extends Error {}
export class TwoFactorRequiredError extends LoginError {}

export interface LoginParams {
  url: string;
  user: string;
  pass: string;
}

export async function login(page: Page, { url, user, pass }: LoginParams): Promise<void> {
  log.info(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const emailMatch = await firstVisible(emailInput(page), 'emailInput', 5_000);
  if (!emailMatch) {
    throw new LoginError(
      'Could not find an email/username input on the login page. ' +
        'Run `npx playwright codegen <DQR_URL>` and update selectors.ts → emailInput.',
    );
  }
  await emailMatch.loc.fill(user);

  const passwordMatch = await firstVisible(passwordInput(page), 'passwordInput', 3_000);
  if (!passwordMatch) {
    throw new LoginError(
      'Could not find a password input on the login page. ' +
        'If the app uses an external SSO provider, this automation does not support it. ' +
        'Otherwise, update selectors.ts → passwordInput.',
    );
  }
  await passwordMatch.loc.fill(pass);

  const submitMatch = await firstVisible(submitButton(page), 'submitButton', 3_000);
  if (!submitMatch) {
    throw new LoginError('Could not find a submit button. Update selectors.ts → submitButton.');
  }

  log.info('Submitting credentials');
  const urlBefore = page.url();
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    submitMatch.loc.click(),
  ]);

  // Brief wait for any redirect/client-side navigation.
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Detect 2FA / SSO handoffs so we fail with a clear message.
  const twoFaVisible = await twoFactorOrSsoSignals(page)
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
  if (twoFaVisible) {
    const sample = await twoFactorOrSsoSignals(page)
      .innerText()
      .catch(() => '(unreadable)');
    throw new TwoFactorRequiredError(
      `The login flow appears to require an extra step (2FA/SSO). ` +
        `Page shows: "${sample.slice(0, 120)}". ` +
        `This automation only supports plain username+password login.`,
    );
  }

  // Confirm we're past login: either the URL changed, or the password field vanished.
  const urlChanged = page.url() !== urlBefore;
  const pwStillVisible = await page
    .locator('input[type="password"]')
    .first()
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  if (!urlChanged && pwStillVisible) {
    const errorBanner = await page
      .getByText(/(invalid|incorrect|failed|wrong|unauthor)/i)
      .first()
      .innerText({ timeout: 1_000 })
      .catch(() => '');
    throw new LoginError(
      `Login did not advance past the sign-in page. ${
        errorBanner ? `App message: "${errorBanner}". ` : ''
      }Check credentials in .env.`,
    );
  }

  log.ok(`Logged in (now at ${page.url()})`);
}
