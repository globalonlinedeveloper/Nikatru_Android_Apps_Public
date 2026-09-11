// ─────────────────────────────────────────────────────────────────────────────
// fs-spy-preload.mjs — TEST-ONLY. Loaded with `node --import <this file> <script>`.
//
// Records, per path, whether a file was CHECKED before it was USED — the runtime
// shape of CodeQL's js/file-system-race: a decision taken on one look at a path
// and acted on at a second look, between which the file can change.
//
//   CHECK  existsSync · statSync · lstatSync · accessSync · openSync(path)
//   USE    readFileSync(path) · writeFileSync(path) · appendFileSync(path) · openSync(path)
//
// A descriptor is not a path: `openSync(p)` then `fstatSync(fd)` and
// `readFileSync(fd)` records ONE use of p and no pair, which is the fixed shape.
//
// Env (both required — a spy with no subject would report a clean nothing):
//   FS_SPY_OUT    file the verdict is written to when the process exits
//   FS_SPY_UNDER  absolute directory; only paths under it are recorded
// Verdict JSON: { recorded, uses: [path…], pairs: [{ path, check, use }…], flagged: [same shape] }
//   pairs    every check that preceded a use of the same path
//   flagged  the subset CodeQL's js/file-system-race reports: everything EXCEPT
//            existsSync followed by readFileSync, which the query does not flag
//            (a vanished file makes that read throw; it cannot act on stale state)
// Paths are absolute with forward slashes (lower-cased on Windows).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env.FS_SPY_OUT;
const UNDER = process.env.FS_SPY_UNDER;
if (!OUT || !UNDER) throw new Error('fs-spy-preload: FS_SPY_OUT and FS_SPY_UNDER are both required');

const writeVerdict = fs.writeFileSync; // captured BEFORE the wrappers below replace it
const norm = (p) => {
  const s = resolve(p).split(sep).join('/');
  return process.platform === 'win32' ? s.toLowerCase() : s;
};
const under = `${norm(UNDER).replace(/\/+$/, '')}/`;

const checked = new Map(); // path -> the first check op that looked at it
const uses = new Set();
const pairs = [];
let recorded = 0;

const keyOf = (arg) => {
  let p = null;
  if (typeof arg === 'string') p = arg;
  else if (arg instanceof URL) p = fileURLToPath(arg);
  else if (Buffer.isBuffer(arg)) p = arg.toString();
  if (p === null) return null; // a descriptor, or no path at all
  const k = norm(p);
  return k.startsWith(under) ? k : null;
};
const noteCheck = (k, op) => {
  recorded++;
  if (!checked.has(k)) checked.set(k, op);
};
const noteUse = (k, op) => {
  recorded++;
  uses.add(k);
  const c = checked.get(k);
  if (c) pairs.push({ path: k, check: c, use: op });
};

for (const op of ['existsSync', 'statSync', 'lstatSync', 'accessSync']) {
  const real = fs[op];
  fs[op] = function spiedCheck(...args) {
    const k = keyOf(args[0]);
    if (k !== null) noteCheck(k, op);
    return real.apply(this, args);
  };
}
for (const op of ['readFileSync', 'writeFileSync', 'appendFileSync']) {
  const real = fs[op];
  fs[op] = function spiedUse(...args) {
    const k = keyOf(args[0]);
    if (k !== null) noteUse(k, op);
    return real.apply(this, args);
  };
}
{
  const real = fs.openSync;
  fs.openSync = function spiedOpen(...args) {
    const k = keyOf(args[0]);
    if (k !== null) {
      noteUse(k, 'openSync'); // an open is a use of what an earlier check saw …
      noteCheck(k, 'openSync'); // … and a look that a later use by PATH would act on
    }
    return real.apply(this, args);
  };
}
// Named ESM imports (`import { readFileSync } from 'node:fs'`) are live bindings
// to the builtin's exports; this makes them see the wrappers too.
syncBuiltinESMExports();

process.on('exit', () => {
  const flagged = pairs.filter((x) => !(x.check === 'existsSync' && x.use === 'readFileSync'));
  writeVerdict(OUT, JSON.stringify({ recorded, uses: [...uses], pairs, flagged }));
});
