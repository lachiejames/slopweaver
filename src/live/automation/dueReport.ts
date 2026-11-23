/**
 * The DUE-ASKS report — one row per automation, and the whole of what `slopweaver automation due` composes.
 *
 * **There is no clock.** An automation is run or spawned by the supervisor,
 * by judgement, at the decision point where it already spawns board rows. This module is what the tick is
 * told so that judgement has something to stand on — and it is PURE, so what the supervisor reads is decided
 * by code a test can drive rather than by whatever a verb happened to print.
 *
 * ## It judges nothing new
 *
 * Due-ness comes from `./definitionDue.ts`'s `judgeRecipeDefinitions`, which already ships and is already
 * what `automation run-due` decides with. Lateness comes from `./definitionTolerance.ts`, the run shape from
 * `./definitionShape.ts`, and the claim from `./definitionClaim.ts`. Everything here composes those four
 * into one row and orders the result.
 *
 * ## Every row appears, current ones included
 *
 * The same rule `refresh --if-stale` and the alert tally hold themselves to: a report that lists only what
 * it selected cannot be told apart from a report that selected nothing. A parked row, a current row and a
 * row whose cadence will not parse each print their own line.
 */
import type { RecipeDefinition, RecipeOnMissed } from "./definition.js";
import { liveClaimFor, type RecipeDefinitionClaim, type RecipeDefinitionClaims } from "./definitionClaim.js";
import type { RecipeDueVerdict, RecipeOffReason } from "./definitionDue.js";
import { type RecipeRunShape, runShapeForDefinition } from "./definitionShape.js";
import { judgeRecipeTolerance, type RecipeTolerance, type RecipeToleranceBand } from "./definitionTolerance.js";
import type { RecipeEffect } from "./kinds.js";
import { type OwnerHoldPlacedByState, ownerHoldPlacedByStateOf } from "./ownerHoldPlacedBy.js";
import type { OwnRepositoryState } from "./ownRepository.js";
import type { AutomationRetirementStoreError } from "./retirementStore.js";
import type { StandingRowAbsence } from "./standingRowAbsence.js";
import type { StandingRowRepositoryDrift } from "./standingRowRepositoryDrift.js";
import type { StandingRowSupersession } from "./standingRowSupersession.js";
import { strandedResyncIds } from "./strandedResync.js";
import type { TeamRepositoryStoreError } from "./teamRepositoryStore.js";

/** What one automation looks like to the supervisor's tick. */
export interface DueAskRow {
  readonly recipeId: string;
  readonly kind: string;
  /**
   * The row's own five-field cron, verbatim.
   *
   * Carried rather than left to be inferred from {@link DueAskRow.tolerance}'s derived band: a reader
   * asking "on what cadence is this atlas scheduled" is asking about the DECLARATION, and a tolerance band
   * answers a different question — how late this particular firing is. A report listing every atlas
   * and corpus source WITH its cadence needs the declaration, and a band cannot be read back into one.
   */
  readonly cadence: string;
  /** What the row declared itself to do — so a held row's cost is visible as silence or as a missing card. */
  readonly effect: RecipeEffect;
  /** True only when the row is due AND nothing live is holding it. */
  readonly actionable: boolean;
  /** The due verdict's own answer, before the claim is considered. */
  readonly due: boolean;
  /**
   * Why this row is OFF, or `undefined` when it is live and merely between firings.
   *
   * Carried because without it the two states render identically, which made the report say the opposite of
   * the truth. MEASURED with twelve alert-digest rows already `enabled: false`:
   * `slopweaver automation due | grep -c parked` answered `0`, and every one of those rows printed
   * `· current · next in 17.0h` — a reader checking that the digests were off was told when they would next
   * post. `judgeRecipeDue` had always computed the distinction; the row simply dropped it on the floor.
   */
  readonly offReason?: RecipeOffReason | undefined;
  /**
   * The finding a FAILURE hold names (`./failureHold.ts`), or `undefined` for a live row and for the owner's own hold.
   *
   * Carried because the two holds lift on different acts and the line must say which. MEASURED:
   * six resync rows sat under store-placed failure holds printing "lifted only by the owner's recorded
   * approval" — false for every one of them, since each lifts when its finding settles with the fix — and no
   * session repaired them, because the line read as work blocked on the owner.
   */
  readonly heldOnFinding?: string | undefined;
  /**
   * What the board says about that finding now (`./failureHold.ts#failureFindingState`'s line), when the LIFTED
   * view read it — `undefined` in the stored view. It is what the line quotes, because one case does wait on
   * the owner: a finding settled `declined` lifts only on the owner's `clearedBy`, and a generic "lifts on the fix"
   * would hide it.
   */
  readonly heldFindingLine?: string | undefined;
  /**
   * Whether the owner's words naming this automation are on its OWNER hold (`./ownerHoldPlacedBy.ts`), or `undefined`
   * for a live row and a failure hold. Anything but `anchored` prints UNOWNED: MEASURED,
   * `vulnfix-topup-acme-admin` sat under a hold the chair placed by keypress and the seat wrote up as the owner's, and
   * this report printed it `--` like any hold the owner chose. It reports; the row stays held either way.
   */
  readonly ownerHoldPlacedByState?: OwnerHoldPlacedByState | undefined;
  readonly shape: RecipeRunShape;
  readonly tolerance: RecipeTolerance;
  readonly firingsSinceWatermark: number;
  readonly lastRunAtIso: string | null;
  /** What this row does about missed slots — the policy that chose {@link DueAskRow.slotIso}. */
  readonly onMissed: RecipeOnMissed;
  /** The cadence slot a run now would cover, or `null` when the row is not due. */
  readonly slotIso: string | null;
  /** Slots still owed after that one — non-zero only for a per-slot kind that backfills. */
  readonly slotsOwedAfterThis: number;
  /** The live claim holding this row, or `undefined` when nothing is. */
  readonly claim: RecipeDefinitionClaim | undefined;
}

