/**
 * What `automation due` says about the declaration itself, composed once for the report: which declared rows the store
 * no longer holds or holds in an earlier shape, and what each registry behind the declaration said.
 */
import type { loadAuditedRecipeDefinitions } from "../../../live/automation/auditedDefinitionStore.js";
import type { declaredStandingRows } from "../../../live/automation/declaredStandingRows.js";
import type { RetirementsState, TeamRepositoriesState } from "../../../live/automation/dueReport.js";
import {
  type OwnRepositoryState,
  ownRepositoryDeclaration,
  ownRepositoryStateOf,
} from "../../../live/automation/ownRepository.js";
import type { readAutomationRetirements } from "../../../live/automation/retirementStore.js";
import { absentStandingRows } from "../../../live/automation/standingRowAbsence.js";
import { standingRowRepositoryDrifts } from "../../../live/automation/standingRowRepositoryDrift.js";
import { supersededStandingRows } from "../../../live/automation/standingRowSupersession.js";
import { originSlugOf } from "../../../live/checkout/checkoutForRepo.js";

/**
 * The declared rows the store no longer holds, and those it holds in an earlier build's shape.
 *
 * The declared roster is the generic rows plus every registered team repository's. An unreadable registry
 * leaves it unknown, so nothing is compared and the report says why at the top, rather than reading the file
 * as "none registered" and going quiet about every registered repository's vanished rows.
 *
 * @param declared the home's declaration, or why it could not be composed
 * @param roster what the store holds
 * @returns the three comparisons, each empty when nothing was compared
 */
export function compareDeclared({
  declared,
  roster,
}: {
  readonly declared: ReturnType<typeof declaredStandingRows>;
  readonly roster: ReturnType<typeof loadAuditedRecipeDefinitions>;
}): {
  readonly missing: ReturnType<typeof absentStandingRows>;
  readonly repositoryDrift: ReturnType<typeof standingRowRepositoryDrifts>;
  readonly superseded: ReturnType<typeof supersededStandingRows>;
} {
  if (declared.isErr()) {
    return { missing: [], repositoryDrift: [], superseded: [] };
  }
  return {
    // A row this install declares and the store does not hold reports as nothing at all otherwise: this verb
    // lists what IS scheduled, so what stopped being scheduled has no line to go missing from.
    missing: absentStandingRows({
      declared: declared.value.rows,
      existing: roster.definitions,
      unreadable: roster.rejected.map((rejection) => rejection.file.replace(/\.json$/u, "")),
    }),
    repositoryDrift: standingRowRepositoryDrifts({
      declared: declared.value.ownRepositoryRows,
      existing: roster.definitions,
    }),
    superseded: supersededStandingRows({
      declared: declared.value.rows,
      existing: roster.definitions,
      files: roster.definitionFiles,
    }),
  };
}

/**
 * The team registry's state as the report carries it: none, how many, or why it could not be read — and NOTHING
 * when another registry refused, which leads the report on its own line instead of being printed as a team
 * registry fault.
 *
 * @param declared the home's declaration, or why it could not be composed
 * @returns the report's field, absent when another registry refused
 */
export function teamRepositoriesState({ declared }: { readonly declared: ReturnType<typeof declaredStandingRows> }): {
  readonly teamRepositories?: TeamRepositoriesState;
} {
  if (declared.isErr()) {
    const { error } = declared;
    if (
      error.code === "RETIREMENTS_UNREADABLE" ||
      error.code === "RETIREMENTS_MALFORMED" ||
      error.code === "RETIREMENTS_WRITE_FAILED" ||
      error.code === "OWN_REPOSITORIES_UNREADABLE" ||
      error.code === "OWN_REPOSITORIES_MALFORMED" ||
      error.code === "OWN_REPOSITORIES_WRITE_FAILED"
    ) {
      return {};
    }
    return { teamRepositories: { error, kind: "unreadable" } };
  }
  const count = declared.value.teamRepositoryCount;
  return { teamRepositories: count === 0 ? { kind: "none" } : { count, kind: "configured" } };
}

/**
 * The own repository as the report carries it: which one, why none, or why its history could not be read. Read again
 * on its own when any registry refused the declaration, so a refusal elsewhere cannot swallow the one warning that a
 * stored copy of either row still fires as written.
 *
 * @param declared the home's declaration, or why it could not be composed
 * @param home the state home to read the own repository from when the declaration refused
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the report's field
 */
export function ownRepositoryState({
  declared,
  home,
  originOf = originSlugOf,
}: {
  readonly declared: ReturnType<typeof declaredStandingRows>;
  readonly home: string;
  readonly originOf?: (args: { cwd: string }) => string | undefined;
}): { readonly ownRepository: OwnRepositoryState } {
  if (declared.isOk()) {
    return { ownRepository: ownRepositoryStateOf({ ownRepository: declared.value.ownRepository }) };
  }
  const alone = ownRepositoryDeclaration({ home, originOf });
  if (alone.isErr()) {
    return { ownRepository: { kind: "history-unreadable", message: alone.error.message } };
  }
  return { ownRepository: ownRepositoryStateOf({ ownRepository: alone.value }) };
}

/**
 * The retirement registry's state as the report carries it: none, which rows, or why it could not be read.
 *
 * @param retirements the registry as read
 * @returns the report's field
 */
export function retirementsState({
  retirements,
}: {
  readonly retirements: ReturnType<typeof readAutomationRetirements>;
}): RetirementsState {
  if (retirements.isErr()) {
    return { error: retirements.error, kind: "unreadable" };
  }
  const recipeIds = retirements.value.retirements.map((retirement) => retirement.recipeId);
  return recipeIds.length === 0 ? { kind: "none" } : { kind: "configured", recipeIds };
}
