/**
 * What `cmux spawn` writes down once a seat is open — the doc's run journal — and how it reports a seat left open on
 * a failed delivery. `./run.ts` calls these at the effectful edge. The session ledger's row is NOT written here: the
 * session harness seam's recording launcher writes it from what the launch did (`./spawnLaunch.ts`,
 * `../../../sessionHarness/recordingHarness.ts`).
 */
import type { SpawnPlan } from "../../../cmux/plan.js";
import type { SpawnFailure } from "../../../cmux/spawn.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { spawnDispatcher } from "./core.js";

/** The workspace and surface a seat opened in, as both a successful spawn and a seat left open name it. */
type SpawnedAddress = {
  readonly workspaceRef: string;
  readonly surfaceRef: string;
};

/** The current instant, as ISO-8601. Not injected: this is the effectful CLI edge, not a pure module. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Record a successful spawn into the doc's own run journal; the session ledger's row is the seam's.
 *
 * ## Why the run journal too, and not only the session ledger
 *
 * Measured: `cmux spawn` READ a run journal (to choose start-versus-resume) and never wrote to one,
 * and the only writer of a `launched` event is `handover start` — run by the dispatched session. So a session
 * that booted and never started left the journal completely EMPTY, and its doc sat in `RUN NOW` looking exactly
 * like one nobody had ever been sent to. A supervisor could not distinguish "I never dispatched this" from "I
 * dispatched it and it died silently", and that is precisely what went wrong: a P0 assignment
 * silently never took, with no signal back and nothing to check.
 *
 * The `dispatched` event is the first thing here written by the SUPERVISOR rather than by the session doing the
 * work, which is what makes an absence representable at all — `hasUnansweredDispatch`
 * (`../../../handover/attention.ts`) reads a dispatch with no start after it, which is what lets `handover
 * abandon` clear one.
 *
 * A failed journal write is REPORTED and never fails the spawn: the workspace is already open and the session
 * already booted, so turning a bookkeeping failure into a spawn failure would destroy a real, working dispatch
 * over a missing note about it.
 *
 * A seat whose pickup was SENT but not proven submitted is recorded too, though the spawn fails — see
 * {@link recordSeatLeftOpen}.
 *
 * @param plan the plan the seat was spawned from
 * @param spawned the workspace and surface the seat opened in
 * @param home the state home to write under, or `undefined` for the resolved default
 */
export function recordSpawn({
  plan,
  spawned,
  home,
}: {
  plan: SpawnPlan;
  spawned: SpawnedAddress;
  home: string | undefined;
}): void {
  recordDispatched({ home, plan, spawned });
}

/**
 * Record and report a spawn that failed with its seat left OPEN (`cmux/spawn.ts`'s
 * `spawnFailureKeepsWorkspaceOpen`) — a pickup stranded in the composer, or one nothing saw submitted.
 *
 * Its `dispatched` line is what clears a park, so without it `handover wake` would reseat a second session
 * beside one that may be running the pickup. The report says which of the two the run journal holds. The seat's
 * session-ledger row was already written by the seam's recording launcher, which records a launch that left its
 * session holding the message, and which turns a failed write into a warning rather than a throw.
 *
 * @param plan the plan the seat was spawned from
 * @param failure the failure, naming the workspace and what was seen
 * @param home the state home to write under, or `undefined` for the resolved default
 * @returns the process exit code — always non-zero, since the spawn did not prove its pickup
 */
export function recordSeatLeftOpen({
  plan,
  failure,
  home,
}: {
  plan: SpawnPlan;
  failure: SpawnFailure;
  home: string | undefined;
}): number {
  const dispatchRecorded = recordDispatched({ home, plan, spawned: failure });
  return reportSeatLeftOpen({ dispatchRecorded, failure });
}

/**
 * Append the `dispatched` line to the doc's run journal — reported, never thrown, when it cannot be written.
 *
 * @returns whether the line reached the run journal, which is what clears a park
 */
function recordDispatched({
  plan,
  spawned,
  home,
}: {
  plan: SpawnPlan;
  spawned: { readonly workspaceRef: string; readonly surfaceRef: string };
  home: string | undefined;
}): boolean {
  const dispatched = applyRowEvent({
    event: {
      atIso: nowIso(),
      by: spawnDispatcher({ env: process.env }),
      kind: "dispatched",
      target: spawned.workspaceRef,
    },
    runsDir: stateHomePaths({ home: resolveHome({ named: home }) }).runs,
    slug: plan.slug,
  });
  if (dispatched.isErr()) {
    logger.error({
      msg: `cmux spawn: the workspace opened, but ${plan.slug}'s run journal could not record the dispatch, so a silent no-show will NOT be detectable: ${dispatched.error.message}`,
    });
  }
  return dispatched.isOk();
}

/**
 * Report a spawn that failed with its seat left OPEN, and exit non-zero without the "retry this exact command"
 * every other failure prints: a retry here opens a second session beside one that may be running the pickup.
 *
 * When the `dispatched` line could not be written, the row is still parked and `handover wake` WILL reseat it
 * once due, so this says that rather than the reassurance a recorded dispatch earns.
 *
 * @param failure the failure, naming the workspace and what was seen
 * @param dispatchRecorded whether `recordDispatched` wrote the line that clears the park
 * @returns the process exit code
 */
function reportSeatLeftOpen({
  failure,
  dispatchRecorded,
}: {
  failure: SpawnFailure;
  dispatchRecorded: boolean;
}): number {
  logger.error({ msg: `cmux spawn: opened ${failure.workspaceRef} but ${failure.reason}` });
  const wakeLine = dispatchRecorded
    ? "its dispatch is recorded, so a wake does not reseat it"
    : "its dispatch could NOT be recorded, so the row is still parked and `handover wake` WILL reseat it beside " +
      "this one once due — settle or abandon the row after reading the seat";
  logger.error({
    msg:
      `cmux spawn: ${failure.workspaceRef} is left OPEN and ${wakeLine} — do not retry this command; read the ` +
      `seat first`,
  });
  logger.error({
    msg: `slopweaver cmux read-screen --workspace ${failure.workspaceRef} --surface ${failure.surfaceRef}`,
  });
  return EXIT_ERROR;
}
