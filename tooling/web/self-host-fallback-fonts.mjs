#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// self-host-fallback-fonts.mjs — a Flutter web bundle's text fallback fonts come
// from the app's OWN origin, byte-pinned, or the deploy stops.
//
// ⏱ 2026-09-12 (W5, REVIEW-stores-2026-09-10 #11). Until this existed every
// visitor's browser fetched CanvasKit from www.gstatic.com and Roboto plus the
// Noto fallback set from fonts.gstatic.com — measured in the live main.dart.js
// and registered as provider row `google-gstatic`. Two engine settings decide
// those hosts, and they are separate:
//   · CanvasKit — `flutter build web --no-web-resources-cdn` compiles
//     `useLocalCanvasKit` in, so the engine loads `canvaskit/` from the bundle.
//   · Fonts — `FlutterConfiguration.fontFallbackBaseUrl`, a RUNTIME setting that
//     defaults to `https://fonts.gstatic.com/s/` whatever the build flag says.
//     apps/<id>/web/flutter_bootstrap.js passes `fallback-fonts/`, and THIS script
//     puts the files there.
//
// WHAT IT DOES, on a finished `build/web`:
//   1. Reads the engine's fallback list OUT OF THE BUNDLE (main.dart.js), so the
//      set is always the one this Flutter version will ask for — never a copy.
//   2. Refuses a bundle whose bootstrap does not pass `fallback-fonts/`, whose
//      build config lacks `useLocalCanvasKit: true`, or whose main.dart.js still
//      carries the CanvasKit CDN default (the build flag was dropped).
//   3. Fetches every file, checks size and sha256 against fallback-fonts.lock.json,
//      and only then writes it under build/web/fallback-fonts/<engine path>.
//      A path the lock does not hold (a Flutter upgrade rolled the list) is a
//      failure naming the paths; regenerate with --write-lock.
//
// ⚠️ WHY A MISSING FILE MUST FAIL HERE AND NOT LATER: the apex router answers an
// unknown app path with the SPA shell (HTTP 200, text/html), so a font that was
// never deployed does not 404 in production — the engine gets HTML, cannot
// decode it, and draws empty boxes. Nothing else would notice.
//
// Usage:
//   node tooling/web/self-host-fallback-fonts.mjs <build/web dir> [--lock <file>] [--source <dir>]
//   node tooling/web/self-host-fallback-fonts.mjs --write-lock <build/web dir> [--source <dir>] > tooling/web/fallback-fonts.lock.json
// `--source <dir>` reads the files from a local directory laid out like the
// upstream `/s/` tree instead of fetching them (tests; an offline mirror).
// Exit 0 = every fallback font is in the bundle and matches the lock.
// Exit 1 = a defect (named). Exit 2 = COVERAGE LOST (the bundle could not be read
// the way this script expects, so it cannot say anything about it).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
// writeFileSync is used ONCE, for font bytes fetched from UPSTREAM — and only after their size and sha256
// matched the committed lock. That write is this script's purpose (CodeQL js/http-to-file-access, by design).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FALLBACK_DIR = 'fallback-fonts';
export const FONT_FALLBACK_BASE_URL = `${FALLBACK_DIR}/`;
export const UPSTREAM = 'https://fonts.gstatic.com/s/';
/** The engine's CanvasKit CDN default, compared as a parsed URL (host + path prefix), never as a substring. */
export const CANVASKIT_CDN = { hostname: 'www.gstatic.com', pathPrefix: '/flutter-canvaskit/' };
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LOCK = join(HERE, 'fallback-fonts.lock.json');

/** `<family>/v<n>/<file>.<ext>` exactly as the engine writes it — no `/` inside a
 *  segment and no leading dot, so a path can never climb out of FALLBACK_DIR. */
