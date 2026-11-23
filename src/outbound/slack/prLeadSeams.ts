/**
 * Where the rule against leading a message with a pull request is judged: one row per PRODUCER, a production
 * file that calls a Slack write carrying words.
 *
 * The rule is judged at the verb that authors a message, never at the transport: a transport cannot tell a card the
 * fleet chose to send from an answer to the question a person tagged the bot with, and only the first is the fleet
 * choosing what a teammate opens on. So the completeness has two halves:
 *
 * - **Every transport method is classified** in {@link SLACK_WRITE_METHODS}, by whether it carries words a reader
 *   opens on. The type makes that table complete: a method added to `SlackWriteTransport` does not compile until it
 *   is classified.
 * - **Every call site is counted.** `PR_LEAD_CALL_SITES` (`./prLeadCallSites.ts`) holds, per production file and per
 *   enclosing function, how many times it calls each word-carrying method or {@link SLACK_WRITE_ENTRIES} entry above
 *   the transport, and every file in it is classified in {@link PR_LEAD_PRODUCERS}.
 *   `src/__tests__/unit/outbound/slack/prLeadSeams/` walks the syntax tree of every production file, in any
 *   extension the compiler takes, under the grammar `./prLeadWalk.ts` beside it declares: every invocation form,
 *   every wrapper erased at run time, every holder that names a function. It fails on any difference: a new write
 *   call, or one moved into another named function, fails as a new file does, and so does a callee outside that
 *   grammar that names a write, a write METHOD stored, bound, passed or destructured instead of called where it
 *   stands, and an entry imported under another name or re-exported. A function's key is the chain of named functions around it, numbered in file order
 *   where two chains are equal. A judged row names its writing entry and, per file and enclosing function, how many
 *   times it is called, so a second call through an import that already exists fails too; a caller is any file whose
 *   imports LOAD the producer, resolved as the compiler resolves them (`#` aliases included), and a re-export of a
 *   producer's file fails. It names the test case proving a refused opening writes nothing.
 *
 * Its stated limits: a producer reached two hops up, or through an injected dependency, is classified by its first
 * hop only; the walk keys a call by its callee's NAME, so a bare-named entry (`sendCard`) stored or passed as a value under its own name,
 * a member name computed from parts, a name spelled with an escape sequence or an implicit invocation (an accessor, a
 * coercion, an iterator) is invisible to it, and so is a module loaded by a specifier computed at run time; a move between branches of one named function, or between its pieces
 * with no name of their own (an anonymous callback, a class static block), is not seen; and the order of the
 * judgement and the write, that both read the same payload, and that the named case still runs rather than being
 * skipped, are the case's own assertions rather than the walk's, which only finds its title. A changed count is a
 * prompt to re-read that order, never a number to bump.
 *
 * An `exempt` reason is a decision, not a gap, and the answer lanes are the one the owner has not ruled on: a bot
 * answer, a Queue answer release and a turn card reply to a person's own tag, whose question decides the subject.
 */
import type { SlackWriteTransport } from "../../corpus/slack/writeTransport.js";

/** Every Slack write method, by whether it carries words a reader opens on. */
export const SLACK_WRITE_METHODS = {
  addReaction: "no-words",
  appendStream: "words",
  archiveChannel: "no-words",
  attachAssistantMedia: "words",
  attachMedia: "words",
  attachRecipeResponseMedia: "words",
  conversationInfo: "no-words",
  correctMessage: "words",
  createCanvas: "words",
  createChannel: "no-words",
  createChannelCanvas: "words",
  deleteCanvas: "no-words",
  deleteMessage: "no-words",
  deleteMessageOnce: "no-words",
  inviteToChannel: "no-words",
  joinChannel: "no-words",
  openConversation: "no-words",
  postAssistantMessage: "words",
  postCard: "words",
  postDripMessage: "words",
  postNoFold: "words",
  postPoll: "words",
  postRecipeResponse: "words",
  postTurn: "words",
  readBackFileCount: "no-words",
  readMessage: "no-words",
  readReactions: "no-words",
  removeReaction: "no-words",
  replaceCanvas: "words",
  setAssistantStatus: "words",
  setChannelPurpose: "words",
  setChannelTopic: "words",
  setThreadTitle: "words",
  startStream: "words",
  stopStream: "words",
  updateCard: "words",
  updateDripMessage: "words",
  updateTurn: "words",
  // File bytes uploaded privately; the message that carries them is what a reader opens on.
  uploadPrivately: "no-words",
  userGroupIds: "no-words",
  whoAmI: "no-words",
} as const satisfies Record<keyof SlackWriteTransport, "words" | "no-words">;

