/**
 * The per-source refresh slot — one refresh of a source at a time on this machine, so two callers wanting
 * the same afternoon start one backfill rather than two racing on one resume cursor.
 *
 * ## It is the load slot, not a second lock
 *
 * Everything here is `../lib/loadSlots.ts`'s mechanism with a different directory and a limit of one. That
 * is deliberate and it is the whole design: that lock is pid-owned, liveness-probed, has no release path to
 * forget to call, and its refusal names the holder — so a `SIGKILL`ed refresh frees its own slot, and
 * so does a holder whose pid the OS has since handed to another process: liveness is the pid AND its process's
 * start stamp (`../lib/loadSlots.ts` `slotHolderLive`). A second lock written here would have to re-derive all four properties, and a lock
 * that gets one of them wrong is worse than no lock, because it fails closed forever.
 *
 * What differs is the resource being rationed. A load slot rations this machine's MEMORY, so its limit is
 * derived from host RAM and several may be held at once. A refresh slot rations one SOURCE's fetch: two
 * concurrent refreshes of `slack` race on one resume cursor and one provider rate limit, and the loser is
 * decided by whichever finishes last. So the limit is one, per source, and it is not derived from anything.
 *
 * ## EVERY refresh takes it, not only the just-in-time one
 *
 * It was scoped to `--jit` when it shipped, on the reasoning that an operator running a backfill by hand
 * while a turn waits is a situation for the operator to judge rather than for a lock to refuse. **The rule is the other way**: a lock
 * is needed for corpus refresh IN GENERAL, regardless of whether it is just-in-time or not, because two
 * refreshes happening at once produce undefined behaviour. So a hand-run `refresh`, the scheduled `--if-stale`
 * tick and a `--jit` wait all take it, and the operator-judgement argument above is recorded as what it
 * was: a reasonable call the owner overruled, not a property of the mechanism.
 *
 * `--jit` still names a real difference, and it is the only one left: the REMEDY. A turn that waited should
 * re-ask once the holder finishes, because the holder's run is the refresh it wanted; an operator should
 * wait and run their own command again. {@link refreshSlotRefusalLines} takes `jit` for exactly that.
 *
 * **A held source is DROPPED, never a refusal of the whole run** — a run over slack and linear, where
 * another process holds slack, should still refresh linear. But a run whose sources were ALL dropped
 * fetched nothing, so the verb exits non-zero rather than reporting a success it did not have — `EXIT_DEFERRED`,
 * because the same run is correct once the holder finishes, so a scheduled resync gives its slot back.
 *
 * ## Compaction takes it too
 *
 * `slopweaver compact` rewrites a source's window files into one canonical file and then UNLINKS the windows
 * it read. A refresh appending to one of those windows between the read and the unlink would lose its rows
 * with nothing to say so — the compactor's crash-safety is by ordering, and ordering says nothing about a
 * second writer. So compaction takes the same slot per source, skips a source whose slot a refresh holds, and
 * releases what it took on the way out, because a scheduled compaction runs IN the recipe runner's process
 * (`../live/automation/verbRun.ts`) and a slot held until that process exits would refuse every refresh behind
 * it. The slot therefore rations one source's BRONZE WRITERS, and each refusal says a refresh OR a compaction.
 *
 * ## A refusal can name no holder
 *
 * Taking a slot is exclusive and fails CLOSED (`../lib/loadSlots.ts`), so a slot directory that will not list or
 * rename refuses with `obstacles` instead of a holder. Every writer here skips that source exactly as it skips a held
 * one, printing {@link slotUnavailableLines} — writing without the slot would be a writer the next one cannot see.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { readHeap } from "../lib/heapBudget.js";
import { acquireLoadSlot, liveSlots, releaseLoadSlot, type SlotVerdict } from "../lib/loadSlots.js";
import type { CorpusSource } from "./types.js";

/**
 * How many just-in-time refreshes of ONE source may run at once. One, and not derived from anything: a
 * second concurrent fetch of the same source races on that source's stored resume cursor, and no amount of
 * machine memory makes that safe.
 */
export const REFRESH_SLOT_LIMIT = 1;

/**
 * A just-in-time refresh already running for a source — what the card reads so it never announces a second
 * one. `startedAtIso` is the holder's own start, written when it took the slot.
 */
export interface InFlightRefresh {
  readonly source: CorpusSource;
  readonly pid: number;
  readonly startedAtIso: string;
}

/**
 * Where one source's refresh slot lives: a per-source directory under the OS temp dir.
 *
 * MACHINE-scoped rather than home-scoped, for the reason `../lib/loadSlots.ts` gives about its own
 * directory — two homes on one laptop still share one provider rate limit, and a read-only caller that
 * merely wants to know whether a refresh is running must not write into a home to find out.
 *
 * @param source the source whose slot this is
 * @param root the slot root, overridable so a test never touches the machine-wide directory
 * @returns the absolute directory path
 */
export function refreshSlotDir({
  source,
  root = defaultRefreshSlotRoot(),
}: {
  source: CorpusSource;
  root?: string;
}): string {
  return join(root, source);
}

/** The machine-wide root the per-source slot directories sit under. */
function defaultRefreshSlotRoot(): string {
  return join(tmpdir(), "slopweaver-jit-refresh-slots");
}

