// ─────────────────────────────────────────────────────────────────────────────
// install-pinned-tool.mjs — THE ONE WAY ci.yml's security scanners are fetched:
// a BOUNDED RETRY over the download, and a CHECKSUM-VERIFIED CACHE in front of
// it, so that one bad second on the network cannot turn main red.
//
// 🔴 WHY THIS EXISTS. On 2026-09-12 the push run for 6be21b57 went red in
// "Security — secret and workflow scanners" on this line and nothing else:
//
//     wget -q -O "$tarball" https://github.com/gitleaks/gitleaks/releases/…
//     → exit 4 (network failure)
//
// gitleaks was never installed, the step failed, ci-gate recorded main as not
// green, and deploy-web REFUSED. A deploy was blocked by a transient DNS/TCP
// failure against github.com — not by anything anyone had written. One re-run of
// the job fixed it, which is the definition of a flake, and a flake that gates
// shipping is an outage with a human in the loop.
//
// `wget -q -O` has no retry at all. The repository already knew this: every
// other pinned download in .github/workflows (glitchtip-cli in deploy-web.yml,
// build-platforms.yml and the four submit lanes) uses
// `curl --fail --silent --show-error --location --retry 3 --retry-all-errors`.
// Four steps in ci.yml were the exception, and all four are the scanners that
// gate a deploy. So this is not a new idiom — it is the existing one, applied to
// the four steps that were missed, plus the cache that makes a SECOND attempt
// cost nothing.
//
// 🔴 THE CACHE IS NOT TRUSTED, IT IS VERIFIED. A GitHub Actions cache is writable
// from any branch, so a cache entry is untrusted input. Every artifact this
// module hands back — restored from cache or freshly downloaded — has its sha256
// compared against the digest in tooling/versions.json, the same file the
// version comes from. A cache entry that does not match is DELETED and the
// download happens anyway, so the worst a poisoned or truncated entry can do is
// cost one download. There is no path through this module that installs bytes
// whose digest was not checked against the pin: `acquire` either returns a
// verified path or throws.
//
// WHY A MODULE AND NOT FOUR MORE LINES OF YAML. The four steps were near-
// identical shell, which is the shape this repository keeps measuring drift in —
// what differs between copies is invisible from a green run. Here the four
// differences (URL, archive kind, member name) are DATA in `TOOLS`, the
// behaviour is one code path, and the behaviour has tests: a download that fails
// twice and succeeds on the third attempt, a download that never succeeds, a
// cache hit that skips the network, and a cache entry whose bytes are wrong.
// None of those can be asserted about a `run:` block.
//
// ⚠️ WHAT THIS DOES NOT DO. It does not make a scanner optional. When every
// attempt fails the module throws and the CLI exits 1 with the attempt count and
// the last failure verbatim — a secret scanner that could not be installed is a
// build that must stop, not a build that quietly scanned nothing. The bound
// exists so that "the network hiccuped once" and "github.com is down" stop
// looking identical.
//
// USAGE (from a workflow step):
//     node tooling/ci/install-pinned-tool.mjs gitleaks --out "$RUNNER_TEMP"
// Environment: PINNED_TOOL_CACHE (directory, optional — no cache when unset),
// PINNED_TOOL_ATTEMPTS, PINNED_TOOL_TIMEOUT_MS.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERSIONS_PATH = resolve(HERE, '..', 'versions.json');

/**
 * The four pinned binaries ci.yml's `security-scan` job installs, as DATA.
 *
 * `versionKey` and `digestKey` name entries in tooling/versions.json — this file
 * carries no version and no digest of its own, because [pipeline F-2] gives each
 * pin exactly one home and a second copy here would be one more thing that can
 * drift while every run stays green.
 *
 * `member` is the file to take out of a `.tar.gz`; `archive: 'none'` means the
 * download IS the binary (osv-scanner ships a bare ELF, so its digest is the
 * only integrity check between the download and an executable that then walks
 * the whole workspace).
 */
