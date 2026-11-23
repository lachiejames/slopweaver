/**
 * The two reporting modes of `slopweaver turn dispatch` — `--poll <id>` and `--sweep`.
 *
 * Depth 0 of the family, beside the argument layer and importing neither it nor anything above it. That is
 * the property this module exists for: a poll reports one dispatch's live screen and a sweep reports every
 * dispatched ask's state, and NEITHER has an import edge to the code that admits a responder, records a
 * decision or opens a workspace. In one file that separation was a convention a careful reader kept.
 */
import { realWorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import { logger } from "../../../lib/logger.js";
import { parseAskArgument } from "../../../live/ask/askArgument.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import { readProcessSnapshot } from "../../../live/standing/inspect.js";
import { askIdentityFromDispatchId } from "../../../live/turn/dispatch.js";
import { currentGenerationDispatchRecord, noDispatchRecordReason } from "../../../live/turn/dispatchStore.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuse, str } from "./core.js";
import { runWitnessWarn } from "./dispatchBudget.js";
import { freshVisibleSessionScreenRead, sweepDispatchedAsks } from "./dispatchSweep.js";
import { liveScreenRead } from "./liveScreenRead.js";
import { liveReactionAssertDeps } from "./reactionAssert.js";
import { realReviewerSweepDeps } from "./reviewSurface.js";

/**
 * cmux's own `latest_submitted_message` for one workspace — one client, opened and closed around a single
 * inventory read. An unreachable cmux answers `undefined`, exactly like a workspace with no submitted
 * message: this reconciliation can only ever CONFIRM a pickup, so a broken oracle must leave the ask
 * unwitnessed rather than manufacture either verdict.
 *
 * @param workspaceId the recorded workspace to look up
 * @returns the last message cmux accepted for it, or `undefined`
 */
async function realLatestSubmittedMessage({ workspaceId }: { workspaceId: string }): Promise<string | undefined> {
  return withCmuxSessionHost({
    body: async ({ harness }) => {
      const listed = await harness.list();
      return listed.isOk()
        ? listed.value.find((session) => session.id === workspaceId)?.latestSubmittedMessage
        : undefined;
    },
  });
}

/**
 * The instant one sweep tick judges a lease against.
 *
 * Called INSIDE the `nowIso` arrow rather than hoisted into a const, and that is the whole point of it
 * being a function: `sweepDispatchedAsks` calls that arrow per ask, so a hoisted value would freeze one
 * instant across the whole sweep and judge every lease after the first against a clock that had stopped.
 *
 * @returns the caller's frozen instant when `--now` named one, the real clock otherwise
 */
function sweepInstant({ nowIso }: { nowIso: string | undefined }): string {
  if (nowIso !== undefined) {
    return nowIso;
  }
  return new Date().toISOString();
}

/**
 * The `--sweep` mode: the real wiring — `readScreen`, cmux's delivery record, the clock, `logger`.
 *
 * The clock is the one injected effect a CALLER can name, and only because a replay fixture needs it: a
 * frozen home is a stopped world, so judging its leases by the wall clock reports every one of them expired
 * the day after the fixture was cut. `--now` is refused as a usage error unless it parses, rather than
 * silently falling back to the real clock — a sweep that quietly used a different instant than the one asked
 * for would finalise real asks on a fixture's behalf.
 *
 * @param home the resolved state home
 * @param nowIso the instant to judge every lease against, or `undefined` for the real clock
 * @returns the process exit code
 */
async function runSweep({
  home,
  nowIso,
  only,
}: {
  home: string;
  nowIso: string | undefined;
  only: { readonly channel: string; readonly messageTs: string } | undefined;
}): Promise<number> {
  // ONE reading of the process table for the whole sweep, taken here rather than per ask: `ps -ax` is not
  // free, and every ask in one pass is judged against one instant of the table anyway. Read eagerly rather
  // than memoised behind the closure — a lazy memo has to express "not read yet" as an absent value, and
  // every spelling of that is either the `??=` the `no-silent-fallback` gate refuses or a placeholder
  // snapshot that lies about an unread table. One `ps` per sweep tick is the honest price.
  const table = readProcessSnapshot();
  return sweepDispatchedAsks({
    deps: {
      freshScreenRead: freshVisibleSessionScreenRead,
      latestSubmittedMessage: realLatestSubmittedMessage,
      nowIso: () => sweepInstant({ nowIso }),
      processSnapshot: () => table,
      reaction: liveReactionAssertDeps({ home }),
      reviewer: realReviewerSweepDeps(),
      workerLiveness: realWorkspaceLivenessCheck(),
      writeLine: ({ line }) => {
        logger.out({ line });
      },
    },
    home,
    ...(only === undefined ? {} : { only }),
  });
}

/**
 * The `--sweep` branch of {@link runTurnDispatch}: validate its two optional flags, then sweep.
 *
 * Split out because both flags are REFUSED rather than defaulted when malformed, and two refusals inline
 * put the verb's own entry point over this repo's branch-complexity cap. `--now` must parse because a sweep
 * that quietly used the real clock instead would finalise live asks on a fixture's behalf, and `--ask` must
 * parse because a sweep FINALISES what it finds.
 *
 * @param home the resolved state home
 * @param values the parsed flags
 * @returns the process exit code
 */
export async function runSweepMode({
  home,
  values,
}: {
  home: string;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<number> {
  const nowIso = str({ key: "now", values });
  if (nowIso !== undefined && Number.isNaN(Date.parse(nowIso))) {
    return refuse({ code: EXIT_USAGE, errors: [`--now must be an ISO-8601 instant, got ${nowIso}`] });
  }
  const ask = str({ key: "ask", values });
  const only = ask === undefined ? undefined : parseAskArgument({ ask });
  if (ask !== undefined && only === undefined) {
    return refuse({ code: EXIT_USAGE, errors: [`--ask must read <channel>/<messageTs>, got ${ask}`] });
  }
  const note = str({ key: "warn", values });
  const expectedDispatchedIso = str({ key: "warn-dispatched", values });
  if (note !== undefined || expectedDispatchedIso !== undefined) {
    return runWitnessWarn({ expectedDispatchedIso, home, note, nowIso, only });
  }
  return runSweep({ home, nowIso, only });
}

/**
 * The `--poll <id>` mode: report live truth, never mutate anything.
 *
 * @returns the process exit code
 */
export async function runPoll({ dispatchId, home }: { dispatchId: string; home: string }): Promise<number> {
  const askIdentity = askIdentityFromDispatchId({ dispatchId });
  if (askIdentity === undefined) {
    return refuse({ code: EXIT_ERROR, errors: [`--poll "${dispatchId}" is not a token this build minted`] });
  }
  const record = currentGenerationDispatchRecord({ askIdentity, home });
  if (record === undefined) {
    return refuse({
      code: EXIT_ERROR,
      errors: [`${noDispatchRecordReason({ askIdentity, home })} for --poll "${dispatchId}"`],
    });
  }
  const { truth } = await liveScreenRead({
    askIdentity: record,
    dispatchId,
    home,
    notBeforeIso: capturedAskFor({ channel: record.channel, home, messageTs: record.messageTs })?.firstAnswer?.tsIso,
    surfaceId: record.session.surfaceId,
    workspaceId: record.session.workspaceId,
  });
  logger.out({ line: JSON.stringify(truth) });
  return EXIT_OK;
}
