/**
 * `slack draft record --as bot` — park a `--as bot` card for their approval, the way a finding shared at the top
 * level of a channel is recorded (_"if we are sharing some random finding at the top level in
 * some channel after i approved the queue card, post as the bot instead of as-me"_).
 *
 * The card is admitted, resolved and rendered by the SAME functions a `slack post --as bot` send runs, marked
 * `approvedDraft` so a finding may name a team channel, and its `--media` is admitted, counted against the finding
 * screenshot floor and stored as bytes before anything parks. What is parked is the rendered payload, which the
 * console draws and the digest binds under the bot's own `auth.test` id.
 *
 * **What a recording cannot run is left to the release, and the release runs all of it**: the exact voice rules,
 * the wall and the render proof read or write the live send, and `slack post --as bot --draft` asks them through
 * the ordinary card lane (`./cardWriteRun.ts`). Nothing here can post — every call is a read, under the bot token.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { FINDING_KIND } from "../../../outbound/artifact/finding.js";
import type { SlackBotArtifact } from "../../../outbound/artifact/types.js";
import { prLedRefusalsFor } from "../../../outbound/slack/draftPrLead.js";
import type { ParkedDraftKind, ParkedPriorAsk, ParkedSlackDraftMedia } from "../../../outbound/slack/draftRegister.js";
import { formCountsImpact } from "../../../outbound/slack/findingProof.js";
import { askingWordsOfBot } from "../../../outbound/slack/priorAsk.js";
import type { ParkedDraftReceipts } from "../../../outbound/slack/receiptsLine.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import { renderedCard } from "./cardWriteRun.js";
import { openingUndeclaredRefusals } from "./channelOpeningDeclared.js";
import { type SlackCardOptions, STDIN_SENTINEL } from "./coreTypes.js";
import { approvalAfterRefusals } from "./draftApprovalResolve.js";
import { composeParkedDraft } from "./draftCompose.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { admitAndStoreBotDraftMedia, NOTHING_PARKED } from "./draftMedia.js";
import { parkAndReport } from "./draftPark.js";
import { priorAskOfRecording } from "./draftPriorAsk.js";
import { recordingDestination, recordingProof } from "./draftRecordProof.js";
import { recordingReceipts } from "./draftRecordReceipts.js";
import { registerRefusals } from "./draftRecordRegister.js";
import { draftUsageExit, type RecordedThread, threadParentOf } from "./draftRecordRun.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { settledChaseHold } from "./draftSettledChase.js";
import { problemUndeclaredRefusals } from "./problemDeclared.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/**
 * The card options a bot recording admits and renders under — exactly the ones its release will send with, so the
 * two cannot disagree about the channel, the placement or the approved-share hold.
 *
 * @param formJson the form text, already read from stdin where the sentinel asked for it
 * @param options the parsed record
 * @returns the options the card lane's admission and render run against
 */
export function botRecordCardOptions({
  formJson,
  options,
}: {
  formJson: string;
  options: DraftRecordOptions;
}): SlackCardOptions {
  const { threadTs } = options;
  return {
    actor: "bot",
    allowUnresolvedOwner: false,
    approvedDraft: true,
    channel: options.channel,
    dryRun: true,
    formJson,
    home: options.home,
    json: options.json,
    media: options.media,
    resendUnconfirmed: false,
    verb: threadTs === undefined ? "post" : "reply",
    ...(threadTs === undefined ? {} : { threadTs }),
  };
}

/**
 * Why the bot cannot carry a card into a conversation it is not in — the one read-backed refusal a bot recording
 * adds, so a draft they approve is never one whose release Slack would refuse. Asked of every conversation but a
 * public channel, which the bot posts into without joining (`chat:write.public`).
 *
 * The invite names the first handle the install's profile declares for its bot (`slackBot.selfHandles`); with none
 * declared it says so, rather than a placeholder passing for a command they could paste.
 *
 * @param channel the conversation the recording named
 * @param botHandles the handles the install's profile declares for its own bot
 * @returns the refusal lines
 */
