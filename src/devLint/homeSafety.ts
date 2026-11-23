/**
 * The home-safety gate — two halves over the same subject, refusing a test that reaches the operator's real
 * `~/.slopweaver`: a test file that calls a home-defaulting export without passing `home` (code-quality
 * survey item 10), and a test-tree file that resolves a home from `process.env["SLOPWEAVER_HOME"]` itself
 * (`envHomeReadLines` in `homeEnvReads.ts`, which carries that half's own measurement and pool).
 *
 * ## The failure this closes
 *
 * 184 production signatures take an optional `home?: string` and 120 of them default it to the real
 * `slopweaverHome()` when the caller omits it, in one of three spellings (`home = slopweaverHome()`,
 * `home ?? slopweaverHome()`, `home: home ?? slopweaverHome()`). A test that omits `home` at the call site
 * does not fail — it silently READS AND WRITES the developer's real `~/.slopweaver`. The discipline that
 * prevents this today is convention (239 of 242 corpus/store test files already build a `mkdtempSync` temp
 * dir and pass it through), not construction. This gate makes the convention structural.
 *
 * ## Why the check is per CALL SITE, not "the file mentions `mkdtempSync` somewhere"
 *
 * A first pass of this gate flagged any test importing a home-defaulting module that lacked `mkdtempSync`
 * anywhere in the file — and immediately flagged `stateHome.test.ts`, which passes `home` explicitly on
 * every call (`stateHomePaths({ home })` against a plain string, since the function under test is a pure
 * path builder with no I/O to isolate). Requiring a temp directory when `home` is already supplied is the
 * wrong bar; the actual failure is OMISSION. So this walks the AST for calls to a home-defaulting export and
 * flags only a call with zero arguments, or a single object-literal argument with no `home` property. A call
 * whose argument is a variable or a spread is left alone — genuinely unanalysable without resolved types,
 * and guessing wrong in either direction is worse than declining (`../handover/probe.js`'s own header makes
 * the same call for a different reason).
 *
 * ## What counts as "home-defaulting", and the limitation that follows from it
 *
 * A top-level EXPORTED declaration counts as home-defaulting when its own subtree contains a call to
 * `slopweaverHome()` — covering a function whose parameter defaults through it, and a constant computed
 * from it directly. This is deliberately ONE HOP: a test importing a CLI wrapper that forwards `home` on to
 * a home-defaulting store in a DIFFERENT file is not caught, because the wrapper's own declaration never
 * calls `slopweaverHome()`. Closing that would need a real import graph, which is exactly the whole-repo
 * `ts.Program` cost `devLint.ts`'s own header warns a bespoke gate away from paying twice.
 *
 * The same construction excludes a CLI verb runner that resolves `--home` out of an `argv`/`rest` array
 * ({@link hasHomeParameter}'s whole reason for existing), and that exclusion is where the real leak was
 * found: `retargetRun.test.ts` wrote a `verb:github.pr retarget` door record to the developer's own
 * `~/.slopweaver` on every lap. Do NOT widen this gate to reach it: a syntax-only criterion flags every test
 * calling such a runner without a literal `"--home"` in its argv, which is an order of magnitude more files
 * than actually write, because most pass `home` through an injected dep no AST walk can follow. That half is
 * closed at RUNTIME instead, by `src/__tests__/setup-ambient-home.ts`, which every lane loads and which
 * names the true set — `SLOPWEAVER_HOME=$(mktemp -d) yarn vitest run --config config/vitest/unit.ts &&
 * find "$SLOPWEAVER_HOME"`. The two are complements.
 *
 * The runtime guard has a construction limit of its own, and `envHomeReadLines` is the static half
 * that covers it: the sandbox is installed in a `beforeAll`, so a MODULE-scope environment read runs before
 * it exists and the resulting write lands outside the directory the guard watches. Three checks, each blind
 * where the next one sees.
 *
 * Pure core ({@link homeDefaultingExportNames}, {@link scanHomeSafety} and their helpers) + effectful shell
 * ({@link runHomeSafety}), same split as every other AST-walking gate here.
 */