/**
 * The calls above the transport that post a word-carrying payload: `SlackWriteApi`'s three sends and the four
 * composite sends in `src/corpus/slack/writeSend.ts`. Each is a callee as the scan keys it — `.name` for a member
 * call, `name` for a bare one — and each name is one only that write carries, so no key depends on what a receiver
 * is called.
 */
export const SLACK_WRITE_ENTRIES: readonly string[] = [
  ".sendComposite",
  ".sendDripMessage",
  ".sendNoFold",
  "runCompositeSend",
  "runAssistantCompositeSend",
  "runRecipeResponseCompositeSend",
  "runDripCompositeSend",
];

/** One producer: judged before it writes, or exempt with the reason it has no opening the fleet chose. */
export type PrLeadProducer =
  | {
      readonly kind: "judged";
      /** The file whose judgement runs before this producer writes — itself, or its only authoring caller. */
      readonly judgedAt: string;
      /** The test file proving a refused opening writes nothing. */
      readonly proof: string;
      /** The quoted literal in {@link proof} naming what proves it: a `describe` or `it` title, or an `it.each` row's `name`. */
      readonly proofCase: string;
      /** The exported function through which this producer writes. */
      readonly entry: string;
      /** Per production file and enclosing function, how many times it calls {@link entry}: a new call is a classification. */
      readonly callers: Readonly<Record<string, Readonly<Record<string, number>>>>;
      /** A lane inside it that is not judged, and why, when the file writes both. */
      readonly exceptLane?: string;
    }
  | { readonly kind: "exempt"; readonly why: string };

/** The transport layer: a guard or a send forwards the payload its caller authored. */
const TRANSPORT: PrLeadProducer = {
  kind: "exempt",
  why: "the transport layer, forwarding the payload its caller authored, which is where that caller is classified",
};

/** A turn's working state, in the thread a person tagged the bot in. */
const TURN: PrLeadProducer = {
  kind: "exempt",
  why: "a turn's card, working state or answer notice, in the thread a person tagged the bot in; their question decides the subject",
};

/** A fixed notice the listener posts, worded in code. */
const LISTEN_NOTICE: PrLeadProducer = {
  kind: "exempt",
  why: "a fixed notice the listener posts into the tagging thread, worded in code, naming no pull request",
};

/** A canvas: a document, never a message in a conversation. */
const CANVAS: PrLeadProducer = {
  kind: "exempt",
  why: "a canvas is a document a reader opens, never a message in a conversation",
};

const SLACK = "src/cli/commands/slack";
const PROOF = "src/__tests__/unit/cli/commands/slack";

