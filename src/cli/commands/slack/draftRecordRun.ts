/**
 * `slack draft record` — the effectful half that composes as them and parks, split out of `./draftRun.ts`
 * along the verb's one write seam: every other sub-command only reads or resolves a row.
 *
 * ## One Slack call for two answers
 *
 * The public-channel gate needs the conversation's SURFACE and the console needs its NAME, and both come
 * off one `conversations.info` response (`../../../corpus/slack/writeApiPoll.ts`'s `conversationInfoCall`).
 * So the info read is memoised (`./draftRecordReads.ts`) and `conversationSurface` is wired to it: the gate asking and the
 * recorder asking cost one call between them, and a recorder that skipped the gate would still be paying
 * for the read it needs anyway.
 *
 * The recording's two pure edges, `parkableMessage` and `composeRecorded`, live in `./draftRecordMessage.ts` and are
 * exported from there only; this module imports both, and that one imports the `RecordedInputs` type back from here.
 */
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { botDmWitnessRefusal, isBotDm } from "../../../outbound/slack/botDmWitness.js";
import type { SlackDraftError } from "../../../outbound/slack/draftErrors.js";
import { prLedRefusalsFor } from "../../../outbound/slack/draftPrLead.js";
import type {
  ParkedPriorAsk,
  ParkedReadThrough,
  ParkedSlackDraft,
  ParkedSlackDraftMedia,
  ParkedThreadParent,
} from "../../../outbound/slack/draftRegister.js";
import { askingWords } from "../../../outbound/slack/priorAsk.js";
import type { ParkedDraftReceipts } from "../../../outbound/slack/receiptsLine.js";
import { readThroughOf } from "../../../outbound/slack/releaseFreshness.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { openingDeclaredMessage } from "./channelOpeningDeclared.js";
import { approvalAfterRefusals, type RecordingApproval } from "./draftApprovalResolve.js";
import { compareRecorded, draftComposerOf } from "./draftCompareRun.js";
import { recordDripOptions, threadParentFrom } from "./draftCompose.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { admitAndStoreDraftMedia, NOTHING_PARKED } from "./draftMedia.js";
import { parkAndReport } from "./draftPark.js";
import { priorAskOfRecording } from "./draftPriorAsk.js";
import { whoItReachesHolds } from "./draftRecordHolds.js";
import { composeRecorded, earnedMessage, parkableMessage, recordableVoice } from "./draftRecordMessage.js";
import { firstMessageGroupDm, readRecordingDestination, recordingProof } from "./draftRecordProof.js";
import { type ConversationAnswer, conversationInfoOnce, type SelfIdentity, whoAmIOnce } from "./draftRecordReads.js";
import { recordingReceipts } from "./draftRecordReceipts.js";
import { registerRefusals } from "./draftRecordRegister.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { untaggedNameHold } from "./draftUntaggedNames.js";
import { prepareDrip } from "./prepareDrip.js";
import { problemDeclaredMessage } from "./problemDeclared.js";
import { SLACK_DRAFT_USAGE } from "./slackUsage.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/**
 * Print every rejection, then the usage, and exit as a caller mistake.
 *
 * @returns the usage exit code
 */
