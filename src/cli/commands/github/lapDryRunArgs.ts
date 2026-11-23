/**
 * Which `github lap` flag combinations a `--dry-run` cannot honour. `--land --dry-run` on ONE pull request is the
 * landing preflight (`./lapPhases.ts`'s `preflightLanding`); everything else a dry run is combined with here is
 * refused before any credential or network.
 */

/**
 * The usage problems a dry run raises with the other flags of one lap invocation.
 *
 * @param land whether `--land` (or `--land-only`) was given
 * @param landOnly whether `--land-only` was given
 * @param dryRun whether `--dry-run` was given
 * @param memberCount how many pull requests `--number` named
 * @returns every problem, empty when the combination is fine
 */
export function lapDryRunProblems({
  dryRun,
  land,
  landOnly,
  memberCount,
}: {
  dryRun: boolean;
  land: boolean;
  landOnly: boolean;
  memberCount: number;
}): readonly string[] {
  const problems: string[] = [];
  if (landOnly && dryRun) {
    problems.push(
      "--land-only and --dry-run contradict each other: a dry run posts nothing, so it has nothing to land on",
    );
  }
  if (land && !landOnly && dryRun && memberCount > 1) {
    problems.push(
      "--land --dry-run checks ONE pull request's landing before its lap; a batch's landings are not checked ahead yet, so lap the members one at a time",
    );
  }
  return problems;
}
