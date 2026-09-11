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
// A call node makes INSIDE a spied call is part of that call and is not recorded:
// readFileSync(p) with no encoding and writeFileSync(p, buffer) open p through
// fs.openSync themselves, and that open is not a second look at p.
//
// Env (both required — a spy with no subject would report a clean nothing):
//   FS_SPY_OUT    file the verdict is written to when the process exits
//   FS_SPY_UNDER  absolute directory; only paths under it are recorded
// Verdict JSON: { recorded, uses: [path…], pairs: [{ path, check, use }…], flagged: [same shape] }
//   pairs    every check that preceded a use of the same path
//   flagged  the subset CodeQL's js/file-system-race reports: everything EXCEPT
//            existsSync followed by a READ — readFileSync, or openSync with a read-only
//            flag — which the query does not flag (a vanished file makes that read
//            throw; it cannot act on stale state). Opens are recorded as openSync:r / openSync:w.
//   Every pair also carries sameFunction: true when the check and the use were made from the
//   same function in the same file (the calling frame, read from the stack). A guard whose
//   separate limbs later read, by path, a file its scan already opened makes cross-function
//   pairs; those are not one decision acted on twice, and a test may exclude them.
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

const checked = new Map(); // path -> Map(site -> first op that site used to look at it)

/** "<function>@<file>" of the first stack frame outside this preload and outside node itself. */
function siteOf() {
  const frames = String(new Error().stack).split('\n').slice(1);
  for (const raw of frames) {
    const line = raw.trim().replace(/^at (?:async )?/, '');
    if (line.includes('fs-spy-preload.mjs') || line.startsWith('node:') || line.includes('(node:')) continue;
    const m = /^(.*?) \((.*):\d+:\d+\)$/.exec(line);
    return m ? m[1] + '@' + m[2] : '<top>@' + line.replace(/:\d+:\d+$/, '');
  }
  return '?';
}
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
  const site = siteOf();
  let sites = checked.get(k);
  if (!sites) checked.set(k, (sites = new Map()));
  if (!sites.has(site)) sites.set(site, op);
};
const noteUse = (k, op) => {
  recorded++;
  uses.add(k);
  const sites = checked.get(k);
  if (sites) {
    // Paired with a look from this use's OWN function when there is one: a helper that looked
    // first (a directory walk) must not hide the function that then looks and acts itself.
    const site = siteOf();
    if (sites.has(site)) pairs.push({ path: k, check: sites.get(site), use: op, sameFunction: true });
    else pairs.push({ path: k, check: sites.values().next().value, use: op, sameFunction: false });
  }
};

// Depth of spied calls in progress. Only depth-0 calls are the script's own; see the header.
let depth = 0;
const inner = (self, real, args) => {
  depth++;
  try {
    return real.apply(self, args);
  } finally {
    depth--;
  }
};

for (const op of ['existsSync', 'statSync', 'lstatSync', 'accessSync']) {
  const real = fs[op];
  fs[op] = function spiedCheck(...args) {
    const k = keyOf(args[0]);
    if (k !== null && depth === 0) noteCheck(k, op);
    return inner(this, real, args);
  };
}
for (const op of ['readFileSync', 'writeFileSync', 'appendFileSync']) {
  const real = fs[op];
  fs[op] = function spiedUse(...args) {
    const k = keyOf(args[0]);
    if (k !== null && depth === 0) noteUse(k, op);
    return inner(this, real, args);
  };
}
{
  const real = fs.openSync;
  fs.openSync = function spiedOpen(...args) {
    const k = keyOf(args[0]);
    if (k !== null && depth === 0) {
      // A read-only open READS what an earlier existence check saw, exactly as readFileSync
      // does; any other flag can create or truncate the file, so it is recorded as a write.
      const f = args[1];
      const readOnly = f === undefined || f === null || f === 0 || (typeof f === 'string' && /^(?:r|rs|sr)$/.test(f));
      noteUse(k, readOnly ? 'openSync:r' : 'openSync:w'); // an open is a use of what an earlier check saw …
      noteCheck(k, 'openSync'); // … and a look that a later use by PATH would act on
    }
    return inner(this, real, args);
  };
}
// Named ESM imports (`import { readFileSync } from 'node:fs'`) are live bindings
// to the builtin's exports; this makes them see the wrappers too.
syncBuiltinESMExports();

process.on('exit', () => {
  const flagged = pairs.filter((x) => !(x.check === 'existsSync' && (x.use === 'readFileSync' || x.use === 'openSync:r')));
  writeVerdict(OUT, JSON.stringify({ recorded, uses: [...uses], pairs, flagged }));
});