export function draftUsageExit({ errors }: { errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  logger.error({ msg: SLACK_DRAFT_USAGE });
  return EXIT_USAGE;
}

/**
 * The refusals that cost no Slack read, checked FIRST: the register's (`./draftRecordRegister.ts`), and a top-level
 * post as them in their bot DM, which is their by construction (`../../../outbound/slack/botDmWitness.ts`). A reply
 * there waits for its root's author, so with no root author given the hold passes it here.
 *
 * @param deps the injected world, for the register read and `slackBot.promptChannel`
 * @param options the parsed record
 * @returns the refusal lines, or nothing when the recording may go on to read Slack
 */
function beforeAnyRead({ deps, options }: { deps: SlackDraftDeps; options: DraftRecordOptions }): readonly string[] {
  const register = registerRefusals({ deps, options });
  if (register.length > 0) {
    return register;
  }
  const { channel, home, threadTs } = options;
  const promptChannel = deps.promptChannel({ home });
  const topLevel = botDmWitnessRefusal({
    channel,
    promptChannel,
    rootUserId: undefined,
    selfUserId: undefined,
    threadTs,
  });
  if (topLevel.length > 0) {
    return [...topLevel, NOTHING_PARKED];
  }
  return [];
}

/** Whether the journalled `earns-its-place` hatch is open for this record: a grant, or the ambient variable. */
function earnsItsPlaceHatchOpen({ deps, options }: { deps: SlackDraftDeps; options: DraftRecordOptions }): boolean {
  return hatchOpen({
    env: deps.doorEnv(),
    home: options.home,
    id: "earns-its-place",
    nowIso: deps.nowIso(),
  });
}

/**
 * The three things a form must declare before it parks: the problem it raises (`./problemDeclared.ts`), for a
 * top-level channel post what it is and what it asks of the reader (`./channelOpeningDeclared.ts`), and, bound for a
 * teammate, an opening on the discussion rather than a pull request (`../../../outbound/slack/draftPrLead.ts`).
 *
 * @param message the earned message whose rendered form is checked
 * @param options the parsed record, for where the post lands
 * @param verifiedOwnDm their bot DM's id once a read proved it their, where no teammate reads the opening
 * @returns the message unchanged, or the refusal lines of the first missing declaration
 */
function declaredMessage<
  T extends { readonly payload: unknown; readonly prepared: { readonly plan: { readonly artifact: AsMeArtifact } } },
>({
  message,
  options,
  verifiedOwnDm,
}: {
  message: T;
  options: DraftRecordOptions;
  verifiedOwnDm: string | undefined;
}): Result<T> {
  const { channel, threadTs } = options;
  return problemDeclaredMessage({ message })
    .andThen((value) => openingDeclaredMessage({ channel, message: value, threadTs }))
    .andThen((value) => {
      const prLed = prLedRefusalsFor({ channel, payload: value.payload, verifiedOwnDm });
      return prLed.length === 0 ? ok(value) : err([...prLed, NOTHING_PARKED]);
    });
}

/**
 * Judge the composed message the way a send would: its voice, whether it can park, whether it earns its place, and
 * what it declares. The own-DM proof is read only once the message composed, and only the configured prompt channel
 * pays the call.
 *
 * @param deps the injected world
 * @param options the parsed invocation
 * @param prepared the composed drip, or why it did not compose
 * @returns the message that may park, or every reason it may not
 */
async function judgedMessage({
  deps,
  options,
  prepared,
}: {
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
  prepared: Awaited<ReturnType<typeof prepareDrip>>;
}) {
  const verifiedOwnDm = prepared.isOk()
    ? await deps.verifiedOwnDm({ channel: options.channel, home: options.home })
    : undefined;
  return prepared
    .andThen((value) => recordableVoice({ actor: options.actor, prepared: value }))
    .andThen((value) => parkableMessage({ prepared: value }))
    .andThen((value) => earnedMessage({ hatchIsOpen: earnsItsPlaceHatchOpen({ deps, options }), message: value }))
    .andThen((value) => declaredMessage({ message: value, options, verifiedOwnDm }));
}

/**
 * `slack draft record` — compose as them, check everything a recorder can, and park it. `auth.test` comes AFTER
 * the plan, so a form that was never going to park does not cost the call. The receipts are judged off the rendered
 * message, before the identity check and the conversation read (a card that makes a claim brings
 * its receipts, or says why none is needed, or what it tried), and a row raising a finding then owes its file, link and
 * impact in people. Reached only through `./draftRecordEntry.ts`,
 * which refuses a session never shown the owner's voice brief.
 *
 * @param deps the injected world, carrying no send edge
 * @param options the parsed invocation
 * @returns the process exit code
 */
export async function recordBriefedDraft({
  deps,
  options,
}: {
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
}): Promise<number> {
  const approval = approvalAfterRefusals({ deps, options, refusals: beforeAnyRead({ deps, options }) });
  if (approval.isErr()) {
    return draftUsageExit({ errors: approval.error });
  }
  const token = resolveSlackWriteToken({ actor: "me", botToken: undefined, userToken: deps.userToken(options) });
  if (token.isErr()) {
    return draftUsageExit({ errors: [token.error.message] });
  }
  const config = deps.dripConfig({ home: options.home });
  if (config.isErr()) {
    return unreadableProfileExit({ error: config.error, nothingHappened: "nothing was parked." });
  }
  const readInfo = conversationInfoOnce({ channel: options.channel, deps, token: token.value });
  const prepared = await prepareDrip({
    config: config.value,
    deps: { ...deps, conversationSurface: async () => (await readInfo()).surface },
    env: deps.doorEnv(),
    options: recordDripOptions({ options }),
    token: token.value,
  });
  const message = await judgedMessage({ deps, options, prepared });
  if (message.isErr()) {
    return draftUsageExit({ errors: message.error });
  }
  const { form, payload } = message.value;
  // A first channel message reads the conversation once, memoised, to learn whether a group DM spares it the bar.
  const groupDm = await firstMessageGroupDm({ options, payload, readInfo });
  const receipts = recordingReceipts({ deps, options, payload }).andThen((value) =>
    recordingProof({ form, groupDm, impactInForm: false, kind: options.kind, options, payload }).map(() => value),
  );
  if (receipts.isErr()) {
    return draftUsageExit({ errors: receipts.error });
  }
  const identity = await whoItReachesHolds({ deps, options, payload, readInfo, token: token.value });
  if (identity.isErr()) {
    return draftUsageExit({ errors: identity.error });
  }
  const readSelf = whoAmIOnce({ deps, token: token.value });
  const inputs = await parkInputs({ deps, message: message.value, options, readInfo, readSelf, token: token.value });
  if (inputs.isErr()) {
    return draftUsageExit({ errors: inputs.error });
  }
  const draft = await composeRecorded({
    botCannotPost: identity.value,
    deps,
    inputs: { ...inputs.value, receipts: receipts.value },
    message: message.value,
    options,
    readInfo,
    readSelf,
  });
  return parkThenCompare({ approval: approval.value, deps, draft, inputs: inputs.value, options, token: token.value });
}

/**
 * Park the composed row, stamped with the host that composed it, then put Codex's draft beside it when the park left
 * it waiting on one (`./draftCompareRun.ts`). The comparison never changes the exit: the original parked either way.
 *
 * @param approval their yes the row carries, as resolved before the Slack reads
 * @param deps the injected world
 * @param draft the composed row
 * @param inputs what the recording read, whose conversation rows brief the pass
 * @param options the parsed record
 * @param token their user token
 * @returns the park's exit code
 */
async function parkThenCompare({
  approval,
  deps,
  draft,
  inputs,
  options,
  token,
}: {
  approval: RecordingApproval;
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  inputs: RecordedInputs;
  options: DraftRecordOptions;
  token: string;
}): Promise<number> {
  const { home, reviewer } = options;
  const parked = {
    ...draft,
    composer: draftComposerOf({ env: deps.doorEnv() }),
    ...(reviewer === undefined ? {} : { reviewer }),
  };
  const code = parkAndReport({ approval, deps, draft: parked, options });
  if (code !== EXIT_OK) {
    return code;
  }
  const rows = inputs.thread === undefined ? [] : inputs.thread.rows;
  await compareRecorded({ deps, home, id: parked.id, rows, token });
  return code;
}

/** What a recording read of where the row lands keeps: the root a reply parks under, and how far it read. */
export interface RecordedThread {
  /** The root a reply parks under; absent for a top-level row. */
  readonly parent: ParkedThreadParent | undefined;
  readonly readThrough: ParkedReadThrough | undefined;
  /** The raw messages read, which a Codex draft beside the row is briefed with (`./draftCompareRun.ts`). */
  readonly rows: readonly unknown[];
}

/** What a recording read or stored before the row parks. */
export interface RecordedInputs {
  readonly media: readonly ParkedSlackDraftMedia[];
  readonly thread: RecordedThread | undefined;
  /** The re-ask declaration, as `./draftPriorAsk.ts` judged it; absent for a draft that asks nothing. */
  readonly priorAsk: ParkedPriorAsk | undefined;
  /** What the card brings for its claim (`./draftRecordReceipts.ts`), judged off the rendered message. */
  readonly receipts?: ParkedDraftReceipts | undefined;
}

/**
 * How many of a channel's newest top-level messages a top-level row snapshots — the tail it was written against,
 * so a release can see one of them edited or removed, not only something new below it.
 */
const TOP_LEVEL_SNAPSHOT_ROWS = 20;

/** A destination that is a person rather than a conversation: there is nothing to read until it is opened. */
const MEMBER_DESTINATION = /^[UW][A-Z0-9]+$/;

/**
 * Where the row lands, read live, so a release can see what a person added, edited or removed since
 * (`../../../outbound/slack/releaseFreshness.ts`): a reply's whole thread, which also proves the root it parks
 * under, or a top-level row's channel tail ({@link TOP_LEVEL_SNAPSHOT_ROWS}). A row addressed to a PERSON reads
 * nothing — no DM is opened before the words are approved, exactly as `slack draft context` refuses one — so its
 * release, which reads the DM from the recording instant, sees additions only, a newer tombstone included.
 *
 * @param deps the injected world, for the thread and channel reads
 * @param options the parsed record
 * @param token the token the read goes out under — their for an as-me row, the bot's for a `--as bot` one
 * @returns the root and the read-through, nothing for a person, or why the place cannot be read
 */
export async function threadParentOf({
  deps,
  options,
  token,
}: {
  deps: SlackDraftDeps;
  options: DraftRecordOptions;
  token: string;
}): Promise<Result<RecordedThread | undefined, SlackDraftError>> {
  const { channel, threadTs } = options;
  if (threadTs === undefined) {
    if (MEMBER_DESTINATION.test(channel)) {
      return ok(undefined);
    }
    const tail = await deps.readConversation({
      channel,
      limit: TOP_LEVEL_SNAPSHOT_ROWS,
      threadTs: undefined,
      through: undefined,
      token,
    });
    return tail.map((read) => ({
      parent: undefined,
      readThrough: readThroughOf({ rawMessages: read.rows }),
      rows: read.rows,
    }));
  }
  const read = await deps.threadReplies({ channel, threadTs, token });
  return read.andThen((messages) =>
    threadParentFrom({ channel, messages, threadTs }).map((parent) => ({
      parent,
      readThrough: readThroughOf({ rawMessages: messages }),
      rows: messages,
    })),
  );
}

/**
 * The three things a row carries that are read or written before it parks: its re-ask declaration, the thread
 * root it replies under, and its admitted media. A message naming a colleague it does not tag refuses before any
 * (`./draftUntaggedNames.ts`), and a re-ask refuses before the thread read (`./draftPriorAsk.ts`). The root is read first and the media stored after, so a refused thread stores no
 * bytes and a refused file — or a message the queue card could not draw as Slack will — parks nothing. A reply
 * as them under their own message in their bot DM refuses between the two (`../../../outbound/slack/botDmWitness.ts`).
 *
 * @param deps the injected world, for member bronze, the thread read and the media store
 * @param message the one message the draft would post, which the untagged-name and fidelity checks read
 * @param options the parsed record
 * @param readInfo `conversations.info`, memoised — for an untagged name, and whether a group DM spares the first-message bar
 * @param readSelf `auth.test`, memoised — asked for a reply in their bot DM, or an untagged name
 * @param token the user token the thread and earlier-ask reads go out under
 * @returns the root (nothing for a top-level record), the stored media and the re-ask declaration, or why the row
 *   cannot park
 */
async function parkInputs({
  deps,
  message,
  options,
  readInfo,
  readSelf,
  token,
}: {
  deps: SlackDraftDeps;
  message: Parameters<typeof untaggedNameHold>[0]["message"];
  options: DraftRecordOptions;
  readInfo: () => Promise<ConversationAnswer>;
  readSelf: () => Promise<SelfIdentity>;
  token: string;
}): Promise<Result<RecordedInputs>> {
  const { artifact } = message.prepared.plan;
  const untagged = await untaggedNameHold({ deps, home: options.home, message, readInfo, readSelf });
  if (untagged.length > 0) {
    return err(untagged);
  }
  // Owner rule: a question the team already answered is not asked again with nothing shown.
  const priorAsk = await priorAskOfRecording({
    asked: askingWords({ artifact }),
    declared: options.askedBefore,
    deps,
    home: options.home,
    readSelfUserId: async () => (await readSelf()).userId,
    token,
  });
  if (priorAsk.isErr()) {
    return err(priorAsk.error);
  }
  const threadParent = await threadParentOf({ deps, options, token });
  if (threadParent.isErr()) {
    return err([threadParent.error.message]);
  }
  const promptChannel = deps.promptChannel({ home: options.home });
  const parent = threadParent.value?.parent;
  if (parent !== undefined && isBotDm({ channel: options.channel, promptChannel })) {
    const witness = botDmWitnessRefusal({
      channel: options.channel,
      promptChannel,
      rootUserId: parent.userId,
      selfUserId: (await readSelf()).userId,
      threadTs: options.threadTs,
    });
    if (witness.length > 0) {
      return err([...witness, NOTHING_PARKED]);
    }
  }
  const destination = await readRecordingDestination({ options, payload: message.payload, readInfo });
  const media = await admitAndStoreDraftMedia({ artifact, deps, destination, options, payload: message.payload });
  return media.map((stored) => ({ media: stored, priorAsk: priorAsk.value, thread: threadParent.value }));
}
