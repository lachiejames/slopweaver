/**
 * Whether a coverage report is WHOLE — the check the coverage ratchet runs before it compares a single number.
 *
 * A floor judged over a partial report passes where the full run fails: dropping a file can RAISE a
 * directory's percentage. So before `coverageRatchet.ts`'s measured half compares or rebaselines, it lists
 * every source file coverage includes on disk, the way Vitest's own discovery would, and refuses a report that
 * leaves any of them, or any floored directory, out.
 *
 * Every match runs through picomatch, the matcher Vitest itself calls, with Vitest's own options. A hand
 * emulation over Node's `path.matchesGlob` diverged three times: a dot-prefixed file, a forced
 * exclusion, and a path an exclusion matches only as a PREFIX, which `contains: true` excludes.
 *
 * The pure half ({@link vitestMeasures}, {@link vitestExcludesSubtree}, {@link oneAliasPerFile},
 * {@link directoriesWithSources}, {@link unreportedSourceFiles}) is unit-tested under
 * `src/__tests__/unit/devLint/coverageRatchet/`. The walk and the refusal are the effectful edge, exercised end to
 * end in `coverageRatchetShell.test.ts`.
 */

import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";
import { err, ok, type Result } from "../lib/result.js";
import { COVERAGE_EXCLUDE, COVERAGE_INCLUDE } from "./coverageExclude.js";
import {
  type CoverageBaseline,
  type CoverageMeasurement,
  directoryBucketOf,
  unmeasuredFloors,
} from "./coverageFloor.js";
import { type CoverageFloorError, CoverageFloorErrors } from "./coverageFloorErrors.js";
import { anchorCoverageGlobs } from "./coverageGlobs.js";

/** How many unreported source files a refusal lists before it gives only the count. */
const UNREPORTED_SHOWN = 10;

/**
 * The exclusions Vitest appends to every coverage config and no config can remove. Asking a report for a file
 * under one reddened a complete run (`src/__x00__generated.ts`). Vitest also appends its setup files,
 * test includes and config file, all under `src/__tests__/` or outside `src/`, so `COVERAGE_EXCLUDE` or the
 * walk's root already drops them, bar a path that nests a test include's whole text under another `src/`
 * directory. Repro: `grep -n '__x00__' node_modules/vitest/dist/chunks/coverage.*.js`.
 */
const VITEST_FORCED_EXCLUDE = ["**/virtual:*", "**/__x00__*", "**/node_modules/**"];

/**
 * Every exclusion a real run applies, as Vitest passes them: the repository's own anchored at the root, as
 * `config/vitest/base.ts` anchors them, then the forced ones.
 */
function measuredExclude({ root, exclude }: { root: string; exclude: readonly string[] }): string[] {
  return [...anchorCoverageGlobs({ patterns: exclude, root }), ...VITEST_FORCED_EXCLUDE];
}

/**
 * Vitest's `cleanUrl`, which `isIncluded` applies before matching: everything from the first `?` or `#` is a
 * URL suffix to it, so `src/q?mark.ts` is matched as `src/q` and never measured. Repro:
 * `grep -n -A2 "function cleanUrl" node_modules/@vitest/utils/dist/helpers.js`.
 */
