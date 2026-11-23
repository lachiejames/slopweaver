/**
 * The send half of an as-me draft release: what happens once `./releaseRun.ts` has resolved the row. The words they
 * approved are re-prepared, checked for drift from their digest and re-read for a person's change, then sent; a line of
 * thanks in their place is `./releaseThanks.ts`. Both send through `./asMeSend.ts`'s {@link sendPreparedDrip}, shared
 * with a fresh send, and both journal a release that sent nothing (`./sendFailureJournalling.ts`).
 */
import type { ParkedSlackDraft, ParkedSlackDraftMedia } from "../../../outbound/slack/draftRegister.js";
import type { ReleaseFreshnessError } from "../../../outbound/slack/releaseFreshness.js";
import { EXIT_OK } from "../../exitCodes.js";
import { sendPreparedDrip } from "./asMeSend.js";
import type { SlackDraftReleaseOptions } from "./coreTypes.js";
import type { DripOutcome } from "./dripCore.js";
import { type PreparedDrip, prepareDrip } from "./prepareDrip.js";
import { releaseFreshness, releasePriorAsk } from "./releaseFreshnessGate.js";
import { releaseJoinStep } from "./releaseJoin.js";
import { holdFreshnessRefusal } from "./releaseRefusalHold.js";
import {
  markDraftReleased,
  offeredDigestRefusal,
  releaseMediaLines,
  rowMovedBeforeSend,
  servedMedia,
} from "./releaseRow.js";
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
 * Refuse a re-preparation whose bytes, identity or mentions are not the ones they approved.
 *
 * @param deps the injected world, for `auth.test`
 * @param draft the parked row
 * @param media the attachment entries the store VERIFIED, which the recomputed digest binds
 * @param prepared what the ordinary preparation produced from the release's form
 * @param token the user token the release will post under
 * @returns the refusal, or empty when the release sends exactly the approved message
 */
async function releaseDriftRefusal({
  deps,
  draft,
  media,
  prepared,
  token,
}: {
  deps: Pick<SlackWriteDeps, "whoAmI">;
  draft: ParkedSlackDraft;
  media: readonly ParkedSlackDraftMedia[];
  prepared: PreparedDrip;
  token: string;
}): Promise<readonly string[]> {
  const first = prepared.plan.messages[0];
  if (prepared.plan.messages.length !== 1 || first === undefined) {
    return [
      `draft ${draft.id} re-prepares to ${String(prepared.plan.messages.length)} messages, and a parked draft ` +
        "is ONE — nothing was sent.",
    ];
  }
  return offeredDigestRefusal({
    deps,
    draft,
    media,
    payload: first.payload,
    resolution: prepared.resolution,
    // The thread the send will ACTUALLY land in — `./dripRun.ts` threads only a `thread`-shaped plan — so a
    // plan that would post top-level digests as top-level and a thread row's approval refuses it.
    threadTs: prepared.plan.shape === "thread" ? prepared.plan.threadTs : undefined,
    token,
  });
}

/**
 * Mark the row released once every message landed, so the queue stops offering it.
 *
 * A send that did not fully land leaves the row HELD: a resumed release is the same command again. One Slack refused
 * outright is held `slack-refused` too, so their Queue card says why their yes did not go out. An append that fails after a
 * landed send is the one state the register cannot express, so it exits non-zero and names the drop that resolves it.
 *
 * @param deps the injected world, for the append
 * @param draft the released row
 * @param dryRun whether the release attempted nothing
 * @param exitCode what the send itself exited with
 * @param heldCuts the other held cuts of this message, spent once it lands
 * @param home the state home the register lives under
 * @param outcomes every message's fate, when the send ran
 * @param threadMovedCleared the changes the release judged and sent past, journalled on the released event
 * @returns the exit code the verb ends on
 */
export function recordDraftRelease({
  deps,
  draft,
  dryRun,
  exitCode,
  heldCuts,
  home,
  outcomes,
  threadMovedCleared,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draft: ParkedSlackDraft;
  dryRun: boolean;
  exitCode: number;
  heldCuts: readonly string[];
  home: string;
  outcomes: readonly DripOutcome[] | undefined;
  threadMovedCleared?: readonly string[] | undefined;
}): number {
  const landed = outcomes?.[0];
  if (exitCode !== EXIT_OK || landed === undefined || !("ts" in landed)) {
    holdRefusedRelease({ deps, draft, options: { dryRun, home }, outcomes });
    return exitCode;
  }
  const permalink = landed.state === "sent" ? landed.permalink : undefined;
  return markDraftReleased({ deps, draft, heldCuts, home, permalink, threadMovedCleared, ts: landed.ts });
}