export function botNotInChannelLines({
  channel,
  botHandles,
}: {
  channel: string;
  botHandles: readonly string[];
}): readonly string[] {
  const declared = botHandles.find((one) => one.trim() !== "");
  let who = "the bot";
  let invite =
    "Invite it to that channel (profile.json declares no slackBot.selfHandles, so its handle is not named here)";
  if (declared !== undefined) {
    who = declared.trim().replace(/^@/u, "");
    invite = `Invite it (\`/invite @${who}\` in that channel)`;
  }
  return [
    `${who} is not in ${channel}, which is not a public channel, so a --as bot draft there could never be ` +
      `released. ${invite} and record again. A private channel the bot is not in is the one place a finding may go ` +
      "out as them: record it without --as bot and the recorder reads that same membership and says so on the row.",
    NOTHING_PARKED,
  ];
}

/**
 * Where the card would land: the conversation, refused when it is private and the bot is not in it, and the thread
 * root a reply parks under.
 *
 * @returns the conversation and the thread read, or the refusal lines
 */
async function botWhere({
  deps,
  options,
  token,
}: {
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
  token: string;
}): Promise<
  Result<{
    info: Awaited<ReturnType<SlackDraftDeps["conversationInfo"]>>;
    threadParent: RecordedThread | undefined;
  }>
> {
  const info = await deps.conversationInfo({ channel: options.channel, token });
  const membership = await deps.botMembership({ channel: options.channel, token });
  if (info.surface !== "public-channel" && membership === "not-member") {
    const botHandles = botSelfHandlesFromProfile({ home: options.home, reader: "slack draft record --as bot" });
    return err(botNotInChannelLines({ botHandles, channel: options.channel }));
  }
  const threadParent = await threadParentOf({ deps, options, token });
  if (threadParent.isErr()) {
    return err([threadParent.error.message, NOTHING_PARKED]);
  }
  return ok({ info, threadParent: threadParent.value });
}

/**
 * Who the token is, the re-ask hold, then the card's stored media. Owner rule: a finding asking "is this
 * expected?" is the ruling's own example of a re-ask, so the bot lane holds exactly as the as-me lane does.
 *
 * @param admitted the card as admitted, whose words are read for a question
 * @param payload the rendered card, which a first message's link is read off
 * @returns who `auth.test` named for the token (an earlier ask must be by them), the judged declaration and the stored
 *   media, or the refusal lines
 */
async function botParkInputs({
  admitted,
  deps,
  options,
  payload,
  token,
}: {
  admitted: { artifact: SlackBotArtifact; formKind: string };
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
  payload: unknown;
  token: string;
}): Promise<
  Result<{
    media: readonly ParkedSlackDraftMedia[];
    priorAsk: ParkedPriorAsk | undefined;
    self: Awaited<ReturnType<SlackDraftDeps["whoAmI"]>>;
  }>
> {
  const self = await deps.whoAmI({ token });
  const priorAsk = await priorAskOfRecording({
    asked: askingWordsOfBot({ artifact: admitted.artifact }),
    declared: options.askedBefore,
    deps,
    home: options.home,
    readSelfUserId: async () => self.userId,
    token,
  });
  if (priorAsk.isErr()) {
    return err(priorAsk.error);
  }
  const media = await admitAndStoreBotDraftMedia({
    admitted,
    deps,
    destination: recordingDestination({ groupDm: undefined, options, payload }),
    options,
  });
  if (media.isErr()) {
    return err(media.error);
  }
  return ok({ media: media.value, priorAsk: priorAsk.value, self });
}

/**
 * The card's problem and opening declarations and a first block that leads with a pull request
 * (`../../../outbound/slack/draftPrLead.ts`), then its receipts and, for a row raising a finding, its proof
 * (`./draftRecordProof.ts`): all judged off the rendered card, before any Slack read. No destination is exempt from the pull-request lead: a bot card for their bot DM is already held by
 * `renderedCard`'s DM-purpose check, which a recording has no flag to answer, so no own-DM proof is read here.
 *
 * @param admitted the card as admitted, whose problem and opening declarations are checked
 * @param formJson the form as recorded, whose `problem` declaration says whether the row raises a finding
 * @param payload the rendered message, which the receipt links are read off
 * @returns the receipts the row parks with, or the refusal lines
 */