/**
 * Take this process's just-in-time refresh slot for one source, or report the live holder.
 *
 * @param source the source about to be refreshed
 * @param root the slot root, overridable in a test
 * @returns the verdict; a lane is held only when admitted
 */
export function acquireRefreshSlot({
  source,
  root = defaultRefreshSlotRoot(),
}: {
  source: CorpusSource;
  root?: string;
}): SlotVerdict {
  return acquireLoadSlot({
    ceilingMib: Math.round(readHeap().limitBytes / (1024 * 1024)),
    dir: refreshSlotDir({ root, source }),
    limit: REFRESH_SLOT_LIMIT,
  });
}

/**
 * Give back this process's slot for one source — what a process that outlives its write owes the next
 * writer. A dead holder is taken over by liveness, so exclusivity never depends on this; but a lane that will not
 * free keeps refusing the next refresh of `source` until this process exits, so each one is warned here, where every
 * caller passes, and returned.
 *
 * @param source the source whose slot this process took
 * @param root the slot root, overridable in a test
 * @returns a sentence for each lane that stayed held; empty when the slot was given back
 */
export function releaseRefreshSlot({
  source,
  root = defaultRefreshSlotRoot(),
}: {
  source: CorpusSource;
  root?: string;
}): readonly string[] {
  const stuck = releaseLoadSlot({ dir: refreshSlotDir({ root, source }) });
  for (const why of stuck) {
    logger.warn({ msg: `${source}'s refresh slot was not given back: ${why}` });
  }
  return stuck;
}

/**
 * Which of these sources already have a just-in-time refresh running, by another process.
 *
 * Reads only — taking a slot is what a refresh does, and a card that took one to describe one would hold a
 * source hostage for as long as the query took to render. This process's own slot is excluded so a turn
 * that is already refreshing does not report itself as somebody else's run.
 *
 * @param sources the sources to check
 * @param root the slot root, overridable in a test
 * @returns one entry per source with a live foreign holder, in the order asked
 */
export function liveRefreshes({
  sources,
  root = defaultRefreshSlotRoot(),
}: {
  sources: readonly CorpusSource[];
  root?: string;
}): readonly InFlightRefresh[] {
  return sources.flatMap((source): readonly InFlightRefresh[] =>
    liveSlots({ dir: refreshSlotDir({ root, source }) })
      .filter((slot) => slot.pid !== process.pid)
      .map((slot) => ({ pid: slot.pid, source, startedAtIso: slot.startedAtIso })),
  );
}

/**
 * What `refresh` prints when another process holds a source's slot: what is running, and the whole remedy.
 *
 * Nothing is queued, exactly as the load slot's own refusal says, so the remedy is always to let the holder
 * finish. WHICH remedy differs by caller, which is the one thing `--jit` still decides: a turn that waited
 * should re-ask, because the holder's run is the refresh it wanted; an operator should run their command
 * again. Neither should ever start a second fetch of the same source.
 *
 * @param source the source whose slot is held
 * @param holder the live holder
 * @param jit whether this run is a turn's just-in-time wait rather than a hand-run or scheduled refresh
 * @returns the refusal lines, remedy last
 */
export function refreshSlotRefusalLines({
  source,
  holder,
  jit = false,
}: {
  source: CorpusSource;
  holder: InFlightRefresh;
  jit?: boolean;
}): readonly string[] {
  const remedy = jit
    ? "  to answer: let that run finish, then re-run the gate — nothing is queued, so re-asking is the whole remedy."
    : "  let that run finish and run this again — nothing is queued, and there is no flag that waives the slot.";
  return [
    `refresh ${source} · a refresh or compaction of ${source} is already running (pid ${String(holder.pid)}, since ${holder.startedAtIso}) — not starting a refresh beside it, which would race it on ${source}'s resume cursor or window files.`,
    remedy,
  ];
}

/**
 * What `refresh` or `compact` prints for a source whose slot could not be TAKEN, with no holder to name — a slot
 * directory that will not list or rename, or a lane that kept changing hands. The source is skipped exactly as a
 * held one is: running without the slot would be a writer the next refresh or compaction could not see.
 *
 * @param source the source skipped
 * @param obstacles what stopped the slot being taken, one sentence each
 * @param verb which verb skipped it
 * @returns the lines, remedy last
 */
export function slotUnavailableLines({
  source,
  obstacles,
  verb,
}: {
  source: CorpusSource;
  obstacles: readonly string[];
  verb: "refresh" | "compact";
}): readonly string[] {
  return [
    `${verb} ${source} · ${source}'s slot could not be taken: ${obstacles.join("; ")} — skipping ${source} rather than writing it beside a refresh or compaction this run could not count.`,
    "  run this again — a lane changing hands settles in moments; a slot directory that will not list or rename is a filesystem fault to clear first.",
  ];
}

/**
 * What `compact` prints for a source it skipped because another process holds that source's slot.
 *
 * @param source the source left uncompacted
 * @param holder the live holder
 * @returns the lines, remedy last
 */
export function compactSlotRefusalLines({
  source,
  holder,
}: {
  source: CorpusSource;
  holder: InFlightRefresh;
}): readonly string[] {
  return [
    `compact ${source} · a refresh or compaction of ${source} is already running (pid ${String(holder.pid)}, since ${holder.startedAtIso}) — skipping ${source}: unlinking its window files under a live writer would lose the rows it appends.`,
    "  let that run finish and run this again — nothing is queued, and every other source was still compacted.",
  ];
}