/**
 * Every check the approved words cross before they are sent: re-preparation through the live gates, drift from the
 * digest they approved, a person's change to the thread, and an earlier ask. A release that sends nothing is journalled
 * like a fresh send: the draft was parked before they asked, so its hold alone would read as "not sent yet" to
 * `talk slack-send-outcome`.
 *
 * @param env the door's environment, for its override tokens
 * @returns the exit code a refusal ends on, or what the send needs
 */
async function approvedWordsGates({
  config,
  deps,
  env,
  options,
  resolved,
  token,
}: {
  config: Parameters<typeof prepareDrip>[0]["config"];
  deps: SlackWriteDeps;
  env: Readonly<Record<string, string | undefined>>;
  options: SlackDraftReleaseOptions;
  resolved: ResolvedRelease;
  token: string;
}): Promise<number | { readonly cleared: readonly string[]; readonly prepared: PreparedDrip }> {
  const { draft, drip, media } = resolved;
  const refused = ({ errors, journalAs }: { errors: readonly string[]; journalAs: readonly string[] }): number => {
    journalSendFailure({ channel: draft.channel, errors: journalAs, options: drip, threadTs: draft.threadTs });
    return usage({ errors });
  };
  const prepared = await prepareDrip({ config, deps, env, options: drip, token });
  if (prepared.isErr()) {
    return refused({ errors: prepared.error, journalAs: [UNPREPARED_SEND_ERROR] });
  }
  const records = [...media.values()].map((entry) => entry.record);
  const drift = await releaseDriftRefusal({ deps, draft, media: records, prepared: prepared.value, token });
  if (drift.length > 0) {
    return refused({ errors: drift, journalAs: drift });
  }
  // The thread moving is one of their named reasons not to send, so it is held on the row as well as journalled.
  const movedOn = ({ error }: { error: ReleaseFreshnessError }): number => {
    holdFreshnessRefusal({ deps, draftId: draft.id, dryRun: drip.dryRun, error, home: drip.home });
    return refused({ errors: [error.message], journalAs: [error.message] });
  };
  const fresh = await releaseFreshness({ cleared: options.threadMovedCleared, deps, draft, home: drip.home, token });
  if (fresh.isErr()) {
    return movedOn({ error: fresh.error });
  }
  const prior = await releasePriorAsk({ deps, draft, token });
  if (prior.isErr()) {
    return movedOn({ error: prior.error });
  }
  const moved = rowMovedBeforeSend({ deps, draft, home: drip.home });
  if (moved !== undefined) {
    return refused({ errors: [moved.message], journalAs: [moved.message] });
  }
  return { cleared: fresh.value, prepared: prepared.value };
}

/**
 * Send the words they approved: re-prepare them through every live gate, refuse any drift from the digest, re-read the
 * thread for a person's change, join a public channel they are not in when the row carries their yes, then send as the
 * ordinary drip does and mark the row released.
 *
 * @param config the operator's drip configuration, read before the row
 * @param resolved the row, its drip options, held re-cuts and verified media
 * @param token the user token the re-reads and the send go out under
 * @returns the exit code the verb ends on
 */
export async function releaseApprovedWords({
  config,
  deps,
  options,
  resolved,
  token,
}: {
  config: Parameters<typeof prepareDrip>[0]["config"];
  deps: SlackWriteDeps;
  options: SlackDraftReleaseOptions;
  resolved: ResolvedRelease;
  token: string;
}): Promise<number> {
  const { draft, drip, heldCuts, media } = resolved;
  const env = deps.doorEnv();
  const gated = await journalReleaseThrow({
    deps,
    draft,
    drip,
    gates: () => approvedWordsGates({ config, deps, env, options, resolved, token }),
  });
  if (typeof gated === "number") {
    return gated;
  }
  // After every gate, so a release that was going to stop joins nothing.
  const refusedJoin = await releaseJoinStep({ deps, draft, drip, token });
  if (refusedJoin !== undefined) {
    return refusedJoin;
  }
  if (!drip.json) {
    for (const line of releaseMediaLines({ media })) {
      deps.out(line);
    }
  }
  const served = { ...deps, readMedia: servedMedia({ media }) };
  const sent = await holdSendThrow({
    deps,
    draft,
    drip,
    send: () =>
      sendPreparedDrip({
        deps: served,
        env,
        lastCheck: () => rowMovedBeforeSend({ deps, draft, home: drip.home }),
        options: drip,
        prepared: gated.prepared,
        token,
      }),
  });
  return recordDraftRelease({
    deps,
    draft,
    dryRun: drip.dryRun,
    exitCode: sent.exitCode,
    heldCuts,
    home: drip.home,
    outcomes: sent.outcomes,
    threadMovedCleared: gated.cleared,
  });
}
