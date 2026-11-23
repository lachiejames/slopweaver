/**
 * The gate that stops a command module shipping with no test importing it at all.
 *
 * ## The property, and its limits — stated up front
 *
 * This checks ONE thing: every module a manifest can load is imported by a collected unit test, directly or
 * through a test-tree helper that test imports ({@link reachableTestSources}). That is
 * weaker than "is tested", and deliberately so, because the stronger text-based versions are forgeable and
 * a gate that overclaims is the defect this repo keeps paying for.
 *
 * Specifically, this does NOT prove the module's behaviour is exercised, that the manifest-selected export
 * is the thing invoked, or that any assertion depends on it. Two other checks cover the neighbouring ground:
 * {@link unresolvedVerbs} below awaits every real loader and fails when a manifest names an export that does
 * not exist, and the per-command suites under `src/__tests__/unit/cli/commands` exercise behaviour.
 *
 * ## Why the enumeration comes from the manifests
 *
 * The obvious inventory — globbing every `run.ts` one level under `src/cli/commands` — misses five real
 * loader targets, including
 * `slack/lifecycleRun.ts` and `slack/pollRun.ts`, the two door-routed external-write modules. Measured
 * against that glob the answer was "six untested"; measured against the manifests it was eleven, and the
 * five it missed were the ones that most needed a test.
 *
 * ## The ESM trap
 *
 * A manifest imports `../commands/x/run.js`; the file on disk is `run.ts`. Comparing the literal `.ts` path
 * against test sources reports EVERY module as untested. The specifier is normalised here for that reason.
 */

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { ts, withSourceFile } from "#lib/tsSyntax.js";
import { MANIFEST_MODULES } from "../cli/manifests/index.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles, type TextFileScanResult } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/** A module some manifest can load, as a repo-relative `.ts` path. */
export interface LoaderTarget {
  readonly path: string;
}

/**
 * Every `import("../commands/…")` specifier a manifest source names, normalised from `.js` to `.ts`.
 *
 * @param manifestSources the manifest files' text
 * @returns the loader targets, enumerated from the MANIFESTS rather than a path glob — the obvious glob
 *   missed five real targets, two of them the door-routed external-write modules
 */
export function loaderTargetsIn({ manifestSources }: { manifestSources: readonly string[] }): readonly LoaderTarget[] {
  const found = new Set<string>();
  for (const source of manifestSources) {
    for (const match of source.matchAll(/import\("\.\.\/(commands\/[^"]+)\.js"\)/g)) {
      found.add(`src/cli/${match[1]!}.ts`);
    }
  }
  return [...found].toSorted().map((path) => ({ path }));
}

/** A source with every comment and template literal removed, so only live statements are left to match. */
function liveSourceOf({ source }: { source: string }): string {
  // Comments are stripped before matching, BLOCK comments included. The header promises a commented-out
  // occurrence does not count, and it took two review passes to make that true: the first version missed
  // `// import …`, and the version that fixed it still let a single-line `/* import … */` through.
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Template literals go too. A multi-line template can put a fake `import …` at the start of a line,
      // which the anchored matcher below would accept — a review pass built exactly that decoy. Note the
      // direction of the risk: if this ever strips something it should not, the gate reports a target as
      // UNIMPORTED, which fails closed. Over-stripping costs a false alarm; under-stripping costs a lie.
      .replace(/`[\s\S]*?`/g, "")
      .split("\n")
      // `//` and a bare `*` continuation line both go: the block strip above handles a well-formed comment,
      // and the `*` filter still catches a JSDoc body line reached without its opening delimiter.
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n")
  );
}

/**
 * A module specifier as a relative path without its `.js`, or nothing when it is not one.
 *
 * Only plain path characters are followed: a specifier is a URL to the ESM resolver, so `%2F` names no
 * file literally called `x%2Fy.ts`, and a helper reached only through one must not count. Dropping an exotic
 * specifier fails closed — its target reads as unimported. Past the leading `./` or `../` run, every segment must
 * start with a name character, so a filename such as `..js` is never re-read as a `..` segment once `.js` goes.
 */
function relativeOf({ specifier }: { specifier: ts.Expression }): readonly string[] {
  if (!ts.isStringLiteral(specifier) || !/^\.\.?\/[\w./-]+\.js$/.test(specifier.text)) {
    return [];
  }
  const segments = specifier.text.split("/");
  const interior = segments.slice(segments.findIndex((segment) => segment !== "." && segment !== ".."));
  if (!interior.every((segment) => /^[\w-]/.test(segment))) {
    return [];
  }
  const stem = specifier.text.slice(0, -".js".length);
  // `./decl.d.js` loads that JavaScript file, never its sibling `decl.d.ts`, which no resolver runs.
  if (stem.endsWith(".d")) {
    return [];
  }
  return [stem];
}

