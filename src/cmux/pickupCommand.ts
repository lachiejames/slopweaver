/**
 * The ONE pickup line a spawned session is sent — composed from the doc's path, its slug and its run state,
 * and NEVER from the doc's own text.
 *
 * ## Why the doc body is not an input any more
 *
 * This module used to read the doc for its own stated pickup command: the first heading that mentioned
 * "pickup" or "launching a fresh …", and the first line of the first fenced block under it. Measured:
 * `session respawn loop --successor <a loop doc>` booted a successor in the right
 * worktree at the right HEAD, and the line it sent was
 *
 *     <channel>  dispatch-unwitnessed 05:04:29.565Z  ->  dispatch-witnessed 05:15:40.801Z  ->  answered
 *
 * — a ROW of a witness TABLE, lifted out of the doc's findings section
 * `## ★★ THE PICKUP WITNESS IS 0-FOR-3 IN-BAND …`, because that heading contained the word "pickup" and its
 * first fence was a table. The successor spent its whole first turn analysing that row, parked on "Want me
 * to file either?", and never armed a listener; every worktree/branch/directory gate downstream read green,
 * because none of them asks what the session was TOLD. A doc dense with fenced command-shaped lines — which
 * every loop-chain doc is — was one heading away from this the whole time.
 *
 * The fix is not a tighter heading regex. A handover doc is prose for the session to READ; letting it also
 * be the source of the instruction that tells the session to read it makes every code block in it reachable
 * by the spawner. So the pickup is the lifecycle template below, always: it names the doc's path, tells the
 * session to read it end to end, names the ONE lifecycle verb that matches the run's current phase, and
 * carries the two standing instructions every spawned session gets. What a doc says under "Pick up in a
 * fresh chat" is still true — the session reads it — it just does not get typed at the session.
 *
 * ## Why the same line serves both drivers
 *
 * `/slopweaver:pickup` and `/slopweaver:orchestrate` are Claude Code slash commands — resolved by a plugin
 * skill this checkout registers with Claude Code, never by a shell. A standalone `codex` CLI session has no
 * such registration, so sending it a `/`-prefixed line lands as a bare unrecognised chat message. The
 * template is plain prose naming a `slopweaver` verb, which both drivers act on unchanged; that is why there
 * is no per-driver branch left in this module.
 */

import { type RunEvent, type RunPhase, runStateOf } from "../handover/ledger.js";
import type { HarnessLaunchOperation } from "../sessionHarness/errors.js";
import { pickupLine } from "../transcripts/spawnPickupLine.js";

export { WAIT_RULE_INSTRUCTION } from "../transcripts/spawnPickupLine.js";

/** Which real, interactive CLI a spawned session boots. */
export type CmuxDriver = "claude" | "codex";

/**
 * The exact line to send to a freshly booted session: the lifecycle template, and nothing read from the doc.
 *
 * @param docPath the doc's absolute path, named explicitly so a freshly booted session is told to READ it
 *   rather than left to infer that from a bare CLI command
 * @param slug the doc's slug, for the lifecycle verb
 * @param runPhase whether the handover currently has a resumable run, which decides `start` versus `resume`
 * @returns the exact line to send
 */
export function resolvePickupCommand({
  docPath,
  slug,
  runPhase,
}: {
  docPath: string;
  slug: string;
  runPhase: RunPhase;
}): string {
  return handoverLifecycleCommand({ docPath, runPhase, slug });
}

/**
 * Resolve a handover pickup command from the journal events themselves, keeping lifecycle folding out of the
 * effectful caller that read them.
 *
 * @param docPath the doc's absolute path, named explicitly in the lifecycle instruction
 * @param slug the doc's slug, for the lifecycle verb
 * @param runEvents the already-read journal events whose latest cycle decides start versus resume
 * @returns the exact line to send to the freshly booted session
 */
export function resolveSpawnPickupCommand({
  docPath,
  slug,
  runEvents,
}: {
  docPath: string;
  slug: string;
  runEvents: readonly RunEvent[];
}): string {
  return resolvePickupCommand({ docPath, runPhase: runStateOf({ events: runEvents }).phase, slug });
}

/**
 * The lifecycle verb that matches whether this doc currently has a resumable run, in the one line
 * `../transcripts/spawnPickupLine.ts` composes — there, beside the reader that keeps it from being read back as
 * the owner's own turn.
 */
function handoverLifecycleCommand({
  docPath,
  runPhase,
  slug,
}: {
  docPath: string;
  runPhase: RunPhase;
  slug: string;
}): string {
  return pickupLine({ docPath, slug, verb: launchOperationForPhase({ runPhase }) === "open" ? "start" : "resume" });
}

/**
 * Which launch act a spawn for this run phase is — the session harness's `open` for a doc with no resumable run,
 * `resume` for one that has — decided by the same phase that picks the pickup line's `start` versus `resume`, so
 * the ledger row and the line the session is sent can never disagree.
 *
 * @param runPhase the run's current phase
 * @returns the launch act
 */
export function launchOperationForPhase({ runPhase }: { runPhase: RunPhase }): HarnessLaunchOperation {
  if (runPhase === "closed") {
    return "open";
  }
  return "resume";
}

/**
 * {@link launchOperationForPhase} over the journal events themselves.
 *
 * @param runEvents the doc's run journal
 * @returns the launch act
 */
export function launchOperationForRun({ runEvents }: { runEvents: readonly RunEvent[] }): HarnessLaunchOperation {
  return launchOperationForPhase({ runPhase: runStateOf({ events: runEvents }).phase });
}
