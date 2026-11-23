/**
 * Which own-repository rows the store holds on a `--repo` this install does not declare, in a shape no build or pass
 * wrote. `register-standing` never writes over such a row, because it is somebody's edit, so this is the one report of
 * it: a wrong slug reads as zero open pull requests rather than failing (`./standingOwnRepositoryRows.ts`).
 *
 * A stored row in a shape {@link holdsEarlierShape} recognises is left to `./standingRowSupersession.ts`, whose verdict
 * is stronger because a pass can act on it. Team rows are not judged here: an install adds its own flags to them.
 *
 * Pure: the rows in, a verdict out.
 */
import type { RecipeDefinition } from "./definition.js";
import { namedRepository } from "./repositoryArgv.js";
import type { StandingRow } from "./standingRow.js";
import { holdsEarlierShape } from "./standingRowSupersession.js";

/** One stored row whose `--repo` is not the declared one. */
export interface StandingRowRepositoryDrift {
  readonly recipeId: string;
  readonly declaredRepository: string;
  /** What the stored row names, or `undefined` when it names no repository at all. */
  readonly storedRepository: string | undefined;
}

/**
 * Which of the declared own-repository rows the store holds on another repository.
 *
 * @param declared the own-repository rows this install declares
 * @param existing every row the store parsed
 * @returns one entry per drifted row, in declaration order
 */
export function standingRowRepositoryDrifts({
  declared,
  existing,
}: {
  readonly declared: readonly StandingRow[];
  readonly existing: readonly RecipeDefinition[];
}): readonly StandingRowRepositoryDrift[] {
  return declared.flatMap((row) => {
    const { recipeId, params } = row.definition;
    const { supersedes = [] } = row;
    const declaredRepository = namedRepository({ argv: params["argv"] })!;
    return existing.flatMap((stored) => {
      if (stored.recipeId !== recipeId || holdsEarlierShape({ stored, supersedes })) {
        return [];
      }
      const storedRepository = namedRepository({ argv: stored.params["argv"] });
      if (storedRepository?.toLowerCase() === declaredRepository.toLowerCase()) {
        return [];
      }
      return [{ declaredRepository, recipeId, storedRepository }];
    });
  });
}

/**
 * The line `automation due` prints for one drifted row.
 *
 * @param drift the row whose stored repository is not the declared one
 * @returns the line to print
 */
export function repositoryDriftLine({ drift }: { readonly drift: StandingRowRepositoryDrift }): string {
  const stored = drift.storedRepository === undefined ? "no repository" : `\`${drift.storedRepository}\``;
  return (
    `!! ${drift.recipeId} · REPOSITORY DRIFT — the store's row names ${stored} where this install's checkout resolves ` +
    `to \`${drift.declaredRepository}\`, and no build wrote that shape, so \`slopweaver automation ` +
    "register-standing` leaves it: a wrong slug reads as zero open pull requests. Correct it with " +
    `\`slopweaver automation repoint ${drift.recipeId}\`, which keeps every other field, \`enabled\` included`
  );
}
