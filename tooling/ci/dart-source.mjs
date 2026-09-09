// ─────────────────────────────────────────────────────────────────────────────
// dart-source.mjs — THE ONE READING OF "which bytes of a .dart file are CODE".
//
// Both functions lived in assert-app-dod.mjs until 2026-09-09, verbatim as they
// stand below. They moved because a SECOND guard needed the same question
// answered: assert-mutation-proofs.mjs pins each mutation proof to a content hash
// of the effect file with its comment prose gone, and that hash MUST be computed
// by the same stripper assert-app-dod.mjs uses — its `lastCodeChangeDay` walk
// compares historical blobs through it, and its effect anchor reads a symbol
// through it. Two strippers disagreeing about what a Dart file's code is is not a
// hypothetical here: it is the defect that produced `lastCodeChangeDay` in the
// first place, when limb 3 and limb 2 of that one guard disagreed with each
// other about whether a symbol surviving only inside a comment counts. Two FILES
// disagreeing would be the same defect with a wider blast radius and nothing
// comparing them.
//
// It is not a guard: text in, text out, no filesystem, no tree, no exit. "Did my
// scan still reach the tree" belongs to the importers, each of which carries its
// own COVERAGE LOST over what it read. Its own failing cases are in
// test/app-dod.test.mjs and test/mutation-proofs.test.mjs. It sits flat in
// tooling/ci because the stray-.mjs check in assert-guard-coverage.mjs
// (correctly) treats a subdirectory as a guard escaping the scan.
// ─────────────────────────────────────────────────────────────────────────────
// ── Dart source helpers. BOTH are LENGTH-PRESERVING on purpose: the declaration
//    is found in the comment-stripped text (the test NAME is a string literal, so
//    strings must survive) and the body is brace-matched in the string-blanked
//    text (a brace inside a string is not a brace). Same indices, two views.
export function stripDartComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') {
          depth--; out[i] = ' '; out[i + 1] = ' '; i += 2;
          if (depth === 0) break;
          continue;
        }
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Blanks the CONTENTS of string literals, keeping the quotes and the length. */
export function blankDartStrings(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { out[j] = ' '; out[j + 1] = ' '; j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') { j++; break; }
        if (src[j] !== '\n') out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}
