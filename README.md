# DQR Automation

Playwright (TypeScript) automation that completes every card in the **Data Quality Rating** flow of the EnviGuide Management Suite and then clicks **Save Progress**.

The automation has **no knowledge of the app's source code** — it works purely from the rendered DOM, using resilient selectors (role → label → text → testid → CSS) with fallback chains. When the UI changes, selectors can be updated in one place: [src/selectors.ts](src/selectors.ts).

---

## Requirements

- Node.js **20+**
- A live browser session to the EnviGuide app that accepts plain username + password login (SSO / 2FA flows are **not** supported — the script fails loudly if it detects one)

## Install

```bash
npm install
npx playwright install chromium
```

## Configure

```bash
cp .env.example .env
```

Then edit `.env`:

```dotenv
DQR_URL=https://enviguide.nextechl.example.com/login
DQR_USER=you@company.com
DQR_PASS=your-password
```

`.env` is git-ignored — never commit it.

## Run

### Manual-login mode (use this if the app has MFA/SSO)

```bash
npm run dqr:manual
```

A visible Chromium window opens with a persistent profile. You do everything that involves judgment — sign in, complete MFA, navigate to **Data Quality Rating**. A big green **START AUTOMATION** button is injected at the bottom-right of every page. When you're on the DQR page and ready, click it — the automation takes over that tab and iterates every card.

The session (cookies, localStorage) is cached in `.playwright-user-data/` so on future `npm run dqr:manual` runs you usually won't need to MFA again until your session expires. Delete that folder any time for a clean profile.

### Automated-login mode (username + password only, no MFA)

```bash
# Headless, full run
npm run dqr

# Headed (visible browser) — easier to watch / debug
npm run dqr:headed

# Dry-run: open each panel, log what it WOULD fill, make no changes, don't save
npm run dqr:dry
```

### CLI flags

All flags can be passed after `--` to any npm script, e.g. `npm run dqr -- --only "PCF Methodology"`.

| Flag | Effect |
|------|--------|
| `--manual` | Skip scripted login; open a persistent browser and wait for you to sign in (incl. MFA) and navigate to the DQR page. Automation auto-starts on detection. |
| `--headed` | Show the browser window |
| `--headless` | Force headless (the default; ignored with `--manual`) |
| `--dry-run` | Open each panel and log what it would fill; make no actual changes; skip Save |
| `--only "<name>"` | Run on a single card whose title equals `<name>` (case-insensitive) |
| `--skip-save` | Fill every card but do NOT click Save Progress |
| `--slow-mo <ms>` | Pause that many ms between every Playwright action — nice with `--headed` |
| `-h`, `--help` | Print help |

### Examples

```bash
# Debug one card with a slow, visible browser
npm run dqr -- --headed --slow-mo 250 --only "PCF Methodology"

# Populate every card but don't save (so a human can review)
npm run dqr -- --headed --skip-save

# Verbose logs (per-field actions + which selector strategy matched)
DEBUG=1 npm run dqr -- --headed
```

## What it does

1. Navigates to `DQR_URL` and logs in by finding the email / password / submit controls **by role and label** — not by class name.
2. If it detects a 2FA prompt or an SSO bounce (Microsoft / Okta / Azure / Google / "verification code"), it aborts with a clear error.
3. Clicks the sidebar item **Data Quality Rating** and waits for the **Data Points** heading.
4. Expands all collapsed category sections, then scrolls the card list until the number of visible `N/5 DQIs` counters stops growing (so lazy-loaded cards finish loading).
5. For each discovered card, in DOM order:
   - Scrolls it into view, clicks to open the side panel
   - Waits for a `role="dialog"` whose heading matches the card's title
   - Fills every form control it finds inside the panel:
     - `<select>` → picks a random non-placeholder option
     - `role="combobox"`, `aria-haspopup="listbox"`, or any placeholder-text trigger → clicks to open, picks a random non-placeholder option from the popup (options may render in a portal at document root)
     - Text / email / url / tel / search → `"N/A"` (or a label-aware default, e.g. years → `2024`, percent → `100`)
     - Number → random int 1–100
     - Date → today
     - Radio group → random member
     - Checkbox → 50/50 check
   - Closes the panel via its X / close button (fallback: Escape)
   - Verifies the card's counter advanced to `5/5 DQIs` or the Pending badge disappeared. On failure, retries the card up to 3 times.
6. When all cards are processed, clicks **Save Progress** and waits for either a success toast/text OR a 2xx response on the save request.
7. Writes a summary to `artifacts/run-summary.json`:

