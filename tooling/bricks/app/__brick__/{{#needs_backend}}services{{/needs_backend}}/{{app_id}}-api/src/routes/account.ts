import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { run } from '../lib/d1';
import { userOwnedTables, userReferencingColumns } from '../../../_shared/src/erasure';

// ─────────────────────────────────────────────────────────────────────────────
// G2 — in-app account deletion (server side). DELETE /v1/account purges every
// row this user owns from the app database, their shared-platform entitlements,
// AND their identity record, then returns what was deleted. The client
// (Settings → Delete account) calls this, then signs the user out of Supabase.
//
// ⏱ 2026-09-12 · NOTHING TO EXTEND PER APP ANY MORE, AND THAT IS THE POINT.
// This used to read "add every user-owned APP_DB table to `appTables`", with a
// warning that missing one meant orphaned personal data after "delete my account".
// That is a correctness property resting on somebody editing two files in one
// change, and it fails SILENTLY and permanently: the route answers ok, the rows
// stay, and the identity is gone by the time anyone could notice. The schema
// answers instead - every table carrying a `user_id` column is user-owned by
// definition - so a migration that adds a user-owned table is covered by that
// migration alone. Both live Workers had already been fixed this way; the
// template had not, which is the whole of the defect.
//
// 🔴 THREE LIMBS, AND THE THIRD IS THE ONE THAT WAS MISSING. This route used to
// purge `appTables` + entitlements and return `{ ok: true }` — with the identity
// record untouched. So after "your account has been deleted" the same email and
// password still logged in, to an account with no data. That is a deletion the
// user cannot detect as incomplete, which is exactly the failure the client half
// refuses to fake. Deleting the identity needs the SERVICE ROLE key, which no
// Worker held; it is now a required secret and the route REFUSES rather than
// reporting a success it cannot deliver.
// ─────────────────────────────────────────────────────────────────────────────
const account = new Hono<AppEnv>();

account.delete('/', async (c) => {
  // ── LIMB 0 · THE PROOF IS ASYMMETRIC, OR THERE IS NO ERASURE ──────────────
  // `supabaseAuth` — the middleware every other route uses — may verify with the
  // shared `SUPABASE_JWT_SECRET` when the JWKS path fails. A symmetric secret is
  // a string, and whoever learns it can mint a token for any user. Behind a read
  // that is a data leak; behind THIS route it is an unauthenticated remote wipe
  // of anybody's account. So `index.ts` mounts this route behind `erasureAuth`,
  // which has no secret in scope at all.
  //
  // 🔴 THIS CHECK IS THE SECOND LIMB AND IT IS NOT REDUNDANT WITH THE MOUNTING.
  // The mounting is one line in another file; a tidy-up that moved this route
  // under the permissive group would silently put account deletion behind the
  // shared secret and every existing test would still pass. Re-checking here
  // turns that edit into a loud, logged 403.
  //
  // ⚠️ FAIL-CLOSED ON `undefined`. A route reached with NO auth middleware reads
  // undefined, which is not 'asymmetric', which is a refusal. The dangerous
  // spelling would have been `!== 'symmetric'`.
  const assurance = c.get('tokenAssurance');
  if (assurance !== 'asymmetric') {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} app=${c.env.APP_ID} REFUSING ERASURE: admitted with tokenAssurance=${assurance ?? 'none'}, and account deletion requires an ES256/JWKS-verified token. A shared HS256 secret is one leaked environment variable away from letting anyone erase any account, so it is not an acceptable proof for an irreversible route. Mount DELETE /v1/account behind erasureAuth.`,
    );
    return c.json({ error: 'erasure_requires_asymmetric_auth' }, 403);
  }

  const userId = c.get('userId');

  // PRECONDITION, checked BEFORE anything is destroyed. Discovering halfway
  // through that the identity cannot be deleted would leave a user with no data
  // and a working login — strictly worse than refusing up front. Set it once per
  // Worker with:  wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  const serviceRoleKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} refusing deletion: SUPABASE_SERVICE_ROLE_KEY is not set, so the identity record cannot be removed`,
    );
    return c.json({ error: 'account_deletion_unconfigured' }, 501);
  }

  const deleted: Record<string, number> = {};
  const unlinked: Record<string, number> = {};

  // App-owned data (APP_DB). The set is DERIVED FROM THE SCHEMA, never listed
  // here: `user_id` means the row IS this person's, `*_user_id` means the row
  // REFERENCES them. See services/_shared/src/erasure.ts for why the walk is two
  // statements and why the two sets are disjoint by construction.
  let tables: string[];
  let references: Array<{ table: string; column: string }>;
  try {
    tables = await userOwnedTables(c.env.APP_DB);
    references = await userReferencingColumns(c.env.APP_DB);
  } catch (err) {
    console.error(`[account] rid=${c.get('requestId') ?? '-'} schema read failed`, err);
    return c.json({ error: 'account_deletion_failed' }, 503);
  }

  // 🔴 AN EMPTY SET IS A FAILURE, NOT A FAST PATH. If the derivation ever stops
  // finding tables - a schema change, a driver that does not support
  // pragma_table_info - this route would delete NOTHING and report ok. The
  // identity would then be deleted below, and every row here would be orphaned
  // behind a login that no longer exists. Refuse instead.
  if (tables.length === 0) {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} refusing deletion: no user-owned table was found, so this request cannot prove it erased anything`,
    );
    return c.json({ error: 'account_deletion_failed' }, 503);
  }

  for (const table of tables) {
    // Through `run`, not `.run()` directly: D1 lives in a Durable Object that is
    // occasionally reset, and a DELETE is idempotent by its own shape. The name
    // comes from sqlite_master, never from the request, and D1 cannot bind an
    // identifier.
    // eslint-disable-next-line no-await-in-loop
    const res = await run(
      c.env.APP_DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId),
    );
    deleted[table] = res.meta.changes ?? 0;
  }

  // Then the REFERENCES: after this, no `*_user_id` column in APP_DB holds this
  // person's id. Table and column both come from sqlite_master.
  for (const ref of references) {
    // eslint-disable-next-line no-await-in-loop
    const res = await run(
      c.env.APP_DB.prepare(
        `UPDATE ${ref.table} SET ${ref.column} = NULL WHERE ${ref.column} = ?`,
      ).bind(userId),
    );
    unlinked[`${ref.table}.${ref.column}`] = res.meta.changes ?? 0;
  }

  // Shared entitlements (PLATFORM_DB). Best-effort: the table may not exist in a
  // fresh platform database, so a failure here must not block the deletion.
  try {
    const res = await run(
      c.env.PLATFORM_DB.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId),
    );
    deleted['entitlements'] = res.meta.changes ?? 0;
  } catch {
    deleted['entitlements'] = 0;
  }

  // The IDENTITY record, last — the row that decides whether the login still
  // works. 404 counts as done: the user is gone, which is what was asked for,
  // and a retry after a partial failure must not fail on the second pass.
  // The key is never echoed, logged, or returned.
  const identityRes = await fetch(
    `${c.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!identityRes.ok && identityRes.status !== 404) {
    console.error(
      `[account] rid=${c.get('requestId') ?? '-'} identity delete failed with ${identityRes.status}`,
    );
    // NOT ok:true. The data is gone and the login is not — the user must be
    // told, and the client turns this into a visible failure rather than a
    // "deleted" they cannot verify. The purges above are idempotent, so a retry
    // is safe.
    return c.json({ error: 'identity_delete_failed' }, 502);
  }
  deleted['identity'] = 1;

  // `unlinked` is reported beside `deleted` because they are different claims:
  // rows removed, versus rows that merely stopped naming this person. A caller
  // that read one as the other would be told more than happened.
  return c.json({ ok: true, deleted, unlinked });
});

export default account;
