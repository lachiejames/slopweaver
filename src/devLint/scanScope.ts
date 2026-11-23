/**
 * The single declaration of which files a devLint gate scans — the tree list, the self-file exclusion, and
 * the working-tree listing. Extracted after the code-quality survey's item 8 found `isScannablePath` written
 * 13 times across 6 policies (not always deliberately distinct), `repoRoot()` re-wrapped 12 times around it,
 * and the file listing re-wrapped 8 times on top of that.
 *
 * Each gate keeps its own predicate DECLARATION — a one-line {@link ScanScope} naming its trees, its
 * extensions and how it treats tests — so a reader can still see a gate's exact policy at the gate. Only the
 * mechanics (the tree/extension/test matching, the repo-root anchor, the working-tree listing) are shared.
 * A gate whose scan predicate genuinely does not fit this shape (`control-bytes` excludes by extension
 * rather than including by tree; `no-headless` matches non-`.ts` paths and several bespoke directories) is
 * left alone rather than forced in — see each gate's own file for why.
 *
 * Every gate here declares `trees: ["src/", "eval/", "hooks/"]` (or, for `jsdoc-tags`, `trees: []` —
 * repo-wide, genuinely wider than any tree list; for `no-python`, those three plus `skills/`, because a skill's
 * prose is where an agent is told what to run; for `file-size-ratchet`, those three plus `site/` and `desktop/`
 * and `.tsx`, because the owner's 300-line cap names every file) — matching AGENTS.md's own path-scoping for the three
 * TypeScript rules. Eight gates (`boundary-residue`, `duplicate-windows`, `file-size-ratchet`,
 * `max-function-lines`, `operation-labels`, `resilience-residue`, `scheduler-bypass`, `unbounded-spread`)
 * used to declare `src/` only; round 2's residue sweep ran each against `eval/` and `hooks/` before widening
 * — both trees are small (`find eval hooks -name '*.ts' -exec cat {} + | wc -l`: 585 + 105 lines) and came
 * back clean under all eight, so the widening cost nothing measured.
 */

import { basename, extname } from "node:path";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";

/**
 * The repo-relative directory a gate's scan may be rooted at. Trailing slash, so `startsWith` is exact.
 *
 * `site/` is the odd one and is here for a reason no other tree needs: it is a separate Yarn project, and
 * a gate was once the ONLY mechanism that could hold a class down inside it (`console-verb-binary`). The
 * unit lane now reaches `site/__tests__/unit/**` as a second root, so the console's PURE modules have
 * tests too — but only those. Everything the console does with React, `next build` or a spawned verb is
 * still gate-only, which is what this tree exists for.
 *
 * The three `site/` subtrees and `desktop/` are the APP, as `app-copy-voice` means it: the console's pages,
 * components and the modules that word them, and the Electron shell around them. `site/content/` is the docs
 * site, which that gate deliberately leaves out.
 */
type ScanTree =
  "src/" | "eval/" | "hooks/" | "skills/" | "site/" | "site/app/" | "site/components/" | "site/lib/" | "desktop/";

/** A gate's declared scan predicate: which trees, which extensions, and how tests are treated. */
export interface ScanScope {
  /** The trees in scope. Empty means every file in the working tree — `testing-discipline`'s shape. */
  readonly trees: readonly ScanTree[];
  /** File extensions in scope, each checked with `endsWith`. Defaults to `[".ts"]`. */
  readonly extensions?: readonly string[];
  /**
   * Also select a file with NO extension (`extname(path) === ""`), whatever {@link ScanScope.extensions}
   * says. A selection, not a judgement: an extensionless script's shebang decides what it is, and only its
   * content can say. `no-python` needs this; it cannot be spelled as an extension, since every name ends in "".
   */
  readonly includeExtensionless?: boolean;
  /** Drop `*.test.ts`. */
  readonly excludeTests?: boolean;
  /** Also drop any path with a `__tests__` segment. */
  readonly excludeTestsDir?: boolean;
  /** Scan ONLY `*.test.ts` and `*.test.tsx` — mutually exclusive with `excludeTests`. */
  readonly onlyTests?: boolean;
  /**
   * Scan ONLY paths with a `__tests__` segment — the whole test TREE, setup files and helpers included, not
   * just the `*.test.ts` files {@link ScanScope.onlyTests} selects. Mutually exclusive with
   * {@link ScanScope.excludeTestsDir}. `home-safety`'s `env-home-read` half needs this exact pool: the
   * `$SLOPWEAVER_HOME` read it refuses lived in `setup-polly.ts`, which is neither a test file nor source.
   */
  readonly onlyTestsDir?: boolean;
  /**
   * This gate's own files (source, entry point, test) — never in scope. An entry is a basename
   * ({@link gateSelfFiles}) or an exact repo-relative path ({@link gateSelfPaths}); a basename also drops a
   * same-named file in any other tree the scope reaches.
   */
  readonly selfFiles: ReadonlySet<string>;
}

