/**
 * `session respawn loop --confirm` — phase two of the loop's respawn, split out of `./respawn.ts` along the seam
 * the two phases already have: phase one boots and writes the pending record, this reads it back against the
 * live listener and is the only thing that publishes `respawned`. `./respawn.ts`'s header carries why the respawn
 * is two phases at all.
 *
 * Exiting 0 on any record already carrying a confirmed arm, whatever was live, would let a successor whose own arm
 * never went live read as respawned off an earlier seat's confirmation. A confirmation answers 0 only while its arm is the live one, and every exit 0 re-reads the
 * record first, because a phase one can replace it while this read runs. No lock joins the two verbs,
 * so the answer is exact as of that re-read and a later re-arm or boot is a later answer. The residue, stated:
 * a phase one landing between the final re-read and the stamp, with no subprocess between the two,
 * is overwritten by this boot's stamp, and that later boot's `--confirm` then reads a stale arm and exits 3.
 */
import { realpathSync } from "node:fs";

import { publishSupervisorEvent } from "../../../events/store.js";
import { logger } from "../../../lib/logger.js";
import { currentLiveness } from "../../../live/listen/supervise/currentLiveness.js";
import type { ListenerLiveness } from "../../../live/listen/supervise/liveness.js";
import { productionStandingInspectDeps, standingTreeTargets } from "../../../live/standing/inspect.js";
import { confirmedRecordVerdict, successorArmVerdict } from "../../../live/standing/respawn.js";
import {
  type PendingLoopRespawn,
  readPendingLoopRespawn,
  writePendingLoopRespawn,
} from "../../../live/standing/respawnStore.js";
import { standingRespawnedEvent } from "../../../live/standing/streamEvents.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { confirmedAtWords, supersededBootWords } from "./respawnWords.js";
import { LOOP_SESSION, reportProblems } from "./standingFreshness.js";

/** Every line this phase prints opens with it. */
const PREFIX = "session respawn --confirm";

/**
 * A path as the filesystem resolves it, so a worktree reached through a symlinked parent (`.claude/worktrees`
 * → `.claude/worktrees.noindex`) and the same tree spelled directly compare equal. Falls back to the spelling
 * when the path does not resolve, which the comparison then reports as a mismatch rather than a guess.
 *
 * @param path the path to resolve
 * @returns the real path, or the spelling when it cannot be resolved
 */
