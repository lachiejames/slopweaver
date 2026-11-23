/**
 * The gap lifecycle every atlas shares, and the small vocabulary every atlas must be able to raise.
 *
 * A gap is a first-class OUTPUT — the thing that makes a ticket list derivable instead of remembered. So it
 * accumulates like an entity, and it closes only when its own `(condition, scope)` pair is rechecked. A gap
 * closed by "the sync succeeded" would be closed by an unrelated success, and the questions that never get
 * answered are exactly the ones nobody rechecks — so a run that failed closes nothing at all.
 *
 * ## Why surface disagreement lives HERE and not in a resolver
 *
 * When the API and the browser disagree about the same thing, the atlas records the disagreement as a gap
 * rather than picking a winner. That is the owner's ruling and the reasoning is not about difficulty: you
 * cannot always code your way out of it, because sometimes the vendor is simply like that. VISIBILITY over
 * the gotcha IS the product — an unknown-unknown you would otherwise hit the hard way, surfaced in a list
 * you can read. A resolver that quietly preferred one surface would destroy exactly the signal the second
 * surface was added to produce.
 *
 * ## The vocabulary is split, and the split is measured
 *
 * Across the two atlases that existed before this kit, 25 distinct gap conditions were in use and exactly
 * TWO were shared. A kit-owned union of all of them would fit neither. So a platform owns its own
 * vocabulary and the kit owns only {@link KIT_GAP_CONDITIONS} — the conditions that are part of what an
 * atlas IS rather than what a platform happens to do, which is why every atlas must be able to raise them.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { stableGapId } from "./identity.js";
import { AtlasPublishErrors, atlasPublishErrorLines } from "./publishErrors.js";

/**
 * The conditions every atlas must be able to raise, whatever platform it maps.
 *
 * Both members concern the relationship BETWEEN surfaces, which is why neither can belong to a platform:
 * corroboration between the API and the browser is part of the definition of an atlas, so two atlases
 * describing the same phenomenon in two different words would be two atlases with no comparable output.
 */
export const KIT_GAP_CONDITIONS = ["api-browser-disagreement", "browser-surface-unreadable"] as const;

/** A gap, as stored. `condition` is the platform's own vocabulary widened by {@link KIT_GAP_CONDITIONS}. */
export interface AtlasGap {
  readonly condition: string;
  readonly firstDetectedAt: string;
  /** Which fields the surfaces disagree about. Empty unless the condition is a disagreement. */
  readonly fields: readonly string[];
  readonly id: string;
  /** The entity kind this gap is about, or `null` for a cross-kind gap. */
  readonly kind: string | null;
  readonly lastCheckedAt: string | null;
  readonly lastDetectedAt: string;
  readonly reason: string;
  readonly scope: string;
  readonly status: "open" | "closed";
  /** Which surfaces this gap concerns. Two of them, for a disagreement; empty when surface-independent. */
  readonly surfaces: readonly string[];
}

/**
 * The minimum the lifecycle needs of a gap. A platform whose stored gap predates {@link AtlasGap} — one
 * carrying its own surface vocabulary, say — still reconciles through this without a disk change, for the
 * same reason `merge.ts` takes a fold callback rather than a shared entity schema: the lifecycle is what
 * generalises, and forcing a stored shape to change is how a refactor turns into a mandatory reset.
 */
interface ReconcilableGap {
  readonly condition: string;
  readonly firstDetectedAt: string;
  readonly id: string;
  readonly lastCheckedAt: string | null;
  readonly lastDetectedAt: string;
  readonly scope: string;
  readonly status: "open" | "closed";
}

/**
 * A gap observed during this run.
 *
 * @param condition what is missing, from the platform's vocabulary or {@link KIT_GAP_CONDITIONS}
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which surfaces this gap concerns; empty when surface-independent
 * @param fields which fields disagree; empty unless this is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: string;
  scope: string;
  kind: string | null;
  surfaces: readonly string[];
  fields: readonly string[];
  reason: string;
  at: string;
}): AtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: stableGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/**
 * Record that two surfaces disagree about one thing.
 *
 * A named constructor rather than a bare {@link openGap} call, because this is the case the whole
 * two-surface design exists to surface and it should be as cheap to raise as it is important.
 *
 * @param scope what the two surfaces disagree about
 * @param kind the entity kind, or `null` for a cross-kind disagreement
 * @param surfaces the two disagreeing surface names
 * @param fields the fields whose values differ
 * @param reason why, in English — what each surface said
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openDisagreementGap({
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  scope: string;
  kind: string | null;
  surfaces: readonly string[];
  fields: readonly string[];
  reason: string;
  at: string;
}): AtlasGap {
  return openGap({ at, condition: "api-browser-disagreement", fields, kind, reason, scope, surfaces });
}

/**
 * The same gap, returned under a platform's own narrow vocabulary.
 *
 * {@link openGap} returns the kit's widened {@link AtlasGap}, whose `condition`, `kind` and `surfaces` are
 * plain strings — which is right for the lifecycle and wrong for a stored document, where each atlas's
 * schema admits only its own words. Every atlas therefore wrote the same eleven-field literal a second time
 * to get the narrow type back. This returns it directly: the caller's own literal types flow through, so
 * the result is exactly as strict as a hand-written one and there is one construction rather than two.
 *
 * @param condition what is missing, from the platform's vocabulary
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which surfaces this gap concerns; empty when surface-independent
 * @param fields which fields disagree; empty unless this is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped, under the caller's own types
 */
