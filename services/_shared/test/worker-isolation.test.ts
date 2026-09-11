import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// worker-isolation.test.ts — no Worker's module graph may pull in a SIBLING
// Worker's module that carries a bare import.
//
// 🔴 THE FAILURE THIS FILE IS THE RED FOR (#617, 2026-09-11). The first proof
// that both Workers answer `/v1/entitlements` identically lived in
// services/platform/test/one-entitlement-reader.test.ts and imported
// services/subscriptiontracker-api/src/routes/entitlements.ts. That file imports
// `hono`. Node, tsc, esbuild and Vite all resolve a bare specifier by walking up
// from the FILE that writes it, so `hono` was looked for in
// services/subscriptiontracker-api/node_modules — which the platform CI lane
// never installs (each Worker runs its own `npm ci`). Measured in the platform
// lane's shape (api node_modules absent):
//   services/platform $ npx tsc --noEmit
//   ../subscriptiontracker-api/src/routes/entitlements.ts(43,22): error TS2307
//   ../subscriptiontracker-api/src/routes/entitlements.ts(55,21): error TS7006
// On a machine with BOTH Workers installed the same command is green, which is
// why it reached CI: the defect is invisible exactly where it is written.
//
// THE RULE, AND WHY IT IS NOT "NO CROSS-WORKER IMPORT AT ALL". The api Worker's
// test harness legitimately imports services/platform/test/harness.ts for the
// shipped platform_db migrations (it reads that database; a copied list is the
// drift its header records). That file carries no bare import, so it resolves
// the same in every lane. What breaks a lane is a sibling module that needs the
// SIBLING's node_modules — so that is what is refused: every module reachable
// through relative imports from a Worker's src/ or test/ that lives under ANOTHER
// Worker's directory must carry no bare import (`node:` and `cloudflare:`
// builtins resolve without node_modules and are allowed).
//
// ⚠️ A TEST, NOT A tooling/ci GUARD, for the reason shared-home.test.ts gives:
// it runs inside both Workers' `npm test`, in front of the same tsc that would
// otherwise find it, with no new workflow wiring.
// ─────────────────────────────────────────────────────────────────────────────

interface Dirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
const nodeProcess = (
  globalThis as unknown as {
    process: {
      cwd(): string;
      getBuiltinModule(id: 'node:fs'): {
        existsSync(p: string): boolean;
        readFileSync(p: string, enc: 'utf8'): string;
        readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
      };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');

/** The repo root, found by walking up from the cwd (the SERVICE directory under `npm test`). */
function repoRoot(): string {
  const cwd = nodeProcess.cwd().replaceAll('\\', '/');
  for (const up of ['', '/..', '/../..', '/../../..']) {
    const root = normalise(`${cwd}${up}`);
    if (fs.existsSync(`${root}/services/_shared/src`)) return root;
  }
  throw new Error(
    `COVERAGE LOST — no ancestor of ${cwd} holds services/_shared/src, so no Worker can be found and every ` +
      'assertion below would range over an empty set.',
  );
}

/** Collapse `.` and `..` segments of a forward-slash path. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '.' || (seg === '' && out.length > 0)) continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

const SKIP = new Set(['node_modules', '.wrangler', 'dist', 'coverage']);

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) tsFilesUnder(p, out);
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Comments out, so an import spelled in prose is not an import. Strings stay. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Every static module specifier a file imports or re-exports from — multi-line
 *  `import { a,\n b } from '…'` included (shared-home.test.ts's single-line form
 *  would miss the carriers' multi-line imports of the reader). */
export function specifiersOf(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|[;\n])\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

const isRelative = (spec: string): boolean => spec.startsWith('./') || spec.startsWith('../');
export const isBare = (spec: string): boolean =>
  !isRelative(spec) && !spec.startsWith('/') && !spec.startsWith('node:') && !spec.startsWith('cloudflare:');

/** The .ts module a relative specifier names, or null for a data import (`?raw`, .json, .sql). */
function resolveModule(fromFile: string, spec: string): string | null {
  const bare = spec.replace(/\?.*$/, '');
  if (/\.(?:sql|json|txt|md)$/.test(bare) || spec.includes('?')) return null;
  const base = normalise(`${fromFile.slice(0, fromFile.lastIndexOf('/'))}/${bare}`);
  for (const cand of [base.endsWith('.ts') ? base : `${base}.ts`, `${base}/index.ts`]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

const ROOT = repoRoot();
const SERVICES = `${ROOT}/services`;

/** Every Worker, derived from the tree: a services/<name> with a package.json, `_shared` excluded. */
const WORKERS: string[] = fs
  .readdirSync(SERVICES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && fs.existsSync(`${SERVICES}/${e.name}/package.json`))
  .map((e) => e.name)
  .sort();

const workerOf = (file: string): string | null => {
  const m = file.slice(SERVICES.length + 1).match(/^([^/]+)\//);
  return m && WORKERS.includes(m[1]) ? m[1] : null;
};

describe('a Worker never compiles a sibling Worker module that needs the sibling’s node_modules', () => {
  it('the scan finds the Workers and their modules', () => {
    expect(WORKERS.length, `only ${WORKERS.length} Worker(s) under ${SERVICES} — the scan is broken`).toBeGreaterThanOrEqual(2);
    for (const w of WORKERS) {
      expect(tsFilesUnder(`${SERVICES}/${w}/src`).length, `services/${w}/src has no .ts — the walk is broken`).toBeGreaterThan(0);
    }
  });

  it('the specifier and bare-import reads are not vacuous', () => {
    const sample = "import { Hono } from 'hono';\nimport {\n  type A,\n  b,\n} from '../../_shared/src/x';\n// import z from 'prose'\nimport type { D } from 'node:sqlite';\n";
    expect(specifiersOf(sample)).toEqual(['hono', '../../_shared/src/x', 'node:sqlite']);
    expect(specifiersOf(sample).filter(isBare)).toEqual(['hono']);
  });

  it('no module reachable from a Worker, living under ANOTHER Worker, carries a bare import', () => {
    const offenders: string[] = [];
    for (const w of WORKERS) {
      const roots = [...tsFilesUnder(`${SERVICES}/${w}/src`), ...tsFilesUnder(`${SERVICES}/${w}/test`)];
      const seen = new Set<string>(roots);
      const queue = roots.map((f) => ({ file: f, via: [f] }));
      while (queue.length > 0) {
        const { file, via } = queue.shift()!;
        const specs = specifiersOf(fs.readFileSync(file, 'utf8'));
        const owner = workerOf(file);
        if (owner !== null && owner !== w) {
          const bare = specs.filter(isBare);
          if (bare.length > 0) {
            offenders.push(
              `services/${w} reaches ${file.slice(ROOT.length + 1)} (via ${via.map((p) => p.slice(ROOT.length + 1)).join(' → ')}), ` +
                `which imports ${bare.map((b) => `\`${b}\``).join(', ')}. That resolves only from services/${owner}/node_modules, ` +
                `which the services/${w} lane never installs: its \`tsc --noEmit\` fails with TS2307 in CI while passing on a ` +
                'machine where both Workers are installed. Move the shared part to services/_shared (dependency-free), or ' +
                'assert the shared answer from each Worker’s own suite (see _shared/test/entitlement-parity.ts).',
            );
          }
        }
        for (const spec of specs) {
          if (!isRelative(spec)) continue;
          const target = resolveModule(file, spec);
          if (target === null || seen.has(target)) continue;
          seen.add(target);
          queue.push({ file: target, via: [...via, target] });
        }
      }
    }
    expect(offenders, offenders.join('\n\n')).toEqual([]);
  });
});
