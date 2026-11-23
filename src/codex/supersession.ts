/**
 * Retiring ONE recorded review pass whose PROPERTY WORDING was unsatisfiable, with the reason on the record.
 *
 * The owner's ruling chose between reading only the latest verdict per property id and giving a session a verb
 * that supersedes a pass with a recorded reason. The second, because the first hides the thing worth seeing: a session that softened
 * a real `BROKEN` finding by re-running the same property id with weaker wording would leave no trace at all.
 *
 * ## What made this necessary, measured
 *
 * A review property containing an unbounded quantifier has no fixed point. On one pull request, a property
 * asked that the request uuid be carried "wherever GitHub supplied one ANYWHERE in the response".
 * Each round the reviewer moved the uuid one level deeper — top-level, then `details.request.uuid`, then a
 * fabricated `{"a":{"b":{"c":{"d":{"uuid":"req-123"}}}}}` — and no bounded search can win that, while an
 * unbounded walk over an arbitrary structure is a worse thing to own than a lost id. The same property,
 * scoped to GitHub's documented schema, returned `CLEAN` immediately. Six EARLIER rounds under bounded
 * properties found six real defects and converged, so the failure is the wording rather than the reviewer.
 *
 * ## The three properties that keep this from being an escape hatch
 *
 * **It retires one ARTIFACT, never a property id.** The row names the exact pass being set aside, so a future
 * pass under the same id is untouched and a genuinely broken finding cannot be pre-emptively waived.
 *
 * **It REFUSES without a replacement.** {@link supersedeRefusal} requires a later pass on the same property
 * id, over the same tree, that reached a conclusive verdict. So the shape is "this wording was replaced by
 * that one", never "this finding is dismissed" — which is exactly the flow the ruling describes and makes the
 * abuse the owner was worried about structurally unavailable rather than merely discouraged.
 *
 * **A retired pass stays VISIBLE.** It is never deleted and never hidden: `codex status` keeps printing it,
 * marked `SUPERSEDED` with its reason, so the fact that a wording was retired is part of the permanent record.
 * Only the landing gate stops counting it.
 *
 * ## The second shape: a pass that recorded NO TREE (owner ruling)
 *
 * A pass whose tree capture failed cannot be placed on any branch, so `./ledger.ts` counts it `unknowable` for
 * its whole checkout and the landing floor fails closed on it — correctly, because it could have been the
 * newest BLOCKED plan. Nothing retired one, so a checkout that ever recorded one refused FOREVER: measured on
 * one checkout, a plan READY with no tree, a later placed p2 READY and
 * CLEAN reviews after it, and the landing still needed `SLOPWEAVER_ALLOW_UNREVIEWED`. Over ten days,
 * 20 of 504 plan passes on this machine recorded no tree.
 *
 * The owner's ruling chose this verb over quietly not counting such a record once a later pass captured a tree: a supersede verb retires a no-tree record with its reason, explicit
 * and journalled, the gate staying fail-closed by default. So the same three properties hold, with the replacement stated for a record nobody can place:
 * {@link unplaceableSupersedeRefusal} wants a STRICTLY LATER conclusive pass of the same mode, with provenance,
 * on the branch being judged — exactly the state `planFailures` would have accepted had the record been placed
 * there, since a later plan is already the latest word.
 *
 * Pure. The caller supplies the rows and the ledger; `./supersessionStore.ts` is the effectful half.
 */

import type { LedgerEntry } from "./ledger.js";
import type { UnplaceableRecord } from "./unplaceable.js";

/** One retirement: which recorded pass, why, and who said so. */
export type Supersession = WordingSupersession | UnplaceableSupersession;

/** A review pass whose property WORDING could not be satisfied, retired beside a replacement under the same id. */
export interface WordingSupersession {
  /**
   * Absent on every row written before the second shape existed, so it is optional rather than required: an
   * old row on disk and a new one read the same.
   */
  readonly kind?: "wording";
  /** The artifact id of the pass being retired. One row retires one pass, never a property id. */
  readonly artifactId: string;
  /** The property id that pass reviewed, carried so a reader can see what was retired without a second read. */
  readonly propertyId: string;
  /** Why the wording could not be satisfied. Required, and printed forever beside the retired pass. */
  readonly reason: string;
  /** The artifact id of the pass that replaced it, which {@link supersedeRefusal} proved exists. */
  readonly replacedBy: string;
  readonly atIso: string;
}