export const FONT_PATH = /^[a-z0-9]+\/v\d+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:woff2|ttf|otf)$/;
const QUOTED_FONT_PATH = /["']([a-z0-9]+\/v\d+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:woff2|ttf|otf))["']/g;

/** Every engine fallback font path the compiled bundle names, sorted, unique. */
export function extractFallbackPaths(mainJs) {
  const out = new Set();
  for (const m of mainJs.matchAll(QUOTED_FONT_PATH)) out.add(m[1]);
  return [...out].sort();
}

/** What the built flutter_bootstrap.js tells the engine. */
export function inspectBootstrap(text) {
  const base = text.match(/fontFallbackBaseUrl\s*:\s*(["'])([^"']*)\1/);
  return {
    useLocalCanvasKit: /["']?useLocalCanvasKit["']?\s*:\s*true/.test(text),
    fontFallbackBaseUrl: base ? base[2] : null,
  };
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every double- or single-quoted absolute https URL literal in `text`, parsed. Unparseable ones are skipped. */
export function httpsLiterals(text) {
  const out = [];
  for (const m of text.matchAll(/["'](https:\/\/[^"'\s]+)["']/g)) {
    try {
      out.push(new URL(m[1]));
    } catch {
      /* not a URL after all */
    }
  }
  return out;
}

/** True when the compiled bundle still carries the CanvasKit CDN default (the build flag was dropped). */
export function carriesCanvasKitCdnDefault(mainJs) {
  return httpsLiterals(mainJs).some((u) => u.hostname === CANVASKIT_CDN.hostname && u.pathname.startsWith(CANVASKIT_CDN.pathPrefix));
}

async function readUpstream(path, source) {
  if (source) {
    const abs = join(source, path);
    if (!existsSync(abs)) throw new Error(`not in --source: ${abs}`);
    return readFileSync(abs);
  }
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(UPSTREAM + path, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${UPSTREAM}${path}: ${last?.message ?? last}`);
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** Pure grading of a build directory before anything is fetched. */
export function gradeBuild(buildDir, lock) {
  const problems = [];
  const lost = [];
  const mainPath = join(buildDir, 'main.dart.js');
  const bootPath = join(buildDir, 'flutter_bootstrap.js');
  if (!existsSync(mainPath) || !existsSync(bootPath)) {
    lost.push(`${buildDir} has no main.dart.js or no flutter_bootstrap.js — this is not a finished Flutter web build.`);
    return { problems, lost, paths: [] };
  }
  const mainJs = readFileSync(mainPath, 'utf8');
  const paths = extractFallbackPaths(mainJs);
  if (paths.length === 0) {
    lost.push('main.dart.js names ZERO fallback font paths. The engine changed how it stores the list, so this script would copy nothing and print ok.');
  } else if (!paths.some((p) => p.startsWith('roboto/'))) {
    lost.push(`main.dart.js names ${paths.length} fallback path(s) and none is Roboto, the one font the engine loads on EVERY boot. The extraction is no longer reading the engine's list.`);
  }
  const boot = inspectBootstrap(readFileSync(bootPath, 'utf8'));
  if (boot.fontFallbackBaseUrl !== FONT_FALLBACK_BASE_URL) {
    problems.push(
      `flutter_bootstrap.js passes fontFallbackBaseUrl ${JSON.stringify(boot.fontFallbackBaseUrl)}, not ${JSON.stringify(FONT_FALLBACK_BASE_URL)}. ` +
        `Without it the engine fetches every fallback font from ${UPSTREAM}. apps/<id>/web/flutter_bootstrap.js must call ` +
        `_flutter.loader.load({config: {fontFallbackBaseUrl: "${FONT_FALLBACK_BASE_URL}"}}).`,
    );
  }
  if (!boot.useLocalCanvasKit) {
    problems.push('the build config in flutter_bootstrap.js does not set useLocalCanvasKit: true — the build was not given --no-web-resources-cdn, so CanvasKit loads from www.gstatic.com.');
  }
  if (carriesCanvasKitCdnDefault(mainJs)) {
    problems.push(`main.dart.js still carries the CanvasKit CDN default https://${CANVASKIT_CDN.hostname}${CANVASKIT_CDN.pathPrefix}… — the build was not given --no-web-resources-cdn.`);
  }
  if (!existsSync(join(buildDir, 'canvaskit', 'canvaskit.wasm'))) {
    problems.push('build/web/canvaskit/canvaskit.wasm is missing, so a local CanvasKit cannot load.');
  }
  if (lock) {
    const missing = paths.filter((p) => !lock.files?.[p]);
    if (missing.length) {
      problems.push(
        `${missing.length} fallback font path(s) in this bundle are not in the lock (a Flutter upgrade rolled the list): ` +
          `${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}. Regenerate with --write-lock and review the diff.`,
      );
    }
  }
  return { problems, lost, paths };
}

function readLock(lockPath) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (e) {
    return { lost: `the lock ${lockPath} could not be read (${e.message}).` };
  }
  const files = lock?.files;
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
    return { lost: `the lock ${lockPath} holds no files.` };
  }
  for (const [p, v] of Object.entries(files)) {
    if (!FONT_PATH.test(p) || !/^[0-9a-f]{64}$/.test(v?.sha256 ?? '') || !(Number.isInteger(v?.bytes) && v.bytes > 0)) {
      return { lost: `the lock entry ${JSON.stringify(p)} is malformed (path shape, sha256 or bytes).` };
    }
  }
  return { lock };
}

function parseArgs(argv) {
  const args = { writeLock: false, dir: null, lock: DEFAULT_LOCK, source: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write-lock') args.writeLock = true;
    else if (a === '--lock') args.lock = resolve(argv[++i]);
    else if (a === '--source') args.source = resolve(argv[++i]);
    else if (!args.dir) args.dir = resolve(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error('usage: self-host-fallback-fonts.mjs [--write-lock] <build/web dir> [--lock <file>] [--source <dir>]');
    process.exit(2);
  }
  const lostExit = (msgs) => {
    console.error('✗ COVERAGE LOST — self-host-fallback-fonts could not read the bundle it was pointed at:');
    for (const m of msgs) console.error(`    ${m}`);
    process.exit(2);
  };

  if (args.writeLock) {
    const { lost, paths } = gradeBuild(args.dir, null);
    if (lost.length) lostExit(lost);
    const files = {};
    let bytes = 0;
    await pool(paths, 12, async (p) => {
      const buf = await readUpstream(p, args.source);
      files[p] = { sha256: sha256(buf), bytes: buf.length };
      bytes += buf.length;
    });
    const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
    const lock = {
      _readme: [
        'GENERATED by tooling/web/self-host-fallback-fonts.mjs --write-lock from a built main.dart.js. Do not edit by hand.',
        'Each key is a path in the Flutter engine\'s text fallback list, exactly as the engine appends it to fontFallbackBaseUrl;',
        `each value pins the bytes fetched from ${UPSTREAM}<path>. deploy-web.yml copies every file into build/web/${FALLBACK_DIR}/`,
        'and refuses a byte that differs. Regenerate only when a Flutter upgrade changes the list, and review the diff.',
      ],
      upstream: UPSTREAM,
      count: Object.keys(sorted).length,
      bytes,
      files: sorted,
    };
    // Printed, not written: the maintainer redirects it into the lock and reviews the diff.
    process.stdout.write(`${JSON.stringify(lock, null, 2)}\n`);
    console.error(`ok  lock printed: ${lock.count} font(s), ${bytes} bytes`);
    return;
  }

  const { lock, lost: lockLost } = readLock(args.lock);
  if (lockLost) lostExit([lockLost]);
  const { problems, lost, paths } = gradeBuild(args.dir, lock);
  if (lost.length) lostExit(lost);
  if (problems.length) {
    console.error(`✗ self-host-fallback-fonts — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }

  const failures = [];
  let bytes = 0;
  await pool(paths, 12, async (p) => {
    const want = lock.files[p];
    const dest = join(args.dir, FALLBACK_DIR, p);
    try {
      const buf = await readUpstream(p, args.source);
      const got = sha256(buf);
      if (buf.length !== want.bytes || got !== want.sha256) {
        failures.push(`${p}: fetched ${buf.length} bytes sha256 ${got}; the lock pins ${want.bytes} bytes sha256 ${want.sha256}`);
        return;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      bytes += buf.length;
    } catch (e) {
      failures.push(`${p}: ${e.message}`);
    }
  });
  if (failures.length) {
    console.error(`✗ self-host-fallback-fonts — ${failures.length} of ${paths.length} font(s) not placed:`);
    for (const f of failures.slice(0, 20)) console.error(`    ${f}`);
    console.error('  Nothing is deployed with a missing or altered fallback font: the router would answer that path with HTML.');
    process.exit(1);
  }
  const stale = Object.keys(lock.files).filter((p) => !paths.includes(p)).length;
  console.log(`ok  ${paths.length} fallback font(s), ${bytes} bytes, placed under ${FALLBACK_DIR}/ and matched to the lock`);
  console.log(`ok  flutter_bootstrap.js passes fontFallbackBaseUrl "${FONT_FALLBACK_BASE_URL}" and useLocalCanvasKit: true; main.dart.js has no CanvasKit CDN default`);
  if (stale) console.log(`--  ${stale} lock entr(y/ies) not named by this bundle (an older engine list); harmless, dropped at the next --write-lock`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