/** Every production file that calls a word-carrying Slack write, classified. Keys are repository-relative paths. */
export const PR_LEAD_PRODUCERS: Readonly<Record<string, PrLeadProducer>> = {
  [`${SLACK}/canvasRun.ts`]: CANVAS,
  [`${SLACK}/canvasWiring.ts`]: CANVAS,
  [`${SLACK}/cardSend.ts`]: {
    callers: { [`${SLACK}/cardWriteRun.ts`]: { "performSend/perform": 1 } },
    entry: "sendCard",
    judgedAt: `${SLACK}/cardWriteRun.ts`,
    kind: "judged",
    proof: `${PROOF}/run/prLead.test.ts`,
    proofCase: "runSlackWrite — a fresh card leads with the discussion, never a pull request",
  },
  [`${SLACK}/channelWiring.ts`]: {
    kind: "exempt",
    why: "a channel's purpose and topic, set when the fleet opens a channel, never a message",
  },
  [`${SLACK}/correctRun.ts`]: {
    kind: "exempt",
    why: "keeps the original opening, struck, and adds a Correction line under it, so it inherits the original's classification: a card judged at its send, an answer exempt",
  },
  [`${SLACK}/dripRun.ts`]: {
    callers: { [`${SLACK}/dripPerform.ts`]: { dripPerform: 1 } },
    entry: "runDripSequence",
    judgedAt: `${SLACK}/asMeSend.ts`,
    kind: "judged",
    proof: `${PROOF}/dripShell/releaseOpening.test.ts`,
    proofCase: "runSlackWrite --as me — the opening leads with the discussion, never a pull request",
  },
  [`${SLACK}/dripSendPlan.ts`]: {
    callers: { [`${SLACK}/writeWiring.ts`]: { "productionSlackWriteDeps/proveRender": 1 } },
    entry: "runRenderProof",
    judgedAt: `${SLACK}/asMeSend.ts`,
    kind: "judged",
    proof: `${PROOF}/dripShell/releaseOpening.test.ts`,
    proofCase: "runSlackWrite --as me — the opening leads with the discussion, never a pull request",
  },
  [`${SLACK}/lifecycleRunAsMe.ts`]: {
    callers: { [`${SLACK}/lifecycleRunEdit.ts`]: { runEdit: 1 } },
    entry: "runEditAsMe",
    judgedAt: `${SLACK}/lifecycleRunAsMe.ts`,
    kind: "judged",
    proof: `${PROOF}/lifecycleRun.test.ts`,
    proofCase: "refuses an edit opening on a pull request, updating nothing",
  },
  [`${SLACK}/lifecycleRunEdit.ts`]: {
    callers: { [`${SLACK}/lifecycleRun.ts`]: { runLifecycle: 1 } },
    entry: "runEdit",
    exceptLane: "an answer card's edit, which replies to a person's tag exactly as the answer did",
    judgedAt: `${SLACK}/lifecycleRunEdit.ts`,
    kind: "judged",
    proof: `${PROOF}/lifecycleRun.test.ts`,
    proofCase: "slack edit --as bot — a card whose new lead opens on a pull request",
  },
  [`${SLACK}/lifecycleRunEditChecklist.ts`]: TURN,
  [`${SLACK}/lifecycleRunEditPoll.ts`]: {
    callers: { [`${SLACK}/lifecycleRunEdit.ts`]: { runEditAsBot: 1 } },
    entry: "runEditPoll",
    judgedAt: `${SLACK}/lifecycleRunEditPoll.ts`,
    kind: "judged",
    proof: `${PROOF}/lifecycleRunEditPoll.test.ts`,
    proofCase: "refuses a poll edit whose question opens on a pull request, updating nothing",
  },
  [`${SLACK}/pollRun.ts`]: {
    callers: { [`${SLACK}/pollRun.ts`]: { run: 1 } },
    entry: "runPollWithDeps",
    judgedAt: `${SLACK}/pollDoor.ts`,
    kind: "judged",
    proof: `${PROOF}/pollRun.test.ts`,
    proofCase: "HOLDS a poll whose question opens on a pull request, and posts nothing",
  },
  "src/cli/commands/listen/liveCapture.ts": TURN,
  "src/cli/commands/listen/liveListenDeps.ts": LISTEN_NOTICE,
  "src/cli/commands/listen/run.ts": LISTEN_NOTICE,
  "src/cli/commands/listen/scheduledRecover.ts": LISTEN_NOTICE,
  "src/cli/commands/queue/queueReleaseDoor.ts": {
    kind: "exempt",
    why: "a Queue answer release, posting the answer to the question a person tagged the bot with",
  },
  "src/cli/commands/turn/ensureCard.ts": TURN,
  "src/corpus/slack/writeApi.ts": TRANSPORT,
  "src/corpus/slack/writeApiStream.ts": TRANSPORT,
  "src/corpus/slack/writeGuardHighStakes.ts": TRANSPORT,
  "src/corpus/slack/writeGuardPlacement.ts": TRANSPORT,
  "src/corpus/slack/writeGuardPlacementRepair.ts": {
    kind: "exempt",
    why: "a fixed line, worded in code, linking a message that landed in the wrong place to where it landed",
  },
  "src/corpus/slack/writeGuardRepeat.ts": TRANSPORT,
  "src/corpus/slack/writeGuardTypedRuns.ts": TRANSPORT,
  "src/corpus/slack/writeSend.ts": TRANSPORT,
  "src/live/turn/posterAnswer.ts": {
    kind: "exempt",
    why: "the bot's answer to the question a person tagged it with",
  },
  "src/live/turn/posterStatus.ts": TURN,
  "src/live/turn/posterWorking.ts": TURN,
};