/** A pass that recorded no tree, retired beside a later pass on the branch that did. */
export interface UnplaceableSupersession {
  readonly kind: "no-tree";
  /** The artifact id of the pass being retired. */
  readonly artifactId: string;
  /** The pass id and arm it recorded, carried so the retirement reads without the record. */
  readonly pass: string;
  readonly mode: "plan" | "review";
  /** The property id, for a review; absent for a plan, which reviews no single claim. */
  readonly propertyId?: string;
  /** Why it may stop counting. Required, and printed forever beside the retired pass. */
  readonly reason: string;
  /** The later pass with provenance that {@link unplaceableSupersedeRefusal} proved exists. */
  readonly replacedBy: string;
  /**
   * The branch that replacement stood on, and the ONLY branch the retirement discounts the record for. The
   * record itself names no branch, so the proof holds for the branch it was taken on and no other: a checkout
   * that has since moved to another branch still counts the record there, fail-closed.
   */
  readonly branch: string;
  readonly atIso: string;
}

/**
 * Why this pass may not be retired, or `undefined` when it may.
 *
 * The replacement requirement is the whole guard, so it is stated as a REFUSAL rather than a warning: a
 * retirement with nothing in its place is indistinguishable from dismissing a finding, and the point of the
 * ruling was that the two must not look alike.
 *
 * @param entries the branch ledger, newest first
 * @param artifactId the pass a caller wants to retire
 * @param alreadyRetired the artifact ids already carrying a row
 * @returns the four-line refusal body, or `undefined` when the retirement is allowed
 */
export function supersedeRefusal({
  entries,
  artifactId,
  alreadyRetired,
}: {
  entries: readonly LedgerEntry[];
  artifactId: string;
  alreadyRetired: ReadonlySet<string>;
}): string | undefined {
  const target = entries.find((entry) => entry.artifactId === artifactId);
  if (target === undefined) {
    return `no pass with artifact id ${artifactId} ran on this branch in this checkout`;
  }
  if (alreadyRetired.has(artifactId)) {
    return `${artifactId} is already superseded — one row retires it once, and the row is permanent`;
  }
  if (target.mode !== "review") {
    return `${artifactId} is a ${target.mode} pass; only a REVIEW pass reviews a property wording`;
  }
  if (target.propertyId === undefined) {
    return `${artifactId} names no property id, so there is no wording to retire`;
  }
  if (target.freshness.kind !== "current") {
    return (
      `${artifactId} is ${target.freshness.kind.toUpperCase()}, not current, so it already counts for nothing — ` +
      "retiring it would record a decision that changes nothing"
    );
  }
  const replacement = replacementFor({ entries, target });
  if (replacement === undefined) {
    return (
      `no CURRENT, conclusive pass under ${target.propertyId} stands beside ${artifactId} — a retirement ` +
      "with nothing in its place is a dismissal, and this verb does not do that. Re-run the property with " +
      "the wording you can actually satisfy first, then retire the one it replaced"
    );
  }
  return undefined;
}

/**
 * The current, conclusive pass under the same property id that would replace this one.
 *
 * A replacement must be LIVE: current, conclusive, under the same property id, and not itself retired. The
 * caller must therefore pass a ledger built WITH the register, or every entry reads unretired and the cycle
 * above reopens.
 *
 * @param entries the branch ledger, newest first, with retirements already applied
 * @param target the pass being retired
 * @returns the replacing entry, or `undefined` when none stands
 */
export function replacementFor({
  entries,
  target,
}: {
  entries: readonly LedgerEntry[];
  target: LedgerEntry;
}): LedgerEntry | undefined {
  return entries.find(
    (entry) =>
      entry.artifactId !== target.artifactId &&
      entry.propertyId === target.propertyId &&
      entry.mode === "review" &&
      entry.freshness.kind === "current" &&
      // An already-RETIRED pass is not a replacement. Without this, two current BROKEN passes under one
      // property retire EACH OTHER — B replaces A, then the already-retired A replaces B — and the property
      // ends up with no live pass at all while both findings stop counting. That is precisely the escape
      // this verb was built to make unavailable. Found by a Codex review, which executed the guard to
      // confirm both refusals returned undefined.
      entry.superseded === undefined &&
      (entry.verdict === "CLEAN" || entry.verdict === "BROKEN"),
  );
}

