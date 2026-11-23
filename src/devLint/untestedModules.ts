/**
 * The untested-modules gate (enforced test coverage) — a production module under
 * `src/` that no file in the test tree so much as imports.
 *
 * ## Why this is not the coverage ratchet, and why both exist
 *
 * `coverage-ratchet` measures PERCENTAGES: four repo-wide minimums plus a statement floor per `src/<dir>`.
 * That answers "how much of what the suite runs is covered" and it cannot answer "is this module reached at
 * all", because a directory can sit comfortably above its floor while individual modules inside it have
 * never been imported by a test. The two are complements and neither subsumes the other: this gate measures
 * an EDGE, `coverage-ratchet` measures execution.
 *
 * ## The criterion — one sentence, no allowlist, no exemption marker
 *
 * A `.ts` file under `src/`, outside `src/__tests__/`, that EXPORTS A VALUE and is imported by no file
 * under `src/__tests__/`.
 *
 * State that sentence whenever you quote this class, never a count. Three clauses earn their place:
 *
 * - **"imported by", not "has a mirrored test file".** The mirrored-path rule (`src/foo/bar.ts` wants
 *   `src/__tests__/unit/foo/bar.test.ts`) was measured first and REJECTED, because this repository refutes
 *   it in its own words: `src/devLint/coverageFloor.ts`'s header says its functions are unit-tested under
 *   `src/__tests__/unit/devLint/coverageRatchet/` — a pure core deliberately tested through its sibling's tests. A
 *   mirrored-path gate calls that uncovered forever and the only way to satisfy it is to split a test file
 *   to please a path. MEASURED: the mirror rule reports 1,904 modules, the import edge 813.
 *   Reproduce the gate's own half with `yarn devlint:untested-rebaseline`.
 * - **The whole test TREE, not the unit lane.** Integration, subprocess and replay tests all live under
 *   `src/__tests__/`, so a module proven only end-to-end counts as reached. A gate that recognised only the
 *   unit lane would price the other three lanes at zero.
 * - **"exports a value" excludes a shape BY CONSTRUCTION rather than by allowlist.** A `*.entry.ts` whose
 *   whole body is `process.exit(run…())` exports nothing; a module of `interface`s and `type`s exports
 *   nothing a unit test could call. There is no honest test to write for either, so neither is in scope —
 *   the same move `epoch-arithmetic` makes when it says the legitimate shapes are already outside its
 *   criterion. MEASURED: 82 of the 813 are this shape, leaving 731 — and the list this
 *   branch commits holds 735, because `main` landed four more while the gate was being built. That churn
 *   ENDS when this lands: from then on, main itself cannot add an untested module without the gate
 *   refusing it. Reproduce: `rm .baselines/untested-modules-baseline.json && yarn devlint:untested-rebaseline`.
 *
 * ## Its residue, stated rather than discovered
 *
 * - **An import is not an assertion.** A test that imports a module only to build a fixture counts as
 *   covering it here. That is the cost of a syntax-only edge, and it is why `coverage-ratchet` is not
 *   retired by this gate.
 * - **`import type` counts too.** Separating a type-only edge from a value edge needs resolved types, and
 *   `devLint.ts`'s header says what a second whole-repo `ts.Program` costs. The looser edge is taken on
 *   purpose.
 * - **Transitive coverage is invisible.** A module whose only consumer is another production module that IS
 *   tested reads as untested. It lands in the baseline rather than in a refusal, so it only ever bites on a
 *   genuinely new file, which is the right place for it to bite.
 *
 * ## The debt list is a committed baseline, and it can only shrink
 *
 * {@link BASELINE_FILE} names today's untested modules by path. The gate REFUSES a module that is untested
 * and absent from that list — a new file with no test, or an existing one whose last test import was
 * deleted. `--rebaseline` tightens the committed set to the current one and **REFUSES to add any path the
 * committed set did not already carry**, which is one notch stricter than `file-size-ratchet` and
 * `no-silent-fallback`, where a rebaseline may still record a brand-new entry. A list no verb can widen is
 * not an allowlist.
 *
 * **Which leaves exactly one way to write the first one, and it is self-limiting.** A rebaseline run when
 * the committed file does not EXIST writes the current set and says so: creating a list where there is none
 * is not widening one. The file is committed from that moment, so the seed path can only ever be reached
 * again by deleting it — a deliberate act, visible in the diff, that review sees. There is no flag for it
 * and no marker.
 *
 * Pure cores ({@link importedPathsOf}, {@link resolveSpecifier}, {@link exportsValue}, {@link untestedOf},
 * {@link parseBaselineJson}, {@link regressionsOf}, {@link widenedOf}) are unit-tested; the thin
 * {@link runUntestedModules} edge reads the tree, the baseline file, and prints.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { z } from "zod";
import { hasModifier, moduleSpecifiers, ts, withSourceFile } from "#lib/tsSyntax.js";
import { ok, type Result } from "../lib/result.js";
import { decodeDebtList } from "./decodeDebtList.js";
import type { DevLintInputError } from "./errors.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { gateSelfFiles, repoRoot, type ScanScope, scopedScanFiles } from "./scanScope.js";

/** The committed debt list, repo-relative. */
export const BASELINE_FILE = ".baselines/untested-modules-baseline.json";

