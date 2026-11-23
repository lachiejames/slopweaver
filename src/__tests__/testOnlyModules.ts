/**
 * Test support: which production modules under `src/` are kept alive ONLY by tests.
 *
 * `knip` and the `internal-exports` gate both count a test import as a use, so a module whose every importer is a
 * test (or another such module) is invisible to both while nothing at runtime loads it. This is the mirror of
 * `src/devLint/untestedModules.ts`, which finds the modules no test imports; this finds the ones ONLY tests import.
 *
 * Lives under `src/__tests__/` on purpose: a helper whose only consumer is a test, placed in `src/devLint/`, would
 * itself be the thing it hunts.
 *
 * Its residue, stated: the edge is syntactic. A module a test loads through a non-literal `import(prefix + name)`, or
 * names only as data, has NO readable importer, so it is not listed here: it reads as an importer-less module, which
 * is `knip`'s report (it cannot resolve that import either), not this guard's. A module a PRODUCTION file loads that
 * way would read as test-only if a test also imports it literally, so {@link computedDynamicImportsIn} finds every
 * such call and the guard's test pins the exact specifier expression of each one in production code: the blind
 * spot is a listed set, not an assumption.
 *
 * Also out of reach, by design: a computed import written in a TEST file (an under-report, a dead module goes unlisted),
 * and a production file reaching a module through a symlink or a non-TypeScript loader (it would read as test-only).
 * The guard is a drift catcher over the import graph, not a proof of death: every deletion still reads the importers.
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { importedPathsOf, resolveSpecifier } from "../devLint/untestedModules.js";

/**
 * The source text of the specifier of every dynamic `import(...)` call that takes a computed one (anything but a
 * plain string or an untagged template with no substitution). Pure. These are the calls `importedPathsOf` cannot
 * attribute to a module, so each is a place the importer graph is blind.
 *
 * @param content the file's text
 * @returns each computed specifier expression as written, in source order
 */
export function computedDynamicImportsIn({ content }: { content: string }): readonly string[] {
  // A cheap prefilter: `import (x)` and `import /* c */ (x)` are the same call as `import(x)`. The keyword alone
  // would parse nearly every file (measured: 6.0s against 0.1s over this tree), so it must be followed by `(` or a comment.
  if (!/\bimport\s*[(/]/.test(content)) {
    return [];
  }
  const found: string[] = [];
  withSourceFile({
    fileName: "m.ts",
    text: content,
    use: (source) => {
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const specifier = node.arguments[0];
          if (specifier === undefined) {
            found.push("");
          } else if (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier)) {
            found.push(specifier.getText(source));
          }
        }
        forEachChild({ node, visit });
      };
      visit(source);
    },
  });
  return found;
}

/**
 * Whether a repo-relative path is test code: anything under a `__tests__/` directory. The vitest lanes select by
 * directory (`.claude/rules/testing.md`), so a `*.test.ts` outside one is never run and is not a test here.
 */
function isTestPath({ path }: { path: string }): boolean {
  return path.split("/").includes("__tests__");
}

/** Whether a path is a production module this sweep judges: under `src/`, a TypeScript or JavaScript file, not test code. */
function isJudgedModule({ path }: { path: string }): boolean {
  return path.startsWith("src/") && /\.(tsx?|js)$/.test(path) && !isTestPath({ path });
}

/**
 * Resolve one specifier to a path that exists in the scanned set. `resolveSpecifier` maps an ESM `.js` spelling
 * back to `.ts`; this also tries the authored `.tsx`, an actual `.js` file, and a directory index.
 *
 * @param fromPath the repo-relative importing file
 * @param specifier the specifier as written
 * @param known every scanned repo-relative path
 * @returns the scanned path it names, or `undefined` when it names something outside the scanned files
 */
function resolveKnown({
  fromPath,
  specifier,
  known,
}: {
  fromPath: string;
  specifier: string;
  known: ReadonlySet<string>;
}): string | undefined {
  const resolved = resolveSpecifier({ fromPath, specifier });
  if (resolved === undefined) {
    return undefined;
  }
  const stem = resolved.slice(0, -".ts".length);
  const candidates = [
    resolved,
    `${stem}.tsx`,
    `${stem}.js`,
    `${stem}/index.ts`,
    `${stem}/index.tsx`,
    `${stem}/index.js`,
  ];
  return candidates.find((candidate) => known.has(candidate));
}

/**
 * Map every scanned module to the set of scanned files that import it. A specifier naming something outside the
 * scanned files, or the file itself, adds no edge.
 *
 * @param sources every scanned source file, repo-relative path to its text
 * @returns each imported path to its importers
 */
function importersOf({ sources }: { sources: ReadonlyMap<string, string> }): ReadonlyMap<string, ReadonlySet<string>> {
  const known: ReadonlySet<string> = new Set(sources.keys());
  const importers = new Map<string, Set<string>>();
  for (const [path, content] of sources) {
    for (const specifier of importedPathsOf({ content, path })) {
      const target = resolveKnown({ fromPath: path, known, specifier });
      if (target === undefined || target === path) {
        continue;
      }
      const seen = importers.get(target);
      if (seen === undefined) {
        importers.set(target, new Set([path]));
      } else {
        seen.add(path);
      }
    }
  }
  return importers;
}

/**
 * Every production module under `src/` with at least one importer, none of which is live: the greatest set in which
 * each member is imported only by test files or by other members. Computed by starting from every imported
 * production module and repeatedly dropping one that a live importer (production code outside the set) reaches, so a
 * chain only a test enters is found whole down to a leaf no test imports directly, and a cycle only a test enters is
 * found too. A module with no importer at all is `knip`'s to report and is not listed. An importer outside `src/` (a
 * script, a tool, a config) is production. Pure.
 *
 * @param sources every scanned source file, repo-relative path to its text
 * @returns the test-only production modules, in path order
 */
export function testOnlyModulesOf({ sources }: { sources: ReadonlyMap<string, string> }): readonly string[] {
  const importers = importersOf({ sources });
  const remaining = new Set([...sources.keys()].filter((path) => isJudgedModule({ path }) && importers.has(path)));
  let shrank = true;
  while (shrank) {
    shrank = false;
    for (const candidate of remaining) {
      if (isReachedByLive({ importers: importers.get(candidate)!, remaining })) {
        remaining.delete(candidate);
        shrank = true;
      }
    }
  }
  return [...remaining].toSorted((a, b) => a.localeCompare(b));
}

/** Whether any importer of a candidate is production code that has already left the set. */
function isReachedByLive({
  importers,
  remaining,
}: {
  importers: ReadonlySet<string>;
  remaining: ReadonlySet<string>;
}): boolean {
  return [...importers].some((path) => !isTestPath({ path }) && !remaining.has(path));
}