```json
{
  "total": 60,
  "succeeded": 59,
  "failed": [{ "card": "Flywheel", "reason": "..." }],
  "durationSec": 184.21,
  "saved": true
}
```

## Failure artifacts

Every card that fails after all retries writes two files into `./artifacts/`:

- `<cardName>-<timestamp>.png` — full-page screenshot
- `<cardName>-<timestamp>.html` — `outerHTML` of the open panel at the moment of failure

Use these to diff the DOM against the selectors and update fallbacks.

## Project layout

```
src/
  index.ts         CLI entry + arg parsing
  login.ts         Login flow; fails loudly on 2FA/SSO
  dqr-runner.ts    Navigate → expand → scroll → iterate cards → save
  panel-filler.ts  Fills every control inside an open side panel
  selectors.ts     Centralized selector helpers with fallback chains
  logger.ts        Timestamped, color-coded console output
.env.example
package.json
playwright.config.ts
tsconfig.json
```

---

## When selectors break

The EnviGuide app uses utility CSS classes (Tailwind-ish) that change between releases. All CSS class selectors in this repo are behind `aria-*` / `role` / visible text fallbacks — so a class change should NOT break anything. But if the app restructures its DOM (e.g. renames the sidebar item, changes the dialog role, moves where the X close button lives), you'll need to update the selector helpers.

**Everything you need to change lives in [src/selectors.ts](src/selectors.ts).** Each helper returns a list of candidate strategies; the first visible one wins, and the name of the matching strategy is logged at `DEBUG=1`.

### Recording new selectors with codegen

Playwright ships a recorder that writes selectors for you. Point it at the live app:

```bash
npx playwright codegen "$DQR_URL"
```

A browser window opens; click around the app. The Inspector window shows generated selectors like `page.getByRole('textbox', { name: 'Email' })`. Copy the relevant ones and paste them as a new candidate in the right helper:

| If this breaks... | Update this helper |
|---|---|
| Login email field | [selectors.ts → `emailInput`](src/selectors.ts) |
| Login password field | [selectors.ts → `passwordInput`](src/selectors.ts) |
| Login submit button | [selectors.ts → `submitButton`](src/selectors.ts) |
| Sidebar link "Data Quality Rating" | [selectors.ts → `sidebarNavItem`](src/selectors.ts) |
| Page heading "Data Points" | [selectors.ts → `dataPointsHeading`](src/selectors.ts) |
| "Save Progress" button | [selectors.ts → `saveProgressButton`](src/selectors.ts) |
| Collapsible category toggles | [selectors.ts → `collapsedCategoryToggles`](src/selectors.ts) |
| DQR card containers | [selectors.ts → `cardContainers`](src/selectors.ts) and `cardContainersCssFallback` |
| DQI counter text / Pending badge | [selectors.ts → `dqiCounterText`, `pendingBadge`](src/selectors.ts) |
| Side panel dialog / heading match | [selectors.ts → `openPanel`](src/selectors.ts) |
| Panel's X / close button | [selectors.ts → `panelCloseButton`](src/selectors.ts) |

Each helper is a function returning an array of `{ name, loc }` candidates. Add a new entry at the TOP of the array (so it wins), run `DEBUG=1 npm run dqr:headed`, and confirm the log line reads `matched via "<your new strategy>"`.

### Troubleshooting

- **"Could not find an email/username input"** — the login page HTML changed. Update `emailInput`.
- **"The login flow appears to require an extra step (2FA/SSO)"** — this automation only handles plain password login. Get the user flagged for password-only auth, or expand `login.ts` to handle your specific IdP.
- **"No DQR cards found"** — the card container selector couldn't resolve. Open the app, inspect a card, and update `cardContainers` / `cardContainersCssFallback`.
- **"Side panel did not open (or its heading did not match the card title)"** — the dialog markup changed. Update `openPanel`. Tip: the fallback `last visible dialog` should still work for most refactors — if even that fails, the panel probably isn't being rendered with `role="dialog"`.
- **Card filled but still shows Pending** — there may be a form control the filler doesn't recognize yet. Run with `DEBUG=1` and look at the `fields=X filled=Y skipped=Z` summary — if `discovered` < the actual number of fields, extend `panel-filler.ts`.
- **"options popup did not appear"** — custom dropdowns render their listbox in a portal. The filler queries `[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]` — if the app uses a different library, add its portal container's selector to `fillCustomDropdowns` in `panel-filler.ts`.

### Typecheck

```bash
npm run typecheck
```
