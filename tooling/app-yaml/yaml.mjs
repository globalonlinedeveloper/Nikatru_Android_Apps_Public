// ─────────────────────────────────────────────────────────────────────────────
// yaml.mjs — the ONE reader of the declaration files this directory renders
// from: apps/<id>/app.yaml and apps/<id>/privacy.yaml.
//
// [ADR 067] decision 2 — "an app is app.yaml + its own screens". A declaration
// nothing can read is prose; a declaration read by a library nobody pinned is a
// dependency in a workspace whose package.json has none (measured: the root
// package.json declares `packageManager` and NOTHING else, so `import 'yaml'`
// would be a new supply-chain edge for two files).
//
// ── IT PARSES A SUBSET AND REFUSES EVERYTHING ELSE, ON PURPOSE ───────────────
// The dangerous shape for a hand-rolled parser is the one that GUESSES: it meets
// a construct it does not implement, produces something plausible, and the
// renderer writes plausible bytes into a public catalogue. So every construct
// outside the subset raises `YamlError` with a line number, and the subset is
// stated here rather than discovered by reading the code:
//
//   · block mappings          key: value          (keys match /^[A-Za-z0-9_.-]+$/)
//   · block sequences         - value             (scalars and mappings)
//   · scalars                 null | ~ | true | false | 12 | 1.5 | plain text
//   · quoted scalars          "double" (with \" \\ \n \t escapes) and 'single'
//                             (with '' for a literal quote)
//   · block scalars           `>-` folded and `|-` literal, STRIP-CHOMPED ONLY.
//                             Prose that has to be read aloud — the `basis` of a
//                             privacy row — does not fit on one line, and a
//                             1,200-character quoted string is a sentence nobody
//                             reviews. The un-chomped `>` and `|` are REFUSED
//                             rather than treated as their `-` forms: their
//                             difference is a trailing newline this parser does
//                             not model, and quietly ignoring a chomping
//                             indicator is the same silent-guess this file
//                             exists not to make.
//                             ⚠️ A ` #` inside a block scalar is stripped as a
//                             comment, like everywhere else. Do not write one.
//   · comments                a whole line starting `#`, or ` #` after a value
//                             when the `#` is outside quotes
//   · indentation             EXACTLY two spaces per level, spaces only
//
// Refused, loudly: tabs, odd indentation, flow style (`[a, b]` / `{a: b}`),
// anchors and aliases (`&x` / `*x`), tags (`!!str`), un-chomped block scalars
// (`|` / `>`), multiple documents (`---`), and a duplicate key in one mapping.
//
// 🔴 A DUPLICATE KEY IS AN ERROR, NOT A LAST-WRITE-WINS. `traps.json` ci-33
// records a duplicate YAML key taking a whole workflow down with zero jobs and
// no message any API returned, because every permissive loader accepted it.
// Here the file being parsed is what a public listing is rendered from, so a
// silently-dropped first value is a listing field nobody typed.
// ─────────────────────────────────────────────────────────────────────────────

export class YamlError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'YamlError';
    this.line = line ?? null;
  }
}

const KEY = /^[A-Za-z0-9_.-]+$/;
const INT = /^-?(0|[1-9][0-9]*)$/;
const FLOAT = /^-?(0|[1-9][0-9]*)\.[0-9]+$/;

/** Strip a trailing ` # comment` that begins OUTSIDE any quotes.
 *  A `#` inside a value ("https://x#y", 'a # b') is content, not a comment —
 *  the scanner tracks quote state rather than reaching for a regex, because a
 *  regex over this is exactly the "matched the comment explaining why" defect
 *  the guards in this repo keep being rewritten for. */
function stripInlineComment(body) {
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === '\\') i += 1;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || body[i - 1] === ' ')) {
      return body.slice(0, i).replace(/\s+$/, '');
    }
  }
  return body;
}

/** Does this fragment carry a top-level `key:` — i.e. is it a mapping entry
 *  rather than a plain scalar? Quote-aware for the same reason as above. */
function hasTopLevelColon(body) {
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === '\\') i += 1;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ':' && (i + 1 === body.length || body[i + 1] === ' ')) {
      return true;
    }
  }
  return false;
}

function scalar(text, line) {
  const t = text.trim();
  if (t === '' || t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t[0] === '"') {
    if (t.length < 2 || t[t.length - 1] !== '"') throw new YamlError('unterminated double-quoted scalar', line);
    let out = '';
    for (let i = 1; i < t.length - 1; i += 1) {
      const c = t[i];
      if (c !== '\\') { out += c; continue; }
      const n = t[i + 1];
      i += 1;
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === '"') out += '"';
      else if (n === '\\') out += '\\';
      else throw new YamlError(`unsupported escape \\${n} in a double-quoted scalar`, line);
    }
    return out;
  }
  if (t[0] === "'") {
    if (t.length < 2 || t[t.length - 1] !== "'") throw new YamlError('unterminated single-quoted scalar', line);
    return t.slice(1, -1).split("''").join("'");
  }
  if (t[0] === '[' || t[0] === '{') {
    throw new YamlError('flow style ([...] / {...}) is not part of the subset — write a block sequence or mapping', line);
  }
  if (t[0] === '&' || t[0] === '*') throw new YamlError('anchors and aliases are not part of the subset', line);
  if (t[0] === '!') throw new YamlError('tags (!!str, !x) are not part of the subset', line);
  if (t === '|' || t === '>') {
    throw new YamlError(`the un-chomped block scalar "${t}" is refused — write "${t}-", whose trailing newline this parser models`, line);
  }
  if (INT.test(t)) return Number.parseInt(t, 10);
  if (FLOAT.test(t)) return Number.parseFloat(t);
  return t;
}

