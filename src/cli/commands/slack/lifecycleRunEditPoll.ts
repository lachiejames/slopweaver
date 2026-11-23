/**
 * `slack edit --as bot` over a POLL — re-render it in place from a `kind: "poll"` form, by the poll's own
 * renderer (`../../../outbound/slack/pollRender.ts`), never the card's.
 *
 * ## The ballot is frozen; the question and the reason are not
 *
 * A vote is a REACTION, and a reaction is bound to an emoji position, not to the words beside it. So an edit that
 * relabelled, reordered, added or dropped an option would silently re-point every vote already cast at an option
 * the voter never chose — and the tally (`slack poll results`) would report it as their choice. The edit is
 * therefore REFUSED unless the form's ballot is exactly the one the local record holds, whether or not anyone has
 * voted yet; a changed ballot is a new poll, posted with `slack poll` once this one is taken down with `slack
 * delete`. The question, the reason and the pings are free to move, and the record's question and reason follow.
 *
 * ## The poll id is INHERITED, never supplied
 *
 * The record is found by the `pollId` the message's own metadata carries, and must name this exact channel and
 * `ts`. A form-derived id would be a fresh digest of the new wording, pointing at no record at all.
 *
 * ## Its opening is judged, as the poll's post was
 *
 * A poll's question is what a teammate opens on, so the edit runs `prLedSendRefusals` over the re-rendered payload
 * exactly as `slack poll` gates its post, and the high-stakes target check before the dry-run branch.
 */
