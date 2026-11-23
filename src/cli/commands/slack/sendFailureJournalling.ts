/**
 * Journalling an as-me send or release that sent nothing, so `talk slack-send-outcome` can say it failed and why
 * (`../../../outbound/slack/sendFailureJournal.ts` reads the rows back). Split out of `./asMeSend.ts` and
 * `./releaseRun.ts` along that one seam: both lanes journal through these functions and nothing else, so a fresh send
 * and a release are judged by the same rows.
 */
import { appendSlackSendFailure } from "../../../admit/slackSendFailureStore.js";
import { unsetFieldAsNull } from "../../../lib/absent.js";
import { logger } from "../../../lib/logger.js";
import type { ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import type { SlackDraftReleaseOptions, SlackDripOptions } from "./coreTypes.js";
import type { DripOutcome } from "./dripCore.js";
import { heldRowOf } from "./releaseHeldRow.js";
import { appendReleaseHold } from "./releaseRefusalHold.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * What a send refused while it was still being prepared is journalled as, in place of the refusal's own words: a
 * malformed form's parser error quotes the form, and the journal never holds the message text.
 */
export const UNPREPARED_SEND_ERROR =
  "the message was refused before it could be prepared to send — its form did not parse or a check refused it";

/**
 * Journal one as-me send that did not go out, so the console voice can say it failed and why. A dry run attempted
 * nothing and is never journalled; a journal that cannot be written is said on stderr and changes no exit code,
 * because the send's own refusal is what the caller acts on.
 */
export function journalSendFailure({
  channel,
  errors,
  options,
  threadTs,
}: {
  channel: string;
  errors: readonly string[];
  options: Pick<SlackDripOptions, "dryRun" | "home">;
  threadTs: string | undefined;
}): void {
  if (options.dryRun) {
    return;
  }
  const written = appendSlackSendFailure({
    failure: {
      atIso: new Date().toISOString(),
      channel,
      error: errors.join(" "),
      // A top-level send has no thread, by design.
      threadTs: unsetFieldAsNull({ key: "threadTs", record: { threadTs } }),
    },
    home: options.home,
  });
  if (written.isErr()) {
    logger.error({ msg: written.error.message });
  }
}

/**
 * Why a drip of which THIS run landed nothing stopped, or `undefined` when this run landed a message or none stopped
 * it. A drip with one message out is a send the live thread read finds, so it is never journalled as a failure
 * (`../../../outbound/slack/sendFailureJournal.ts`). An `unconfirmed` message is one this run did NOT send — an
 * earlier run reserved it and never confirmed it — so it stops the drip like a failure; should that earlier send be
 * in Slack after they asked, the live read says sent first. A drip every message of which an earlier run already sent
 * posts nothing either, and says so, since the send they asked for this time did not go out.
 *
 * @param outcomes every message's fate, in order
 * @returns the first failure's error, unconfirmed reservation or already-sent reason, when this run sent nothing
 */
export function firstFailureOfUnsentDrip({ outcomes }: { outcomes: readonly DripOutcome[] }): string | undefined {
  // Only `sent` is this run's: `already-sent` landed in an earlier run, perhaps before they asked.
  const landed = outcomes.some((outcome) => outcome.state === "sent");
  if (landed) {
    return undefined;
  }
  for (const outcome of outcomes) {
    if (outcome.state === "failed") {
      return outcome.error;
    }
    if (outcome.state === "unconfirmed") {
      return (
        `not sent: an earlier attempt reserved this message at ${outcome.reservedIso} and never confirmed it, ` +
        "so it was held back rather than risk posting it twice"
      );
    }
  }
  if (outcomes.some((outcome) => outcome.state === "already-sent")) {
    return "not sent again: this exact message is already in Slack from an earlier send, so it was not posted twice";
  }
  return undefined;
}

/**
 * Journal a drip the door let through of which this run landed nothing, by {@link firstFailureOfUnsentDrip}'s reason.
 *
 * @param outcomes every message's fate, in order
 * @param threadTs the thread the drip replied in, or `undefined` for a top-level send
 */
export function journalUnsentDrip({
  channel,
  options,
  outcomes,
  threadTs,
}: {
  channel: string;
  options: Pick<SlackDripOptions, "dryRun" | "home">;
  outcomes: readonly DripOutcome[];
  threadTs: string | undefined;
}): void {
  const nothingLanded = firstFailureOfUnsentDrip({ outcomes });
  if (nothingLanded !== undefined) {
    journalSendFailure({ channel, errors: [nothingLanded], options, threadTs });
  }
}

/** Where a held release would have landed: the channel and thread root its row names. */
export interface HeldReleaseTarget {
  readonly channel: string;
  readonly threadTs: string | undefined;
}

/**
 * Where the row a release names would land, read once while that row is held. A row that is missing, spent or
 * already landed as another cut names no thread this release could have failed in, and a spent one may well be in
 * Slack, so it has none.
 *
 * @param options the parsed release, naming the row and the home
 * @returns the held row's channel and thread, or `undefined` when the row is not held
 */
export function heldReleaseTarget({
  deps,
  options,
}: {
  deps: Pick<SlackWriteDeps, "readDraftLog">;
  options: SlackDraftReleaseOptions;
}): HeldReleaseTarget | undefined {
  const held = heldRowOf({ deps, draftId: options.release.draftId, home: options.home });
  if (held.isErr()) {
    return undefined;
  }
  const { channel, threadTs } = held.value.row.draft;
  return { channel, threadTs };
}

/**
 * Journal a release refused or stopped before its options were built, against the target read when it started —
 * never a re-read, which a row dropped or spent while the release ran would leave with nothing to journal against.
 *
 * @param target the held row's channel and thread from {@link heldReleaseTarget}; nothing is journalled without one
 * @param errors what the release printed, journalled as its reason
 * @param options the parsed release, naming the home and whether it was a dry run
 */
export function journalUnresolvedRelease({
  target,
  errors,
  options,
}: {
  target: HeldReleaseTarget | undefined;
  errors: readonly string[];
  options: SlackDraftReleaseOptions;
}): void {
  if (target === undefined) {
    return;
  }
  journalSendFailure({ channel: target.channel, errors, options, threadTs: target.threadTs });
}

/**
 * Run a release's gates, journalling a throw against the draft's thread before it propagates. Nothing has been sent
 * yet, and the draft was parked before they asked, so without a row `talk slack-send-outcome` would read "not sent yet".
 * The row is held `slack-refused` too: every gate that can throw is a Slack read under the token the send would use, so
 * their Queue card says why their yes did not go out. The send itself is not run here: `sendPreparedDrip` journals its own
 * throw, and {@link holdSendThrow} holds the row on it.
 *
 * @param gates every check that runs before the send, ending on an exit code or what the send needs
 * @returns what the gates returned
 */
export async function journalReleaseThrow<T>({
  deps,
  draft,
  drip,
  gates,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draft: ParkedSlackDraft;
  drip: SlackDripOptions;
  gates: () => Promise<T>;
}): Promise<T> {
  try {
    return await gates();
  } catch (cause: unknown) {
    const why = `the release stopped on an error before sending: ${cause instanceof Error ? cause.message : String(cause)}`;
    journalSendFailure({ channel: draft.channel, errors: [why], options: drip, threadTs: draft.threadTs });
    if (!drip.dryRun) {
      appendReleaseHold({ deps, home: drip.home, id: draft.id, reason: "slack-refused", why });
    }
    throw cause;
  }
}

/**
 * Run a release's send, holding the row `slack-refused` when it throws: the send journals its own throw, so only the
 * hold is added here, and their Queue card says why their yes did not go out. Whether a message landed before the throw is
 * the send journal's to say; the hold keeps their approval, so a resend still crosses the reservation check.
 *
 * @param send the send the gates prepared
 * @returns what the send returned
 */
export async function holdSendThrow<T>({
  deps,
  draft,
  drip,
  send,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draft: Pick<ParkedSlackDraft, "id">;
  drip: Pick<SlackDripOptions, "dryRun" | "home">;
  send: () => Promise<T>;
}): Promise<T> {
  try {
    return await send();
  } catch (cause: unknown) {
    if (!drip.dryRun) {
      const why = `the send threw before Slack confirmed it: ${cause instanceof Error ? cause.message : String(cause)}`;
      appendReleaseHold({ deps, home: drip.home, id: draft.id, reason: "slack-refused", why });
    }
    throw cause;
  }
}

/**
 * Hold a released row Slack refused, so the Queue card says why their yes did not go out (a
 * Slack token or permission is a legitimate reason not to send, and it is SURFACED, never swallowed). Only a
 * `failed` message counts — Slack's own refusal at the transport; an unconfirmed reservation or an already-sent
 * message is not Slack refusing, and a session names it with `slack draft hold`. The pre-send re-read's refusal is held
 * by `./releaseRefusalHold.ts`'s `holdFreshnessRefusal`. A run that landed a message holds nothing; a dry run attempted
 * nothing. A hold that cannot be written is said loudly and changes no exit code: the send's own failure is what the
 * caller acts on.
 *
 * @param draft the row the release named
 * @param options the drip options, naming the home and whether it was a dry run
 * @param outcomes every message's fate, when the send ran
 */
export function holdRefusedRelease({
  deps,
  draft,
  options,
  outcomes,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draft: Pick<ParkedSlackDraft, "id">;
  options: Pick<SlackDripOptions, "dryRun" | "home">;
  outcomes: readonly DripOutcome[] | undefined;
}): void {
  // Only a message THIS run sent stands down the hold: one an earlier run confirmed is not this release landing.
  if (options.dryRun || outcomes === undefined || outcomes.some((outcome) => outcome.state === "sent")) {
    return;
  }
  const failed = outcomes.find((outcome) => outcome.state === "failed");
  if (failed?.state !== "failed") {
    return;
  }
  appendReleaseHold({
    deps,
    home: options.home,
    id: draft.id,
    reason: "slack-refused",
    why: `Slack refused the send: ${failed.error}`,
  });
}

/**
 * Hold a release that could not reach Slack at all — no token, or one of the wrong kind — when the row it names is
 * still held: the same `slack-refused` reason, since a token or a permission is exactly the case they named.
 *
 * @param options the parsed release, naming the row, the home and whether it was a dry run
 * @param target the held row's channel and thread, `undefined` when the row is not held — then nothing is recorded
 * @param why what the token resolution said
 */
export function holdTokenlessRelease({
  deps,
  options,
  target,
  why,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  options: SlackDraftReleaseOptions;
  target: HeldReleaseTarget | undefined;
  why: string;
}): void {
  if (options.dryRun || target === undefined) {
    return;
  }
  appendReleaseHold({
    deps,
    home: options.home,
    id: options.release.draftId,
    reason: "slack-refused",
    why: `no Slack token the send could go out under: ${why}`,
  });
}
