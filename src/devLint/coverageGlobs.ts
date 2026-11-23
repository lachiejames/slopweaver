/**
 * Anchoring for the coverage globs — the difference between "this file is excluded" and "this CHECKOUT is
 * excluded".
 *
 * Vitest matches `coverage.include` and `coverage.exclude` with picomatch's `contains: true` against the
 * ABSOLUTE path of every file (`BaseCoverageProvider.isIncluded`). A repo-relative pattern is therefore
 * unanchored: it matches anywhere in that path, including the directories ABOVE the repository. Measured on
 * a checkout whose leaf directory ends in `coverage`: the `coverage/**` entry in `COVERAGE_EXCLUDE`
 * matched every source file, both lanes reported `0/0` statements, and the floor ratchet could say nothing
 * better than `coverage summary: unexpected shape`. One such trap exists per leading segment in the exclude
 * list — a checkout under a directory ending in `dist`, `eval`, `hooks` or `stubs` collapses the same way.
 *
 * The worse half was quieter than that, and is why this exists at all: `eval/**`, written for the top-level
 * `eval/` directory, also matched `src/retrieval/**` and `src/eval/**`. 24 first-party source files (589
 * statements, at 93% covered) sat outside the measured denominator in every checkout, CI included, while the
 * floor gate printed `clean` — see `docs/integration-coverage.md` for the measurement.
 *
 * The fix belongs here rather than in the list: the list still says exactly what it said, it just now says
 * it about THIS repository. Nothing is added to or removed from what is excluded — see
 * `coverageGlobs.test.ts`, which pins that equivalence.
 *
 * Only `exclude` is anchored. `include` is left as written because an over-broad include cannot reach outside
 * the repo (Vitest's `allowExternal` defaults to false, so a file outside the root is dropped first) and this
 * tree has no nested `src/` directory for it to over-match inside the root — anchoring it would be a no-op
 * dressed as a safeguard.
 */

/**
 * Re-anchor repo-relative coverage globs to an absolute project root, so a directory name above the repo
 * cannot satisfy them.
 *
 * @param root Absolute path of the project root; a trailing slash is tolerated.
 * @param patterns Repo-relative globs, e.g. `COVERAGE_EXCLUDE`. An already-absolute pattern is passed through.
 * @returns The same globs in the same order, each anchored at `root`.
 */
export function anchorCoverageGlobs({
  root,
  patterns,
}: {
  root: string;
  patterns: readonly string[];
}): readonly string[] {
  const base = root.replace(/\/+$/, "");
  return patterns.map((pattern) => (pattern.startsWith("/") ? pattern : `${base}/${pattern}`));
}