/** Everything one read of the store found. */
export interface DueAskReport {
  readonly rows: readonly DueAskRow[];
  /** Definition files that could not be parsed at all, as the store reported them. */
  readonly rejected: readonly string[];
  /**
   * Rows this install declares that the store does not hold at all — `./declaredStandingRows.ts`.
   *
   * Carried here because a report of what IS scheduled can never report what stopped being scheduled, and
   * that is not a hypothetical: the `worktree-prune` row ran daily, left the definition
   * directory, and this verb printed nothing about it for seventeen days while worktrees accumulated to 766.
   */
  readonly missing: readonly StandingRowAbsence[];
  /**
   * Required rows the store still holds exactly as an earlier build wrote them — `./standingRowSupersession.ts`'s
   * `supersededStandingRows`. Carried beside {@link DueAskReport.missing} because a row that is present
   * on a retired cadence lists as healthy: `worktree-prune` stayed `0 4 * * *` on the install that the
   * hourly declaration was written for.
   */
  readonly superseded: readonly StandingRowSupersession[];
  /**
   * Rows that RUN a resync on a kind no seat picks up — `./strandedResync.ts`, by recipe id.
   *
   * Carried for the same reason {@link DueAskReport.missing} is: a report of what IS scheduled cannot say
   * what the schedule can never reach. MEASURED, 43 of these read as `actionable` on the same
   * store where `automation seat` exited 3 with nothing to seat.
   */
  readonly stranded: readonly string[];
  /**
   * What this install's team repository registry said — `./teamRepositoryStore.ts`. `none` is a fresh install's
   * valid state, printed as one informational line; `unreadable` means the declared roster is unknown, so
   * {@link DueAskReport.missing} and {@link DueAskReport.superseded} are empty because nothing was compared,
   * never because nothing is missing. Omitted by a caller that did not read the registry.
   */
  readonly teamRepositories?: TeamRepositoriesState;
  /**
   * What this install's retirement registry said — `./retirementStore.ts`. A retired row has no definition and no
   * line of its own, so this is the one place a retirement stays visible: `configured` prints one line naming every
   * retired row, and `unreadable` leads the report because the declaration it feeds is unknown, so
   * {@link DueAskReport.missing} is empty by not comparing. Omitted by a caller that did not read it.
   */
  readonly retirements?: RetirementsState;
  /**
   * Which repository this install's own-repository rows drive — `./ownRepository.ts`. `unresolved` leads the report:
   * neither row is declared, so {@link DueAskReport.missing} is silent about them by not comparing. Read on its own when
   * a registry refused the whole declaration, so that refusal cannot hide it. Omitted by a caller that did not read it.
   */
  readonly ownRepository?: OwnRepositoryState;
  /**
   * Own-repository rows the store holds on another repository, in a shape no build wrote —
   * `./standingRowRepositoryDrift.ts`. Carried because such a row lists as healthy while reading zero pull requests.
   */
  readonly repositoryDrift: readonly StandingRowRepositoryDrift[];
  readonly nowIso: string;
}