/** Whether TypeScript erases an import declaration: `import type`, or braces holding only `type` members. */
function importErased({ statement }: { statement: ts.ImportDeclaration }): boolean {
  const clause = statement.importClause;
  if (clause === undefined) {
    return false;
  }
  const bindings = clause.namedBindings;
  const onlyTypeMembers =
    clause.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly);
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword || onlyTypeMembers;
}

/** Whether TypeScript erases a re-export: `export type`, or braces holding only `type` members. */
function exportErased({ statement }: { statement: ts.ExportDeclaration }): boolean {
  const clause = statement.exportClause;
  const onlyTypeMembers =
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly);
  return statement.isTypeOnly || onlyTypeMembers;
}

/**
 * The specifiers of the statements by which a source loads modules at RUN time: every
 * top-level `import` and `export … from` the TypeScript parser finds, less the ones it erases — `import type`, `export type`, or
 * non-empty braces holding nothing but `type` members. `import {} from` counts, as the direct matcher counts
 * it: it is an import, whatever the transform keeps. Parsed rather than pattern-matched:
 * the string version was beaten five times — an `export const` decoy, `import type{…}`,
 * `type/**\/Rows` and more — where the parser judges comments, strings and spacing by construction.
 *
 * The residue, stated: this reads SYNTAX, not use. A plain `import { Rows }` whose bindings are never used, or
 * used only as types, is elided too (`isolatedModules` without `verbatimModuleSyntax`), and still counts — exactly as the direct
 * match in {@link targetsWithoutTests} counts it, `import type` included, at the first hop. The gate's
 * header claims "imported", never "loaded"; this follows imports no further than that claim.
 */
function loadingStatementsOf({ path, source }: { path: string; source: string }): readonly string[] {
  return withSourceFile({
    fileName: path,
    text: source,
    use: (file): readonly string[] =>
      file.statements
        .flatMap((statement) => {
          if (ts.isImportDeclaration(statement) && !importErased({ statement })) {
            return [statement.moduleSpecifier];
          }
          if (
            ts.isExportDeclaration(statement) &&
            statement.moduleSpecifier !== undefined &&
            !exportErased({ statement })
          ) {
            return [statement.moduleSpecifier];
          }
          return [];
        })
        .flatMap((specifier) => relativeOf({ specifier })),
  });
}

/**
 * The sources a collected test loads: every test, plus each test-tree helper reachable from one by relative
 * import, transitively.
 *
 * A test that imports a helper which imports a command module loads that module exactly as a direct import
 * would, so the helper's source counts — but only when some test reaches it. A helper no test imports adds
 * nothing, which keeps a stray fixture module from certifying a target. Measured: splitting
 * `helpTruth.test.ts`'s tables into helper slices left 21 targets reported unimported while the same test
 * still loaded every one (repro: `slopweaver dev lint --only manifest-loader-tests` with this function
 * returning only the tests' sources).
 *
 * @param tests the collected test files, each with its repo-relative path
 * @param helpers the non-test files under the test tree that a test may import, a tracked `.js` among them so
 * one can shadow its same-named `.ts`
 * @returns every test's raw source and, for every reachable helper, one `import "src/cli/….js";` line per
 * kept relative import resolving under `src/cli/`, for `targetsWithoutTests` to sanitise once
 */
export function reachableTestSources({
  tests,
  helpers,
}: {
  tests: readonly { path: string; source: string }[];
  helpers: readonly { path: string; source: string }[];
}): readonly string[] {
  const helperByPath = new Map(helpers.map((helper) => [helper.path, helper.source]));
  const reached = new Set<string>();
  const pending = tests.map((test) => ({ ...test, helper: false }));
  const sources: string[] = [];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const stems = loadingStatementsOf({ path: next.path, source: next.source }).map((specifier) =>
      posix.join(posix.dirname(next.path), specifier),
    );
    // RAW, never sanitised here: `targetsWithoutTests` sanitises once, and a second pass of that non-idempotent
    // strip can splice an import out of comment fragments (`im//*x*/* y */port …`). A test counts
    // whole, as it always has. A helper counts only by the kept imports it RESOLVES into `src/cli/`, each
    // re-spelled as that repository path: its `import type`, a quoted binding name naming a target
    // (`import { "commands/x.js" as y } from "./y.js"`) and a test-tree fixture whose path merely ends like one
    // (`./fixtures/commands/x.js`) all certify nothing.
    const cliLines = stems.filter((stem) => stem.startsWith("src/cli/")).map((stem) => `import "${stem}.js";`);
    sources.push(next.helper ? cliLines.join("\n") : next.source);
    for (const stem of stems) {
      // `./x.js` is `x.ts` and nothing else: NodeNext resolution does no directory-index fallback, and
      // guessing one let a helper the import never named certify a target.
      const path = `${stem}.ts`;
      // A tracked `x.js` beside `x.ts` is the file the resolver loads, so `x.ts` is never followed.
      if (helperByPath.has(`${stem}.js`)) {
        continue;
      }
      if (helperByPath.has(path) && !reached.has(path)) {
        reached.add(path);
        pending.push({ path, source: helperByPath.get(path)!, helper: true });
      }
    }
  }
  return sources;
}