function botCardReceipts({
  admitted,
  deps,
  formJson,
  options,
  payload,
}: {
  admitted: { artifact: SlackBotArtifact; formKind: string };
  deps: SlackDraftDeps;
  formJson: string;
  options: DraftRecordOptions;
  payload: unknown;
}): Result<ParkedDraftReceipts | undefined> {
  const { artifact, formKind } = admitted;
  const undeclared = [
    ...problemUndeclaredRefusals({ artifact, formKind }),
    ...openingUndeclaredRefusals({ artifact, channel: options.channel, formKind, threadTs: options.threadTs }),
    ...prLedRefusalsFor({ channel: options.channel, payload, verifiedOwnDm: undefined }),
  ];
  if (undeclared.length > 0) {
    // Each refusal closes on the same nothing-parked line; say it once, after every reason.
    return err([...undeclared.filter((line) => line !== NOTHING_PARKED), NOTHING_PARKED]);
  }
  return recordingReceipts({ deps, options, payload }).andThen((receipts) =>
    recordingProof({
      form: formJson,
      groupDm: undefined,
      impactInForm: formCountsImpact({ form: formJson }),
      kind: botRowKind({ formKind, options }),
      options,
      payload,
    }).map(() => receipts),
  );
}

/**
 * The kind a bot row stores: a `finding` form is a finding whatever `--kind` said, else what `--kind` declared. One
 * helper, so the finding proof bar and the stored row can never disagree about what the row is.
 *
 * @param formKind the bot form kind that produced the card
 * @param options the parsed record, whose `--kind` is read
 * @returns the row's kind, absent when neither says
 */
function botRowKind({
  formKind,
  options,
}: {
  formKind: string;
  options: DraftRecordOptions;
}): ParkedDraftKind | undefined {
  return formKind === FINDING_KIND ? "finding" : options.kind;
}

/**
 * `slack draft record --as bot` — admit and render the card as its release would, check the bot can post there,
 * store its media, and park it. The register is checked FIRST, as the as-me recording does: a re-cut naming a spent
 * row, or a second card for one thread, parks nothing and costs no Slack read.
 *
 * @param deps the injected world, carrying no send edge
 * @param options the parsed invocation
 * @returns the process exit code
 */
export async function runDraftRecordBot({
  deps,
  options,
}: {
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
}): Promise<number> {
  const approval = approvalAfterRefusals({ deps, options, refusals: registerRefusals({ deps, options }) });
  if (approval.isErr()) {
    return draftUsageExit({ errors: approval.error });
  }
  const { home } = options;
  const token = resolveSlackWriteToken({ actor: "bot", botToken: deps.botToken({ home }), userToken: undefined });
  if (token.isErr()) {
    return draftUsageExit({ errors: [token.error.message] });
  }
  const formJson = options.formSource === STDIN_SENTINEL ? await deps.readStdin() : options.formSource;
  const rendered = await renderedCard({ cardOptions: botRecordCardOptions({ formJson, options }), deps, formJson });
  if (rendered.isErr()) {
    return draftUsageExit({ errors: [...rendered.error, NOTHING_PARKED] });
  }
  const { admitted, mentions, plan } = rendered.value;
  const receipts = botCardReceipts({ admitted, deps, formJson, options, payload: plan.payload });
  if (receipts.isErr()) {
    return draftUsageExit({ errors: receipts.error });
  }
  const settled = await settledChaseHold({ deps, options, payload: plan.payload });
  if (settled.isErr()) {
    return draftUsageExit({ errors: settled.error });
  }
  const where = await botWhere({ deps, options, token: token.value });
  if (where.isErr()) {
    return draftUsageExit({ errors: where.error });
  }
  const inputs = await botParkInputs({ admitted, deps, options, payload: plan.payload, token: token.value });
  if (inputs.isErr()) {
    return draftUsageExit({ errors: inputs.error });
  }
  const draft = composeParkedDraft({
    advisory: [],
    authorId: inputs.value.self.userId,
    botCannotPost: undefined,
    channelName: where.value.info.name,
    form: formJson,
    groupDm: undefined, // never stamped: a bot card is judged before its conversation read, so it owes the proof
    id: deps.mintId(),
    kind: botRowKind({ formKind: admitted.formKind, options }),
    media: inputs.value.media,
    options,
    payload: plan.payload,
    priorAsk: inputs.value.priorAsk,
    readThrough: where.value.threadParent?.readThrough,
    receipts: receipts.value,
    resolution: mentions,
    threadParent: where.value.threadParent?.parent,
    tsIso: deps.nowIso(),
    workspaceUrl: inputs.value.self.workspaceUrl,
  });
  return parkAndReport({ approval: approval.value, deps, draft, options });
}