/** The subpath-import root `package.json` declares, so `#lib/x.js` resolves the same way the runtime does. */
const LIB_SUBPATH = "#lib/";

/** Where `#lib/` points. */
const LIB_ROOT = "src/lib";

/**
 * Every module specifier a source text imports, dynamic `import()` and re-exports included. Pure — gives the syntax
 * tree's answer through {@link moduleSpecifiers} rather than a regex, so a specifier inside a string, a comment or a
 * regular expression is never counted.
 *
 * @param path the importing file's path, which a TypeScript 7 reader parses by
 * @param content the file's text
 * @returns each specifier exactly as written
 */
export function importedPathsOf({ path, content }: { path: string; content: string }): readonly string[] {
  return moduleSpecifiers({ fileName: path, text: content });
}

/**
 * Resolve one specifier to a repo-relative `.ts` path, or `undefined` when it names something outside this
 * repository (a package, a `node:` builtin). Pure — the `.js` suffix an ESM specifier carries maps back to
 * the `.ts` on disk, which is what every import in this tree is written as.
 *
 * @param fromPath the repo-relative path of the importing file
 * @param specifier the specifier exactly as written
 * @returns the repo-relative `.ts` path it names, or `undefined`
 */
export function resolveSpecifier({ fromPath, specifier }: { fromPath: string; specifier: string }): string | undefined {
  let joined: string;
  if (specifier.startsWith(".")) {
    joined = normalize(join(dirname(fromPath), specifier));
  } else if (specifier.startsWith(LIB_SUBPATH)) {
    joined = normalize(join(LIB_ROOT, specifier.slice(LIB_SUBPATH.length)));
  } else {
    return undefined;
  }
  if (joined.endsWith(".js")) {
    return `${joined.slice(0, -".js".length)}.ts`;
  }
  if (joined.endsWith(".ts")) {
    return joined;
  }
  return `${joined}.ts`;
}

/** The statement kinds that put a runnable value into a module's public surface. */
const VALUE_STATEMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.VariableStatement,
]);

/** Whether a statement carries the `export` keyword. */
function isExported({ statement }: { statement: ts.Statement }): boolean {
  return hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node: statement });
}

/**
 * Whether a module exports anything a unit test could call — a function, class, enum, `const`, a default
 * export, or a value re-export. Pure. A module of nothing but `interface` and `type` returns false, and is
 * therefore outside this gate's criterion rather than exempted by it.
 *
 * @param content the file's text
 * @returns true when the module puts a runnable value into its public surface
 */
