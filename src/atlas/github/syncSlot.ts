/**
 * One kind's per-run accumulator in `github sync`, and the two folds into it that need nothing but the slot:
 * a call's graded FAILURE, and the compiled `rest-openapi` surface that costs no network call.
 *
 * A leaf on purpose. `sync.ts` imports from here and this module imports nothing from it, so the
 * accumulator's shape and its no-lookup folds sit below the orchestration that reads, merges and publishes.
 */
import { failedGithubCoverageCell, githubKindScope, succeededGithubCoverageCell } from "./coverage.js";
import type { GithubAtlasError } from "./errors.js";
import type { GithubCoverageCell, GithubEntity, GithubGap } from "./kindFiles.js";
import { classifyGithubGap, openGithubGap } from "./reconcile.js";
import { type GithubKindFailure, isExpectedRefusal } from "./refusalGrade.js";
import type { CallOutcome } from "./syncRead.js";

/**
 * What one kind accumulated over this run, before it is merged into what the store already holds.
 *
 * `everyReadSucceeded` is the field a review caught missing. Staling is only safe when the read that did
 * not return an entity actually FINISHED, and a kind is fed by one call PER SCOPE — so a run in which one
 * organisation's webhooks read was refused, or stopped at the page ceiling, contributed no entities for it
 * and would otherwise have had a completeness proof manufactured for the kind as a whole. Live webhooks
 * belonging to that organisation would then be marked stale, which is the one error in this atlas a reader
 * cannot spot, because a staled record looks exactly like a deleted one.
 */
export interface KindSlot {
  entities: GithubEntity[];
  cells: GithubCoverageCell[];
  gaps: GithubGap[];
  /** False as soon as ANY call feeding this kind failed, for any scope. Only `true` permits staling. */
  everyReadSucceeded: boolean;
}

/**
 * Fold one call's FAILURE into its kind's bucket.
 *
 * @param outcome the call that failed
 * @param error its typed failure
 * @param scope the coverage scope this call is recorded under
 * @param slot the kind's accumulator
 * @param at this run's ISO timestamp
 * @returns the failure, marked `expected` when the refusal is one the call declares
 */
export function foldFailure({
  outcome,
  error,
  scope,
  slot,
  at,
}: {
  outcome: CallOutcome;
  error: GithubAtlasError;
  scope: string;
  slot: KindSlot;
  at: string;
}): GithubKindFailure {
  // Any failure at any scope, expected or not, costs this kind its completeness proof. An EXPECTED refusal
  // is an honest coverage boundary and still means the atlas did not see that scope's entities, so it may
  // not conclude that the ones it already holds are gone.
  slot.everyReadSucceeded = false;
  const expected = isExpectedRefusal({ call: outcome.call, error });
  const cell = failedGithubCoverageCell({ error, previous: null, role: "authoritative", scope, surface: "rest-live" });
  // An UNEXPECTED refusal is never an honest absence, whatever its natural grading. A 404 grades
  // `unavailable`, which `isCoveredCell` accepts — and a review found the consequence: `GET /orgs/{org}`
  // answering 404 counted as covered, so a sync that could not read an organisation's settings at all
  // exited zero. Where the call did not declare the status expected, the cell says `unreadable`: the atlas
  // wanted this and did not get it, which is exactly what that state means.
  slot.cells.push(expected ? cell : { ...cell, state: "unreadable" });
  const failure = { code: error.code, expected, kind: outcome.call.kind, reason: error.message, route: outcome.route };
  if (expected) {
    return failure;
  }
  slot.gaps.push(
    openGithubGap({
      at,
      condition: classifyGithubGap({ error }),
      fields: [],
      kind: outcome.call.kind,
      reason: error.message,
      scope,
      surfaces: ["rest-live"],
    }),
  );
  return failure;
}

/**
 * Seed the compiled `rest-openapi` surface into its kind.
 *
 * The only surface that costs no network call, so it is always fully covered and always `synced`.
 *
 * @param restOperations the compiled operations
 * @param slot the kind's accumulator
 * @param at this run's ISO timestamp
 */
export function seedCompiledOperations({
  restOperations,
  slot,
  at,
}: {
  restOperations: readonly GithubEntity[];
  slot: KindSlot;
  at: string;
}): void {
  slot.entities.push(...restOperations);
  slot.cells.push(
    succeededGithubCoverageCell({
      artifacts: [],
      at,
      reason: `${String(restOperations.length)} operation(s) read from GitHub's own published OpenAPI description, with no network call`,
      role: "authoritative",
      scope: githubKindScope({ kind: "rest-operation", scopeRef: "github" }),
      state: "synced",
      surface: "rest-openapi",
    }),
  );
}