/** The retirement registry as `automation due` read it. */
export type RetirementsState =
  | { readonly kind: "none" }
  | { readonly kind: "configured"; readonly recipeIds: readonly string[] }
  | { readonly kind: "unreadable"; readonly error: AutomationRetirementStoreError };

/** The team repository registry as `automation due` read it. */
export type TeamRepositoriesState =
  | { readonly kind: "none" }
  | { readonly kind: "configured"; readonly count: number }
  | { readonly kind: "unreadable"; readonly error: TeamRepositoryStoreError };

/**
 * A row is worth acting on when its schedule says so, nothing is already running it, and this build can
 * actually run it.
 *
 * The third clause is the one a dogfood found: a `metrics-push` row was registered, due and unrunnable, and
 * counting it actionable told a tick to act on a row that has no executor at all. It still PRINTS — with
 * its own `!!` marker — because a registered kind nothing implements is a real state a reader should see;
 * it is simply not something the tick can be asked to do anything about.
 *
 * Two more clauses come from the same pre-mortem. A row whose cadence will not parse cannot be CLAIMED —
 * there is no next firing to expire a claim at, so `automation claim` refuses it — and reporting it actionable
 * would tell a tick to attempt something guaranteed to fail. And when the claims file itself could not be
 * read, NOTHING is actionable: rows still print, so a tick sees its whole schedule, but a corrupt claim
 * file read as "nothing is claimed" is exactly how two ticks spawn the same investigation.
 */
function rowIsActionable({
  due,
  claim,
  shape,
  band,
  claimsReadable,
}: {
  readonly due: boolean;
  readonly claim: RecipeDefinitionClaim | undefined;
  readonly shape: RecipeRunShape;
  readonly band: RecipeToleranceBand;
  readonly claimsReadable: boolean;
}): boolean {
  return due && claim === undefined && shape !== "no-executor" && band !== "unschedulable" && claimsReadable;
}

/** The owner hold's attribution, for a row OFF on a hold that names no finding — `undefined` for anything else. */
function ownerHoldStateOf({
  definition,
  verdict,
}: {
  readonly definition: RecipeDefinition;
  readonly verdict: RecipeDueVerdict;
}): OwnerHoldPlacedByState | undefined {
  const { hold } = definition;
  if (verdict.offReason !== "held" || hold === undefined || hold.finding !== undefined) {
    return undefined;
  }
  return ownerHoldPlacedByStateOf({ definition: { ...definition, hold } });
}

/**
 * Compose one row from its definition and its due verdict.
 *
 * @param definition the parsed row
 * @param verdict the due verdict for that row
 * @param claims every stored claim
 * @param claimsReadable whether the claims file could be read at all
 * @param nowIso the reference instant
 * @returns the row the report carries
 * @internal — {@link composeDueAskReport} is the entry point; this is exported for its own unit test
 */
export function dueAskRow({
  definition,
  verdict,
  claims,
  claimsReadable,
  nowIso,
}: {
  readonly definition: RecipeDefinition;
  readonly verdict: RecipeDueVerdict;
  readonly claims: RecipeDefinitionClaims;
  readonly claimsReadable: boolean;
  readonly nowIso: string;
}): DueAskRow {
  const claim = liveClaimFor({ claims, nowIso, recipeId: definition.recipeId });
  const shape = runShapeForDefinition({ definition });
  const tolerance = judgeRecipeTolerance({
    cadence: definition.cadence,
    firingsSinceWatermark: verdict.firingsSinceWatermark,
    nowIso,
  });
  return {
    actionable: rowIsActionable({ band: tolerance.band, claim, claimsReadable, due: verdict.due, shape }),
    cadence: definition.cadence,
    claim,
    due: verdict.due,
    effect: definition.effect,
    firingsSinceWatermark: verdict.firingsSinceWatermark,
    heldFindingLine: verdict.offReason === "held" ? definition.hold?.findingState?.line : undefined,
    heldOnFinding: verdict.offReason === "held" ? definition.hold?.finding : undefined,
    kind: definition.kind,
    lastRunAtIso: verdict.lastRunAtIso,
    offReason: verdict.offReason,
    onMissed: definition.onMissed,
    ownerHoldPlacedByState: ownerHoldStateOf({ definition, verdict }),
    recipeId: definition.recipeId,
    shape,
    slotIso: verdict.slotIso,
    slotsOwedAfterThis: verdict.slotsOwedAfterThis,
    tolerance,
  };
}