export function exportsValue({ content }: { content: string }): boolean {
  return withSourceFile({
    fileName: "m.ts",
    text: content,
    use: (source): boolean => {
      for (const statement of source.statements) {
        if (ts.isExportAssignment(statement)) {
          return true;
        }
        if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
          return true;
        }
        if (VALUE_STATEMENTS.has(statement.kind) && isExported({ statement })) {
          return true;
        }
      }
      return false;
    },
  });
}

/**
 * Every production module that exports a value and is imported by no test-tree file. Pure — the property
 * the gate enforces.
 *
 * @param valueExporting every production module that exports a value, repo-relative
 * @param importedByTests every repo-relative path the test tree imports
 * @returns the untested modules, in path order
 */
export function untestedOf({
  valueExporting,
  importedByTests,
}: {
  valueExporting: readonly string[];
  importedByTests: ReadonlySet<string>;
}): readonly string[] {
  return valueExporting.filter((path) => !importedByTests.has(path)).toSorted((a, b) => a.localeCompare(b));
}

/** The committed debt list: every module that was untested when it was cut. */
export interface UntestedBaseline {
  readonly modules: readonly string[];
}

const baselineSchema = z.object({ modules: z.array(z.string().min(1)) });

/**
 * Decode a committed baseline file. Pure.
 *
 * The two failure sentences are {@link decodeDebtList}'s, not this file's — see its header for why a fifth
 * gate keeping a debt list must add no error shape of its own.
 *
 * @param text the baseline file text
 * @returns the baseline, or one sentence naming which half of the decode failed
 */
export function parseBaselineJson({ text }: { text: string }): Result<UntestedBaseline, DevLintInputError> {
  return decodeDebtList({
    label: "untested-modules baseline",
    schema: baselineSchema,
    shape: '{ modules: ["path", …] }',
    text,
  });
}

/**
 * Every currently untested module the committed list does not carry. Pure — what the compare branch
 * refuses.
 *
 * @param current every currently untested module
 * @param baseline the committed debt list
 * @returns each path that is new, in path order (empty when the ratchet holds)
 */
export function regressionsOf({
  current,
  baseline,
}: {
  current: readonly string[];
  baseline: UntestedBaseline;
}): readonly string[] {
  const committed = new Set(baseline.modules);
  return current.filter((path) => !committed.has(path));
}

/**
 * Whether a rebaseline would WIDEN the committed list. Pure — identical to {@link regressionsOf} today, and
 * named separately because the two answer different questions: one is "what does this run refuse", the
 * other is "may this rebaseline be written at all". A list that a rebaseline could widen is an allowlist.
 *
 * @param current every currently untested module
 * @param baseline the committed debt list
 * @returns each path a rebaseline would add, in path order (empty when it may be written)
 */
export function widenedOf({
  current,
  baseline,
}: {
  current: readonly string[];
  baseline: UntestedBaseline;
}): readonly string[] {
  return regressionsOf({ baseline, current });
}

/** This gate's declared scan predicate for PRODUCTION modules: `.ts` under `src/`, the test tree excluded. */
const SOURCE_SCOPE: ScanScope = {
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "untestedModules" }),
  trees: ["src/"],
};

/** And for the test tree: every `.ts` under `src/__tests__/`, helpers and setup files included. */
const TEST_SCOPE: ScanScope = {
  onlyTestsDir: true,
  selfFiles: new Set<string>(),
  trees: ["src/"],
};

/** Read the tree once: which production modules export a value, and what the test tree imports. */
function measure({ root }: { root: string }): { untested: readonly string[]; sources: number } {
  const importedByTests = new Set<string>();
  for (const path of scopedScanFiles({ root, scope: TEST_SCOPE })) {
    const content = readFileSync(join(root, path), "utf8");
    for (const specifier of importedPathsOf({ content, path })) {
      const resolved = resolveSpecifier({ fromPath: path, specifier });
      if (resolved !== undefined) {
        importedByTests.add(resolved);
      }
    }
  }
  const sources = scopedScanFiles({ root, scope: SOURCE_SCOPE });
  const valueExporting: string[] = [];
  for (const path of sources) {
    if (importedByTests.has(path)) {
      continue;
    }
    if (exportsValue({ content: readFileSync(join(root, path), "utf8") })) {
      valueExporting.push(path);
    }
  }
  return { sources: sources.length, untested: untestedOf({ importedByTests, valueExporting }) };
}

