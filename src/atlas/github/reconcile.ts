/**
 * This atlas's gap classification and its per-kind merge — the two judgements that are GitHub's own.
 *
 * The LIFECYCLES are the kit's: `kit/gaps.ts` accumulates a gap and closes it only when its own
 * `(condition, scope)` pair is rechecked, `kit/merge.ts` folds a run's observations into what is stored,
 * and `kit/completeRead.ts` holds the proof that has to exist before anything is staled. What is here is
 * the part that could not be shared — which condition a GitHub failure raises, and what GitHub's own
 * pagination lets a read prove.
 *
 * ## One gap here is PERMANENT and that is honest rather than a defect
 *
 * `browser-denominator-unproven` never closes on a good run, because nothing a run does can close it.
 * Falcon publishes `/content/sitemap-v2/index.json` and CrowdStrike's walk is judged against a list it did
 * not choose; GitHub publishes no authenticated settings sitemap — searched across its REST
 * description, its GraphQL schema documentation and its API root, and none was found. So this walk is
 * judged against the navigation GitHub RENDERED to this principal, which is a frontier and not a manifest.
 *
 * ## GitHub's completeness proof is weaker than Falcon's, and says so
 *
 * Falcon reports a `meta.pagination.total` a read can be checked against. GitHub's REST listings mostly do
 * not — they hand back a `Link` header and stop — so for most kinds the proof rests on paging alone. That
 * is stated in the proof string rather than hidden, so a reader can see which evidence a stale mark rests
 * on rather than assuming both conditions held.
 */
import { ok, type Result } from "../../lib/result.js";
import { type CompleteRead, provenCompleteRead as kitProvenCompleteRead } from "../kit/completeRead.js";
import { openTypedGap } from "../kit/gaps.js";
import { mergeKind } from "../kit/merge.js";
import type { GithubAtlasError } from "./errors.js";
import type { GithubEntity, GithubGap } from "./kindFiles.js";
import type { GithubGapCondition, GithubKind, GithubSurface } from "./model.js";

/**
 * Evidence that one kind's read reached the end of its own result set. Kit-owned; see its own module.
 *
 * @internal
 */
export type CompleteGithubRead = CompleteRead;

/**
 * The gap condition each typed provider failure raises.
 *
 * A TABLE keyed by the error union's own `code`, rather than a switch. `Record<GithubAtlasError["code"], …>`
 * is exhaustive by construction — a new failure kind added to the union fails to compile here until it has
 * a row — which is the same guarantee a `never` default gives and is easier to read as the mapping it is.
 *
 * Two failures deliberately share one condition. A plan gap and an absent route are both `route-absent`
 * because neither is readable HERE and no permission grant changes that; what tells them apart for a reader
 * is the coverage cell's `unblockedBy`, which says "nothing will open this" for one and names a permission
 * for the other.
 */
const GAP_CONDITION_BY_CODE: Readonly<Record<GithubAtlasError["code"], GithubGapCondition>> = {
  AUTH_FAILED: "auth-failed",
  INCOMPLETE_READ: "incomplete-read",
  PLAN_UNAVAILABLE: "route-absent",
  ROUTE_ABSENT: "route-absent",
  SCOPE_REFUSED: "scope-refused",
  TRANSPORT_EXHAUSTED: "transport-exhausted",
  UNUSABLE_RESPONSE: "schema-drift",
};

/**
 * The gap condition a typed provider failure raises.
 *
 * @param error the failure to classify
 * @returns the condition to raise for it
 */
export function classifyGithubGap({ error }: { error: GithubAtlasError }): GithubGapCondition {
  return GAP_CONDITION_BY_CODE[error.code];
}

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which surfaces this gap concerns; empty when surface-independent
 * @param fields which fields disagree; empty unless this is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openGithubGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: GithubGapCondition;
  scope: string;
  kind: GithubKind | null;
  surfaces: readonly GithubSurface[];
  fields: readonly string[];
  reason: string;
  at: string;
}): GithubGap {
  return openTypedGap({ at, condition, fields, kind, reason, scope, surfaces });
}

/**
 * Prove that a GitHub read finished, or say why it did not.
 *
 * @param kind the kind this read covered
 * @param observed how many entities the read produced
 * @param reportedTotal GitHub's own `total_count`, or `null` when the listing reports none
 * @param pagesExhausted whether paging ended because GitHub offered no further page
 * @returns the proof, or every reason the read may not be treated as complete
 */
export function provenCompleteRead({
  kind,
  observed,
  reportedTotal,
  pagesExhausted,
}: {
  kind: GithubKind;
  observed: number;
  reportedTotal: number | null;
  pagesExhausted: boolean;
}): Result<CompleteGithubRead> {
  return kitProvenCompleteRead({ kind, observed, pagesExhausted, providerName: "GitHub", reportedTotal });
}

/**
 * Merge this run's freshly projected entities for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities
 * @param complete the proof that the read finished, or `null` when it did not — a `null` merges what was
 *   seen and leaves every unobserved entity exactly as it was
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeGithubKind<TEntity extends GithubEntity>({
  stored,
  observed,
  complete,
  at,
}: {
  stored: readonly TEntity[];
  observed: readonly TEntity[];
  complete: CompleteGithubRead | null;
  at: string;
}): Result<readonly TEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: prior, observed: fresh, at: when }): Result<TEntity> => {
      // A first sighting is first seen now; a re-sighting keeps the age it already had.
      if (prior === undefined) {
        return ok({ ...fresh, firstSeenAt: when });
      }
      return ok({ ...fresh, firstSeenAt: prior.firstSeenAt });
    },
    observed,
    staleEntity: ({ stored: entity }): TEntity | null =>
      complete === null || entity.state === "stale" ? null : { ...entity, state: "stale" },
    stored,
  });
}
