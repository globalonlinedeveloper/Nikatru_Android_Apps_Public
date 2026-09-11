// ─────────────────────────────────────────────────────────────────────────────
// install-pinned-tool.test.mjs — one transient network failure must not turn
// main red, and no unverified byte may ever be installed.
//
// The defect this pins: on 2026-09-12 main's "Security — secret and workflow
// scanners" job went red on `wget -q -O … gitleaks_8.30.1_linux_x64.tar.gz`
// (exit 4, network). ci-gate then recorded main as not green and deploy-web
// REFUSED. One re-run fixed it. install-pinned-tool.mjs replaces that step's
// shell with a bounded retry and a checksum-verified cache.
//
//   P1 a download that fails once and then succeeds INSTALLS (the 09-12 failure)
//   P2 a download that never succeeds fails LOUDLY, naming every attempt
//   P3 a cache entry whose sha256 matches the pin skips the network entirely
//   P4 a cache entry whose sha256 does NOT match is discarded, not installed
//   P5 downloaded bytes whose sha256 is wrong are never handed back
//   P6 the retry is BOUNDED — attempts stop at the configured number
//   P7 no workflow step downloads one of these four tools any other way
//
// Mutations run against install-pinned-tool.mjs (predictions written first):
//   · `attempts = 1` forced (the retry loop runs once)              → P1, P6 RED
//   · the cache digest comparison made `if (true)`                  → P4 RED
//   · the post-download digest comparison deleted                   → P5 RED
//   · `throw new PinnedToolUnavailable` after the loop → `return`   → P2 RED
//   · ci.yml's gitleaks step restored to `wget -q -O`               → P7 RED
//
// Run:  node --test tooling/ci/test/install-pinned-tool.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquire, PinnedToolUnavailable, TOOLS, DEFAULT_ATTEMPTS } from '../install-pinned-tool.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');