/**
 * Load the committed baseline, or say why it could not be read. `undefined` means the file is ABSENT, which
 * is the one state a rebaseline may write into; every other failure is an error.
 */
function loadBaseline({
  baselinePath,
}: {
  baselinePath: string;
}): Result<UntestedBaseline | undefined, DevLintInputError> {
  let text: string;
  try {
    text = readFileSync(baselinePath, "utf8");
  } catch {
    return ok(undefined);
  }
  return parseBaselineJson({ text });
}

/** Write the committed list. Both the seed and a tightening land here, so they cannot drift in format. */
function writeList({ baselinePath, modules }: { baselinePath: string; modules: readonly string[] }): void {
  writeFileSync(baselinePath, `${JSON.stringify({ modules }, null, 2)}\n`);
}

/** The one write that may create a list: there was no committed file, so nothing was widened. */
function seedBaseline({ baselinePath, current }: { baselinePath: string; current: readonly string[] }): number {
  writeList({ baselinePath, modules: current });
  process.stdout.write(`untested-modules: seeded a new debt list with ${String(current.length)} module(s)\n`);
  return 0;
}

/** The `--rebaseline` branch: write the current set, or refuse a write that would widen it. */
function applyRebaseline({
  baselinePath,
  current,
  widened,
}: {
  baselinePath: string;
  current: readonly string[];
  widened: readonly string[];
}): number {
  if (widened.length > 0) {
    for (const path of widened) {
      process.stderr.write(`  ${path}: untested and not on the committed list\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "untested-modules-rebaseline" }),
        detail: `${String(widened.length)} module(s) would be added`,
      })}\n`,
    );
    return 1;
  }
  writeList({ baselinePath, modules: current });
  process.stdout.write(`untested-modules: debt list tightened to ${String(current.length)} module(s)\n`);
  return 0;
}

/** The compare branch: pass, or name every module that is untested and not on the committed list. */
function reportRegressions({
  current,
  regressions,
  sources,
}: {
  current: readonly string[];
  regressions: readonly string[];
  sources: number;
}): number {
  if (regressions.length === 0) {
    process.stdout.write(
      `untested-modules: clean (${String(current.length)} untested of ${String(sources)} module(s))\n`,
    );
    return 0;
  }
  for (const path of regressions) {
    process.stderr.write(`  ${path}: exports a value and no file under src/__tests__/ imports it\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "untested-modules" }),
      detail: `${String(regressions.length)} module(s) with no test`,
    })}\n`,
  );
  return 1;
}

/**
 * IO edge: measure every untested module against the committed debt list, or (`--rebaseline`) tighten the
 * list to the current set.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runUntestedModules(): number {
  let root: string;
  try {
    root = repoRoot();
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found, or
    // its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("untested-modules: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const baselinePath = join(root, BASELINE_FILE);
  const baseline = loadBaseline({ baselinePath });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`untested-modules: ${baseline.error.message}\n`);
    return 1;
  }
  const committed = baseline.value;
  const rebaselining = process.argv.includes("--rebaseline");
  if (committed === undefined) {
    if (!rebaselining) {
      // devlint: not-a-refusal -- the committed debt list is not there, so the gate has nothing to judge against
      process.stderr.write(`untested-modules: debt list missing at ${baselinePath} — seed it with --rebaseline\n`);
      return 1;
    }
    return seedBaseline({ baselinePath, current: measure({ root }).untested });
  }
  const { sources, untested } = measure({ root });
  if (rebaselining) {
    return applyRebaseline({
      baselinePath,
      current: untested,
      widened: widenedOf({ baseline: committed, current: untested }),
    });
  }
  return reportRegressions({
    current: untested,
    regressions: regressionsOf({ baseline: committed, current: untested }),
    sources,
  });
}
