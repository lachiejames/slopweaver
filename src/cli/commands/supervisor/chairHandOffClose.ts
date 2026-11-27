/**
 * The close step of `supervisor hand-off` (`./chairHandOffRun.ts`): close the outgoing chair's run with a residue
 * naming the episode, so takeover's predecessor gate reads it finished. Its one await, re-resolving the chair's run,
 * comes first, so the hold check, the pin check and the close run with nothing able to move the pin between them.
 */

import { runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { ChairHandOffStarted } from "../../../supervisor/chairHandOff.js";
import { readEpisode } from "../../../supervisor/chairHandOffStore.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { predecessorSlugOf } from "./chairHandOffBegin.js";
import { type Ctx, journal, recheck, say, stop } from "./chairHandOffContext.js";

/** Why the pin no longer names the outgoing chair, or undefined while it still does. */
function pinMoved({ predecessor, home }: { predecessor: string; home: string }): string | undefined {
  const pin = readSupervisorPinDisposition({ home });
  if (pin.kind !== "pin") {
    return `the pin is ${pin.kind} now`;
  }
  if (!("appSessionId" in pin.record) || pin.record.appSessionId !== predecessor) {
    return "the pin names another chair now";
  }
  return undefined;
}

/** Whether the outgoing chair's run already reads closed. */
function runClosed({ runsDir, slug }: { runsDir: string; slug: string }): boolean {
  const read = readRunJournal({ runsDir, slug });
  return read.isOk() && runStateOf({ events: read.value.events }).phase === "closed";
}

/**
 * Journal and print a run some writer, this one or another, already closed. A journal that will not take the
 * `row-closed` line stops the run: carrying on would re-enter this step until the step bound refused.
 */
function closedAlready({ ctx, slug, by }: { ctx: Ctx; slug: string; by: string }): number | undefined {
  if (!journal({ ctx, event: { alreadyClosed: true, atIso: ctx.deps.nowIso(), kind: "row-closed", slug } })) {
    return EXIT_ERROR;
  }
  say({ ctx, line: `the outgoing chair's run ${slug} was ${by}; continuing` });
  return undefined;
}

/**
 * What must still hold before the outgoing chair's run is closed: the recheck, the pin, and the chair's run
 * re-resolved the way `begin` named it and still the run the episode began over.
 *
 * @param started the episode's opening event, naming the run it began over
 * @returns the exit code to stop with, or undefined when the close may go ahead
 */
async function closeGuard({ ctx, started }: { ctx: Ctx; started: ChairHandOffStarted }): Promise<number | undefined> {
  // The ONE await comes first: the hold and pin checks below, and the close after them, run with no await between,
  // so a pin moved while the app answered is read by the pin check rather than slipping past it.
  const current = await predecessorSlugOf({ ctx });
  const refused = recheck({ before: "closing the outgoing chair's run", ctx, started });
  if (refused !== undefined) {
    return stop({ ctx, exit: refused.exit, why: refused.line });
  }
  const moved = pinMoved({ home: ctx.options.home, predecessor: ctx.predecessor });
  if (moved !== undefined) {
    const why = `${moved}, so this hand-off has no chair to replace; nothing was closed or seated`;
    journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "failed", resumable: false, why } });
    say({ ctx, line: `abandoned: ${why}` });
    return EXIT_ERROR;
  }
  if (current.isErr()) {
    return stop({ ctx, exit: current.error.exit, why: current.error.line });
  }
  if (current.value !== started.predecessorSlug) {
    return stop({
      ctx,
      exit: EXIT_ERROR,
      why: `refused: the outgoing chair's run is ${current.value} now, not ${started.predecessorSlug} that ${ctx.episodeId} began over; nothing was closed — read both runs before re-running`,
    });
  }
  return undefined;
}

/**
 * Close the outgoing chair's run, so takeover's predecessor gate reads it finished — only once the chair's run is
 * re-resolved the way `begin` named it and is still the run the episode began over, so a run the chair no longer
 * holds is never closed. An app that does not answer for the chair stops the run deferred.
 *
 * @param started the episode's opening event, naming the run to close
 * @returns the exit code to stop with, or undefined once the run reads closed
 */
export async function closeRow({
  ctx,
  started,
}: {
  ctx: Ctx;
  started: ChairHandOffStarted;
}): Promise<number | undefined> {
  const guarded = await closeGuard({ ctx, started });
  if (guarded !== undefined) {
    return guarded;
  }
  const events = readEpisode({ episodeId: ctx.episodeId, home: ctx.options.home });
  const arrived = events.isOk() && events.value.some((event) => event.kind === "note-arrived");
  const runsDir = stateHomePaths({ home: ctx.options.home }).runs;
  const slug = started.predecessorSlug;
  if (runClosed({ runsDir, slug })) {
    return closedAlready({ by: "already closed", ctx, slug });
  }
  const superseded = `superseded by the control plane's chair hand-off ${ctx.episodeId}`;
  const closed = applyRowEvent({
    event: {
      atIso: ctx.deps.nowIso(),
      kind: "closed",
      residue: [
        superseded,
        arrived
          ? "the outgoing chair's note is in the successor doc"
          : "no note arrived; the successor rebuilds from files",
      ],
      summary: superseded,
    },
    runsDir,
    slug,
  });
  if (closed.isErr()) {
    if (runClosed({ runsDir, slug })) {
      return closedAlready({ by: "closed by another writer", ctx, slug });
    }
    return stop({
      ctx,
      exit: EXIT_ERROR,
      why: `refused: the outgoing chair's run ${slug} would not close (${closed.error.message})`,
    });
  }
  if (!journal({ ctx, event: { alreadyClosed: false, atIso: ctx.deps.nowIso(), kind: "row-closed", slug } })) {
    return EXIT_ERROR;
  }
  say({ ctx, line: `closed the outgoing chair's run ${slug}, superseded by ${ctx.episodeId}` });
  return undefined;
}
