const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code: string, s: string) => (supportsColor ? `${code}${s}${C.reset}` : s);

function ts(): string {
  const d = new Date();
  return d.toISOString().split('T')[1]!.split('.')[0]!;
}

function prefix(tag: string, color: string): string {
  return `${paint(C.gray, `[${ts()}]`)} ${paint(color, tag)}`;
}

export const log = {
  info: (msg: string) => console.log(`${prefix('[INFO]', C.blue)} ${msg}`),
  ok: (msg: string) => console.log(`${prefix('[ OK ]', C.green)} ${msg}`),
  warn: (msg: string) => console.log(`${prefix('[WARN]', C.yellow)} ${msg}`),
  err: (msg: string) => console.log(`${prefix('[ERR ]', C.red)} ${msg}`),
  step: (i: number, total: number, msg: string) =>
    console.log(
      `${prefix('[STEP]', C.cyan)} ${paint(C.bold, `[${i}/${total}]`)} ${msg}`,
    ),
  debug: (msg: string) => {
    if (process.env.DEBUG) console.log(`${prefix('[DBG ]', C.gray)} ${paint(C.dim, msg)}`);
  },
  banner: (msg: string) => console.log(`\n${paint(C.bold + C.cyan, '== ' + msg + ' ==')}\n`),
};

export type Logger = typeof log;
