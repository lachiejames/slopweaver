/**
 * `slopweaver slack draft` — the effectful shell over `./draftCore.ts` and `./draftReport.ts`. The record
 * path, the one that composes and parks, is `./draftRecordRun.ts`.
 *
 * **Nothing in this module posts, and the type says so rather than the header.** {@link SlackDraftDeps}
 * extends `./prepareDrip.ts`'s `DripPrepareDeps`, which carries no `proveRender`, no `makeApi` and no
 * `readMedia`; the live calls it adds are `conversations.info`, `auth.test` and, for a `--thread-ts`
 * reply, `conversations.replies`, with `context` adding one `conversations.history` page — all reads, a
 * `--as bot` recording taking them under the bot token — plus one GitHub read per pull request a `bump` or
 * `review-ask` links (`./draftSettledChase.ts`), which cannot post either. The send
 * lane's own bag satisfies this type structurally, so the production wiring in `./draftWiring.ts` is the
 * narrowing rather than a second copy of the world.
 */
import { slopweaverHome } from "../../../config.js";
import type { OrgChart } from "../../../corpus/members/orgChartIndex.js";
import { type SlackPerson, slackPeopleFor } from "../../../corpus/members/slackPeople.js";
import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import type { RawWords } from "../../../handover/hisWordsResolve.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import {
  CHANNEL_CONTEXT_MESSAGES,
  draftContextDocument,
  draftContextMemberIds,
} from "../../../live/slack/draftContext.js";
import { type SlackDraftError, SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import { foldSlackDraftLog, parseSlackDraftLog, skippedDraftNote } from "../../../outbound/slack/draftLog.js";
import { draftMemberIds } from "../../../outbound/slack/draftMemberIds.js";
import { type SlackDraftEvent, type SlackDraftItem, slackDraftById } from "../../../outbound/slack/draftRegister.js";
import type { ConversationSurface } from "../../../outbound/slack/types.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import type { ReadApprovalLaterRelays } from "../../../talk/approvalRelayRead.js";
import type { CallFence } from "../../../talk/callFence.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { draftAdmissionExit } from "./draftAdmission.js";
import { type DraftComparisonDeps, runDraftCompare } from "./draftCompareRun.js";
import {
  type DraftContextOptions,
  type DraftListOptions,
  type DraftShowOptions,
  parseSlackDraftArgs,
} from "./draftCore.js";
import { type DraftCorrectionsDeps, runDraftCorrections } from "./draftCorrectionsRun.js";
import type { LandedDraftsRead } from "./draftDropGuard.js";
import { runDraftApprove, runDraftDrop, runDraftHold } from "./draftJudgementRun.js";
import { draftListDocument } from "./draftListDocument.js";
import type { DraftMediaDeps } from "./draftMedia.js";
import { heldMediaOf } from "./draftMediaEvidence.js";
import { draftConsoleUrl } from "./draftPark.js";
import { runDraftPick } from "./draftPickRun.js";
import { runDraftRecordBot } from "./draftRecordBotRun.js";
import { runDraftRecord } from "./draftRecordEntry.js";
import { proofMissingWarnings } from "./draftRecordProof.js";
import { draftUsageExit } from "./draftRecordRun.js";
import { draftListLines, draftShowLines } from "./draftReport.js";
import { runDraftRevision } from "./draftReviseRun.js";
import type { ChaseHoldDeps } from "./draftSettledChase.js";
import { liveSlackDraftDeps } from "./draftWiring.js";
import type { DripPrepareDeps } from "./prepareDrip.js";
import type { ReadPriorAsk } from "./priorAskWiring.js";
import type { SlackWriteDeps } from "./run.js";
import type { CardAdmissionDeps } from "./runAdmit.js";

/** Where the verb's own arguments start in `process.argv`: `[node, script, slack, draft, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Every edge `slack draft` touches. The absences are the contract — see this module's header.
 */
export interface SlackDraftDeps
  extends DripPrepareDeps, DraftMediaDeps, CardAdmissionDeps, DraftCorrectionsDeps, DraftComparisonDeps, ChaseHoldDeps {
  readonly userToken: SlackWriteDeps["userToken"];
  /** The bot token, for a `--as bot` recording's reads and for the membership an as-me finding is judged on. */
  readonly botToken: SlackWriteDeps["botToken"];
  /** The operator's card chrome, which a `--as bot` recording renders its card with exactly as the send would. */
  readonly chrome: SlackWriteDeps["chrome"];
  /** Whether the bot is in a conversation, read under the BOT token — see `findingIdentity.ts`. */
  readonly botMembership: SlackWriteDeps["botMembership"];
  readonly dripConfig: SlackWriteDeps["dripConfig"];
  readonly doorEnv: SlackWriteDeps["doorEnv"];
  readonly out: SlackWriteDeps["out"];
  /** The destination when proven their own bot DM, the one place a PR-led opening is not judged. */
  readonly verifiedOwnDm: SlackWriteDeps["verifiedOwnDm"];
  /**
   * `conversations.info`, for the surface the gate needs, the name the console prints, and — for a 1:1 DM — the
   * member on the other end, whom the untagged-name hold never asks to be tagged — and whether it is a group DM.
   */
  readonly conversationInfo: (args: { channel: string; token: string }) => Promise<{
    readonly surface: ConversationSurface | undefined;
    readonly name: string | undefined;
    readonly user?: string | undefined;
    readonly groupDm?: true | undefined;
  }>;
  /**
   * Every `conversations.replies` row of a thread root, unparsed, root first — the read that proves `--thread-ts`
   * names a real root in this channel before a reply is parked under it, and the row's `readThrough` a release
   * re-reads against. `err` is the read failing, which parks nothing: a reply recorded under a thread nobody could
   * read is the row this verb exists to refuse.
   */
  readonly threadReplies: (args: {
    channel: string;
    threadTs: string;
    token: string;
  }) => Promise<Result<readonly unknown[], SlackDraftError>>;
  /**
   * The conversation a draft lands in, read live for `context`: every `conversations.replies` row of a thread,
   * or ONE `conversations.history` page of a channel's newest `limit` rows, with Slack's `has_more` and the
   * workspace origin off `auth.test`. `through` ends that page at a `ts`, inclusive, rather than now: a comparison
   * retry reads the window its recording read, so a message posted since cannot page one it saw out. Reads only —
   * `err` is the read failing, which prints nothing.
   */
  readonly readConversation: (args: {
    channel: string;
    threadTs: string | undefined;
    limit: number;
    through: string | undefined;
    token: string;
  }) => Promise<
    Result<
      { readonly rows: readonly unknown[]; readonly hasMore: boolean; readonly workspaceUrl: string },
      SlackDraftError
    >
  >;
  /**
   * `auth.test`, for the user id the digest binds this draft's identity to, and the workspace URL a thread row's
   * permalink is built on.
   */
  readonly whoAmI: (args: {
    token: string;
  }) => Promise<{ readonly userId?: string | undefined; readonly workspaceUrl?: string | undefined }>;
  /**
   * The earlier ask a `--asked-before <permalink>` names, read whole under the asking identity's token
   * (`./priorAskWiring.ts`). `err` parks nothing.
   */
  readonly readPriorAsk: ReadPriorAsk;
  /**
   * Their words at a `--approved` anchor, read off the record the anchor names (`../../../handover/hisWordsResolve.ts`).
   * `err` parks nothing: an approval that does not resolve to their own words is one the chair pass would send on.
   */
  readonly readOwnerWords: (args: { anchor: string; home: string }) => Result<RawWords, HisWordsError>;
  /**
   * Hold still the call an approval's words were said on, and the landing ledger for a card landing, from its fenced
   * read through its append (`../../../talk/callFence.ts`), with the recheck run just before the act. `err` records
   * nothing.
   */
  readonly fenceCallWrites: (args: { anchor: string; atIso: string; home: string }) => Result<CallFence, string>;
  /**
   * The relays they made after a yes on the same call, while its card or one of the next two was up
   * (`../../../talk/approvalRelayRead.ts`). `err` binds nothing: a call that cannot say what they said next cannot prove
   * they did not take the yes back.
   */
  readonly readApprovalLaterRelays: ReadApprovalLaterRelays;
  /**
   * The card landings bound to held drafts, read as the tick gate reads them
   * (`../supervisor/landedCardReads.ts`), so a drop cannot spend words of their no judgement has answered.
   */
  readonly readLandedDrafts: (args: {
    home: string;
    items: readonly SlackDraftItem[];
    skipped: readonly { readonly id: string | undefined }[];
  }) => LandedDraftsRead;
  readonly nowIso: () => string;
  readonly mintId: () => string;
  readonly appendEvent: (args: { event: SlackDraftEvent; home: string }) => Result<true, SlackDraftError>;
  readonly readLog: (args: { home: string }) => readonly string[];
  /**
   * The register's write lock, held across one verb's read, check and append (`./draftRegisterLock.ts`); `err` when a
   * live writer held it past the wait, and the verb then records nothing.
   */
  readonly lockRegister: (args: { home: string }) => Result<() => void, SlackDraftError>;
  /** The console's own origin, so a parked draft's report can point at the panel that shows it. */
  readonly consoleBase: () => string;
  /** Member bronze, so `--json` names every id a draft carries rather than leaving the console to print it. */
  readonly loadMembers: (args: { home: string }) => {
    readonly rows: readonly MemberBronzeRow[];
    readonly warnings: readonly string[];
  };
  /** The Google directory and the Vanta atlas, so each member `--json` names carries their title, team and groups. */
  readonly loadOrgChart: (args: { home: string }) => { readonly chart: OrgChart; readonly warnings: readonly string[] };
}

/**
 * The register's current rows.
 *
 * A line `parseSlackDraftLog` could not read is passed over and SAID here, on stderr, so `--json` stays
 * parseable: a shorter list than the one on disk is a draft they cannot see, so the shortfall is never silent.
 *
 * @param deps the injected reads, for the log
 * @param home the state home the register lives under
 * @returns every folded row this version can vouch for, newest first
 */
function loadDrafts({ deps, home }: { deps: SlackDraftDeps; home: string }): readonly SlackDraftItem[] {
  const log = parseSlackDraftLog({ lines: deps.readLog({ home }) });
  const note = skippedDraftNote({ skipped: log.skipped });
  if (note !== undefined) {
    logger.warn({ msg: note });
  }
  return foldSlackDraftLog({ log });
}

/**
 * Who each of `ids` is, off member bronze, with where they sit in the organisation — nothing read when `ids` is
 * empty, so a register whose drafts carry no member id costs no roster read, and every store's read warning said on
 * stderr so `--json` stays parseable. An id member bronze does not hold is simply absent, and the console draws it.
 *
 * @returns the members found
 */
function namedPeople({
  deps,
  home,
  ids,
}: {
  deps: SlackDraftDeps;
  home: string;
  ids: readonly string[];
}): readonly SlackPerson[] {
  if (ids.length === 0) {
    return [];
  }
  const members = deps.loadMembers({ home });
  const org = deps.loadOrgChart({ home });
  for (const warning of [...members.warnings, ...org.warnings]) {
    logger.warn({ msg: warning });
  }
  return slackPeopleFor({ ids, orgChart: org.chart, rows: members.rows });
}

/**
 * `slack draft list` — every parked draft, held ones unless `--all`.
 *
 * @param deps the injected world
 * @param options the parsed invocation
 * @returns the process exit code
 */
function runDraftList({ deps, options }: { deps: SlackDraftDeps; options: DraftListOptions }): number {
  const items = loadDrafts({ deps, home: options.home });
  const mediaOf = heldMediaOf({ home: options.home });
  if (options.json) {
    const document = draftListDocument({
      botHandles: botSelfHandlesFromProfile({ home: options.home, reader: "slack draft list" }),
      items,
      mediaOf,
      people: namedPeople({ deps, home: options.home, ids: draftMemberIds({ items }) }),
    });
    for (const msg of proofMissingWarnings({ items: document.items })) {
      logger.warn({ msg });
    }
    deps.out(JSON.stringify(document, null, 2));
    return EXIT_OK;
  }
  for (const line of draftListLines({ items, mediaOf, showResolved: options.all })) {
    deps.out(line);
  }
  return EXIT_OK;
}

/**
 * `slack draft show <id>` — one draft, whole, including the bytes a release would post.
 *
 * @param deps the injected world
 * @param options the parsed invocation
 * @returns the process exit code
 */
function runDraftShow({ deps, options }: { deps: SlackDraftDeps; options: DraftShowOptions }): number {
  const found = slackDraftById({ id: options.id, items: loadDrafts({ deps, home: options.home }), mustBeHeld: false });
  if (found.isErr()) {
    logger.error({ msg: found.error.message });
    return EXIT_EXPECTED_EMPTY;
  }
  if (options.json) {
    const people = namedPeople({ deps, home: options.home, ids: draftMemberIds({ items: [found.value] }) });
    deps.out(
      JSON.stringify({ consoleUrl: draftConsoleUrl({ deps, id: options.id }), item: found.value, people }, null, 2),
    );
    return EXIT_OK;
  }
  for (const line of draftShowLines({ item: found.value })) {
    deps.out(line);
  }
  return EXIT_OK;
}

/**
 * `slack draft context <id>` — the conversation the draft lands in, read LIVE: a reply's whole thread, or a
 * post's channel tail, every member it shows named off member bronze. Read on their user token when they have one,
 * since they are the reader judging it; the bot's otherwise. Any draft state reads — a spent row's thread is still
 * where its message went.
 *
 * @param deps the injected world
 * @param options the parsed invocation
 * @returns the process exit code
 */
async function runDraftContext({
  deps,
  options,
}: {
  deps: SlackDraftDeps;
  options: DraftContextOptions;
}): Promise<number> {
  const found = slackDraftById({ id: options.id, items: loadDrafts({ deps, home: options.home }), mustBeHeld: false });
  if (found.isErr()) {
    logger.error({ msg: found.error.message });
    return EXIT_EXPECTED_EMPTY;
  }
  const { draft } = found.value;
  if (MEMBER_DESTINATION.test(draft.channel)) {
    logger.error({ msg: SlackDraftErrors.contextNoConversation({ channel: draft.channel }).message });
    return EXIT_EXPECTED_EMPTY;
  }
  const chosen = resolveSlackReadToken({
    botToken: deps.botToken({ home: options.home }),
    userToken: deps.userToken({ home: options.home }),
  });
  if (chosen.token === undefined) {
    logger.error({ msg: "no Slack token configured; run `slopweaver connect slack`" });
    return EXIT_ERROR;
  }
  if (chosen.warning !== undefined) {
    logger.warn({ msg: chosen.warning });
  }
  const read = await deps.readConversation({
    channel: draft.channel,
    limit: CHANNEL_CONTEXT_MESSAGES,
    threadTs: draft.threadTs,
    through: undefined,
    token: chosen.token,
  });
  if (read.isErr()) {
    logger.error({ msg: read.error.message });
    return EXIT_ERROR;
  }
  const workspace = read.value.workspaceUrl.replace(/\/+$/, "");
  const document = draftContextDocument({
    channel: draft.channel,
    draft,
    hasMore: read.value.hasMore,
    observedAtIso: deps.nowIso(),
    rows: read.value.rows,
    threadTs: draft.threadTs,
    workspace,
  });
  if (document.isErr()) {
    logger.error({
      msg: SlackDraftErrors.contextUnreadable({ cause: document.error, channel: draft.channel }).message,
    });
    return EXIT_ERROR;
  }
  // Every member the conversation shows, named off member bronze — none read when it names nobody.
  const ids = draftContextMemberIds({ messages: document.value.messages });
  deps.out(JSON.stringify({ ...document.value, people: namedPeople({ deps, home: options.home, ids }) }, null, 2));
  return EXIT_OK;
}

/** A destination that is a member id rather than a conversation — a DM addressed to the person. */
const MEMBER_DESTINATION = /^[UW][A-Z0-9]+$/;

/**
 * Run `slack draft` against SUPPLIED dependencies.
 *
 * Exported so a test can drive the whole verb with plain fakes and assert that a refusal appends nothing.
 *
 * @param argv the full process argv
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runSlackDraftWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: SlackDraftDeps;
}): Promise<number> {
  const options = parseSlackDraftArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (options.isErr()) {
    return draftUsageExit({ errors: slackArgumentErrorLines({ error: options.error }) });
  }
  const parsed = options.value;
  const refused = draftAdmissionExit({ deps, parsed });
  if (refused !== undefined) {
    return refused;
  }
  switch (parsed.mode) {
    case "record":
      return parsed.actor === "bot"
        ? runDraftRecordBot({ deps, options: parsed })
        : runDraftRecord({ deps, options: parsed });
    case "show":
      return runDraftShow({ deps, options: parsed });
    case "drop":
      return runDraftDrop({ deps, options: parsed });
    case "context":
      return runDraftContext({ deps, options: parsed });
    case "approve":
      return runDraftApprove({ deps, options: parsed });
    case "pick":
      return runDraftPick({ deps, options: parsed });
    case "compare":
      return runDraftCompare({ deps, home: parsed.home, id: parsed.id });
    case "revise":
    case "restore":
      return runDraftRevision({ deps, options: parsed });
    case "hold":
      return runDraftHold({ deps, options: parsed });
    case "corrections":
      return runDraftCorrections({
        deps,
        home: parsed.home,
        items: loadDrafts({ deps, home: parsed.home }),
        json: parsed.json,
      });
    case "list":
      return runDraftList({ deps, options: parsed });
  }
}

/**
 * `slopweaver slack draft` — record, list, show, read the conversation of, compare, pick and drop parked drafts, as-me
 * or bot, and report what they corrected on them. Nothing here sends.
 */
export const slackDraftCommand = defineCommand({
  run: (argv) => runSlackDraftWithDeps({ argv, deps: liveSlackDraftDeps() }),
});