/**
 * Which loader targets no test source imports.
 *
 * Matched on the ESM specifier as it appears in an `import … from "…/x.js"`, so a path merely MENTIONED in
 * a string literal or a comment does not count. That distinction is not hypothetical: while this gate was
 * being written, `slack/pollRun.ts` briefly looked covered because an unrelated test used its path as a
 * fixture value.
 *
 * @param targets the modules the manifests can load
 * @param testSources every collected unit-test source
 * @returns the targets with no importing test, in path order
 */
export function targetsWithoutTests({
  targets,
  testSources,
}: {
  targets: readonly LoaderTarget[];
  testSources: readonly string[];
}): readonly string[] {
  const live = testSources.map((source) => liveSourceOf({ source }));
  const segments = quotedJsSegments({ sources: live });
  return targets
    .filter((target) => {
      const specifier = `${target.path.replace(/^src\/cli\//, "").replace(/\.ts$/, "")}.js`;
      const candidates = new Set(
        segments
          .get(specifier.slice(specifier.lastIndexOf("/") + 1))
          ?.filter((entry) => entry.segment.endsWith(specifier))
          .map((entry) => entry.source),
      );
      // Anchored to a real import STATEMENT: a line beginning `import …` (single-line form) or `} from …`
      // (the closing line of a multi-line form). An unanchored `from "…"` search matched a specifier quoted
      // inside a string literal — and this gate's OWN test fixtures are exactly that, so the unanchored
      // version certified `seed/run.ts` as imported on the strength of a fixture in its own test file.
      const pattern = new RegExp(
        `^\\s*(?:import\\b|\\}\\s*from\\b)[^\\n]*"[^"]*${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        "m",
      );
      return ![...candidates].some((index) => pattern.test(live[index]!));
    })
    .map((target) => target.path);
}

/**
 * Every run of text between two double quotes that ends in `.js`, in each source, indexed by its last path
 * component — the prefilter that lets {@link targetsWithoutTests} run its statement pattern only where it can match.
 *
 * It narrows and never decides. That pattern ends `"[^"]*<specifier>"`, so any source it matches holds a
 * quote-free run ending in the specifier right before a closing quote, and every specifier starts `commands/`,
 * so that run's last component is the specifier's own. Every source it could match is therefore a candidate;
 * the pattern still judges each one, anchors, comments and decoys included. MEASURED: testing 604
 * targets against every test source was 26s of the gate's 84s (`node --import tsx --cpu-prof
 * src/devLint/manifestLoaderTests.entry.ts`, then read `targetsWithoutTests`' inclusive time).
 *
 * @param sources the sanitised test sources, in the order their indices refer to
 * @returns for each last path component, every run ending in it and the index of the source holding it
 */
function quotedJsSegments({
  sources,
}: {
  sources: readonly string[];
}): ReadonlyMap<string, readonly { segment: string; source: number }[]> {
  const index = new Map<string, { segment: string; source: number }[]>();
  for (const [source, text] of sources.entries()) {
    for (let close = text.indexOf('.js"'); close !== -1; close = text.indexOf('.js"', close + 1)) {
      const end = close + ".js".length;
      const segment = text.slice(text.lastIndexOf('"', close) + 1, end);
      const last = segment.slice(segment.lastIndexOf("/") + 1);
      const entries = index.get(last);
      if (entries === undefined) {
        index.set(last, [{ segment, source }]);
      } else {
        entries.push({ segment, source });
      }
    }
  }
  return index;
}

/**
 * Await every manifest loader and report the verbs whose export does not resolve to a function.
 *
 * This is the UNFORGEABLE half. A text scan can be satisfied by an import that never touches the selected
 * export — `helpTruth.test.ts` is exactly that case for `codex/run.ts`. Actually calling the loader cannot
 * be faked: a manifest naming an export that does not exist resolves to `undefined` and is reported here,
 * which is precisely the "shipped but wired to nothing" case (help describes it, catalog lists it, dispatch
 * would crash).
 *
 * It lives in this gate rather than in a unit test because awaiting all of them imports every command module
 * and its transitive dependencies — provider SDKs, the embedding runtime. Measured, that took the unit suite
 * from seconds to minutes, and slowing the loop everyone runs constantly to pay for a once-per-gate check is
 * a bad trade.
 *
 * @returns the address of every verb whose loader did not resolve to a function
 */
export async function unresolvedVerbs(): Promise<readonly string[]> {
  const entries = MANIFEST_MODULES.flatMap((module) =>
    Object.entries(module.verbs).map(([verb, entry]) => ({
      address: verb === "" ? module.noun : `${module.noun} ${verb}`,
      load: entry.load,
    })),
  );
  const resolved = await Promise.all(
    entries.map(async (entry) => ({ address: entry.address, kind: typeof (await entry.load()) })),
  );
  return resolved.filter((r) => r.kind !== "function").map((r) => `${r.address} (${r.kind})`);
}

/** Report every scan's integrity to stderr, and whether all of them read every file they were given. */
function everyScanComplete({ scans }: { scans: readonly TextFileScanResult<unknown>[] }): boolean {
  // `map` then `every`, never `every` alone: short-circuiting would report the first failing scan and stay
  // silent about the rest, which is a smaller version of the same "did not check, did not say" defect.
  return scans
    .map((scan) =>
      reportScanIntegrity({
        label: "manifest-loader-tests",
        scanned: scan.scanned,
        unreadable: scan.unreadable,
        write: (text) => {
          process.stderr.write(text);
        },
      }),
    )
    .every((ok) => ok);
}

/**
 * Scan the manifests and the unit-test tree, and fail when a loadable command module has no importing test.
 *
 * @returns 0 when every loader target is imported by a test, else 1
 */
export function runManifestLoaderTests(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("manifest-loader-tests: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const read = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");
  const manifests = listing.filter((p) => p.startsWith("src/cli/manifests/") && p.endsWith(".ts"));
  // Any lane, not just unit — a target legitimately imported only from the subprocess or integration lane
  // (e.g. a real-git-subprocess command test) is still imported, and moving lanes around should not make
  // this gate lie about coverage that still exists.
  const tests = listing.filter((p) => p.startsWith("src/__tests__/") && p.endsWith(".test.ts"));
  // `.js` files ride along only so `reachableTestSources` can see one shadowing a same-named `.ts` helper.
  const helpers = listing.filter(
    (p) => p.startsWith("src/__tests__/") && (p.endsWith(".ts") || p.endsWith(".js")) && !p.endsWith(".test.ts"),
  );

  const manifestScan = scanTextFiles<string>({ paths: manifests, readText: read, scan: ({ content }) => [content] });
  const withPath = ({ path, content }: { path: string; content: string }): { path: string; source: string }[] => [
    { path, source: content },
  ];
  const testScan = scanTextFiles({ paths: tests, readText: read, scan: withPath });
  const helperScan = scanTextFiles({ paths: helpers, readText: read, scan: withPath });
  const targets = loaderTargetsIn({ manifestSources: manifestScan.hits });
  // Read every loader target too. Checking only that some test names the path certifies a module the gate
  // never opened — a review pass showed a target listing-but-absent from the working tree passing clean,
  // which is the same "reported over a file it did not read" defect this gate family exists to close.
  const targetScan = scanTextFiles<string>({ paths: targets.map((t) => t.path), readText: read, scan: () => [] });
  const complete = everyScanComplete({ scans: [manifestScan, testScan, helperScan, targetScan] });
  const testSources = reachableTestSources({ helpers: helperScan.hits, tests: testScan.hits });
  const missing = targetsWithoutTests({ targets, testSources });
  for (const path of missing) {
    process.stderr.write(`  ${path}  (a manifest can load this, but no unit test imports it)\n`);
  }
  if (missing.length === 0 && complete) {
    process.stdout.write(`manifest-loader-tests: clean (${String(targets.length)} loader target(s) imported)\n`);
    return 0;
  }
  if (missing.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "manifest-loader-tests" }),
        detail: `${String(missing.length)} command module(s) the CLI can dispatch that no`,
      })}\n`,
    );
  }
  return 1;
}