import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { forEachChild, hasModifier, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { appendAll } from "../lib/arrays.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { callOmitsHome, namedImports, resolvedImportPath } from "./homeCallSites.js";
import { type EnvHomeReadHit, EXEMPT_MARKER, isExempted, scanEnvHomeReads } from "./homeEnvReads.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { gateSelfFiles, isScannablePath, repoRoot, type ScanScope, scopedScanFiles } from "./scanScope.js";

/** The name every home-defaulting declaration calls. */
const HOME_DEFAULT_FN = "slopweaverHome";

/** Whether `node` (or anything beneath it) calls `slopweaverHome()`. */
function callsHomeDefault({ node }: { node: ts.Node }): boolean {
  // A truthy visit stops `forEachChild`, so the first matching call ends the whole walk.
  const visit: NodeVisitor<boolean> = (n) =>
    (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === HOME_DEFAULT_FN) ||
    forEachChild({ node: n, visit });
  return visit(node) === true;
}

/** A declaration's parameter list, when it is a function/arrow expression — `undefined` for anything else. */
function functionParametersOf({ node }: { node: ts.Node | undefined }): readonly ts.ParameterDeclaration[] | undefined {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    ? node.parameters
    : undefined;
}

/**
 * Whether the SOLE parameter is a destructured object binding that names a `home` property — shorthand
 * (`{ home }`) or renamed (`{ home: renamed }`), with or without a default.
 *
 * This is what tells `runGithubMerge({ argv, deps })` apart from `stateHomePaths({ home })`: the former also
 * reaches `slopweaverHome()` somewhere in its body (resolving a `--home` flag parsed OUT OF `argv`), but its
 * own call-site contract has no `home` property to check at all — flagging every call to it would be a false
 * positive on the one shape this repo actually uses for a home-defaulting parameter.
 *
 * @param parameters the declaration's parameter list
 * @returns true when the sole parameter destructures a `home` property
 */
function hasHomeParameter({ parameters }: { parameters: readonly ts.ParameterDeclaration[] }): boolean {
  if (parameters.length !== 1) {
    return false;
  }
  const [sole] = parameters;
  return (
    sole !== undefined &&
    ts.isObjectBindingPattern(sole.name) &&
    sole.name.elements.some((element) => {
      const key = element.propertyName ?? element.name;
      return key !== undefined && ts.isIdentifier(key) && key.text === "home";
    })
  );
}

/** The exported name of a `function` declaration, when its home-shaped parameter defaults through `slopweaverHome()`. */
function homeDefaultingFunctionName({ node }: { node: ts.FunctionDeclaration }): string | undefined {
  return node.name !== undefined && hasHomeParameter({ parameters: node.parameters }) && callsHomeDefault({ node })
    ? node.name.text
    : undefined;
}

/** Every declared name in an exported `const`/`let` statement whose initializer is a home-defaulting function. */
function homeDefaultingVariableNames({ node }: { node: ts.VariableStatement }): readonly string[] {
  return node.declarationList.declarations.flatMap((decl) => {
    const parameters = functionParametersOf({ node: decl.initializer });
    return ts.isIdentifier(decl.name) &&
      parameters !== undefined &&
      hasHomeParameter({ parameters }) &&
      callsHomeDefault({ node: decl })
      ? [decl.name.text]
      : [];
  });
}

/**
 * Every top-level exported function whose SOLE parameter destructures a `home` property and whose subtree
 * calls `slopweaverHome()` — the shape {@link hasHomeParameter} exists to isolate from a CLI-verb function
 * that reaches `slopweaverHome()` some other way (resolving a `--home` flag deep inside an `argv` it parses).
 *
 * A raw substring check on `"slopweaverHome()"` cannot even find the right CALLS: `homeDir.ts`'s own
 * `export function slopweaverHome(): string {` contains that exact substring (the empty parameter list
 * immediately followed by its return-type colon), which would misname the function's own declaration as
 * "home-defaulting". Requiring an actual `CallExpression` sidesteps that trap.
 *
 * @param content the file's text
 * @returns the exported names that default to the real ambient home
 */
export function homeDefaultingExportNames({ content }: { content: string }): readonly string[] {
  return withSourceFile({
    fileName: "scan.ts",
    text: content,
    use: (sourceFile): readonly string[] => {
      const names: string[] = [];
      sourceFile.forEachChild((node) => {
        if (!hasModifier({ kind: ts.SyntaxKind.ExportKeyword, node })) {
          return;
        }
        if (ts.isFunctionDeclaration(node)) {
          const name = homeDefaultingFunctionName({ node });
          if (name !== undefined) {
            names.push(name);
          }
        } else if (ts.isVariableStatement(node)) {
          appendAll({ from: homeDefaultingVariableNames({ node }), into: names });
        }
      });
      return names;
    },
  });
}

/**
 * One home-defaulting call a test file makes without providing `home`.
 *
 * @internal — no caller outside this module needs the shape by name; `scanHomeSafety`'s callers destructure it.
 */
export interface HomeSafetyHit {
  readonly path: string;
  /** The home-defaulting names called without `home`, deduplicated. */
  readonly calls: readonly string[];
}

/**
 * Every home-defaulting call a test file makes that provably omits `home`.
 *
 * @param importerPath the test file's repo-relative path
 * @param content the test file's text
 * @param homeDefaultingExports every home-defaulting export name, keyed by its repo-relative file
 * @returns the called names that omit `home`, deduplicated, or empty when the file is safe
 */
export function unsafeHomeCalls({
  importerPath,
  content,
  homeDefaultingExports,
}: {
  importerPath: string;
  content: string;
  homeDefaultingExports: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly string[] {
  const riskyLocalNames = new Set<string>();
  for (const { local, imported, specifier } of namedImports({ content })) {
    const resolved = resolvedImportPath({ importerPath, specifier });
    if (resolved !== undefined && (homeDefaultingExports.get(resolved) ?? new Set()).has(imported)) {
      riskyLocalNames.add(local);
    }
  }
  if (riskyLocalNames.size === 0) {
    return [];
  }
  return withSourceFile({
    fileName: "scan.ts",
    text: content,
    use: (sourceFile): readonly string[] => {
      const unsafe = new Set<string>();
      const visit: NodeVisitor = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          riskyLocalNames.has(node.expression.text) &&
          callOmitsHome({ node }) &&
          !isExempted({ node, sourceFile })
        ) {
          unsafe.add(node.expression.text);
        }
        forEachChild({ node, visit });
      };
      visit(sourceFile);
      return [...unsafe];
    },
  });
}

/**
 * Every test file that calls a home-defaulting export without providing `home`.
 *
 * @param testFiles every scanned `*.test.ts` file, path plus content
 * @param homeDefaultingExports every home-defaulting export name, keyed by its repo-relative file
 * @returns one hit per unsafe test file, in scan order
 */
export function scanHomeSafety({
  testFiles,
  homeDefaultingExports,
}: {
  testFiles: readonly { path: string; content: string }[];
  homeDefaultingExports: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly HomeSafetyHit[] {
  const hits: HomeSafetyHit[] = [];
  for (const { path, content } of testFiles) {
    const calls = unsafeHomeCalls({ content, homeDefaultingExports, importerPath: path });
    if (calls.length > 0) {
      hits.push({ calls, path });
    }
  }
  return hits;
}

/**
 * The gate's own files, excluded from every scope below: its triad, plus the call-site reader split out of this
 * file — by its exact repo path, since a basename would also drop a same-named file elsewhere — so the scan
 * set is the one it was before the split.
 */
const HOME_SAFETY_SELF_FILES: ReadonlySet<string> = new Set([
  ...gateSelfFiles({ stem: "homeSafety" }),
  "src/devLint/homeCallSites.ts",
]);

/** Every non-test `.ts` file under `src/`, `eval/` and `hooks/` — the pool a "home-defaulting module" is drawn from. */
const SOURCE_SCOPE: ScanScope = {
  excludeTests: true,
  selfFiles: HOME_SAFETY_SELF_FILES,
  trees: ["src/", "eval/", "hooks/"],
};

/** Every `*.test.ts` file, the pool the home-defaulting-call half of this gate checks. */
const TEST_SCOPE: ScanScope = { onlyTests: true, selfFiles: HOME_SAFETY_SELF_FILES, trees: [] };

/**
 * Every file under `src/__tests__/`, the pool the env-home-read half checks — setup files and helpers
 * included, which {@link TEST_SCOPE} deliberately is not: `setup-polly.ts` is neither a test file nor
 * source, and it is the file this class was found in.
 */
const TEST_TREE_SCOPE: ScanScope = {
  onlyTestsDir: true,
  selfFiles: HOME_SAFETY_SELF_FILES,
  trees: ["src/"],
};

/**
 * Whether a repo-relative path is in scope for either half of this gate.
 *
 * @param path the repo-relative path
 * @returns true when the path is a source file or a test file this gate examines
 */
export function isScannablePathForHomeSafety({ path }: { path: string }): boolean {
  return (
    isScannablePath({ path, scope: SOURCE_SCOPE }) ||
    isScannablePath({ path, scope: TEST_SCOPE }) ||
    isScannablePath({ path, scope: TEST_TREE_SCOPE })
  );
}

/** Read every test path's content, sorting failures into `unreadable` rather than throwing. */
function readTestFiles({
  testPaths,
  readText,
}: {
  testPaths: readonly string[];
  readText: (args: { path: string }) => string;
}): {
  readonly testFiles: readonly { path: string; content: string }[];
  readonly unreadable: readonly { path: string; reason: string }[];
} {
  const testFiles: { path: string; content: string }[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  for (const path of testPaths) {
    try {
      testFiles.push({ content: readText({ path }), path });
    } catch (error) {
      unreadable.push({ path, reason: error instanceof Error ? error.message : "read failed" });
    }
  }
  return { testFiles, unreadable };
}

/**
 * Print the final verdict: clean, or one line per offending file across BOTH halves.
 *
 * Both halves are reported in one pass with no short-circuit, matching `yarn lint`'s own contract that one
 * run tells you everything that is wrong.
 */
function reportHomeSafety({
  hits,
  envHits,
  sourcesScanned,
  testsScanned,
  treeFilesScanned,
}: {
  hits: readonly HomeSafetyHit[];
  envHits: readonly EnvHomeReadHit[];
  sourcesScanned: number;
  testsScanned: number;
  treeFilesScanned: number;
}): number {
  if (hits.length === 0 && envHits.length === 0) {
    process.stdout.write(
      `home-safety: clean (${String(sourcesScanned)} source file(s), ${String(testsScanned)} test file(s), ` +
        `${String(treeFilesScanned)} test-tree file(s) scanned)\n`,
    );
    return 0;
  }
  if (hits.length > 0) {
    for (const hit of hits) {
      process.stderr.write(`  ${hit.path}: ${hit.calls.join(", ")} — this reads and writes the real ~/.slopweaver\n`);
    }
  }
  if (envHits.length > 0) {
    for (const hit of envHits) {
      process.stderr.write(
        `  ${hit.path}:${hit.lines.map(String).join(",")} — the ambient-home sandbox is installed in a ` +
          `\`beforeAll\`, so a read reaches the operator's REAL home; use ` +
          `\`realAmbientHome()\` (src/__tests__/realAmbientHome.ts) on the record lane or the paid Codex acceptance run, or mark the line ` +
          `\`${EXEMPT_MARKER}\` with a reason\n`,
      );
    }
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "home-safety" }),
      detail: `${String(hits.length + envHits.length)} test file(s)`,
    })}\n`,
  );
  return 1;
}

/**
 * Whether one of this gate's three scans read everything it listed, reporting any unreadable file to stderr.
 *
 * Every scan is evaluated before the verdict is taken (the caller collects all three, then checks), so one
 * unreadable file does not hide another — the same no-short-circuit contract `yarn lint` itself has.
 *
 * @param label the scan's name, appended to this gate's own
 * @param scanned how many files the scan actually read
 * @param unreadable the files it could not read, each with the reason
 * @returns true when nothing was unreadable
 */
function scanComplete({
  label,
  scanned,
  unreadable,
}: {
  label: string;
  scanned: number;
  unreadable: readonly { path: string; reason: string }[];
}): boolean {
  return reportScanIntegrity({
    label: `home-safety (${label})`,
    scanned,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
}

/**
 * IO edge: build the home-defaulting export map from every non-test source file, then check every test file
 * against it, printing each violation.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runHomeSafety(): number {
  let root: string;
  let sourcePaths: readonly string[];
  let testPaths: readonly string[];
  let treePaths: readonly string[];
  try {
    root = repoRoot();
    sourcePaths = scopedScanFiles({ root, scope: SOURCE_SCOPE });
    testPaths = scopedScanFiles({ root, scope: TEST_SCOPE });
    treePaths = scopedScanFiles({ root, scope: TEST_TREE_SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("home-safety: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const readText = ({ path }: { path: string }): string => readFileSync(posix.join(root, path), "utf8");

  const sourceScan = scanTextFiles<[string, readonly string[]]>({
    paths: sourcePaths,
    readText,
    scan: ({ path, content }) => {
      const names = homeDefaultingExportNames({ content });
      return names.length > 0 ? [[path, names]] : [];
    },
  });
  const homeDefaultingExports = new Map(sourceScan.hits.map(([path, names]) => [path, new Set(names)]));
  const { testFiles, unreadable: unreadableTests } = readTestFiles({ readText, testPaths });
  const { testFiles: treeFiles, unreadable: unreadableTree } = readTestFiles({ readText, testPaths: treePaths });

  const complete = [
    scanComplete({ label: "source scan", scanned: sourceScan.scanned, unreadable: sourceScan.unreadable }),
    scanComplete({ label: "test scan", scanned: testFiles.length, unreadable: unreadableTests }),
    scanComplete({ label: "test-tree scan", scanned: treeFiles.length, unreadable: unreadableTree }),
  ];
  if (complete.includes(false)) {
    return 1;
  }

  const hits = scanHomeSafety({ homeDefaultingExports, testFiles });
  const envHits = scanEnvHomeReads({ treeFiles });
  return reportHomeSafety({
    envHits,
    hits,
    sourcesScanned: sourceScan.scanned,
    testsScanned: testFiles.length,
    treeFilesScanned: treeFiles.length,
  });
}