/** text -> [{ indent, body, line }], comments and blank lines gone. */
function significantLines(text) {
  const out = [];
  const raw = text.split(/\r?\n/);
  for (let i = 0; i < raw.length; i += 1) {
    const line = i + 1;
    const l = raw[i];
    if (l.includes('\t')) throw new YamlError('tab character — this subset is spaces only', line);
    const right = l.replace(/\s+$/, '');
    if (right === '') continue;
    const indent = right.length - right.trimStart().length;
    let body = right.slice(indent);
    if (body.startsWith('#')) continue;
    if (body === '---' || body === '...') {
      throw new YamlError('document markers (--- / ...) are not part of the subset — one document per file', line);
    }
    body = stripInlineComment(body);
    if (body === '') continue;
    if (indent % 2 !== 0) throw new YamlError(`indent of ${indent} space(s) — this subset uses exactly two per level`, line);
    out.push({ indent, body, line });
  }
  return out;
}

/** Parse the block starting at `lines[i]`, whose entries sit at `indent`.
 *  Returns `[value, next]`. */
function parseBlock(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  if (lines[i].indent !== indent) {
    throw new YamlError(`expected an entry indented ${indent} space(s), found ${lines[i].indent}`, lines[i].line);
  }
  return lines[i].body === '-' || lines[i].body.startsWith('- ')
    ? parseSequence(lines, i, indent)
    : parseMapping(lines, i, indent);
}

function childBlock(lines, i, indent, line) {
  if (i >= lines.length || lines[i].indent <= indent) return [null, i];
  if (lines[i].indent !== indent + 2) {
    throw new YamlError(`nested block is indented ${lines[i].indent}; expected ${indent + 2}`, lines[i].line);
  }
  void line;
  return parseBlock(lines, i, indent + 2);
}

/** `>-` (folded) and `|-` (literal), strip-chomped. The body is every following
 *  line indented further than the key; folded joins them with one space,
 *  literal with a newline. */
function blockScalar(lines, i, indent, marker, line) {
  const body = [];
  while (i < lines.length && lines[i].indent > indent) {
    body.push(lines[i].body);
    i += 1;
  }
  if (body.length === 0) throw new YamlError(`"${marker}" opens a block scalar with nothing indented under it`, line);
  return [body.join(marker === '>-' ? ' ' : '\n'), i];
}

function parseMapping(lines, i, indent) {
  const out = {};
  while (i < lines.length && lines[i].indent === indent) {
    const { body, line } = lines[i];
    if (body === '-' || body.startsWith('- ')) {
      throw new YamlError('a sequence entry cannot sit at the same indent as the mapping keys around it', line);
    }
    const colon = body.indexOf(':');
    if (colon < 0) throw new YamlError(`"${body}" is neither \`key: value\` nor \`- item\``, line);
    const key = body.slice(0, colon).trim();
    if (!KEY.test(key)) throw new YamlError(`key "${key}" is not ${KEY} — this subset keeps keys plain`, line);
    if (Object.hasOwn(out, key)) {
      throw new YamlError(`duplicate key "${key}" — refused rather than last-write-wins (TRAPS ci-33)`, line);
    }
    const rest = body.slice(colon + 1).trim();
    i += 1;
    if (rest === '>-' || rest === '|-') {
      const [text, next] = blockScalar(lines, i, indent, rest, line);
      out[key] = text;
      i = next;
    } else if (rest === '') {
      const [child, next] = childBlock(lines, i, indent, line);
      out[key] = child;
      i = next;
    } else {
      if (i < lines.length && lines[i].indent > indent) {
        throw new YamlError(`"${key}" has both an inline value and an indented block under it`, lines[i].line);
      }
      out[key] = scalar(rest, line);
    }
  }
  return [out, i];
}

function parseSequence(lines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent && (lines[i].body === '-' || lines[i].body.startsWith('- '))) {
    const { body, line } = lines[i];
    const rest = body === '-' ? '' : body.slice(2).trim();
    i += 1;
    if (rest === '') {
      const [child, next] = childBlock(lines, i, indent, line);
      out.push(child);
      i = next;
      continue;
    }
    if (!hasTopLevelColon(rest)) {
      if (i < lines.length && lines[i].indent > indent) {
        throw new YamlError('a scalar sequence entry cannot carry an indented block', lines[i].line);
      }
      out.push(scalar(rest, line));
      continue;
    }
    // `- key: value`, with any continuation lines of the same mapping indented
    // two further. Rebuilt as its own line list so exactly one code path parses
    // a mapping — two would disagree about duplicate keys, which is the one
    // thing this parser refuses hardest.
    const sub = [{ indent: indent + 2, body: rest, line }];
    while (i < lines.length && lines[i].indent >= indent + 2) {
      sub.push(lines[i]);
      i += 1;
    }
    const [map, consumed] = parseMapping(sub, 0, indent + 2);
    if (consumed !== sub.length) {
      throw new YamlError('a sequence entry left lines unparsed — check the indentation under it', sub[consumed].line);
    }
    out.push(map);
  }
  return [out, i];
}

/** Parse `text`. Throws `YamlError` on anything outside the subset. */
export function parseYaml(text) {
  const lines = significantLines(text);
  if (lines.length === 0) return null;
  if (lines[0].indent !== 0) throw new YamlError('the document does not start at column 0', lines[0].line);
  const [value, next] = parseBlock(lines, 0, 0);
  if (next !== lines.length) {
    throw new YamlError('trailing content this parser could not attach to the document', lines[next].line);
  }
  return value;
}
