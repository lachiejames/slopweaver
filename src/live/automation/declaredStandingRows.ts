/**
 * The ONE place a home's declared standing rows are resolved: every generic row (`./standingRows.ts`), this install's
 * own-repository rows when its checkout resolves one (`./ownRepository.ts`), then each registered team repository's
 * rows (`./teamStandingRows.ts`) in repository order, minus every row this install RETIRED (`./retirementStore.ts`).
 *
 * `automation due` and `automation register-standing` both resolve through {@link standingRowsFor}, so the
 * report and its answer can never disagree about what is declared. The pure consumers — absence and
 * supersession — keep receiving the rows explicitly, already without the retired ones.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { originSlugOf } from "../checkout/checkoutForRepo.js";
import { type OwnRepositoryDeclaration, ownRepositoryDeclaration } from "./ownRepository.js";
import type { OwnRepositoryStoreError } from "./ownRepositoryStore.js";
import { type AutomationRetirementStoreError, readAutomationRetirements } from "./retirementStore.js";
import {
  BUMP_DRIVE_OWN_RECIPE_ID,
  BUMP_FIX_OWN_RECIPE_ID,
  ownRepositoryStandingRows,
} from "./standingOwnRepositoryRows.js";
import type { StandingRow } from "./standingRow.js";
import { GENERIC_STANDING_ROWS } from "./standingRows.js";
import {
  readTeamRepositories,
  type TeamRepositoryStoreError,
  TeamRepositoryStoreErrors,
} from "./teamRepositoryStore.js";
import { type TeamRepositoryRegistration, teamRepositoryName, teamStandingRows } from "./teamStandingRows.js";

/** The two ids this install's own repository owns, declared or not. */
const OWN_REPOSITORY_RECIPE_IDS = [BUMP_DRIVE_OWN_RECIPE_ID, BUMP_FIX_OWN_RECIPE_ID] as const;

/** What one home declares, how many team repositories contributed to it, and what it retired. */
export interface DeclaredStandingRows {
  /** The rows this install requires — retired ones already subtracted. */
  readonly rows: readonly StandingRow[];
  /** Every row the build and the registry declare, retired ones INCLUDED: what a retirement may name. */
  readonly universe: readonly StandingRow[];
  readonly teamRepositoryCount: number;
  /** What the declaration was composed with, so a report names an unresolved repository rather than two absent rows. */
  readonly ownRepository: OwnRepositoryDeclaration;
  /** The own-repository rows still declared after retirement, empty when none resolved. */
  readonly ownRepositoryRows: readonly StandingRow[];
}

/** Any registry the declaration reads could not be read. */
export type DeclaredStandingRowsError =
  TeamRepositoryStoreError | AutomationRetirementStoreError | OwnRepositoryStoreError;

/**
 * Compose the declaration from registries already read — the pure seam.
 *
 * A recipe id declared twice is refused as a collision rather than letting the second row silently shadow the
 * first: the registry already refuses two repositories sharing a name, so this is the final check that no team
 * row collides with a generic one either. The collision check runs BEFORE the retired rows are subtracted, so a
 * retirement can never hide a broken declaration.
 *
 * @param ownRepository what this install declares about its own repository; unresolved adds neither of its rows
 * @param teamRepositories every registered repository, canonical
 * @param retiredIds the recipe ids this install retired; an id the build no longer declares retires nothing
 * @returns the declared rows, or the collision that makes them ambiguous
 */
export function standingRowsFor({
  ownRepository,
  teamRepositories,
  retiredIds = new Set<string>(),
}: {
  readonly ownRepository: OwnRepositoryDeclaration;
  readonly teamRepositories: readonly TeamRepositoryRegistration[];
  readonly retiredIds?: ReadonlySet<string>;
}): Result<DeclaredStandingRows, TeamRepositoryStoreError> {
  const sorted = teamRepositories.toSorted((left, right) => left.repository.localeCompare(right.repository));
  const ownRows = ownRepository.kind === "resolved" ? ownRepositoryStandingRows(ownRepository) : [];
  const buildRows = [...GENERIC_STANDING_ROWS, ...ownRows];
  // The own-repository ids are reserved whether or not they resolved, so a team repository named `slopweaver` on an
  // unresolved home cannot declare one of them through the team template.
  const buildIds = [...GENERIC_STANDING_ROWS.map((row) => row.definition.recipeId), ...OWN_REPOSITORY_RECIPE_IDS];
  const owner = new Map<string, string>(buildIds.map((recipeId) => [recipeId, "the generic standing rows"]));
  const universe: StandingRow[] = [...buildRows];
  for (const registration of sorted) {
    for (const row of teamStandingRows(registration)) {
      const recipeId = row.definition.recipeId;
      const earlier = owner.get(recipeId);
      if (earlier !== undefined) {
        return err(
          TeamRepositoryStoreErrors.idCollision({
            repositories: [earlier, registration.repository],
            repositoryName: teamRepositoryName({ repository: registration.repository }),
          }),
        );
      }
      owner.set(recipeId, registration.repository);
      universe.push(row);
    }
  }
  const rows = universe.filter((row) => !retiredIds.has(row.definition.recipeId));
  return ok({
    ownRepository,
    ownRepositoryRows: ownRows.filter((row) => !retiredIds.has(row.definition.recipeId)),
    rows,
    teamRepositoryCount: sorted.length,
    universe,
  });
}

/**
 * Resolve one home's declared standing rows: read every registry and the checkout's `origin`, then compose.
 *
 * @param home the state home whose registries declare the team rows and the retirements
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the declared rows, or why a registry could not be read
 */
export function declaredStandingRows({
  home,
  originOf = originSlugOf,
}: {
  readonly home: string;
  readonly originOf?: (args: { cwd: string }) => string | undefined;
}): Result<DeclaredStandingRows, DeclaredStandingRowsError> {
  const retirements = readAutomationRetirements({ home });
  if (retirements.isErr()) {
    return err(retirements.error);
  }
  const ownRepository = ownRepositoryDeclaration({ home, originOf });
  if (ownRepository.isErr()) {
    return err(ownRepository.error);
  }
  const retiredIds = new Set(retirements.value.retirements.map((retirement) => retirement.recipeId));
  return readTeamRepositories({ home }).andThen((read) =>
    standingRowsFor({ ownRepository: ownRepository.value, retiredIds, teamRepositories: read.repositories }),
  );
}
