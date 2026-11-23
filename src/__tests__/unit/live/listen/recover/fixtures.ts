/*
 * The pure fixtures every dropped-tag recovery test file shares: the bot, the cutoff, the empty registries, the
 * card event type, the one unanswered colleague's tag, a live worker's dispatch of it, an exact answer naming
 * it, and the `classify` wrapper over `classifyCandidate` that defaults every registry to empty.
 */
import type { RecordedAskIdentity } from "../../../../../live/ask/identity.js";
import type { IgnoredAsk } from "../../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../../live/ask/ignoredConversation.js";
import type { AskLifecycle, DispatchedEvent, TerminalAskLifecycleEvent } from "../../../../../live/ask/lifecycle.js";
import { classifyCandidate, type RecoveryCandidate, type RecoveryVerdict } from "../../../../../live/listen/recover.js";

export const BOT = "U_BOT";
export const SINCE = "2026-08-01T00:00:00.000Z";
export const NO_IGNORES: ReadonlyMap<string, IgnoredAsk> = new Map();
export const NO_IGNORED_CONVERSATIONS: ReadonlyMap<string, IgnoredConversation> = new Map();
export const NO_LIFECYCLES: ReadonlyMap<string, AskLifecycle> = new Map();
export const NO_TERMINAL: ReadonlyMap<string, TerminalAskLifecycleEvent> = new Map();
export const CARD_EVENT_TYPE = "slopweaver_card_v1";

/** A tag from a colleague that nobody has replied to — the case the whole verb exists for. */
export const UNANSWERED: RecoveryCandidate = {
  channel: "C_BOT",
  messageTs: "1785000000.000100",
  rawText: `<@${BOT}> are the payment logs kept anywhere, and how far back?`,
  surface: "channel",
  threadAnswers: [],
  threadMarks: [],
  threadTs: "1785000000.000100",
  tsIso: "2026-08-05T13:26:00.000Z",
  userId: "U_ASKER",
  selfAuthored: false,
};

/** A `dispatched` event for the `UNANSWERED` candidate — a live worker holding it. */
export const DISPATCHED_EVENT: DispatchedEvent = {
  channel: UNANSWERED.channel,
  decision: {
    confidence: "high",
    model: "sonnet",
    needs: [],
    rationale: "a scoped, well-precedented investigation",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "current",
  },
  kind: "dispatched",
  leaseExpiresAt: "2026-08-05T15:26:00.000Z",
  messageTs: UNANSWERED.messageTs,
  threadTs: UNANSWERED.threadTs,
  tier: "fresh-visible-session",
  tsIso: "2026-08-05T13:27:00.000Z",
};

/** A real answer's metadata, naming exactly the `UNANSWERED` candidate. */
export const EXACT_ANSWER: Extract<RecordedAskIdentity, { quality: "exact" }> = {
  channel: UNANSWERED.channel,
  messageTs: UNANSWERED.messageTs,
  quality: "exact",
  threadTs: UNANSWERED.threadTs,
};

/**
 * Classify the `UNANSWERED` candidate, with any field overridden, against registries that default to empty.
 *
 * @param over the candidate fields this case changes from `UNANSWERED`
 * @param strandedLane whether the stranded-ask recovery lane is opted into
 * @returns the verdict `classifyCandidate` reaches for that candidate
 */
export const classify = ({
  over = {},
  ignored = NO_IGNORES,
  ignoredConversations = NO_IGNORED_CONVERSATIONS,
  lifecycles = NO_LIFECYCLES,
  strandedLane = false,
  terminalByAsk = NO_TERMINAL,
}: {
  over?: Partial<RecoveryCandidate>;
  ignored?: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations?: ReadonlyMap<string, IgnoredConversation>;
  lifecycles?: ReadonlyMap<string, AskLifecycle>;
  strandedLane?: boolean;
  terminalByAsk?: ReadonlyMap<string, TerminalAskLifecycleEvent>;
} = {}): RecoveryVerdict =>
  classifyCandidate({
    allowedChannels: ["C_BOT"],
    botUserId: BOT,
    candidate: { ...UNANSWERED, ...over },
    cardEventType: CARD_EVENT_TYPE,
    ignored,
    ignoredConversations,
    lifecycles,
    since: SINCE,
    strandedLane,
    terminalByAsk,
  });
