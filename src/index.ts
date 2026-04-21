import 'dotenv/config';
import { chromium } from '@playwright/test';
import * as path from 'node:path';
import { log } from './logger.js';
import { login, LoginError, TwoFactorRequiredError } from './login.js';
import { runDqr, type RunSummary } from './dqr-runner.js';

interface Args {
  headed: boolean;
  dryRun: boolean;
  only?: string;
  skipSave: boolean;
  slowMo: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    headed: false,
    dryRun: false,
    skipSave: false,
    slowMo: 0,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--headed':
        args.headed = true;
        break;
      case '--headless':
        args.headed = false;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--skip-save':
        args.skipSave = true;
        break;
      case '--only': {
        const v = argv[++i];
        if (!v) throw new Error('--only requires a card name argument');
        args.only = v;
        break;
      }
      case '--slow-mo': {
        const v = argv[++i];
        if (!v) throw new Error('--slow-mo requires a number (ms)');
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(`--slow-mo must be a non-negative number, got "${v}"`);
        args.slowMo = n;
        break;
      }
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
DQR Automation

Usage:
  npm run dqr -- [options]

Options:
  --headed            Run with a visible browser window (default: headless)
  --headless          Force headless (default)
  --dry-run           Open each panel and log what it WOULD fill; make no changes
  --only "<name>"     Only process the card whose title matches <name> exactly
  --skip-save         Fill everything but do not click "Save Progress"
  --slow-mo <ms>      Pause <ms> between Playwright actions (useful with --headed)
  -h, --help          Show this help

Environment (.env):
  DQR_URL             Login URL
  DQR_USER            Email or username
  DQR_PASS            Password
`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name}. Copy .env.example → .env and fill it in.`);
  }
  return v;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let url: string, user: string, pass: string;
  try {
    url = requireEnv('DQR_URL');
    user = requireEnv('DQR_USER');
    pass = requireEnv('DQR_PASS');
  } catch (e) {
    log.err((e as Error).message);
    process.exit(2);
  }

  log.banner(`DQR Automation  (headed=${args.headed}, dry-run=${args.dryRun}, skip-save=${args.skipSave})`);

  const browser = await chromium.launch({
    headless: !args.headed,
    slowMo: args.slowMo,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(45_000);

  const page = await context.newPage();

  let summary: RunSummary | null = null;
  let exitCode = 0;
  try {
    await login(page, { url, user, pass });
    summary = await runDqr(page, {
      dryRun: args.dryRun,
      only: args.only,
      skipSave: args.skipSave,
      artifactsDir: path.resolve(process.cwd(), 'artifacts'),
      maxCardAttempts: 3,
    });
  } catch (e) {
    const err = e as Error;
    if (err instanceof TwoFactorRequiredError) {
      log.err(err.message);
      exitCode = 2;
    } else if (err instanceof LoginError) {
      log.err(`Login failed: ${err.message}`);
      exitCode = 2;
    } else {
      log.err(`Fatal: ${err.message}`);
      if (err.stack) log.debug(err.stack);
      exitCode = 1;
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (summary) {
    log.banner('Run summary');
    log.info(`Total:     ${summary.total}`);
    log.info(`Succeeded: ${summary.succeeded}`);
    log.info(`Failed:    ${summary.failed.length}`);
    for (const f of summary.failed) log.warn(`  - ${f.card}: ${f.reason}`);
    log.info(`Saved:     ${summary.saved === null ? 'n/a' : summary.saved ? 'yes' : 'unclear'}`);
    log.info(`Duration:  ${summary.durationSec}s`);
    if (summary.failed.length > 0) exitCode = Math.max(exitCode, 1);
  }

  process.exit(exitCode);
}

main().catch((e) => {
  log.err((e as Error).message);
  process.exit(1);
});