const URL_POSTFIX = /[?#].*$/;

/**
 * Whether a real Vitest run measures a root-relative path: `BaseCoverageProvider.isIncluded`, the include
 * matched with `contains: true` and `dot: true` and the exclusions as its `ignore`, over the absolute path
 * with its URL suffix cleaned off. Pure.
 *
 * @param root the absolute project root Vitest anchors the exclusions at
 * @param exclude the repository's coverage exclude globs, root-relative
 * @returns a predicate over root-relative paths, true when the run measures that path
 */
export function vitestMeasures({
  root,
  exclude,
}: {
  root: string;
  exclude: readonly string[];
}): (path: string) => boolean {
  const matches = picomatch(COVERAGE_INCLUDE, {
    contains: true,
    dot: true,
    ignore: measuredExclude({ exclude, root }),
  });
  return (path) => matches(`${root}/${path}`.replace(URL_POSTFIX, ""));
}

/**
 * Whether Vitest excludes EVERY path under a directory. Under `contains: true` an exclusion matching the
 * directory's own path matches as a substring of every path beneath it, so the walk may prune it. Pure.
 *
 * @param root the absolute project root Vitest anchors the exclusions at
 * @param exclude the repository's coverage exclude globs, root-relative
 * @returns a predicate over root-relative directories, true when nothing under one is measured
 */
export function vitestExcludesSubtree({
  root,
  exclude,
}: {
  root: string;
  exclude: readonly string[];
}): (directory: string) => boolean {
  const matches = picomatch(measuredExclude({ exclude, root }), { contains: true, dot: true });
  return (directory) => matches(`${root}/${directory}/`);
}

/** Vitest's discovery glob, anchored at the root with `dot: true` as tinyglobby walks it. */
const discovered = picomatch(COVERAGE_INCLUDE, { dot: true });

/** A root-relative path the source walk reached, and the real file behind it. */
export interface SourceAlias {
  readonly path: string;
  readonly real: string;
}

/**
 * One path per real source file, the one a report is asked for. A full Vitest run names a file two symlinks
 * reach once, so asking for both paths reddened a complete report. The path the report already
 * names wins; otherwise the first path coverage does not exclude; otherwise the first. Pure.
 *
 * @param aliases every path the walk listed, each with its real file
 * @param measured whether a real run measures a root-relative path, {@link vitestMeasures}
 * @param reported root-relative files the report names
 * @returns one path per real file, sorted
 */
export function oneAliasPerFile({
  aliases,
  measured,
  reported,
}: {
  aliases: readonly SourceAlias[];
  measured: (path: string) => boolean;
  reported: readonly string[];
}): readonly string[] {
  const named = new Set(reported);
  const byReal = new Map<string, string[]>();
  for (const alias of aliases) {
    const paths = byReal.get(alias.real);
    if (paths === undefined) {
      byReal.set(alias.real, [alias.path]);
    } else {
      paths.push(alias.path);
    }
  }
  return [...byReal.values()]
    .map((paths) => chooseAlias({ measured, named, paths: paths.toSorted((a, b) => a.localeCompare(b)) }))
    .toSorted((a, b) => a.localeCompare(b));
}

/** The one path of a real file's sorted, non-empty `paths` that {@link oneAliasPerFile} keeps. */
function chooseAlias({
  paths,
  named,
  measured,
}: {
  paths: readonly string[];
  named: ReadonlySet<string>;
  measured: (path: string) => boolean;
}): string {
  const reported = paths.find((path) => named.has(path));
  if (reported !== undefined) {
    return reported;
  }
  const included = paths.find((path) => measured(path));
  if (included !== undefined) {
    return included;
  }
  return paths[0]!;
}

/**
 * The `src/<dir>` buckets that still hold a source file coverage measures — what "still on disk" means to
 * {@link unmeasuredFloors}. Read off the listed sources rather than asked of the filesystem per directory,
 * because a directory that exists and cannot be read once answered "absent" there. Pure.
 *
 * @param sources root-relative source files on disk that match the coverage include
 * @param measured whether a real run measures a root-relative path, {@link vitestMeasures}
 * @returns the bucket of every source file coverage measures
 */
export function directoriesWithSources({
  sources,
  measured,
}: {
  sources: readonly string[];
  measured: (path: string) => boolean;
}): ReadonlySet<string> {
  const buckets = new Set<string>();
  for (const source of sources) {
    const bucket = directoryBucketOf({ relativePath: source });
    if (bucket !== undefined && measured(source)) {
      buckets.add(bucket);
    }
  }
  return buckets;
}

/**
 * The source files coverage should have measured and the report does not name. Vitest reports every file its
 * include matches, a file no test reached at 0%, so a real run that went short lowers the number rather than
 * dropping a file; a file missing from the report means the report is partial. A counterexample: a
 * directory measured through one file while its other files were left out, the gate clean. The shell passes
 * what is on disk under `COVERAGE_INCLUDE` and Vitest's own matcher over it. Pure.
 *
 * @param sources root-relative source files on disk that match the coverage include
 * @param measured whether a real run measures a root-relative path, {@link vitestMeasures}
 * @param reported root-relative files the report names
 * @returns every measured source file the report left out, sorted
 */
export function unreportedSourceFiles({
  sources,
  measured,
  reported,
}: {
  sources: readonly string[];
  measured: (path: string) => boolean;
  reported: readonly string[];
}): readonly string[] {
  const named = new Set(reported);
  return sources.filter((source) => !named.has(source) && measured(source)).toSorted((a, b) => a.localeCompare(b));
}

/**
 * Whether a caught read error is the file simply not being there.
 *
 * @param error whatever the read threw
 * @returns true only for ENOENT; anything else is a file that exists and could not be read
 */
export function isNotFound({ error }: { error: unknown }): boolean {
  return errorCode({ error }) === "ENOENT";
}

/**
 * The `code` a Node filesystem error carries.
 *
 * @param error whatever a read threw
 * @returns the code, or undefined when the thrown value carries none
 */
function errorCode({ error }: { error: unknown }): unknown {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return error.code;
}

/**
 * Collect every file under `dir` matching the coverage include, following symlinks as Vitest's globber does.
 * Any read error propagates, never a skip. A link goes wrong two ways: skipped, it hid a
 * subtree coverage includes; refused, it reddened a complete report over that subtree. A link whose target is
 * gone holds nothing coverage can measure and is skipped. So is a link back into its own ancestry: every file
 * behind it is already listed under its real path, and Vitest's globber walks such a cycle finitely too, so
 * refusing one reddened a complete report. Each listed path carries its real file, so a file two
 * links reach is asked of the report once ({@link oneAliasPerFile}), as a full run names it.
 *
 * @param ancestors the real paths of every directory from `src/` down to `dir`'s parent
 * @param pruned whether Vitest measures nothing under a root-relative directory, {@link vitestExcludesSubtree}
 */
function walkSources({
  dir,
  relative,
  out,
  ancestors,
  pruned,
}: {
  dir: string;
  relative: string;
  out: SourceAlias[];
  ancestors: ReadonlySet<string>;
  pruned: (directory: string) => boolean;
}): void {
  const real = realpathSync(dir);
  if (ancestors.has(real)) {
    return;
  }
  const lineage = new Set([...ancestors, real]);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    const path = join(dir, entry.name);
    const kind = entry.isSymbolicLink() ? linkTargetKind({ path }) : direntKind({ entry });
    // A file is listed whatever its name, because both readers of the list apply Vitest's matcher themselves.
    if (kind === "directory" && !pruned(child)) {
      walkSources({ ancestors: lineage, dir: path, out, pruned, relative: child });
    } else if (kind === "file" && discovered(child)) {
      out.push({ path: child, real: realpathSync(path) });
    }
  }
}