export function openTypedGap<TCondition extends string, TKind extends string, TSurface extends string>({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: TCondition;
  scope: string;
  kind: TKind | null;
  surfaces: readonly TSurface[];
  fields: readonly string[];
  reason: string;
  at: string;
}): {
  condition: TCondition;
  fields: string[];
  firstDetectedAt: string;
  id: string;
  kind: TKind | null;
  lastCheckedAt: string | null;
  lastDetectedAt: string;
  reason: string;
  scope: string;
  status: "open" | "closed";
  surfaces: TSurface[];
} {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: stableGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/** A condition and scope that were genuinely rechecked, and what the recheck found. */
export interface AtlasGapRecheck {
  readonly condition: string;
  readonly scope: string;
  /** `true` when the question is now answered. Only this closes the gap. */
  readonly resolved: boolean;
}

/** Deterministic order, so two runs over the same data write identical bytes. */
function sorted<TGap extends ReconcilableGap>({ gaps }: { gaps: readonly TGap[] }): readonly TGap[] {
  return [...gaps].toSorted((left, right) => left.id.localeCompare(right.id));
}

/** Fold this run's observations in, preserving each gap's original first-detection stamp. */
function foldObserved<TGap extends ReconcilableGap>({
  byId,
  observed,
  at,
}: {
  byId: Map<string, TGap>;
  observed: readonly TGap[];
  at: string;
}): void {
  for (const gap of observed) {
    const prior = byId.get(gap.id);
    // A gap the store has never held is first detected now; one it holds keeps the stamp it was raised with.
    const firstDetectedAt = prior === undefined ? at : prior.firstDetectedAt;
    byId.set(gap.id, {
      ...gap,
      firstDetectedAt,
      lastCheckedAt: at,
      lastDetectedAt: at,
      status: "open",
    });
  }
}

/**
 * Fold this run's gaps and rechecks into what is already stored.
 *
 * @param stored every gap already held
 * @param observed gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcileGaps<TGap extends ReconcilableGap>({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly TGap[];
  observed: readonly TGap[];
  rechecks: readonly AtlasGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly TGap[]> {
  const duplicates = observed.map((gap) => gap.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length > 0) {
    return err(atlasPublishErrorLines({ error: AtlasPublishErrors.gapIdsDuplicated({ ids: duplicates }) }));
  }

  const byId = new Map(stored.map((gap) => [gap.id, gap]));
  foldObserved({ at, byId, observed });

  if (runFailed) {
    return ok(sorted({ gaps: [...byId.values()] }));
  }
  const observedIds = new Set(observed.map((gap) => gap.id));
  for (const recheck of rechecks) {
    const id = stableGapId({ condition: recheck.condition, scope: recheck.scope });
    const gap = byId.get(id);
    if (gap === undefined || observedIds.has(id)) {
      continue;
    }
    byId.set(id, { ...gap, lastCheckedAt: at, status: recheck.resolved ? "closed" : "open" });
  }
  return ok(sorted({ gaps: [...byId.values()] }));
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 */
export function openGaps<TGap extends ReconcilableGap>({ gaps }: { gaps: readonly TGap[] }): readonly TGap[] {
  return gaps.filter((gap) => gap.status === "open");
}

/**
 * The stored gaps a walk must LEAVE ALONE — everything another writer put there.
 *
 * Kit-owned because it was copied, and because the shape a copy reaches for is the one that is wrong: a
 * chain of `!==` comparisons has to be extended by hand every time the walk learns a new condition, and the
 * one it forgets accumulates duplicates silently. A membership test over the conditions the walk OWNS
 * cannot fall behind them.
 *
 * @param gaps every gap the kind file already holds
 * @param ownConditions the conditions this walk republishes on every run
 * @returns the gaps to carry forward untouched
 */
export function foreignGaps<TGap extends { readonly condition: string }>({
  gaps,
  ownConditions,
}: {
  gaps: readonly TGap[];
  ownConditions: readonly string[];
}): readonly TGap[] {
  const own = new Set(ownConditions);
  return gaps.filter((gap) => !own.has(gap.condition));
}
