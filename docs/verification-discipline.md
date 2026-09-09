# Verification discipline — the eleven rules

Referenced from [`AGENTS.md`](../AGENTS.md), which carries a one-line pointer instead of this page:
the root instruction doc is capped at 8 KiB by `check-agent-docs` limb A-SIZE, and a rule set that
does not change every week is reference, not standing instruction. Worked examples, one per rule,
are in the private corpus at `Private/pre-minimal-2026-09-08:notes/verification-discipline.md`.

**The recurring failure in this tree is not a broken check. It is a check that silently stopped
checking.** It still prints "clean", CI still goes green, and nothing surfaces until the guarded
thing is already broken. Every rule below is a way that has actually happened here.

1. **Every scanner needs a test that it is still scanning what it thinks.** Guards carry a
   `REQUIRED_COVERAGE` declaration and exit **2** — COVERAGE LOST — when they fall under it. A
   guard that reports PASS over an absent subject is the defect this whole discipline exists around.
2. **Assert on parsed structure, never by grepping prose.** Strip comments AND string literals
   first: a rule quoted inside a comment is not the code doing the thing.
3. **An assertion that cannot fail is worse than none.** If you cannot write the input that makes it
   red, delete it — it is carrying the belief that something is checked while checking nothing.
4. **Silence is not success.** Before waiting on a signal, confirm the signal *can* arrive. Every
   wait has a ceiling: state it, check at it, act once, record it.
5. **Live-verify the real thing, not the test double.** A mock agreeing with a mock is not evidence
   about production.
6. **Negative-test every guard before trusting it.** Each guard has a recorded failing case, and the
   green control is run first — otherwise a red for an unrelated reason reads as the catch.
7. **A fixture passing is not a guard working — MUTATE THE REAL TREE.** A fixture you wrote encodes
   the same misunderstanding as the guard you wrote, so the two agree by construction.
8. **Run `analyze` / `tsc` before believing a mutation was caught.** A compile error and a caught
   mutation look identical from the exit code.
9. **Mutation testing is also how you find DEAD code.** If deleting a branch changes no outcome
   anywhere, it is redundant, not load-bearing.
10. **A fail-closed seam with no proven open path is a dead feature that reports healthy.** Where the
    on-switch genuinely cannot be closed inside a build, the guard must PRINT the gap on every run
    rather than fail — and the print must name what would close it, and who can.
11. **Prefer a build-failing guard over a note.** A gotcha that lives only in prose will be repeated;
    encode the lesson whenever it is encodable.

⚠️ **A green guard after a refactor is evidence of nothing.** Moved code leaves a guard's domain by
moving house — the guard still runs, still finds its old subject absent, and still prints ok. After
any move, run the OLD guard against a deliberate mutation, with a green control first.

⏱ **APPENDED 2026-09-09 — GIT HISTORY IS NOT A FRESHNESS ORACLE.** A worked instance of the rule
above, recorded because it cost a whole record. `assert-app-dod.mjs` dated every mutation proof
against a walk of `git log -- <effect file>`. The app-slug rename (`apps/subly/` →
`apps/subscriptiontracker/`, c92bfb80) meant git reported exactly ONE commit at every one of those
paths — the rename — so the walk never compared two blobs and returned the rename day for all
fourteen rows. Three things are worth carrying forward:

1. **The rename did not change the verdict, it destroyed the INFORMATION.** Re-measured with a walk
   that resolves the path at each commit, all fourteen rows are still expired. What was lost was the
   ability to tell a genuine expiry from a rename artefact — every row read the same wrong day, so
   the column said nothing at all. A check that returns the same answer for every input has stopped
   checking even while its answer happens to be right.
2. **The obvious fix was measured and is a no-op.** Adding `--follow` changes nothing, because the
   walk reads each version with `git show <sha>:<path>` at the CURRENT path, which does not exist at
   any pre-rename commit; git exits 128, the reader treats that as unreadable, and the walk stops at
   the newest commit — the rename day again. Measure the fix, do not reason about it.
3. **The repair is to stop asking history.** `assert-mutation-proofs.mjs` records a sha256 of the
   comment-stripped implementation in the row itself. No history walk, so a rename cannot blind it
   and a shallow clone cannot starve it, and the same stripper serves it and the guard it replaces
   (`dart-source.mjs`), because two readings of "what is code" disagreeing is what produced the
   original defect.

🔴 And the rule that outranks all three: **a row may only be re-dated by RE-RUNNING the mutation.**
When a mechanical sweep expires every proof at once, the cheap response is to move the dates, which
converts proofs into claims and teaches the next reader that the date is a field you edit to get
green. The same applies to a hash. The harness exists so that "re-run it" is a command rather than an
afternoon.