/**
 * Why this no-tree record may not be retired, or `undefined` when it may.
 *
 * @param unplaceable the checkout's records that captured no tree, retired ones included
 * @param entries the branch ledger, newest first, with retirements already applied
 * @param artifactId the record a caller wants to retire
 * @param alreadyRetired the artifact ids already carrying a row
 * @returns the refusal body, or `undefined` when the retirement is allowed
 */
export function unplaceableSupersedeRefusal({
  unplaceable,
  entries,
  artifactId,
  alreadyRetired,
}: {
  unplaceable: readonly UnplaceableRecord[];
  entries: readonly LedgerEntry[];
  artifactId: string;
  alreadyRetired: ReadonlySet<string>;
}): string | undefined {
  const target = unplaceable.find((record) => record.artifactId === artifactId);
  if (target === undefined) {
    return `${artifactId} is not a pass in this checkout that recorded no tree`;
  }
  if (alreadyRetired.has(artifactId) && target.superseded !== undefined) {
    return `${artifactId} is already superseded — one row retires it once, and the row is permanent`;
  }
  if (alreadyRetired.has(artifactId)) {
    return (
      `${artifactId} already carries a retirement row that does not retire it on this branch — a no-tree row ` +
      "holds only for the branch its replacement stood on, and one row per record is the limit, so it keeps " +
      "counting here"
    );
  }
  if (unplaceableReplacementFor({ entries, target }) === undefined) {
    return (
      `no later, conclusive ${target.mode} pass with tree provenance stands on this branch beside ${artifactId} ` +
      `(recorded ${target.createdAtIso}) — it could be the newest word, so retiring it would be a dismissal. ` +
      `Run the ${target.mode} again${target.propertyId === undefined ? "" : ` under ${target.propertyId}`} so ` +
      "it captures a tree, then retire this one"
    );
  }
  return undefined;
}

/**
 * The later pass that makes a no-tree record's verdict no longer the latest word, or `undefined`.
 *
 * STRICTLY later, because a no-tree record newer than every placed pass could be the newest BLOCKED plan, and a
 * record sharing the instant is unordered — `planFailures` refuses on a same-instant BLOCKED for the same
 * reason. The replacement must carry provenance (never `unknown`), must be conclusive and must be live. A plan
 * replacement may be stale, since the plan floor WANTS stale; a review replacement must be current and under the
 * same property id, the shape {@link replacementFor} asks of a wording.
 *
 * @param entries the branch ledger, newest first, with retirements already applied
 * @param target the no-tree record being retired
 * @returns the replacing entry, or `undefined` when none stands
 */
export function unplaceableReplacementFor({
  entries,
  target,
}: {
  entries: readonly LedgerEntry[];
  target: UnplaceableRecord;
}): LedgerEntry | undefined {
  return entries.find(
    (entry) =>
      entry.mode === target.mode &&
      entry.createdAtIso > target.createdAtIso &&
      entry.freshness.kind !== "unknown" &&
      entry.superseded === undefined &&
      conclusiveFor({ entry, target }),
  );
}

/**
 * Whether a candidate replacement reached a verdict its arm can give, and — for a review — stands on the same
 * property and still describes the tree.
 *
 * @param entry the candidate replacement
 * @param target the no-tree record being retired
 * @returns true when the candidate can stand in the target's place
 */
function conclusiveFor({ entry, target }: { entry: LedgerEntry; target: UnplaceableRecord }): boolean {
  if (target.mode === "plan") {
    return entry.verdict === "READY" || entry.verdict === "BLOCKED";
  }
  return (
    entry.propertyId === target.propertyId &&
    entry.freshness.kind === "current" &&
    (entry.verdict === "CLEAN" || entry.verdict === "BROKEN")
  );
}