const BYTES = 'the pinned bytes\n';
const DIGEST = createHash('sha256').update(BYTES).digest('hex');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pinned-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
const workDir = () => {
  const d = join(TMP, `w${seq++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

/** A downloader that fails `failFor` attempts and then writes the real bytes.
 *  Counts its calls, so "how many attempts happened" is measured, not assumed. */
function fakeDownload({ failFor = 0, body = BYTES } = {}) {
  const calls = [];
  const fn = ({ url, dest }) => {
    calls.push(url);
    if (calls.length <= failFor) return { ok: false, detail: 'curl exit 6: could not resolve host' };
    writeFileSync(dest, body);
    return { ok: true, detail: 'curl exit 0' };
  };
  fn.calls = calls;
  return fn;
}

const noSleep = () => {};

describe('install-pinned-tool — a transient failure retries, a real one stops the build', () => {
  test('P1 one failed attempt then a good one INSTALLS (the 2026-09-12 red)', () => {
    const dir = workDir();
    const download = fakeDownload({ failFor: 1 });
    const r = acquire({
      url: 'https://example.invalid/gitleaks.tar.gz',
      digest: DIGEST,
      workPath: join(dir, 'dl'),
      download,
      sleep: noSleep,
    });
    assert.equal(download.calls.length, 2, 'the second attempt must happen');
    assert.equal(r.attempts, 2);
    assert.equal(r.fromCache, false);
    assert.equal(readFileSync(r.path, 'utf8'), BYTES);
  });

  test('P2 a download that never succeeds fails loudly, naming every attempt', () => {
    const dir = workDir();
    const download = fakeDownload({ failFor: 99 });
    assert.throws(
      () =>
        acquire({
          url: 'https://example.invalid/gitleaks.tar.gz',
          digest: DIGEST,
          workPath: join(dir, 'dl'),
          download,
          sleep: noSleep,
        }),
      (e) => {
        assert.ok(e instanceof PinnedToolUnavailable, 'must be the named failure, not a stray TypeError');
        const text = e.lines.join('\n');
        assert.match(text, /failed on all 3 attempt\(s\)/);
        assert.match(text, /attempt 1: curl exit 6/);
        assert.match(text, /attempt 3: curl exit 6/);
        return true;
      },
    );
    assert.equal(download.calls.length, DEFAULT_ATTEMPTS);
  });

  test('P3 a cache entry matching the pin means NO network call at all', () => {
    const dir = workDir();
    const cache = join(dir, 'cache', 'gitleaks.tar.gz');
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, BYTES);
    const download = fakeDownload();
    const r = acquire({
      url: 'https://example.invalid/gitleaks.tar.gz',
      digest: DIGEST,
      cachePath: cache,
      workPath: join(dir, 'dl'),
      download,
      sleep: noSleep,
    });
    assert.equal(download.calls.length, 0, 'a verified cache entry must not be re-downloaded');
    assert.equal(r.fromCache, true);
    assert.equal(r.path, cache);
  });

  test('P4 a cache entry whose bytes are WRONG is discarded, never installed', () => {
    const dir = workDir();
    const cache = join(dir, 'cache', 'gitleaks.tar.gz');
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, 'bytes nobody pinned\n');
    const download = fakeDownload();
    const r = acquire({
      url: 'https://example.invalid/gitleaks.tar.gz',
      digest: DIGEST,
      cachePath: cache,
      workPath: join(dir, 'dl'),
      download,
      sleep: noSleep,
    });
    assert.equal(r.fromCache, false, 'the poisoned entry must not be trusted');
    assert.equal(download.calls.length, 1, 'it must fall through to the download');
    assert.equal(readFileSync(r.path, 'utf8'), BYTES);
    // and the good bytes replace it, so the next run is a hit again
    assert.equal(readFileSync(cache, 'utf8'), BYTES);
  });

  test('P5 downloaded bytes whose sha256 is wrong are never handed back', () => {
    const dir = workDir();
    const download = fakeDownload({ body: 'bytes nobody pinned\n' });
    assert.throws(
      () =>
        acquire({
          url: 'https://example.invalid/gitleaks.tar.gz',
          digest: DIGEST,
          workPath: join(dir, 'dl'),
          download,
          sleep: noSleep,
        }),
      (e) => {
        assert.match(e.lines.join('\n'), /sha256 [0-9a-f]{64}, expected /);
        return true;
      },
    );
    assert.equal(existsSync(join(dir, 'dl')), false, 'the wrong bytes must not be left on disk');
  });

  test('P6 the retry is BOUNDED — it stops at the configured number', () => {
    const dir = workDir();
    const download = fakeDownload({ failFor: 99 });
    assert.throws(() =>
      acquire({
        url: 'https://example.invalid/gitleaks.tar.gz',
        digest: DIGEST,
        workPath: join(dir, 'dl'),
        attempts: 2,
        download,
        sleep: noSleep,
      }),
    );
    assert.equal(download.calls.length, 2, 'a bound that does not bind is not a bound');
  });
});

describe('install-pinned-tool — no workflow may fetch these four any other way', () => {
  // 🔴 THE RATCHET. Without this, the next hand to add a scanner writes the same
  // `wget -q -O` and the 2026-09-12 red comes back with nothing to notice it.
  // The check is over the REAL workflow set, so it cannot pass vacuously: it
  // asserts the installer is actually referenced before it judges anything.
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'));
  const bodies = new Map(files.map((f) => [f, readFileSync(join(WORKFLOWS, f), 'utf8')]));

  test('P7 every pinned-tool release URL is fetched through install-pinned-tool.mjs', () => {
    assert.ok(files.length > 5, `expected the real workflow set, found ${files.length} file(s)`);
    const installerUsers = [...bodies].filter(([, b]) => b.includes('install-pinned-tool.mjs')).map(([f]) => f);
    assert.ok(
      installerUsers.length > 0,
      'no workflow calls install-pinned-tool.mjs — the installer is dead code and this check is vacuous',
    );
    const offenders = [];
    for (const [file, body] of bodies) {
      body.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('#')) return;
        if (!/\b(wget|curl)\b/.test(line) && !/releases\/download\//.test(line)) return;
        for (const name of TOOLS.keys()) {
          const host = name === 'gitleaks' ? 'gitleaks/gitleaks' : name === 'zizmor' ? 'zizmorcore/zizmor' : name === 'trivy' ? 'aquasecurity/trivy' : 'google/osv-scanner';
          if (line.includes(`${host}/releases/download/`)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `these steps fetch a pinned tool outside install-pinned-tool.mjs, so they have no retry and no cache:\n${offenders.join('\n')}`,
    );
  });

  test('P7b the four tools this installer knows are the four ci.yml installs', () => {
    const ci = bodies.get('ci.yml');
    assert.ok(ci, 'ci.yml must exist');
    for (const name of TOOLS.keys()) {
      assert.match(
        ci,
        new RegExp(`install-pinned-tool\\.mjs ${name.replace(/[-]/g, '\\-')}\\b`),
        `ci.yml must install ${name} through the installer`,
      );
    }
  });
});