/** What a walked entry is, as far as coverage is concerned. */
type EntryKind = "directory" | "file" | "other";

/** The kind of a non-link entry. */
function direntKind({ entry }: { entry: Dirent }): EntryKind {
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  return "other";
}

/**
 * The kind of what a symlink points at. A dangling or self-looping link is `other`: there is nothing behind it
 * for Vitest to measure. Any other failure to read the target propagates.
 */
function linkTargetKind({ path }: { path: string }): EntryKind {
  let target: ReturnType<typeof statSync>;
  try {
    target = statSync(path);
  } catch (error) {
    if (isNotFound({ error }) || errorCode({ error }) === "ELOOP") {
      return "other";
    }
    throw error;
  }
  if (target.isDirectory()) {
    return "directory";
  }
  if (target.isFile()) {
    return "file";
  }
  return "other";
}

/**
 * List the root-relative source files coverage includes. Only a missing `src/` is an empty list; any other
 * read failure is an error. `existsSync` and `globSync` both read an unreadable directory as an empty or
 * absent one, which used to pass a partial report: every floor under it looked deleted.
 *
 * @param root the repository root
 * @returns the source files, or why the tree could not be listed
 */
function listCoverageSources({ root }: { root: string }): Result<readonly SourceAlias[], CoverageFloorError> {
  const out: SourceAlias[] = [];
  const pruned = vitestExcludesSubtree({ exclude: COVERAGE_EXCLUDE, root });
  try {
    walkSources({ ancestors: new Set(), dir: join(root, "src"), out, pruned, relative: "src" });
  } catch (error) {
    if (isNotFound({ error }) && out.length === 0 && !existsSync(join(root, "src"))) {
      return ok([]);
    }
    return err(
      CoverageFloorErrors.sourceTreeUnreadable({ reason: error instanceof Error ? error.message : "read failed" }),
    );
  }
  return ok(out);
}