const DEFAULT_EXTENSIONS: readonly string[] = [".ts"];

/**
 * A gate's own `<stem>.ts` / `<stem>.entry.ts` / `<stem>.test.ts` triad, ready for {@link ScanScope.selfFiles}.
 *
 * @param stem the gate's base filename, e.g. `"maxFunctionLines"`
 * @returns the three basenames to exclude from the gate's own scan
 */
export function gateSelfFiles({ stem }: { stem: string }): ReadonlySet<string> {
  return new Set([`${stem}.ts`, `${stem}.entry.ts`, `${stem}.test.ts`]);
}

/**
 * The same triad as {@link gateSelfFiles}, by EXACT repo-relative path under `src/devLint/` and its unit-test
 * directory, so a file elsewhere that happens to share the gate's name stays in scope. A gate whose criterion
 * a same-named file could evade (an override read in `desktop/src/escapeHatch.ts`) takes this one.
 *
 * @param stem the gate's base filename, e.g. `"escapeHatch"`
 * @returns the three repo-relative paths to exclude from the gate's own scan
 */
export function gateSelfPaths({ stem }: { stem: string }): ReadonlySet<string> {
  return new Set([
    `src/devLint/${stem}.ts`,
    `src/devLint/${stem}.entry.ts`,
    `src/__tests__/unit/devLint/${stem}.test.ts`,
  ]);
}

/**
 * Whether a path is a TEST file — `*.test.ts` or `*.test.tsx` — the one definition {@link ScanScope.excludeTests}
 * and {@link ScanScope.onlyTests} select by, exported so a gate judging tests by a different rule reads the
 * same set rather than a second spelling of it. A helper or fake under `__tests__/` is not one.
 *
 * @param path a repo-relative path
 * @returns true when the path names a test file of either extension
 */
export function isTestFilePath({ path }: { path: string }): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

/**
 * Whether a repo-relative path is in scope for a gate, given its declared {@link ScanScope}.
 *
 * @param path the repo-relative path
 * @param scope the gate's declared scan predicate
 * @returns true when the gate should scan the path
 */
export function isScannablePath({ path, scope }: { path: string; scope: ScanScope }): boolean {
  if (scope.selfFiles.has(path) || scope.selfFiles.has(basename(path))) {
    return false;
  }
  if (scope.trees.length > 0 && !scope.trees.some((tree) => path.startsWith(tree))) {
    return false;
  }
  const { extensions = DEFAULT_EXTENSIONS } = scope;
  const extensionless = scope.includeExtensionless === true && extname(path) === "";
  if (!extensionless && !extensions.some((ext) => path.endsWith(ext))) {
    return false;
  }
  // A `.test.tsx` is a test as much as a `.test.ts`; it only matters to a scope that admits `.tsx` at all.
  const isTest = isTestFilePath({ path });
  // A whole `__tests__` SEGMENT, so a directory merely named `my__tests__` is not the test tree.
  const inTestsDir = `/${path}`.includes("/__tests__/");
  if (scope.onlyTests === true) {
    return isTest;
  }
  if (scope.onlyTestsDir === true) {
    return inTestsDir;
  }
  if (scope.excludeTests === true && isTest) {
    return false;
  }
  if (scope.excludeTestsDir === true && inTestsDir) {
    return false;
  }
  return true;
}

/**
 * Repo root, anchored on THIS module's own location — every gate lives beside it in `src/devLint/`.
 *
 * @returns the absolute path of the repository root
 */
export function repoRoot(): string {
  return repoRootOf({ importMetaUrl: import.meta.url });
}

/**
 * The working-tree files in scope for a gate — committed or not, minus what git ignores
 * ({@link workingTreeFilesOf}). Uses a single-tree pathspec as a listing optimisation when the scope names
 * exactly one tree; otherwise lists the whole tree and lets {@link isScannablePath} filter it.
 *
 * @param root the repository root
 * @param scope the gate's declared scan predicate
 * @returns each in-scope repo-relative path
 */
export function scopedScanFiles({ root, scope }: { root: string; scope: ScanScope }): readonly string[] {
  const files =
    scope.trees.length === 1
      ? workingTreeFilesOf({ pathspec: scope.trees[0]!.slice(0, -1), root })
      : workingTreeFilesOf({ root });
  return files.filter((path) => isScannablePath({ path, scope }));
}
