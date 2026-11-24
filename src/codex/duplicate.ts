/**
 * Refusing a pass that has already been run, with the same question, over the same bytes — the EXACT-key
 * half of the Codex spend work.
 *
 * ## The measurement, and why the key is exact rather than clever
 *
 * A duplicate pass is worth refusing: a measurable share of all Codex input was the same pass asked twice,
 * not a nearly-same
 * one, so the key here is EXACT and the refusal is a lookup rather than a judgement. A fuzzy key — "similar
 * diff", "same area" — would start refusing passes that had never run, which is the failure that makes a
 * gate get routed around. There is no similarity anywhere in this module.
 *
 * ## The two keys, and what each deliberately leaves OUT
 *
 * A **plan** is keyed on branch + pass + `headSha`. Not on the prompt hash, not on the task text, not on the
 * dirty-tree fingerprint. So re-running `p2` on the same branch and commit with a DIFFERENT question is a
 * duplicate and is refused. That is the requested rule and it is a real trade rather than an oversight:
 * {@link duplicatePassRefusal} names it, and the hatch's exception list leads with exactly that case.
 *
 * A **review** is keyed on `diffSha256` + `propertyId` + pass. Not on `headSha`, not on the branch, not on
 * the base ref, not on the property's prose. A byte-identical diff asked the same property is the same
 * question however the commit was spelled, so a rebase that changes every SHA and no bytes is still a
 * duplicate — which is the common duplicate class the measurement found.
 *
 * **The landing floor agrees, and must.** `./ledger.ts`'s `freshnessOf` carries a review across a rebase as
 * CURRENT when the diff the tree now produces against the record's base ref — or, at landing, against the
 * pull request's current base, which is what carries a review pinned to an older base commit — hashes to this
 * same `diffSha256`. Before it did, the floor keyed the review on the TREE: after a conflict-free rebase it called
 * every review STALE while this gate refused the re-run, and only the hatch got a branch out.
 * Two gates asking one question must key it the same way.
 *
 * ## Scope: one checkout
 *
 * Records are filtered by `repoRoot` before the key is applied, the same attribution `./ledger.ts` uses, and
 * for the same reason: a worktree has its own root and that is the grain the rest of this repository works
 * at. The plan key ALSO carries the branch; the review key does not, deliberately — a diff is the same bytes
 * whatever branch it was taken on.
 *
 * Pure. The scan and the refusal live in `./passAdmission.ts`.
 */
import { absentAsNull } from "#lib/absent.js";
import type { CodexArtifactRecord, CodexPassScope, PlanPassId, ReviewPassId } from "./types.js";

/** The exact identity of a pass — a structure, never a delimiter-joined string that two values could collide in. */
export type ExactPassKey =
  | { readonly mode: "plan"; readonly pass: PlanPassId; readonly branch: string; readonly headSha: string }
  | {
      readonly mode: "review";
      readonly pass: ReviewPassId;
      readonly propertyId: string;
      readonly diffSha256: string;
    };

/**
 * The key a planning pass sits under, or undefined when it cannot be keyed at all.
 *
 * A plan needs the tree's branch and head, so a plan on a DETACHED HEAD (`branch === null`) or with no
 * captured tree has no key — and no key means no refusal. That is the right direction to fail: this module
 * can only ever say "this exact thing already ran", so an absence of provenance has to read as "cannot say",
 * never as "it did".
 *
 * Takes the three facts it needs rather than a whole `CodexPassScope`, so a caller keying a pass BEFORE it
 * runs does not have to fabricate a prompt hash it has not computed yet.
 *
 * @param branch the branch the pass is running on, or null on a detached HEAD
 * @param headSha `HEAD` at pass start
 * @param pass which planning pass
 * @returns the key, or undefined when this pass cannot be keyed
 */
export function planPassKey({
  branch,
  headSha,
  pass,
}: {
  branch: string | null;
  headSha: string | undefined;
  pass: PlanPassId;
}): ExactPassKey | undefined {
  if (branch === null || headSha === undefined) {
    return undefined;
  }
  return { branch, headSha, mode: "plan", pass };
}

/**
 * The key a review pass sits under. Always keyable — a diff and a property are both in hand before the pass
 * starts, and neither depends on provenance the capture might have failed to take.
 *
 * @param diffSha256 the diff's content hash, byte-identical across every property of one fan-out
 * @param propertyId the single falsifiable claim's id
 * @param pass which review pass
 * @returns the key
 */
export function reviewPassKey({
  diffSha256,
  pass,
  propertyId,
}: {
  diffSha256: string;
  pass: ReviewPassId;
  propertyId: string;
}): ExactPassKey {
  return { diffSha256, mode: "review", pass, propertyId };
}

