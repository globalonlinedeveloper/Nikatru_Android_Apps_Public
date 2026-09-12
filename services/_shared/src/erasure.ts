// ─────────────────────────────────────────────────────────────────────────────
// erasure.ts — WHICH TABLES AND COLUMNS NAME A USER. THE ONE HOME.
//
// "Delete my account" is only as complete as the list of places the person's rows
// live. Every Worker that erases needs that list, and the correctness property is
// harsh: a table left out is ORPHANED PERSONAL DATA behind a login that no longer
// exists, the route still answers `ok: true`, and nothing surfaces. There is no
// second chance to notice — the identity record is gone by then.
//
// 🔴 SO THE SCHEMA ANSWERS, NOT A LIST IN A FILE. Every table carrying a
// `user_id` column is user-owned BY DEFINITION, so a migration that adds one is
// covered by that migration alone. The alternative — a hand-kept array — rests on
// somebody remembering to edit two files in one change, and fails silently and
// permanently when they do not.
//
// Two rules, for the two spellings, disjoint BY CONSTRUCTION rather than by a
// subtraction somebody could forget:
//     ·  user_id   → the row IS this person's        → DELETE the row
//     · *_user_id  → the row REFERENCES this person  → NULL the column
//
// ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────
// ⏱ 2026-09-12. These four declarations were private to TWO route files, one per
// live Worker, byte-identical. The app template had none of it: its erasure route
// carried `const appTables = ['records'];` and a comment warning that missing a
// table there means orphaned personal data. So the SAFE derivation reached both
// live Workers and not the factory, and every app stamped from it would have been
// born with the hand-kept list and the silent failure. Found by the
// factory-vs-app drift audit (research/factory-drift-2026-09-12/) and fixed the
// way [ADR 067] decision 2 says to — one home, re-exported — rather than by
// copying a correctness argument into a third file.
//
// ⚠️ NO BARE IMPORT HERE. See the header of health.ts for the measurement behind
// that rule; this module imports one sibling, by relative path, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
import { allRows } from './d1';

/** Tables SQLite/D1 own, which must never be a delete target even if some future
 *  column there were named `user_id`. */
const RESERVED = /^(sqlite_|d1_|_cf_)/;

/** A plain SQL identifier. The table and column names below are INTERPOLATED
 *  into statements — D1 cannot bind an identifier — so anything that is not one
 *  of these is refused rather than quoted. Nothing caller-controlled reaches
 *  here; it comes from `sqlite_master`. A schema is still not a trust boundary
 *  anyone audits, and the string gets built either way. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * 🔴 THE TWO-STEP WALK EXISTS BECAUSE D1 REFUSES THE ONE-STEP FORM.
 *
 * Both derivations here used to be a single correlated join:
 *
 *     FROM sqlite_master m JOIN pragma_table_info(m.name) p
 *
 * D1 rejects that with `not authorized: SQLITE_AUTH` (error 7500), and the rule
 * is about the STATEMENT rather than about where the pragma's argument came
 * from: any single statement that names sqlite_master/sqlite_schema AND calls a
 * pragma_* table-valued function is rejected — join, subquery, CTE and correlated
 * scalar subquery alike (measured 2026-08-09 against both production databases).
 * The same pragma fed a literal, a bound parameter or a VALUES list is accepted,
 * and so is a plain sqlite_master read. So: read the tables, then ask each one.
 *
 * ⚠️ IT IS STILL THE NARROW RETRY, AND THAT MATTERS MORE THAN THE RETRY. The
 * SQLITE_AUTH rejection is DETERMINISTIC, so `isTransientD1Error` refuses it and
 * the second attempt `allRows` allows is never spent re-asking a question D1 has
 * already answered.
 */
export async function columnsMatching(
  db: D1Database,
  match: (column: string) => boolean,
): Promise<Array<{ table: string; column: string }>> {
  const listed = await allRows<{ name: string }>(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
  );

  const tables = listed
    .map((r) => r.name)
    .filter((n) => typeof n === 'string' && !RESERVED.test(n) && PLAIN_IDENTIFIER.test(n));

  const hits: Array<{ table: string; column: string }> = [];
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const cols = await allRows<{ name: string }>(
      db.prepare(`SELECT name FROM pragma_table_info('${table}')`),
    );
    for (const row of cols) {
      if (typeof row.name === 'string' && match(row.name)) {
        hits.push({ table, column: row.name });
      }
    }
  }
  return hits;
}

/**
 * Every table in the bound database that carries a `user_id` column — the rows
 * that ARE this person's, and must be deleted.
 */
export async function userOwnedTables(db: D1Database): Promise<string[]> {
  const hits = await columnsMatching(db, (col) => col === 'user_id');
  return hits.map((h) => h.table);
}

/**
 * Every (table, column) where the column NAMES a user without making the row
 * theirs — the `*_user_id` form, which must be NULLed rather than deleted.
 *
 * `user_id` itself cannot match: something must precede the `_user_id` suffix. So
 * this set and [userOwnedTables] are disjoint by construction, not by a
 * subtraction somebody could forget.
 */
export async function userReferencingColumns(
  db: D1Database,
): Promise<Array<{ table: string; column: string }>> {
  const hits = await columnsMatching(
    db,
    (col) => col.endsWith('_user_id') && col.length > '_user_id'.length,
  );
  return hits.filter((h) => PLAIN_IDENTIFIER.test(h.column));
}
