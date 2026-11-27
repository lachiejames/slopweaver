/**
 * `slopweaver supervisor hand-off` — the control plane replacing the pinned chair at its bar, WITHOUT THE MODEL DOING
 * IT. The watch (`supervisor chair-watch`, `./chairWatchRun.ts`) decides whether; this transaction asks the outgoing
 * chair for its note, closes its run, writes the successor doc and seats the successor in a visible app card on the
 * plan with the most room. The model supplies what to hand over, never whether to hand over.
 *
 * ## The order, every step journalled (`../../../supervisor/chairHandOff.ts`)
 *
 * 1. Take the process-lifetime lock `chair-hand-off:<predecessor>` SYNCHRONOUSLY, before the first await, so two
 *    invocations in one process or two can never both proceed: the second exits 4.
 * 2. Load the chair's episode (one per outgoing chair, `chair-hand-off:<app session id>`), or begin one. A journal
 *    whose `started` event names another episode or another chair is refused, exit 1, with nothing journalled.
 * 3. While the predecessor's run is still open, re-read the watch fresh and refuse unless it says `hand-off` or the
 *    owner passed `--now --reason` (`./chairHandOffBegin.ts`).
 * 4. Ask the outgoing chair for its note and wait for it (`./chairHandOffNoteSteps.ts`).
 * 5. Close the predecessor's run once its slug re-resolves to the one `started` named, reserve the successor slug,
 *    write its doc, spawn and reconcile against the ledger and then the app (`./chairHandOffSeat.ts`).
 *
 * This file walks the journal from wherever it stands, and routes the verb's three other bodies. Every step prints
 * one line with its reason; every refusal names its override.
 */
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { logger } from "../../../lib/logger.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { withAppSessionHarness } from "../../../sessionHarness/appHarness.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { runtimeLockDir } from "../../../stateRuntime.js";
import {
  type ChairHandOffEvent,
  type ChairHandOffStarted,
  type ChairHandOffStep,
  episodeIdOf,
  nextStep,
} from "../../../supervisor/chairHandOff.js";
import { readChairHandOffHold } from "../../../supervisor/chairHandOffHold.js";
import { recordChairHandOffNote } from "../../../supervisor/chairHandOffNote.js";
import { readEpisode } from "../../../supervisor/chairHandOffStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { type ChairHandOffInvocation, type ChairHandOffOptions, parseChairHandOffArgs } from "./chairHandOffArgs.js";
import { begin } from "./chairHandOffBegin.js";
import { closeRow } from "./chairHandOffClose.js";
import { type ChairHandOffDeps, type Ctx, say, VERB } from "./chairHandOffContext.js";
import { productionChairHandOffHoldDeps, runChairHandOffHold, runChairHandOffRelease } from "./chairHandOffHoldRun.js";
import { askNote, awaitNote } from "./chairHandOffNoteSteps.js";
import { openSuccessor, reconcile, reserveSlug, writeDoc } from "./chairHandOffSeat.js";
import { CHAIR_HAND_OFF_USAGE } from "./chairHandOffUsage.js";
import { realSuccessorSpawn } from "./chairSuccessorLaunch.js";
import { readChairWatch } from "./chairWatchPass.js";
import { handOffChairWatchDeps } from "./chairWatchRun.js";

/** The most steps one invocation takes: the journal's whole order, with room for the slug retries. */
const MAX_STEPS = 32;