/** Where a row sorts: actionable first, then the most overdue, then by id so the order never wobbles. */
const BAND_RANK: Readonly<Record<RecipeToleranceBand, number>> = {
  comfortable: 2,
  overdue: 0,
  unschedulable: 3,
  urgent: 1,
};

/**
 * Order the rows the way a tick reads them: what can be acted on now, most pressing first.
 *
 * Ordering is here rather than in the renderer because it is a claim about priority, which is the kind of
 * thing a test should be able to pin. Ties break on `recipeId` so two rows in the same band never swap
 * places between two ticks and read as movement.
 *
 * @param rows the composed rows
 * @returns the same rows, ordered
 */
export function orderDueAskRows({ rows }: { readonly rows: readonly DueAskRow[] }): readonly DueAskRow[] {
  return rows.toSorted((left, right) => {
    if (left.actionable !== right.actionable) {
      return left.actionable ? -1 : 1;
    }
    const bandDelta = BAND_RANK[left.tolerance.band] - BAND_RANK[right.tolerance.band];
    if (bandDelta !== 0) {
      return bandDelta;
    }
    return left.recipeId.localeCompare(right.recipeId);
  });
}

/**
 * Build the whole report from what the store handed back.
 *
 * @param definitions the parsed rows
 * @param verdicts one due verdict per row, in the same order
 * @param rejected the definition files the store could not parse
 * @param claims every stored claim
 * @param claimsReadable whether the claims file could be read; when false NOTHING is actionable
 * @param missing the declared rows the store does not hold — `./declaredStandingRows.ts`
 * @param superseded the rows the store holds as an earlier build wrote them, untouched since
 * @param teamRepositories what the team repository registry said, when the caller read it
 * @param retirements what the retirement registry said, when the caller read it
 * @param ownRepository which repository the own-repository rows drive, when the caller read it
 * @param repositoryDrift the own-repository rows the store holds on another repository
 * @param tickResyncIds the managed resync rows this build writes to run in the chair's tick — a compile-only
 *   atlas's — so one of those on a run-here kind is where it belongs rather than stranded. Required: omitting
 *   it would report every such row as unreachable, and a caller has to say which build it read
 * @param nowIso the reference instant
 * @returns the ordered report
 */
export function composeDueAskReport({
  definitions,
  verdicts,
  rejected,
  claims,
  claimsReadable = true,
  missing = [],
  superseded = [],
  teamRepositories,
  retirements,
  ownRepository,
  repositoryDrift = [],
  tickResyncIds,
  nowIso,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly verdicts: readonly RecipeDueVerdict[];
  readonly rejected: readonly string[];
  readonly claims: RecipeDefinitionClaims;
  readonly claimsReadable?: boolean;
  readonly missing?: readonly StandingRowAbsence[];
  readonly superseded?: readonly StandingRowSupersession[];
  readonly teamRepositories?: TeamRepositoriesState;
  readonly retirements?: RetirementsState;
  readonly ownRepository?: OwnRepositoryState;
  readonly repositoryDrift?: readonly StandingRowRepositoryDrift[];
  readonly tickResyncIds: readonly string[];
  readonly nowIso: string;
}): DueAskReport {
  const byId = new Map(verdicts.map((verdict) => [verdict.recipeId, verdict]));
  const rows = definitions.flatMap((definition) => {
    const verdict = byId.get(definition.recipeId);
    if (verdict === undefined) {
      return [];
    }
    return [dueAskRow({ claims, claimsReadable, definition, nowIso, verdict })];
  });
  // The registry's state leads the report, so an unreadable registry is the first thing --json shows.
  return {
    ...(teamRepositories === undefined ? {} : { teamRepositories }),
    ...(retirements === undefined ? {} : { retirements }),
    ...(ownRepository === undefined ? {} : { ownRepository }),
    missing,
    nowIso,
    rejected,
    repositoryDrift,
    rows: orderDueAskRows({ rows }),
    stranded: strandedResyncIds({ definitions, tickResyncIds }),
    superseded,
  };
}