/**
 * Refuse a coverage report that is not whole over the source tree on disk: the tree cannot be listed, it holds
 * no file coverage includes, a floored directory still on disk went unmeasured, or an included file is unnamed.
 * Each is incomplete input rather than a measurement, so it prints a fact, never a policy refusal.
 *
 * @param root the repository root
 * @param baseline the working-tree floor, for its directory floors
 * @param current the parsed report
 * @param writeErr where each failure goes
 * @returns 0 when the report is whole, 1 when it is not
 */
export function reportCompleteness({
  root,
  baseline,
  current,
  writeErr,
}: {
  root: string;
  baseline: CoverageBaseline;
  current: CoverageMeasurement;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const listed = listCoverageSources({ root });
  if (listed.isErr()) {
    // devlint: not-a-refusal -- the source tree could not be listed, so the gate cannot tell a partial report
    // from a complete one; an unreadable directory once read as an absent one and let every floor under it go
    writeErr({ text: `coverage-ratchet: ${listed.error.message}\n` });
    return 1;
  }
  const measured = vitestMeasures({ exclude: COVERAGE_EXCLUDE, root });
  const sources = oneAliasPerFile({ aliases: listed.value, measured, reported: current.reportedFiles });
  // Every file coverage measures, whether reported or not: the scope a floor is about.
  if (unreportedSourceFiles({ measured, reported: [], sources }).length === 0) {
    // devlint: not-a-refusal -- there is no source file to measure, so no report can be judged against a floor;
    // A past version passed a report over a file outside the include while every `src/` file was excluded
    writeErr({
      text: `coverage-ratchet: no source file coverage includes is on disk under src/, so there is nothing for the floor to judge\n`,
    });
    return 1;
  }
  const onDisk = directoriesWithSources({ measured, sources });
  const unmeasured = unmeasuredFloors({ baseline, current, onDisk });
  if (unmeasured.length > 0) {
    for (const shortfall of unmeasured) {
      writeErr({ text: `  ${shortfall.message}\n` });
    }
    // devlint: not-a-refusal -- the report left out directories that still exist, so it is incomplete input
    // rather than a measurement the floor can judge; both the comparison and a rebaseline would read it wrong
    writeErr({
      text: `coverage-ratchet: the coverage summary measured nothing under ${String(unmeasured.length)} floored directory(ies) still on disk, so it is partial; regenerate it with \`yarn test:unit\`\n`,
    });
    return 1;
  }
  const unreported = unreportedSourceFiles({ measured, reported: current.reportedFiles, sources });
  if (unreported.length > 0) {
    for (const file of unreported.slice(0, UNREPORTED_SHOWN)) {
      writeErr({ text: `  ${file}\n` });
    }
    // devlint: not-a-refusal -- the report left out source files coverage includes, so it is incomplete input
    // rather than a measurement the floor can judge; both the comparison and a rebaseline would read it wrong
    writeErr({
      text: `coverage-ratchet: the coverage summary does not name ${String(unreported.length)} source file(s) coverage includes, so it is partial; regenerate it with \`yarn test:unit\`\n`,
    });
    return 1;
  }
  return 0;
}
