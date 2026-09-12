import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// chassis-wiring.test.ts — THE FIRST TEST A STAMPED WORKER OWNS, and it is about
// the one thing a stamped Worker can get wrong on its own.
//
// Everything this Worker does that is worth testing — verifying a token, judging
// its own health, retrying a reset database, deriving which tables name a user —
// lives in `services/_shared/src/`, and the chassis's own suite runs here through
// `vitest.config.ts`'s `include`. Duplicating those assertions would be a second
// copy of a correctness rule, which is the thing this repository keeps deleting.
//
// 🔴 WHAT IS LEFT IS THE WIRING, AND IT IS EXACTLY WHAT DRIFTS. Each file under
// `src/lib/` is a RE-EXPORT of the one home. The failure mode is quiet and
// specific: somebody needs "just one small change" to a shared helper, pastes its
// body into this Worker, and the re-export becomes a copy. Nothing breaks that
// day. Every later fix to the shared module then reaches every other Worker and
// not this one — which is precisely how the template this app was stamped from
// came to be a version behind the apps it produced.
//
// So this file asks the one question the rest of the suite cannot: are these
// files still POINTERS?
//
// ⚬ WHAT IT DELIBERATELY DOES NOT DO: read the shared modules' behaviour. That is
// the chassis suite's job, it already runs here, and asserting it twice would
// make this file the second opinion nobody updates.
// ─────────────────────────────────────────────────────────────────────────────

/** Each file under `src/lib/` that must be a pointer, and the home it points at. */
const RE_EXPORTS = [
  ['src/lib/d1.ts', '_shared/src/d1'],
  ['src/lib/health.ts', '_shared/src/health'],
  ['src/lib/error-sink.ts', '_shared/src/error-sink'],
] as const;

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Comments out. A header that MENTIONS the home is not an export of it, and the
 *  headers here all name the module they re-export — so a raw match would pass
 *  over a file whose `export *` had been replaced by a pasted copy. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');

describe('this Worker takes its shared modules from the one home', () => {
  for (const [rel, home] of RE_EXPORTS) {
    it(`${rel} is a re-export, not a copy`, () => {
      const body = code(read(rel));
      expect(body).toMatch(new RegExp(`export \\* from '[^']*${home.replace('/', '\\/')}'`));
      // A pointer is a line or two. A file that grew a body grew a copy.
      expect(body.split('\n').filter((l) => l.trim() !== '').length).toBeLessThanOrEqual(3);
    });
  }

  it('the erasure route derives its table set rather than listing tables by hand', () => {
    // The rule the shared derivation exists for: a table left out of a hand-kept
    // list is orphaned personal data behind a login that no longer exists, and the
    // route still answers ok. If this Worker grows its own list, that is the
    // regression — and it is invisible until somebody asks to be deleted.
    const body = code(read('src/routes/account.ts'));
    expect(body).toMatch(/userOwnedTables\s*\(/);
    expect(body).not.toMatch(/const\s+appTables\s*=\s*\[/);
  });
});