import { throughDoor } from "../../../admit/effects.js";
import type { VoiceGateInput } from "../../../admit/voiceProfileGate.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { prLedSendRefusals } from "../../../outbound/slack/draftPrLead.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import { type PollArtifact, type PollBallotEntry, pollBallot } from "../../../outbound/slack/pollForm.js";
import { renderPoll } from "../../../outbound/slack/pollRender.js";
import { type PollRecord, readPollRecord, revisePollRecord } from "../../../outbound/slack/pollStore.js";
import type { SlackPollPayload } from "../../../outbound/slack/types.js";
import { pollProse } from "../../../outbound/voice/artifactProse.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type EditCardOptions, lifecycleDoorRequest } from "./lifecycleCore.js";
import { type SlackEditTargetError, SlackEditTargetErrors } from "./lifecycleEditErrors.js";
import { cardEditTargetRefusals } from "./lifecycleEditTarget.js";
import { requireEditTarget } from "./lifecycleEventTypes.js";
import { editVoice, gatesFor, reportNotPerformed, usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";
import { resolvePollPings } from "./pollPings.js";
import { unreadableProfileExit } from "./voiceAdmission.js";

/**
 * The local record a poll edit may rewrite, or why there is none to trust.
 *
 * @param home the state home holding the poll store
 * @param pollId the id the message's own metadata carries
 * @param posted the message being edited, which the record must name
 * @returns the record, or the typed refusal
 */
export function editablePollRecord({
  home,
  pollId,
  posted,
}: {
  home: string;
  pollId: string;
  posted: PostedMessage;
}): Result<PollRecord, SlackEditTargetError> {
  const at = `${posted.channel}/${posted.ts}`;
  const read = readPollRecord({ home, pollId });
  if (read.kind === "unreadable") {
    return err(SlackEditTargetErrors.pollRecordUnusable({ at, pollId, why: `is unreadable (${read.reason})` }));
  }
  if (read.kind !== "found") {
    return err(SlackEditTargetErrors.pollRecordUnusable({ at, pollId, why: `is ${read.kind}` }));
  }
  if (read.record.channel !== posted.channel || read.record.ts !== posted.ts) {
    const names = `names ${read.record.channel}/${String(read.record.ts)}, not this message`;
    return err(SlackEditTargetErrors.pollRecordUnusable({ at, pollId, why: names }));
  }
  return ok(read.record);
}

/**
 * Whether this form's ballot is exactly the recorded one: same labels, same emoji, same order, same count.
 *
 * @param ballot the ballot the form would render, its escape hatch included
 * @param record the record whose ballot every cast vote is bound to
 * @returns the typed refusal, or `undefined` when the two are identical
 */
export function ballotChangeRefusal({
  ballot,
  record,
}: {
  ballot: readonly PollBallotEntry[];
  record: PollRecord;
}): SlackEditTargetError | undefined {
  const same =
    ballot.length === record.options.length &&
    ballot.length === record.emojiNames.length &&
    ballot.every(
      (entry, index) => entry.label === record.options[index] && entry.emojiName === record.emojiNames[index],
    );
  return same ? undefined : SlackEditTargetErrors.pollBallotChanged({ recorded: record.options });
}

/**
 * Re-render a poll in place from a validated `kind: "poll"` form.
 *
 * @param form the validated poll form
 * @param options the parsed invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runEditPoll({
  form,
  options,
  deps,
}: {
  form: PollArtifact;
  options: EditCardOptions;
  deps: LifecycleDeps;
}): Promise<number> {
  const { home } = options;
  const token = deps.botToken({ home });
  if (token === undefined) {
    return usage({ errors: ["slack edit needs a Slack bot token: run `slopweaver secrets set slack-bot-token`"] });
  }
  const voice = editVoice({ deps, home, prose: pollProse({ artifact: form }) });
  if (voice.isErr()) {
    return unreadableProfileExit({ error: voice.error, nothingHappened: "nothing was changed." });
  }
  const transport = deps.makeTransport({ home, token });
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const target = await requireEditTarget({ deps, formKind: "poll", home, posted, transport });
  if ("exit" in target) {
    return target.exit;
  }
  const existing = target.message;
  const planned = await plannedPollEdit({ deps, existing, form, options, token, transport });
  if (planned.isErr()) {
    return usage({ errors: planned.error });
  }
  const { payload, pollId, record } = planned.value;
  if (options.dryRun) {
    deps.out(`dry run — nothing was changed. would chat.update ${options.channel}/${options.ts} as a POLL`);
    const size = pollBallot({ options: form.options }).length;
    deps.out(`  ballot unchanged (${String(size)} options), poll id inherited: ${pollId}`);
    return EXIT_OK;
  }
  return performPollEdit({
    deps,
    existing,
    form,
    home,
    options,
    payload,
    pollId,
    posted,
    record,
    transport,
    voice: voice.value,
  });
}

/**
 * Put the re-rendered poll through the door, record first, and report what happened.
 *
 * Split out of {@link runEditPoll} under the line cap, on the seam the card path already has: the caller decides
 * WHETHER this edit may happen, and this performs it.
 *
 * @param payload the re-rendered poll
 * @param existing the read-back, for the file ids an edit must re-send
 * @param home the state home captured once at entry, so the record moves where it was checked
 * @param record the record as it stood, which a failed Slack update puts back
 * @param voice the voice input the door judges, read before any Slack call was made
 * @returns the process exit code
 */
async function performPollEdit({
  deps,
  existing,
  form,
  home,
  options,
  payload,
  pollId,
  posted,
  record,
  transport,
  voice,
}: {
  deps: LifecycleDeps;
  existing: ReadSlackMessage;
  home: string;
  form: PollArtifact;
  options: EditCardOptions;
  payload: SlackPollPayload;
  pollId: string;
  posted: PostedMessage;
  record: PollRecord;
  transport: SlackWriteTransport;
  voice: VoiceGateInput;
}): Promise<number> {
  const routed = await throughDoor({
    gates: gatesFor({ voice }),
    ledger: deps.doorLedger,
    // The record moves FIRST, so a record that cannot be written stops the edit before Slack is touched, and a
    // Slack update that throws puts the record back: the message and its record never disagree on a single fault.
    perform: async (): Promise<{ readonly recordUnwritable: string | undefined }> => {
      const revised = revisePollRecord({ home, pollId, question: form.question, why: form.why });
      if (revised.kind === "failed") {
        return { recordUnwritable: revised.reason };
      }
      try {
        await transport.updateCard({ fileIds: existing.fileIds, payload, posted });
      } catch (cause) {
        restorePollRecord({ deps, home, pollId, record });
        throw cause;
      }
      return { recordUnwritable: undefined };
    },
    request: lifecycleDoorRequest({ blockCount: payload.attachments[0].blocks.length, options, targetTs: options.ts }),
  });
  if (!routed.performed) {
    return reportNotPerformed({ through: routed });
  }
  if (routed.result.recordUnwritable !== undefined) {
    deps.out(
      `not edited — the poll record ${pollId} could not be updated (${routed.result.recordUnwritable}), so the ` +
        "message was left alone rather than made to disagree with it. Nothing was changed.",
    );
    return EXIT_ERROR;
  }
  deps.out(`edited — channel=${options.channel} ts=${options.ts} as a poll`);
  return EXIT_OK;
}

/**
 * Put the record's question and reason back after the Slack update threw, and say what is NOT known: a rejection
 * does not prove Slack did not apply it (a response lost after the server committed reads the same), so the
 * message may show the new question while the record holds the old. Re-running the same edit settles both.
 */
function restorePollRecord({
  deps,
  home,
  pollId,
  record,
}: {
  deps: LifecycleDeps;
  home: string;
  pollId: string;
  record: PollRecord;
}): void {
  const restored = revisePollRecord({ home, pollId, question: record.question, why: record.why });
  if (restored.kind === "failed") {
    deps.out(
      `the Slack update failed, and the poll record ${pollId} could not be put back (${restored.reason}): it ` +
        `carries the new question, and whether the message does is unknown. Re-run this same edit to settle both.`,
    );
    return;
  }
  deps.out(
    `the Slack update failed, so the poll record ${pollId} was put back to the old question; if Slack applied the ` +
      `update anyway, the message and its record now disagree. Re-run this same edit to settle both.`,
  );
}

/**
 * Every check a poll edit owes before the dry-run branch, then the payload it would send: the inherited id, the
 * record, the frozen ballot, the high-stakes target, the pings, the surface the footer describes, and the opening.
 */
async function plannedPollEdit({
  deps,
  existing,
  form,
  options,
  token,
  transport,
}: {
  deps: LifecycleDeps;
  existing: ReadSlackMessage;
  form: PollArtifact;
  options: EditCardOptions;
  token: string;
  transport: SlackWriteTransport;
}): Promise<Result<{ payload: SlackPollPayload; pollId: string; record: PollRecord }>> {
  const { channel, home } = options;
  const frozen = frozenPollRecord({ existing, form, options });
  if (frozen.isErr()) {
    return err([frozen.error.message]);
  }
  const { ballot, pollId, record } = frozen.value;
  const targetRefusals = cardEditTargetRefusals({ deps, existing, formKind: "poll", options });
  if (targetRefusals.length > 0) {
    return err(targetRefusals);
  }
  const pings = await resolvePollPings({
    artifact: form,
    deps: { resolvePeople: deps.resolvePollPeople, userGroupIds: async () => transport.userGroupIds() },
    home,
    token,
  });
  if ("errors" in pings) {
    return err(pings.errors);
  }
  // Read live, as `slack poll` reads it: the footer states who can see a vote, and a guess here is a false claim.
  const { surface } = await transport.conversationInfo({ channel });
  if (surface === undefined) {
    return err([SlackEditTargetErrors.pollSurfaceUnknown({ channel }).message]);
  }
  const payload = renderPoll({
    artifact: form,
    ballot,
    chrome: deps.cardChrome({ home }),
    // The message's own type, so a poll posted under a since-renamed profile type keeps the type it was posted with.
    metadataEventType: existing.metadataEventType!,
    pings: pings.tokens,
    pollId,
    surface: surface === "direct-message" ? "direct-message" : "shared-channel",
  });
  const prLed = prLedSendRefusals({ channel, payload, verifiedOwnDm: await deps.verifiedOwnDm({ channel, home }) });
  return prLed.length > 0 ? err(prLed) : ok({ payload, pollId, record });
}

/**
 * The inherited poll id, the record it names and the form's ballot, once that ballot is proven the recorded one.
 */
function frozenPollRecord({
  existing,
  form,
  options,
}: {
  existing: ReadSlackMessage;
  form: PollArtifact;
  options: EditCardOptions;
}): Result<{ ballot: readonly PollBallotEntry[]; pollId: string; record: PollRecord }, SlackEditTargetError> {
  const { channel, home, ts } = options;
  const { pollId } = existing;
  if (pollId === undefined) {
    return err(SlackEditTargetErrors.inheritedIdMissing({ at: `${channel}/${ts}`, field: "pollId", owner: "poll" }));
  }
  const record = editablePollRecord({ home, pollId, posted: { channel, ts } });
  if (record.isErr()) {
    return err(record.error);
  }
  const ballot = pollBallot({ options: form.options });
  const changed = ballotChangeRefusal({ ballot, record: record.value });
  return changed === undefined ? ok({ ballot, pollId, record: record.value }) : err(changed);
}