function realPathOrSpelled({ path }: { readonly path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The checkout the live arm's process runs from, resolved like the successor's tree so the two compare.
 *
 * @param liveness what `listen status` read
 * @returns the arm's real tree, or `undefined` when no pid or no checkout could be read
 */
function liveArmTree({ liveness }: { readonly liveness: ListenerLiveness }): string | undefined {
  const pid = "pid" in liveness ? liveness.pid : undefined;
  const bin = standingTreeTargets({
    fallbackBin: undefined,
    pid,
    processes: productionStandingInspectDeps().processes(),
  }).find((target) => target.role === "bin")?.path;
  return bin === undefined ? undefined : realPathOrSpelled({ path: bin });
}

/**
 * Re-read the pending record and say so when another boot replaced the one this `--confirm` judged.
 *
 * @param home the resolved state home
 * @param record the record this invocation read first and judged
 * @param judgedArmId the arm this invocation judged live and up
 * @returns `true` when the record on disk is no longer that boot's on that arm, having printed why
 */
function bootSuperseded({
  home,
  record,
  judgedArmId,
}: {
  readonly home: string;
  readonly record: PendingLoopRespawn;
  readonly judgedArmId: string;
}): boolean {
  const reread = readPendingLoopRespawn({ home });
  const now = reread.isOk() ? reread.value : undefined;
  const why = supersededBootWords({ before: record, judgedArmId, now, unreadable: reread.isErr() });
  if (why === undefined) {
    return false;
  }
  logger.out({ line: `${PREFIX}: ${why}` });
  return true;
}

/**
 * The answer for a record ALREADY confirmed: 0 only while the arm it confirmed is the one live now, up, and the
 * record is still that boot's.
 *
 * @param home the resolved state home
 * @param liveness what `listen status` read
 * @param record the pending record, carrying `confirmedArmId`
 * @param confirmedArmId the arm the record confirmed
 * @returns the exit code
 */
function answerConfirmedRecord({
  home,
  liveness,
  record,
  confirmedArmId,
}: {
  readonly home: string;
  readonly liveness: ListenerLiveness;
  readonly record: PendingLoopRespawn;
  readonly confirmedArmId: string;
}): number {
  const standing = confirmedRecordVerdict({
    liveness,
    record: { confirmedArmId, confirmedAt: confirmedAtWords({ record }), successor: record.successor },
    trees: { arm: liveArmTree({ liveness }), successor: realPathOrSpelled({ path: record.successorTree }) },
  });
  if (standing.kind === "stale") {
    logger.out({ line: `${PREFIX}: ${standing.why}` });
    return EXIT_EXPECTED_EMPTY;
  }
  if (bootSuperseded({ home, judgedArmId: confirmedArmId, record })) {
    return EXIT_EXPECTED_EMPTY;
  }
  logger.out({ line: `${PREFIX}: ${standing.why}` });
  return EXIT_OK;
}

/**
 * Stamp the confirmation onto the record, then publish `respawned` for the confirmed arm — the stamp IS the
 * supersede, and a later boot replaces the record whole. The stamp goes FIRST so it lands straight after the
 * caller's re-read: publishing shells `git rev-parse`, and a stamp written after that subprocess would widen the
 * window in which a later boot's record could be overwritten with this one. A stamp that fails
 * publishes nothing and exits {@link EXIT_ERROR}: an unstamped record is not a confirmation.
 *
 * @param home the resolved state home
 * @param nowMs the current instant, epoch milliseconds
 * @param record the pending record this confirmation is for
 * @param successorTree the successor's tree, already resolved to a real path
 * @param confirmed the arm and pid the verdict confirmed
 * @returns the exit code; a failed publish after a landed stamp is reported, never turned into a refusal
 */
function publishConfirmation({
  home,
  nowMs,
  record,
  successorTree,
  confirmed,
}: {
  readonly home: string;
  readonly nowMs: number;
  readonly record: PendingLoopRespawn;
  readonly successorTree: string;
  readonly confirmed: { readonly armId: string; readonly pid: number; readonly why: string };
}): number {
  const atIso = new Date(nowMs).toISOString();
  const written = writePendingLoopRespawn({
    home,
    pending: { ...record, confirmedArmId: confirmed.armId, confirmedAtIso: atIso },
  });
  if (written.isErr()) {
    logger.error({ msg: `${PREFIX}: ${written.error.join("; ")} — the confirmation was not recorded. Not respawned.` });
    return EXIT_ERROR;
  }
  const failure = publishSupervisorEvent({
    event: standingRespawnedEvent({
      atIso,
      detail: `${record.successor} confirmed its own listener: arm ${confirmed.armId} (pid ${String(confirmed.pid)}) live from ${successorTree}`,
      head: productionStandingInspectDeps().git({ args: ["rev-parse", "--short", "HEAD"], cwd: successorTree }),
      session: LOOP_SESSION,
    }),
    home,
  });
  if (failure !== undefined) {
    logger.error({ msg: `${PREFIX}: ${failure}` });
  }
  logger.out({ line: `${PREFIX}: ${confirmed.why}` });
  return EXIT_OK;
}

/**
 * Phase two: confirm that the live listener is the SUCCESSOR's own arm, and only then publish `respawned`.
 *
 * Idempotent while it is TRUE: a record already confirmed exits 0 again only while the arm it confirmed is the
 * one live now and is not down (`live/standing/respawn.ts`'s `confirmedRecordVerdict`), so a gate can call this
 * as often as it likes and never reads an earlier successor's confirmation as this one's. Every refusal exits
 * {@link EXIT_EXPECTED_EMPTY} — a diagnostic that found the answer "not yet", which is what a script polling for
 * the handover should read.
 *
 * @param home the resolved state home
 * @param nowMs the current instant, epoch milliseconds
 * @returns the exit code
 */
export function confirmLoopRespawn({ home, nowMs }: { readonly home: string; readonly nowMs: number }): number {
  const pending = readPendingLoopRespawn({ home });
  if (pending.isErr()) {
    logger.error({ msg: `${PREFIX}: ${pending.error.join("; ")}` });
    return EXIT_ERROR;
  }
  if (pending.value === undefined) {
    logger.out({ line: `${PREFIX}: no loop respawn is pending — nothing was booted that awaits confirmation` });
    return EXIT_EXPECTED_EMPTY;
  }
  const record = pending.value;
  const { liveness, problems } = currentLiveness({ home, nowMs });
  reportProblems({ prefix: PREFIX, problems });
  if (record.confirmedArmId !== undefined) {
    return answerConfirmedRecord({ confirmedArmId: record.confirmedArmId, home, liveness, record });
  }
  const successorTree = realPathOrSpelled({ path: record.successorTree });
  const verdict = successorArmVerdict({
    armTree: liveArmTree({ liveness }),
    liveness,
    pending: { predecessorArmId: record.predecessorArmId, successor: record.successor },
    successorTree,
  });
  if (verdict.kind !== "confirmed") {
    logger.out({ line: `${PREFIX}: ${verdict.why}` });
    return EXIT_EXPECTED_EMPTY;
  }
  // Re-read before publishing or stamping: a boot that replaced the record while this read ran must not be
  // overwritten with THIS record's confirmation, nor have one published in its name.
  if (bootSuperseded({ home, judgedArmId: verdict.armId, record })) {
    return EXIT_EXPECTED_EMPTY;
  }
  return publishConfirmation({ confirmed: verdict, home, nowMs, record, successorTree });
}
