/**
 * The thanks half of an as-me draft release: the just-in-time re-read found the approved message no longer needed,
 * so one line of thanks goes in its place and the row closes like any release. The approved words' own send is
 * `./releaseSend.ts`; both send through `./asMeSend.ts`'s {@link sendPreparedDrip} and journal a release that sent
 * nothing (`./sendFailureJournalling.ts`).
 */
import { EXIT_OK } from "../../exitCodes.js";
import { sendPreparedDrip } from "./asMeSend.js";
import type { SlackDraftReleaseOptions, SlackDripOptions } from "./coreTypes.js";
import { type PreparedDrip, prepareDrip } from "./prepareDrip.js";
import { releaseFreshness } from "./releaseFreshnessGate.js";
import { holdFreshnessRefusal } from "./releaseRefusalHold.js";
import { markDraftReleased, rowMovedBeforeSend } from "./releaseRow.js";
import type { ResolvedRelease } from "./releaseRun.js";
import type { SlackWriteDeps } from "./run.js";
import {
  holdRefusedRelease,
  holdSendThrow,
  journalReleaseThrow,
  journalSendFailure,
  UNPREPARED_SEND_ERROR,
} from "./sendFailureJournalling.js";
import { usage } from "./writeOutput.js";

/**
 * Close a row on THANKS: the just-in-time re-read found the approved message no longer needed, so one line of
 * thanks for the review goes to the same place in its stead, and the row closes like any release. The shape is
 * that the message changes into thanks for the review and comes off the owner's board, with nothing more
 * for the owner to hear about it. So no card and no second approval: the thanks still
 * crosses every live gate the ordinary as-me send runs, carries none of the row's media, and the released event
 * journals the line, so a register reader sees the row closed on thanks rather than on the words they read.
 *
 * @param config the operator's drip configuration, read before the row
 * @param options the parsed release, naming the change set the session judged
 * @param resolved the row, its drip options and held re-cuts
 * @param thanks the one line sent in place of the approved words
 * @returns the exit code the verb ends on
 */
export async function releaseAsThanks({
  config,
  deps,
  options,
  resolved,
  thanks,
  token,
}: {
  config: Parameters<typeof prepareDrip>[0]["config"];
  deps: SlackWriteDeps;
  options: SlackDraftReleaseOptions;
  resolved: ResolvedRelease;
  thanks: string;
  token: string;
}): Promise<number> {
  const { draft, drip, heldCuts } = resolved;
  // Thanks is sent into the same thread, so it re-reads exactly as the approved words would: a change newer than the
  // set the session judged refuses it too.
  const fresh = await journalReleaseThrow({
    deps,
    draft,
    drip,
    gates: () => releaseFreshness({ cleared: options.threadMovedCleared, deps, draft, home: drip.home, token }),
  });
  if (fresh.isErr()) {
    const errors = [fresh.error.message];
    journalSendFailure({ channel: draft.channel, errors, options: drip, threadTs: draft.threadTs });
    holdFreshnessRefusal({ deps, draftId: draft.id, dryRun: drip.dryRun, error: fresh.error, home: drip.home });
    return usage({ errors });
  }
  const cleared = fresh.value;
  const env = deps.doorEnv();
  const thanksDrip: SlackDripOptions = { ...drip, media: [], source: { kind: "body", text: thanks } };
  const prepared = await journalReleaseThrow({
    deps,
    draft,
    drip,
    gates: () => prepareDrip({ config, deps, env, options: thanksDrip, token }),
  });
  if (prepared.isErr()) {
    const errors = [UNPREPARED_SEND_ERROR];
    journalSendFailure({ channel: draft.channel, errors, options: thanksDrip, threadTs: draft.threadTs });
    return usage({ errors: prepared.error });
  }
  const moved = rowMovedBeforeSend({ deps, draft, home: drip.home });
  if (moved !== undefined) {
    const errors = [moved.message];
    journalSendFailure({ channel: draft.channel, errors, options: thanksDrip, threadTs: draft.threadTs });
    return usage({ errors });
  }
  const sent = await sendThanks({ deps, draft, env, prepared: prepared.value, thanksDrip, token });
  return closeOnThanks({ cleared, deps, draft, heldCuts, sent, thanks, thanksDrip });
}

/** Send the thanks, re-reading the row once more just before its message goes, and hold the row on a throw. */
async function sendThanks({
  deps,
  draft,
  env,
  prepared,
  thanksDrip,
  token,
}: {
  deps: SlackWriteDeps;
  draft: ResolvedRelease["draft"];
  env: ReturnType<SlackWriteDeps["doorEnv"]>;
  prepared: PreparedDrip;
  thanksDrip: SlackDripOptions;
  token: string;
}): ReturnType<typeof sendPreparedDrip> {
  return holdSendThrow({
    deps,
    draft,
    drip: thanksDrip,
    send: () =>
      sendPreparedDrip({
        deps,
        env,
        lastCheck: () => rowMovedBeforeSend({ deps, draft, home: thanksDrip.home }),
        options: thanksDrip,
        prepared,
        token,
      }),
  });
}

/** Close the row on the thanks that landed, or hold it on the refusal Slack gave. */
function closeOnThanks({
  cleared,
  deps,
  draft,
  heldCuts,
  sent,
  thanks,
  thanksDrip,
}: {
  cleared: Parameters<typeof markDraftReleased>[0]["threadMovedCleared"];
  deps: SlackWriteDeps;
  draft: ResolvedRelease["draft"];
  heldCuts: ResolvedRelease["heldCuts"];
  sent: Awaited<ReturnType<typeof sendPreparedDrip>>;
  thanks: string;
  thanksDrip: SlackDripOptions;
}): number {
  const landed = sent.outcomes?.[0];
  if (sent.exitCode !== EXIT_OK || landed === undefined || !("ts" in landed)) {
    holdRefusedRelease({ deps, draft, options: thanksDrip, outcomes: sent.outcomes });
    return sent.exitCode;
  }
  const permalink = landed.state === "sent" ? landed.permalink : undefined;
  return markDraftReleased({
    deps,
    draft,
    heldCuts,
    home: thanksDrip.home,
    permalink,
    thanksInstead: thanks,
    threadMovedCleared: cleared,
    ts: landed.ts,
  });
}