/** Take one step: an exit code ends the walk, undefined takes the next. */
async function takeStep({ ctx, step }: { ctx: Ctx; step: ChairHandOffStep }): Promise<number | undefined> {
  switch (step.kind) {
    case "done":
      say({ ctx, line: `nothing to do: ${ctx.episodeId} already seated app:${step.sessionId} from ${step.slug}` });
      return EXIT_EXPECTED_EMPTY;
    case "abandoned":
      say({ ctx, line: `nothing to do: ${ctx.episodeId} ended without a successor (${step.why})` });
      return EXIT_EXPECTED_EMPTY;
    case "start":
      return begin({ ctx });
    case "ask-note":
      return askNote({ ctx, started: step.started });
    case "await-note":
      return awaitNote({ ctx, deadlineIso: step.deadlineIso });
    case "close-row":
      return closeRow({ ctx, started: step.started });
    case "reserve-slug":
      return reserveSlug({ ctx });
    case "write-doc":
      return writeDoc({ ctx, slug: step.slug, started: step.started });
    case "open-successor":
      return openSuccessor({ ctx, slug: step.slug, started: step.started });
    case "reconcile":
      return reconcile({ ctx, slug: step.slug, started: step.started });
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/**
 * Why the journal read under this episode is another chair's, or undefined when its `started` event names this
 * episode and this chair (or it has none yet). Two episode ids can share one journal file once its name is made
 * safe, and a run continuing another chair's journal would close that chair's run and seat its successor.
 */
function foreignEpisode({ ctx, events }: { ctx: Ctx; events: readonly ChairHandOffEvent[] }): string | undefined {
  const started = events.find((event): event is ChairHandOffStarted => event.kind === "started");
  if (started === undefined) {
    return undefined;
  }
  if (started.episodeId !== ctx.episodeId) {
    return `the journal for ${ctx.episodeId} was started as episode ${started.episodeId}`;
  }
  if (started.predecessor !== ctx.predecessor) {
    return `the journal for ${ctx.episodeId} hands off chair app:${started.predecessor}, not the pinned app:${ctx.predecessor}`;
  }
  return undefined;
}

/** Walk the episode from wherever its journal stands to its end, or to the first stop. */
async function walk({ ctx }: { ctx: Ctx }): Promise<number> {
  for (let taken = 0; taken < MAX_STEPS; taken += 1) {
    const events = readEpisode({ episodeId: ctx.episodeId, home: ctx.options.home });
    if (events.isErr()) {
      say({ ctx, line: `refused: ${events.error.message}` });
      return EXIT_ERROR;
    }
    const foreign = foreignEpisode({ ctx, events: events.value });
    if (foreign !== undefined) {
      say({
        ctx,
        line: `refused: ${foreign}; nothing was journalled, closed or seated — read that journal before re-running`,
      });
      return EXIT_ERROR;
    }
    const stopped = await takeStep({ ctx, step: nextStep({ events: events.value }) });
    if (stopped !== undefined) {
      return stopped;
    }
  }
  say({ ctx, line: `refused: ${String(MAX_STEPS)} steps without an end; read the journal for ${ctx.episodeId}` });
  return EXIT_ERROR;
}

/** Run the hand-off itself. Everything before the first await is synchronous, so the lock is taken before it. */
async function runHandOff({
  options,
  deps,
}: {
  options: ChairHandOffOptions;
  deps: ChairHandOffDeps;
}): Promise<number> {
  const pin = readSupervisorPinDisposition({ home: options.home });
  if (pin.kind !== "pin" || !("appSessionId" in pin.record)) {
    const what = pin.kind === "pin" ? "a cmux chair" : `the pin is ${pin.kind}`;
    deps.out({
      line: `${VERB}: refused: ${what}; the control plane hands off only a pinned desktop-app chair, even with --now — hand a cmux chair off from the chair itself`,
    });
    return EXIT_ERROR;
  }
  const predecessor = pin.record.appSessionId;
  const episodeId = episodeIdOf({ appSessionId: predecessor });
  const directory = runtimeLockDir({ home: options.home });
  if (directory.isErr()) {
    deps.out({ line: `${VERB}: refused: no runtime directory for the lock (${directory.error.message})` });
    return EXIT_ERROR;
  }
  const lock = acquireOperationLock({
    directory: directory.value,
    home: options.home,
    key: episodeId,
    nowIso: deps.nowIso(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    deps.out({
      line: `${VERB}: not yet: another hand-off of app:${predecessor} is running (${lock.error}); it seats the successor, so nothing is done here`,
    });
    return EXIT_DEFERRED;
  }
  try {
    return await deps.withHarness({
      body: async ({ harness }) => walk({ ctx: { deps, episodeId, harness, lock: lock.value, options, predecessor } }),
    });
  } finally {
    lock.value.release();
  }
}

/** `hand-off note`: record the outgoing chair's note, and nothing else. */
function runNote({
  invocation,
  deps,
}: {
  invocation: Extract<ChairHandOffInvocation, { kind: "note" }>;
  deps: ChairHandOffDeps;
}): number {
  const recorded = recordChairHandOffNote({
    episodeId: invocation.episodeId,
    file: invocation.file,
    home: invocation.home,
    nowIso: deps.nowIso(),
  });
  if (recorded.isErr()) {
    deps.out({ line: `${VERB} note: refused: ${recorded.error.message}` });
    return recorded.error.code === "LOCK_HELD" ? EXIT_DEFERRED : EXIT_ERROR;
  }
  deps.out({
    line: `${VERB} note: recorded ${String(recorded.value)} characters for ${invocation.episodeId}; the control plane seats the successor — do not spawn one or finish your run`,
  });
  return EXIT_OK;
}

/**
 * `supervisor hand-off`, over its tail.
 *
 * @param rest argv after `supervisor hand-off`
 * @param deps every seam the hand-off reaches
 * @returns the exit code: 0 seated or recorded, 3 nothing to do, 4 not yet, 1 refused, 2 usage
 */
export async function runChairHandOff({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChairHandOffDeps;
}): Promise<number> {
  const parsed = parseChairHandOffArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.out({ line: `${VERB}: ${problem}` });
    });
    deps.out({ line: CHAIR_HAND_OFF_USAGE });
    return EXIT_USAGE;
  }
  const invocation = parsed.value;
  switch (invocation.kind) {
    case "help":
      deps.out({ line: CHAIR_HAND_OFF_USAGE });
      return EXIT_OK;
    case "hold":
      return deps.hold({ rest: invocation.rest });
    case "release":
      return deps.release({ rest: invocation.rest });
    case "note":
      return runNote({ deps, invocation });
    case "run":
      return runHandOff({ deps, options: invocation.options });
    default: {
      const unhandled: never = invocation;
      return unhandled;
    }
  }
}

/**
 * The real seams: a fresh watch pass, the hold journal, the desktop app's socket, `cmux spawn` in-process, the main
 * checkout, the wall clock and stdout.
 *
 * @returns the production dependencies for {@link runChairHandOff}
 */
export function productionChairHandOffDeps(): ChairHandOffDeps {
  const holdDeps = productionChairHandOffHoldDeps();
  return {
    hold: ({ rest }) => runChairHandOffHold({ deps: holdDeps, rest }),
    nowIso: () => new Date().toISOString(),
    out: ({ line }) => {
      logger.out({ line });
    },
    readHold: ({ home }) => readChairHandOffHold({ home }),
    release: ({ rest }) => runChairHandOffRelease({ deps: holdDeps, rest }),
    repo: ({ home }) => checkoutForRunningRepo({ home, verb: VERB }).mapErr((problems) => problems.join("; ")),
    sleep: async ({ ms }) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    spawn: realSuccessorSpawn,
    watch: async ({ home }) => readChairWatch({ deps: handOffChairWatchDeps(), home }),
    withHarness: async ({ body }) => withAppSessionHarness({ body }),
  };
}

/** `slopweaver supervisor hand-off`. */
export const supervisorHandOffCommand = defineCommand({
  run: async (argv) =>
    runChairHandOff({ deps: productionChairHandOffDeps(), rest: verbTail({ argv, verbs: ["hand-off"] }) }),
});
