/**
 * The THIN SHELL for `slopweaver slack post|reply` — the only file here that touches the world.
 *
 * The order is deliberate and each step is refusable before the one after it costs anything:
 *   1. parse argv                      (pure; a bad flag never reaches the network)
 *   2. resolve the token for `--as`    (a missing or wrong-KIND token fails here, before any call)
 *   3. read the form (stdin or inline) and validate it against the schema
 *   4. resolve mentions through the identity map (exact match only; unresolvable is fatal)
 *   5. render the card + derive its identities   (pure)
 *   6. `--dry-run` prints every step and stops, leaving no reservation, ledger entry or network call
 *   7. otherwise reserve the duplicate key atomically, then `throughDoor` ONCE around the whole
 *      composite send — whose thunk is the only code in this program that can change Slack.
 *
 * Steps 3 to 7 for a bot card are `./cardWriteRun.ts`, shared with the release of a parked `--as bot` draft.
 * Every dependency the shell needs is injected via {@link SlackWriteDeps}, so the whole flow is
 * exercisable with plain fakes and no mocks.
 */

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { PainPointLane } from "../../../admit/painPoint.js";
import type { VerifiedDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { slopweaverHome } from "../../../config.js";
import type { SlackWriteApi } from "../../../corpus/slack/writeApi.js";
import type { JoinedChannel } from "../../../corpus/slack/writeApiConversations.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { type Result } from "../../../lib/result.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import type { ChannelAccess } from "../../../outbound/slack/channelJoin.js";
import type { TaggedAccount } from "../../../outbound/slack/departedTags.js";
import type { ConversationMembership } from "../../../outbound/slack/dmMembership.js";
import type { SlackDraftError } from "../../../outbound/slack/draftErrors.js";
import type { ParkedSlackDraftMedia, SlackDraftEvent } from "../../../outbound/slack/draftRegister.js";
import type { BotMembership } from "../../../outbound/slack/findingIdentity.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import type { ConversationSurface, SlackCardChrome, SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import type { WallActor, WallRun } from "../../../outbound/slack/wallGate.js";
import { type ExactVoiceRule, type ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { runSlackDrip } from "./asMeSend.js";
import { runSlackCardWrite } from "./cardWriteRun.js";
import {
  isDraftRelease,
  parseSlackWriteArgs,
  resolveSlackWriteToken,
  type SlackWriteVerb,
  takesFreshWordsAsMe,
} from "./core.js";
import type { SlackWriteOptions } from "./coreTypes.js";
import type { HighStakesDeps } from "./highStakesGate.js";
import type { ReadPriorAsk } from "./priorAskWiring.js";
import type { SlackRead } from "./readErrors.js";
import { runSlackDraftRelease } from "./releaseRun.js";
import {
  heldReleaseTarget,
  holdTokenlessRelease,
  journalSendFailure,
  journalUnresolvedRelease,
} from "./sendFailureJournalling.js";
import type { VerifyOwnDm } from "./verifiedOwnDm.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { voiceBriefingExit } from "./voiceBriefingGate.js";
import type { DripConfig } from "./wiring.js";
import { usage } from "./writeOutput.js";
import { productionSlackWriteDeps } from "./writeWiring.js";

// The wiring moved to `./writeWiring.ts` and every caller keeps importing it from here: one definition,
// one import path, so a consumer never has to know which half of this verb a dependency lives in.
export { productionSlackWriteDeps } from "./writeWiring.js";

/**
 * Where a verb's own flags start in `process.argv`: `[node, script, noun, verb, ...flags]`.
 *
 * The router hands every handler the FULL argv and each verb slices its own tail. Getting this wrong
 * is invisible to unit tests that pass a hand-made tail — the previous attempt at this PR shipped
 * exactly that bug past seventy green tests, so {@link slackPostCommand} is exercised through this
 * offset in the test suite rather than only through `runSlackWrite`.
 */
const VERB_ARG_OFFSET = 4;

/** Everything the shell needs from the world, injected so the flow is testable with plain fakes. */
export interface SlackWriteDeps extends HighStakesDeps {
  readonly readStdin: () => Promise<string>;
  readonly readMedia: (args: { path: string }) => Promise<SlackUpload>;
  /**
   * The bot token, resolved under the SAME home as the rest of the invocation. It takes `home` because the
   * token lives at `$home/secrets/slack-bot-token` — a resolver that ignored `home` (or read `process.env`
   * directly, which is what shipped) tells a user who has successfully run `secrets set slack-bot-token` to
   * go and export an env var instead.
   */
  readonly botToken: (args: { home: string }) => string | undefined;
  /**
   * The USER token, resolved under the SAME home as the rest of the invocation — the token `--as me`
   * sends with. It takes `home` for exactly the reason `botToken` does: a resolver that ignored it would
   * read one home's secret while writing another home's ledger and reservations.
   */
  readonly userToken: (args: { home: string }) => string | undefined;
  /** The operator's as-me drip preferences and exact voice rules, from `profile.json`. */
  readonly dripConfig: (args: { home: string }) => Result<DripConfig, ProfileReadError>;
  /**
   * The ONE conversation an automation's PROMPT may be posted into, from `slackBot.promptChannel`.
   *
   * A seam of its own rather than a field on `dripConfig`, for the reason `voiceRules` is one: the prompt
   * gate has nothing to do with the operator's as-me drip, and a lane reaching into that shape for one field
   * is how a later edit to it silently changes what the bot is refused for. `undefined` on an install that
   * has configured none, which REFUSES every such post rather than admitting it somewhere public.
   */
  readonly promptChannel: (args: { home: string }) => string | undefined;
  /**
   * The destination when it is PROVEN their own bot DM, the one conversation a PR-led opening is not judged in
   * (`./verifiedOwnDm.ts`): `promptChannel` alone is a configured candidate, never the proof.
   */
  readonly verifiedOwnDm: VerifyOwnDm;
  /**
   * Every channel some recipe row carries their own recorded approval for, from the definitions store.
   *
   * The DOOR's half of owner turn 291-8x asks the weaker of two questions — has they approved this CHANNEL
   * for anything — because a scheduled post's delivery key is a digest and names no row
   * (`live/automation/slotLedger.ts#slotDeliveryKey`). `outbound/slack/scheduledPostChannel.ts` says why that
   * is the right weaker question rather than a shortfall, and the planner's own gate asks the exact one.
   *
   * A seam rather than a direct store read for the reason `promptChannel` is one: a refusal a test cannot
   * reach is a refusal no test can prove still fires.
   */
  readonly approvedScheduledChannels: (args: { home: string }) => readonly string[];
  /**
   * The owner's own Slack user id, from `slackBot.ownerUserId` — one of the two spellings of their DM that
   * `../../../outbound/slack/dmPurpose.ts` holds a purposeless post to. `null` when unset. A seam for the
   * reason `promptChannel` is one.
   */
  readonly ownerUserId: (args: { home: string }) => string | null;
  /**
   * The operator's exact voice rules alone, for the BOT card lane.
   *
   * A seam of its own rather than `dripConfig().exactVoiceRules`, even though both read the same
   * `slackMe.voice.exact` list: a bot card has no cadence, no bullet cap and no sole-message ceiling, and a
   * lane reaching into the as-me drip's configuration for one field is how a later edit to that shape
   * silently changes what the bot is judged against.
   */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Record exact-rule matches as bounded future-turn guidance; this observation never decides the send. */
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  /**
   * The environment the door and exact voice gate read their override tokens from, injected as one seam.
   *
   * One seam rather than two, and that is the point: the door decides whether to admit a repeated drip,
   * and the drip loop decides whether to actually repost it. If those two read the override from
   * different places they can disagree, and the disagreement is silent — the door admits the send and
   * the loop then skips every message as already-sent, so "post it again, I mean it" posts nothing.
   */
  readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
  /**
   * The consecutive run WE BUILT at the tail of a thread, live — see `./wallRunRead.js`'s `liveWallRun`. Only
   * ever asked about a REPLY; `slack post` never carries a `threadTs` to ask about. `actor` decides what
   * "we built" means: under `bot` every earlier message from that identity counts, under `me` none of them
   * does, because that identity is the owner's own hand
   * (`../../../outbound/slack/wallGate.ts`).
   */
  readonly wallRun: (args: {
    token: string;
    channel: string;
    threadTs: string;
    actor: WallActor;
  }) => Promise<SlackRead<WallRun>>;
  /**
   * What KIND of surface a channel is, live — a DM, a private channel, or one anybody in the org can read.
   * Only ever asked when a send could actually be refused on the answer (see `needsSurfaceForOneCard`), so a
   * single-message post never pays for a Slack call it cannot act on. `undefined` when Slack could not say,
   * which the one-card gate treats as a refusal rather than a pass.
   */
  readonly conversationSurface: (a: { token: string; channel: string }) => Promise<ConversationSurface | undefined>;
  /**
   * Whether a conversation is a group DM, live — `conversations.info`'s `is_mpim`, `true` only when it says so. A
   * release asks it of a row stamped `groupDm` only, so a stamp a register line could carry by hand is re-read.
   */
  readonly conversationGroupDm: (a: { token: string; channel: string }) => Promise<true | undefined>;
  /**
   * Whether the bot is in a conversation — `conversations.info`'s `is_member`, asked under the BOT token it is
   * handed, `not-member` for a private channel that answers `channel_not_found`, `unknown` for anything else. Read
   * only by `slack draft record`: an as-me top-level finding in a private channel, and a `--as bot` recording
   * outside a public one (`../../../outbound/slack/findingIdentity.ts`). No send asks it — a fresh send carries no
   * `--kind` or `--why` to say it is a finding, so the rule holds where a finding is parked and released.
   */
  readonly botMembership: (a: { token: string; channel: string }) => Promise<BotMembership>;
  /**
   * Post one payload to the render-proof conversation, read Slack's own parse of it back, and delete it.
   *
   * Injected rather than reached for because the whole round trip — post, read, delete — has to be
   * exercisable with a plain fake, including the arms where each of the three fails.
   */
  readonly proveRender: (a: {
    token: string;
    home: string;
    channel: string;
    payload: SlackDripMessagePayload;
  }) => Promise<{ kind: "checked"; issues: readonly string[] } | { kind: "unprovable"; reason: string }>;
  /** What this write's bare `#<n>`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  readonly chrome: (args: { home: string }) => SlackCardChrome;
  /**
   * Resolve everyone a message addresses, over ONE read of the store's identity roster; that read's typed refusal
   * stops the send.
   */
  readonly resolveMentions: (args: {
    people: readonly string[];
    groups: readonly string[];
    home: string;
    /** The Slack ids in the conversation the message posts into, when read: a member there is addressable. */
    conversationMembers?: ReadonlySet<string> | undefined;
  }) => Promise<Result<MentionResolution, IdentityRosterError>>;
  /**
   * Who is in the conversation a message posts into, and whether it is a direct message (1:1 or group). Read
   * only by an as-me preparation that mentions somebody (`./prepareDrip.ts`).
   */
  readonly conversationMembership: (args: {
    channel: string;
    home: string;
    token: string;
  }) => Promise<ConversationMembership>;
  /**
   * Whether one account an as-me message tags is still active, read live off `users.info` for every person the
   * message tags (`../../../outbound/slack/departedTags.ts`).
   */
  readonly taggedAccount: (args: { home: string; token: string; user: string }) => Promise<TaggedAccount>;
  readonly makeApi: (args: { token: string; home: string }) => SlackWriteApi;
  /**
   * Where DATA output goes (stdout in production). Injected so a test can assert the exact bytes — which is
   * how `--json` is proven to emit ONE document and nothing else. Diagnostics still go to the module logger
   * on stderr, so the two streams cannot cross.
   */
  readonly out: (line: string) => void;
  /** The as-me draft register's lines, which a `--draft` release finds its row in. */
  readonly readDraftLog: (args: { home: string }) => readonly string[];
  /** Append one register event: a release's `released` row, once every message landed. */
  readonly appendDraftEvent: (args: { event: SlackDraftEvent; home: string }) => Result<true, SlackDraftError>;
  /** A released draft's stored attachments, read once and verified against the row before anything is prepared. */
  readonly readDraftMedia: (args: {
    home: string;
    media: readonly ParkedSlackDraftMedia[];
  }) => Result<readonly VerifiedDraftMedia[], SlackDraftError>;
  /**
   * `auth.test`, for the identity a release's recomputed digest binds, and the bot whose own posts its re-read leaves
   * out (none for their token).
   */
  readonly whoAmI: (args: { token: string }) => Promise<{
    readonly userId?: string | undefined;
    readonly botId?: string | undefined;
    /** `auth.test`'s workspace base, which a release join's autonomy row links the channel on. */
    readonly workspaceUrl?: string | undefined;
  }>;
  /** The autonomy ledger a release join records its own act in (`./releaseJoin.ts`). */
  readonly autonomy: AutonomyLedgerPort;
  /** The door ledger every card or as-me send's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  /**
   * Whether their account is in the channel a release posts into, and what kind of channel it is
   * (`conversations.info`), read by a release before it posts (`./releaseJoin.ts`).
   */
  readonly channelAccess: (args: { channel: string; token: string }) => Promise<ChannelAccess>;
  /**
   * `conversations.join` as their account, taken only for an approved release to a public channel they are not in;
   * `confirm` is asked right before the dispatch, and a `false` sends nothing.
   */
  readonly joinChannel: (args: {
    channel: string;
    confirm: () => boolean;
    home: string;
    token: string;
  }) => Promise<JoinedChannel>;
  /**
   * Where a release is about to land, read live, whole and unparsed: a thread, or the channel's top-level messages
   * from `oldest` on, `oldest` included. `err` is the read failing or proving incomplete, which a release refuses
   * on — it does not send where it cannot see.
   */
  readonly readReleaseConversation: (args: {
    channel: string;
    home: string;
    threadTs: string | undefined;
    oldest: string;
    token: string;
  }) => Promise<Result<readonly unknown[], string>>;
  /**
   * The earlier ask a re-ask row names, read again at release, the same read the recording ran
   * (`./priorAskWiring.ts`). An answer that arrived since the recording is a refusal.
   */
  readonly readPriorAsk: ReadPriorAsk;
}

/**
 * A write with no token to send it: hold a release, journal an as-me send's failure, and exit usage.
 *
 * @param message why the token did not resolve
 * @returns the usage exit code
 */
function tokenlessExit({
  deps,
  message,
  options,
}: {
  deps: SlackWriteDeps;
  message: string;
  options: SlackWriteOptions;
}): number {
  const errors = [message];
  if (isDraftRelease(options)) {
    const target = heldReleaseTarget({ deps, options });
    holdTokenlessRelease({ deps, options, target, why: message });
    if (options.actor === "me") {
      journalUnresolvedRelease({ errors, options, target });
    }
  } else if (options.actor === "me") {
    const { channel, threadTs } = options;
    journalSendFailure({ channel, errors, options, threadTs });
  }
  return usage({ errors });
}

/**
 * Run one Slack write.
 *
 * @param verb the write verb
 * @param argv the argv tail after the verb
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runSlackWrite({
  verb,
  argv,
  deps,
}: {
  verb: SlackWriteVerb;
  argv: readonly string[];
  deps: SlackWriteDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "slack", rest: argv, verb });
  if (gated !== undefined) {
    return gated;
  }
  const options = parseSlackWriteArgs({ defaultHome: slopweaverHome(), rest: argv, verb });
  if (options.isErr()) {
    return usage({ errors: slackArgumentErrorLines({ error: options.error }) });
  }
  // Fresh words in the owner's name need their voice brief, a release's `--thanks-instead` line included.
  const unbriefed = voiceBriefingExit({
    applies: takesFreshWordsAsMe({ options: options.value }),
    env: deps.doorEnv(),
    home: options.value.home,
    now: () => new Date().toISOString(),
  });
  if (unbriefed !== undefined) {
    return unbriefed;
  }
  const token = resolveSlackWriteToken({
    actor: options.value.actor,
    botToken: deps.botToken({ home: options.value.home }),
    userToken: deps.userToken({ home: options.value.home }),
  });
  if (token.isErr()) {
    return tokenlessExit({ deps, message: token.error.message, options: options.value });
  }
  if (isDraftRelease(options.value)) {
    return runSlackDraftRelease({ deps, options: options.value, token: token.value });
  }
  if (options.value.actor === "me") {
    return runSlackDrip({ deps, options: options.value, token: token.value });
  }
  // READ before stdin: admission judges the card against these rules, and a corrupt profile is a fact about the
  // install rather than a refused form, so it exits 1 here instead of 2 from inside admission.
  const rules = readExactVoiceRules({ home: options.value.home });
  if (rules.isErr()) {
    return unreadableProfileExit({ error: rules.error, nothingHappened: "nothing was posted." });
  }
  return runSlackCardWrite({ cardOptions: options.value, deps, token: token.value });
}

/** `slopweaver slack post` — a new card in a channel. */
export const slackPostCommand = defineCommand({
  run: (argv) => runSlackWrite({ argv: argv.slice(VERB_ARG_OFFSET), deps: productionSlackWriteDeps(), verb: "post" }),
});

/** `slopweaver slack reply` — the same card, inside a thread. */
export const slackReplyCommand = defineCommand({
  run: (argv) => runSlackWrite({ argv: argv.slice(VERB_ARG_OFFSET), deps: productionSlackWriteDeps(), verb: "reply" }),
});