export const TOOLS = new Map([
  [
    'gitleaks',
    {
      versionKey: 'gitleaks',
      digestKey: 'gitleaks_sha256',
      url: (v) => `https://github.com/gitleaks/gitleaks/releases/download/v${v}/gitleaks_${v}_linux_x64.tar.gz`,
      archive: 'tar.gz',
      member: 'gitleaks',
    },
  ],
  [
    'zizmor',
    {
      versionKey: 'zizmor',
      digestKey: 'zizmor_sha256',
      // ⚠️ THE ASSET NAME CARRIES NO VERSION — `zizmor-x86_64-unknown-linux-gnu.tar.gz`
      // is the same string at every release, and only the `/v${ver}/` path
      // segment differs. On this lane the digest is not a second opinion about
      // the bytes, it is the only thing that distinguishes one release's bytes
      // from another's.
      url: (v) => `https://github.com/zizmorcore/zizmor/releases/download/v${v}/zizmor-x86_64-unknown-linux-gnu.tar.gz`,
      archive: 'tar.gz',
      member: 'zizmor',
    },
  ],
  [
    'osv-scanner',
    {
      versionKey: 'osv_scanner',
      digestKey: 'osv_scanner_sha256',
      url: (v) => `https://github.com/google/osv-scanner/releases/download/v${v}/osv-scanner_linux_amd64`,
      archive: 'none',
      member: 'osv-scanner',
    },
  ],
  [
    'trivy',
    {
      versionKey: 'trivy',
      digestKey: 'trivy_sha256',
      url: (v) => `https://github.com/aquasecurity/trivy/releases/download/v${v}/trivy_${v}_Linux-64bit.tar.gz`,
      archive: 'tar.gz',
      member: 'trivy',
    },
  ],
]);

/** Attempts at the download before the build stops. Three, because the failure
 *  this bound exists for lasted one attempt. */
export const DEFAULT_ATTEMPTS = 3;
/** Wall clock for ONE attempt. curl retries inside this; the spawn is killed at
 *  it, so a hung TLS handshake cannot become a 15-minute job timeout with no
 *  name on it. */
export const DEFAULT_TIMEOUT_MS = 120_000;
/** Pause before attempt n+1. Small and fixed: this is a flake bound, not a
 *  politeness budget against a rate limit. */
export const RETRY_DELAY_MS = 3_000;

