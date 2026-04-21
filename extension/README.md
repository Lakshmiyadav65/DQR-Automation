# DQR Automation — Chrome Extension

A Chrome/Brave/Edge extension that fills every card on the EnviGuide **Data Quality Rating** page in one click. Runs inside your own browser session, so **MFA / SSO / cookies are never a problem** — you log in normally like always.

## Install (one-time, ~30 seconds)

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`)
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `extension` folder inside this repo
5. The DQR Automation icon appears in your toolbar (puzzle piece menu → pin it for easy access)

## Use

1. Open the EnviGuide app in any tab. Log in / complete MFA / navigate to **Data Quality Rating**. When you see all the cards, you're ready.
2. Click the **DQR Automation** extension icon in your toolbar.
3. A popup appears:
   - **Dry-run** — check this to see what the extension *would* fill without changing anything
   - **Skip "Save Progress"** — check to leave everything filled but not saved (human review)
   - **Only card** — optional: fill one card whose title matches exactly (case-insensitive)
4. Click **START**.
5. A dark progress overlay slides in at the top-right of the page showing live status:
   `[12/60] Gearbox` — progress bar — STOP button
6. The automation clicks every card, fills every dropdown/input/radio/checkbox, closes each panel, and finally clicks **Save Progress**.
7. When done, the overlay turns green and says "Done. Filled N/60 cards." Click **CLOSE** to dismiss.

You can click **STOP** any time — the run finishes the current card cleanly, then halts.

## What it fills

| Control | Value |
|---|---|
| Native `<select>` | Random non-placeholder option |
| Custom React dropdowns (`role=combobox`, `aria-haspopup=listbox`, or text-placeholder triggers) | Random non-placeholder option from the popup listbox |
| Text / email / url / tel / search inputs | `"N/A"` (or a label-aware default — years → `2024`, percent → `100`, email → `qa@example.com`, etc.) |
| Number input | Random integer 1–100 |
| Date / datetime / month / time | Today |
| Radio group | Random member |
| Checkbox | 50/50 flip |

Already-filled controls are skipped. The extension never overwrites a value you already set.

## Troubleshooting

### "Could not reach the page"
The content script only gets injected when the page matches `https://*.nextechltd.in/*`. If you installed the extension while the DQR page was already open, Chrome hasn't injected the script into that existing tab yet. Fix: press **Ctrl+R** to reload the page, then click START again.

### "No DQR cards found"
You're not on the DQR view. Click **Data Quality Rating** in the sidebar so the cards are visible on screen, then click START.

### Cards fill but still show "Pending"
There may be a required control the extension doesn't recognize. Open DevTools (F12) → Console tab before starting — the overlay's "Done" state logs each failing card with a reason. Grab the panel's HTML (right-click → Inspect → Copy outer HTML) and update the selectors in `content.js`.

### The overlay disappears
The EnviGuide app's React renderer probably wiped it — reload and try again. If it happens consistently, open `content.js` and change the overlay's `position: fixed` parent from `document.documentElement` to `document.body`, or add a `MutationObserver` guard like in the earlier Playwright version.

## Updating the extension

After editing any file in `extension/`:

1. Go to `chrome://extensions`
2. Click the reload icon (↻) on the DQR Automation card
3. Reload the DQR page (Ctrl+R) so the new content script runs

## Which URL patterns does it run on?

From `manifest.json`:
- `https://enviguide.nextechltd.in/*`
- `https://*.nextechltd.in/*`

Update `host_permissions` and `content_scripts.matches` in `manifest.json` if the app moves to a different domain.

## Files

```
extension/
  manifest.json     Manifest V3 declaration + URL matches
  popup.html        Popup UI
  popup.css         Popup styles
  popup.js          Handles START/STOP clicks, messages the content script
  content.js        Runs inside the page: discovery, panel filling, overlay
```

## When selectors break

The automation uses the same resilience strategy as the Playwright version (ARIA roles first, text content second, CSS classes never). If the EnviGuide app redesigns:

| If this breaks... | Edit this in `content.js` |
|---|---|
| Card discovery | `findCards()` — walks "N/5 DQIs" text nodes up to their clickable ancestor |
| Panel detection | `openCardPanel()` — queries `[role="dialog"]` / `[aria-modal="true"]` |
| Close button | `closePanel()` — tries `aria-label*="close"`, `×`, icon-only buttons |
| Custom dropdown popup | `fillCustomDropdowns()` — queries `[role="listbox"]`, Radix/Headless wrappers |
| Save Progress button | the `/save\s+progress/i` regex at the bottom of `runAutomation()` |

Each section is a small, self-contained function — pick the one that matches the failure and tweak the selectors.