/**
 * The key a RECORDED pass sits under, or undefined when the record cannot be keyed.
 *
 * @param record the pass record, as read from disk
 * @returns the key, or undefined for a plan record with no usable branch or head
 */
export function recordPassKey({ record }: { record: CodexArtifactRecord }): ExactPassKey | undefined {
  const scope: CodexPassScope = record.scope;
  if (scope.mode === "review") {
    return reviewPassKey({ diffSha256: scope.diffSha256, pass: scope.pass, propertyId: scope.property.id });
  }
  return planPassKey({
    branch: absentAsNull({ value: record.tree?.branch }),
    headSha: record.tree?.headSha,
    pass: scope.pass,
  });
}

/**
 * Whether two keys are the same pass. Field-by-field, so no two different keys can be joined into one
 * string — two distinct pairs can produce the same delimiter-joined text, and this gate must never fire on
 * a collision.
 *
 * @param left one key
 * @param right the other
 * @returns true only when both keys name the same mode and every field of that mode agrees
 */
export function sameExactPass({ left, right }: { left: ExactPassKey; right: ExactPassKey }): boolean {
  if (left.mode === "plan") {
    return (
      right.mode === "plan" &&
      left.pass === right.pass &&
      left.branch === right.branch &&
      left.headSha === right.headSha
    );
  }
  return (
    right.mode === "review" &&
    left.pass === right.pass &&
    left.propertyId === right.propertyId &&
    left.diffSha256 === right.diffSha256
  );
}

/**
 * Whether a record reached a verdict a re-run would only reproduce.
 *
 * Stricter than `./ledger.ts`'s `concluded`, and deliberately not reusing it: that one tests a rendered
 * verdict STRING for a `NO_VERDICT`/`FATAL` prefix, which is the right test for a ledger row and the wrong
 * one for a spend gate. Here the record's own `outcome` is read, and its answer has to match its scope —
 * a record whose scope says `review` carrying a plan's `READY` concluded nothing about any diff, and
 * refusing a real review on the strength of it would be the worst possible failure of this gate.
 *
 * @param record the pass record, as read from disk
 * @returns true only when this pass answered the question its own scope asked
 */
export function conclusivePass({ record }: { record: CodexArtifactRecord }): boolean {
  if (record.outcome.kind !== "answered") {
    return false;
  }
  const verdict = record.outcome.answer.verdict;
  if (record.scope.mode === "plan") {
    return verdict === "READY" || verdict === "BLOCKED";
  }
  return (verdict === "CLEAN" || verdict === "BROKEN") && record.outcome.answer.propertyId === record.scope.property.id;
}

/**
 * The already-conclusive record for this exact pass, or undefined when none exists.
 *
 * @param key the pass about to run
 * @param records every pass record in THIS checkout (filter by `repoRoot` first)
 * @returns the newest matching conclusive record, or undefined
 */
export function findExactDuplicate({
  key,
  records,
}: {
  key: ExactPassKey;
  records: readonly CodexArtifactRecord[];
}): CodexArtifactRecord | undefined {
  const matches = records.filter((record) => {
    if (!conclusivePass({ record })) {
      return false;
    }
    const recorded = recordPassKey({ record });
    return recorded !== undefined && sameExactPass({ left: key, right: recorded });
  });
  return matches.toSorted(
    (a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || b.artifactId.localeCompare(a.artifactId),
  )[0];
}

/**
 * The lines describing WHY this pass is a duplicate, for the refusal body.
 *
 * Names the trade the plan key makes, because a caller whose question changed has to be told that the key
 * did not notice — silently refusing a genuinely new planning question is the one way this gate becomes a
 * thing people work around instead of a thing they use.
 *
 * @param duplicate the record already on file
 * @param key the pass that was about to run
 * @returns the detail lines
 */
export function duplicatePassDetail({
  duplicate,
  key,
}: {
  duplicate: CodexArtifactRecord;
  key: ExactPassKey;
}): readonly string[] {
  const verdict = duplicate.outcome.kind === "answered" ? duplicate.outcome.answer.verdict : "unknown";
  const identity =
    key.mode === "plan"
      ? `${key.pass} on branch ${key.branch} at HEAD ${key.headSha}`
      : `${key.pass} on property ${key.propertyId} over diff ${key.diffSha256}`;
  const trade =
    key.mode === "plan"
      ? "The plan key is branch + pass + HEAD and does NOT include the question asked, so a DIFFERENT planning question at the same commit reads as a duplicate too."
      : "The review key is diff + property + pass and does NOT include the commit, so a rebase that changed every SHA and no bytes is still the same question.";
  return [
    `${identity} already has a conclusive record: ${duplicate.artifactId} (${verdict}, ${duplicate.createdAtIso}).`,
    trade,
  ];
}
