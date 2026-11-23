/**
 * What `session respawn loop` resolves the successor's tree with, and what it prints for each value a record
 * may lack — split out of `respawn.ts` so each absence is a function that RETURNS its word rather than an
 * operator standing in for one.
 *
 * Every word here is absence BY DESIGN: a journal written before a field existed, an arm that was never live,
 * a confirmation stamped by an older writer. None of them means something went wrong, so none is refused.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { conventionalWorktreePath } from "../../../cmux/plan.js";
import { findWorktreeAtPath, findWorktreeForBranch, type WorktreeInfo } from "../../../cmux/worktreeList.js";
import type { RunWriter } from "../../../handover/runOwner.js";
import type { PendingLoopRespawn } from "../../../live/standing/respawnStore.js";
import type { SessionEvent } from "../../../sessions/session.js";

/**
 * The worktree a successor would REUSE, judged before the boot by two of the keys `cmux/plan.ts` resolves a
 * spawn's worktree with, in its order: the branch the slug names, then whatever is registered at the
 * conventional path whatever branch it holds. `cmux/worktree.ts`'s own header carries the collision that made the
 * second key necessary.
 *
 * It is NARROWER than the spawn: `cmux/plan.ts` reaches a doc's declared branch and a parked checkpoint first,
 * and this sees neither. So it serves only the pre-boot reused-tree gate, and never names the tree a boot landed
 * in — {@link spawnedSuccessorTree} does that, off the spawn's own row (audit L6-1).
 *
 * @param repoRoot the checkout whose conventional worktree path is the second key
 * @param successor the successor doc's slug, which is also its branch and directory name
 * @param worktrees every worktree git lists
 * @returns the matching worktree, or `undefined` when neither key finds one
 */
export function successorWorktree({
  repoRoot,
  successor,
  worktrees,
}: {
  repoRoot: string;
  successor: string;
  worktrees: readonly WorktreeInfo[];
}): WorktreeInfo | undefined {
  const byBranch = findWorktreeForBranch({ candidates: [successor], worktrees });
  if (byBranch !== undefined) {
    return byBranch;
  }
  return findWorktreeAtPath({ path: conventionalWorktreePath({ repoRoot, slug: successor }), worktrees });
}

/**
 * The tree THIS boot of a successor landed in, read off the `spawned` row `cmux spawn` appended to the session
 * ledger for it — the spawn's own record of where it went, rather than a second guess at the keys it used.
 *
 * Resolving the tree with {@link successorWorktree}, by slug alone, would miss the case below: phase one resolved the tree with {@link successorWorktree}, by slug alone, while
 * `cmux/plan.ts` reaches the doc's DECLARED branch first. A loop doc that declares the predecessor's branch
 * booted into a tree no slug key finds, phase one recorded nothing, and the previous successor's confirmed record
 * was left standing for `--confirm` to read. A row older than this respawn's own start belongs to an earlier boot
 * of the same slug and is not evidence about this one.
 *
 * @param events the session ledger, in file order
 * @param successor the successor doc's slug
 * @param sinceMs when this respawn started, epoch milliseconds; an earlier row is another boot's
 * @returns the latest qualifying row's working directory, or `undefined` when this boot recorded none
 */
export function spawnedSuccessorTree({
  events,
  successor,
  sinceMs,
}: {
  events: readonly SessionEvent[];
  successor: string;
  sinceMs: number;
}): string | undefined {
  const rows = events.filter(
    (event): event is Extract<SessionEvent, { kind: "spawned" }> =>
      event.kind === "spawned" && event.slug === successor && Date.parse(event.tsIso) >= sinceMs,
  );
  return rows.at(-1)?.cwd;
}

/**
 * Whether the pending record on disk is still the boot a `--confirm` read and judged — pure.
 *
 * A phase one can replace the record between `--confirm`'s first read and its
 * answer, and without a second look an earlier boot's confirmation answered 0 while the record named a new boot.
 * A boot is every field it was written with: its `bootId`, instant, predecessor arm, slug and tree. The id is there
 * because two boots can share the rest, and two records written before the id existed compare on
 * every other field, so a "same" boot is an identical record and stamping it overwrites nothing. A confirmation
 * stamped on the SAME boot meanwhile is not a replacement when it names the arm this invocation judged; one naming
 * ANOTHER arm is.
 *
 * @param before the record `--confirm` read first
 * @param now the record on disk at the re-read, `undefined` when none stands
 * @param unreadable whether the re-read failed, which is not evidence the boot still stands
 * @param judgedArmId the arm this invocation judged live and up, the only one the record may be confirmed on
 * @returns the sentence saying what replaced it, or `undefined` when it is the same boot on the same arm
 */
export function supersededBootWords({
  before,
  now,
  unreadable,
  judgedArmId,
}: {
  before: PendingLoopRespawn;
  now: PendingLoopRespawn | undefined;
  unreadable: boolean;
  judgedArmId: string;
}): string | undefined {
  const judged = `the respawn to ${before.successor} booted ${before.bootedAtIso}`;
  if (unreadable) {
    return `the pending record could not be re-read after judging ${judged}, so it is not confirmed. Not respawned.`;
  }
  if (now === undefined) {
    return `${judged} was removed while this read ran — a later boot replaced it. Not respawned.`;
  }
  const same =
    now.bootedAtIso === before.bootedAtIso &&
    now.bootId === before.bootId &&
    now.predecessorArmId === before.predecessorArmId &&
    now.successor === before.successor &&
    now.successorTree === before.successorTree;
  if (!same) {
    return (
      `${judged} was replaced while this read ran by a respawn to ${now.successor} booted ${now.bootedAtIso}; ` +
      "that boot confirms its own arm. Not respawned."
    );
  }
  if (now.confirmedArmId !== undefined && now.confirmedArmId !== judgedArmId) {
    return (
      `${judged} was confirmed on arm ${now.confirmedArmId} by another \`--confirm\` while this one judged arm ` +
      `${judgedArmId}, so this answer is stale. Not respawned.`
    );
  }
  return undefined;
}

/**
 * Where a run's live holder works, for the gate-3 refusal.
 *
 * @param writer the session holding the run
 * @returns its worktree, or a phrase saying the journal recorded none
 */
export function holderWorktreeWords({ writer }: { writer: RunWriter }): string {
  const worktree = writer.worktree;
  if (worktree === undefined) {
    return "an unrecorded worktree";
  }
  return worktree;
}

/**
 * The arm a successor's must differ from, as phase one's closing line names it.
 *
 * @param predecessorArmId the arm live when the gates were measured, or `undefined` when none was
 * @returns that arm's id, or a phrase naming whichever arm stands when the successor confirms
 */
export function predecessorArmWords({ predecessorArmId }: { predecessorArmId: string | undefined }): string {
  if (predecessorArmId === undefined) {
    return "the one standing now";
  }
  return predecessorArmId;
}

/**
 * When an already-confirmed respawn was confirmed, for `--confirm`'s idempotent re-read.
 *
 * @param record the pending record, already carrying a confirmed arm
 * @returns the confirmation instant, or a phrase saying the record carries none
 */
export function confirmedAtWords({ record }: { record: PendingLoopRespawn }): string {
  const confirmedAtIso = unsetFieldAsNull({ key: "confirmedAtIso", record });
  if (confirmedAtIso === null) {
    return "an unrecorded instant";
  }
  return confirmedAtIso;
}