export function readVersions(path = VERSIONS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** sha256 of a file, lowercase hex. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * ONE download attempt with curl. Bounded by `timeoutMs` and killed with
 * SIGKILL, never left to a job timeout.
 * @returns {{ok: boolean, detail: string}}
 */
export function curlDownload({ url, dest, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const args = [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--retry',
    '2',
    '--retry-all-errors',
    '--output',
    dest,
    url,
  ];
  const r = spawnSync('curl', args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.error?.code === 'ETIMEDOUT') {
    return { ok: false, detail: `curl did not finish within ${Math.round(timeoutMs / 1000)} s — killed` };
  }
  if (r.error) return { ok: false, detail: `curl could not be started (${r.error.code ?? r.error.message})` };
  if (r.status !== 0) return { ok: false, detail: `curl exit ${r.status}: ${(r.stderr ?? '').trim() || '<no stderr>'}` };
  if (!existsSync(dest)) return { ok: false, detail: 'curl exited 0 but wrote no file' };
  return { ok: true, detail: `curl exit 0` };
}

/** Raised when every attempt failed. Carries the attempts so the CLI can say so. */
export class PinnedToolUnavailable extends Error {
  constructor(lines) {
    super(lines.join('\n'));
    this.lines = lines;
  }
}

/**
 * Return the path of an artifact whose sha256 EQUALS `digest`.
 *
 * Order: a cache entry (verified, and deleted when it does not verify), then up
 * to `attempts` downloads. A download whose digest is wrong is discarded and
 * counts as a failed attempt — truncation looks exactly like that, and bytes
 * that do not match the pin are never handed back either way.
 *
 * @returns {{path: string, attempts: number, fromCache: boolean, log: string[]}}
 */
export function acquire({
  url,
  digest,
  cachePath = null,
  workPath,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  download = curlDownload,
  sleep = defaultSleep,
}) {
  const log = [];
  if (cachePath && existsSync(cachePath)) {
    const got = sha256File(cachePath);
    if (got === digest) {
      log.push(`cache hit ${cachePath} — sha256 matches the pin, nothing downloaded`);
      return { path: cachePath, attempts: 0, fromCache: true, log };
    }
    log.push(`cache entry ${cachePath} has sha256 ${got}, the pin says ${digest} — discarded`);
    rmSync(cachePath, { force: true });
  }

  mkdirSync(dirname(workPath), { recursive: true });
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    rmSync(workPath, { force: true });
    const r = download({ url, dest: workPath, timeoutMs });
    if (!r.ok) {
      failures.push(`attempt ${attempt}: ${r.detail}`);
      log.push(`attempt ${attempt} failed — ${r.detail}`);
      if (attempt < attempts) sleep(RETRY_DELAY_MS);
      continue;
    }
    const got = sha256File(workPath);
    if (got !== digest) {
      failures.push(`attempt ${attempt}: sha256 ${got}, expected ${digest}`);
      log.push(`attempt ${attempt} downloaded bytes whose sha256 is ${got}, not ${digest} — discarded`);
      rmSync(workPath, { force: true });
      if (attempt < attempts) sleep(RETRY_DELAY_MS);
      continue;
    }
    log.push(`attempt ${attempt} ok — sha256 matches the pin`);
    if (cachePath) {
      mkdirSync(dirname(cachePath), { recursive: true });
      copyFileSync(workPath, cachePath);
      log.push(`cached as ${cachePath}`);
    }
    return { path: workPath, attempts: attempt, fromCache: false, log };
  }

  throw new PinnedToolUnavailable([
    `the pinned download failed on all ${attempts} attempt(s), so the tool could not be installed.`,
    `url = ${url}`,
    ...failures,
    'A scanner that could not be installed is a build that stops. The bound exists so that one transient',
    'network failure retries instead of turning main red — not so that a real outage passes unscanned.',
  ]);
}

function defaultSleep(ms) {
  // Synchronous: everything around it is spawnSync, and a promise here would
  // make the one code path two.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Put the binary at `outDir/<member>` and make it executable. */
export function place({ artifact, archive, member, outDir, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, member);
  if (archive === 'none') {
    if (resolve(artifact) !== resolve(dest)) copyFileSync(artifact, dest);
  } else {
    // ⚠️ RELATIVE, FROM `outDir`. An absolute Windows path reaches tar as
    // `C:\…`, which GNU tar reads as the HOST `C` and answers "Cannot connect to
    // C: resolve failed" — so the whole installer could only ever be proved on
    // the runner. A relative name has no colon, and `cwd` makes it unambiguous.
    const r = spawnSync('tar', ['-xzf', relative(outDir, artifact) || basename(artifact), member], {
      cwd: outDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    if (r.error || r.status !== 0) {
      throw new PinnedToolUnavailable([
        `\`tar -xzf\` could not take ${member} out of ${basename(artifact)} (${r.error ? r.error.code : `exit ${r.status}`}).`,
        `stderr = ${(r.stderr ?? '').trim() || '<none>'}`,
      ]);
    }
  }
  spawnSync('chmod', ['+x', dest], { timeout: 10_000, killSignal: 'SIGKILL' });
  return dest;
}

/** The whole job for one named tool. */
export function installPinnedTool({
  name,
  outDir,
  versions = readVersions(),
  cacheDir = process.env.PINNED_TOOL_CACHE || null,
  attempts = Number(process.env.PINNED_TOOL_ATTEMPTS) || DEFAULT_ATTEMPTS,
  timeoutMs = Number(process.env.PINNED_TOOL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  download = curlDownload,
  sleep = defaultSleep,
}) {
  const spec = TOOLS.get(name);
  if (!spec) {
    throw new PinnedToolUnavailable([
      `${name} is not one of the pinned tools this installer knows: ${[...TOOLS.keys()].join(', ')}.`,
      'Add it to TOOLS here, with its version and digest keys in tooling/versions.json — never as shell in a workflow.',
    ]);
  }
  const version = versions[spec.versionKey];
  const digest = versions[spec.digestKey];
  if (!version || !digest) {
    throw new PinnedToolUnavailable([
      `tooling/versions.json declares no ${!version ? spec.versionKey : spec.digestKey} — the pin has no home.`,
    ]);
  }
  const url = spec.url(version);
  const fileName = `${name}-${version}-${digest.slice(0, 12)}${spec.archive === 'none' ? '' : '.tar.gz'}`;
  const { path, attempts: used, fromCache, log } = acquire({
    url,
    digest,
    cachePath: cacheDir ? join(cacheDir, fileName) : null,
    workPath: join(outDir, `.download-${fileName}`),
    attempts,
    timeoutMs,
    download,
    sleep,
  });
  const binary = place({ artifact: path, archive: spec.archive, member: spec.member, outDir, timeoutMs });
  return { binary, version, digest, url, attempts: used, fromCache, log };
}

function main(argv) {
  const name = argv[0];
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : process.env.RUNNER_TEMP;
  if (!name || !outDir) {
    console.error('usage: node tooling/ci/install-pinned-tool.mjs <tool> --out <dir>');
    return 1;
  }
  try {
    const r = installPinnedTool({ name, outDir });
    for (const line of r.log) console.log(`  ${line}`);
    console.log(
      `ok ${name} ${r.version} installed at ${r.binary} — ` +
        `${r.fromCache ? 'from the verified cache, no download' : `downloaded on attempt ${r.attempts}`}`,
    );
    return 0;
  } catch (e) {
    console.error(`FAIL 🔴 ${name} could not be installed`);
    for (const line of e instanceof PinnedToolUnavailable ? e.lines : [e.message]) console.error(`  ${line}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
