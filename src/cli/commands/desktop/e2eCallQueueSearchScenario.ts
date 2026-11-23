/**
 * The `queue-search` call scenario: a Queue question TYPED into the orb messenger, the surface where
 * the search timed out, and the one-word answer it must settle on. The other call scenarios, and the moves they share,
 * are `./e2eCallScenarios.ts`.
 *
 * **Never beside the owner's conversation.** A typed conversation REPLACES an older one (`site/lib/talkArbiter.ts`), so the
 * question waits until no call lease is live and no typed conversation of the owner's is open, and afterwards says whether one
 * was written to beside it.
 */
import { queueSearchQuestion } from "../../../desktop/e2eCallPlan.js";
import { type E2eQueueSearchAnswer, queueSearchAnswerOf } from "../../../desktop/e2eCallQueueSearch.js";
import { openTypedConversations, typedBesideSince } from "./e2eCallEvidenceRead.js";
import { liveRows, typeToVoice, until } from "./e2eCallPage.js";
import { awaitAnswer, CLEAR_CAP_MS, nothingYet, type Scenario } from "./e2eCallScenarios.js";
import { type CallSession, voicePageOf } from "./e2eCallSession.js";
import type { VoiceView } from "./e2eCallView.js";
import { readOnCallHold } from "./onCallRead.js";

/** How long `queue-search`'s one-word answer must stay the last row before it counts. */
const ANSWER_SETTLE_MS = 8000;

/**
 * Wait until nothing of the owner's is up that a typed conversation would disturb: no call lease live, and no typed
 * conversation of the owner's open, which a newer one would REPLACE (`site/lib/talkArbiter.ts`).
 *
 * @returns `undefined` once clear, else what stayed up at the cap
 */
export async function typedWhenClear({ session }: { session: CallSession }): Promise<string | undefined> {
  let problem: string | undefined;
  const clear = await until({
    capMs: CLEAR_CAP_MS,
    test: async () => {
      problem = typedNotClear({ session });
      return problem === undefined;
    },
  });
  return clear ? undefined : `no typed conversation opened beside one of the owner's — ${String(problem)}`;
}

/**
 * One read of what a typed conversation would disturb.
 *
 * @returns `undefined` when the owner is not on a call and no typed conversation of the owner's is open, else what is, or why either
 * could not be read
 */
function typedNotClear({ session }: { session: CallSession }): string | undefined {
  // The whole on-call hold, not a lease list: a lease that does not parse may be the owner's call, and their Zoom or Meet holds
  // the real microphone and writes no lease at all. A typed conversation holds no lease and the
  // test instance never opens the real microphone, so the hold is never the test's own. Only waited on here, as the
  // Talk press's wait is; the read at the send itself records it (`typedSendNotClear`).
  const onCall = readOnCallHold({ home: session.spec.home });
  if (onCall !== undefined) {
    return onCall.message;
  }
  return typedOpen({ session });
}

/**
 * The read at a typed send itself: the whole on-call hold, RECORDED on the session when present so the leg stops on
 * it even once the owner's call has ended by the cleanup — exactly as the Talk press's read at the click is — then any typed
 * conversation of the owner's open.
 *
 * @returns `undefined` when the send may go, else why not
 */
export function typedSendNotClear({ session }: { session: CallSession }): string | undefined {
  const onCall = heldAtSend({ session });
  if (onCall !== undefined) {
    return onCall;
  }
  return typedOpen({ session });
}

/**
 * The whole on-call hold read at a send, recorded on the session when present.
 *
 * @returns the hold's message, `undefined` when the owner is not on a call
 */
export function heldAtSend({ session }: { session: CallSession }): string | undefined {
  const onCall = readOnCallHold({ home: session.spec.home });
  if (onCall === undefined) {
    return undefined;
  }
  session.onCallHold = onCall;
  return onCall.message;
}

/**
 * Whether a typed conversation of the owner's is open, which a newer one would replace.
 *
 * @returns `undefined` when none is, else which, or why the store could not say
 */
function typedOpen({ session }: { session: CallSession }): string | undefined {
  const typed = openTypedConversations({ home: session.spec.home, nowMs: Date.now() });
  if (typed.isErr()) {
    return typed.error.message;
  }
  if (typed.value.length === 0) {
    return undefined;
  }
  return `typed conversation(s) open: ${typed.value.join(", ")}`;
}

/**
 * Whether a typed conversation beside the test's was written to after the last read found none of the owner's open: one
 * opened before the press and so ended by it whether or not its close line landed, or one the owner opened after, which
 * ended the test's.
 *
 * @param clearReadMs when that last read began
 * @param ownerText what the test's typed turn contains: the run's nonce
 * @returns `undefined` when none was, else which were, or that the store could not say
 */
export function besideOwnerText({
  session,
  clearReadMs,
  ownerText,
}: {
  session: CallSession;
  clearReadMs: number;
  ownerText: string;
}): string | undefined {
  const read = typedBesideSince({ clearReadMs, home: session.spec.home, ownerText });
  if (read.isErr()) {
    return `whether the typed question replaced a conversation of the owner's cannot be told — ${read.error.message}`;
  }
  const { beside, unread } = read.value;
  // Both are said: a file it could not read never hides a conversation it could.
  const problems: string[] = [];
  if (beside.length > 0) {
    problems.push(`a typed conversation beside the test's was written to after the clear read: ${beside.join(", ")}`);
  }
  if (unread.length > 0) {
    problems.push(
      `whether the typed question replaced a conversation of the owner's cannot be told — ${unread.join("; ")}`,
    );
  }
  return problems.length > 0 ? problems.join("; ") : undefined;
}

/**
 * `queue-search`: with no call up, a Queue question is TYPED into the orb messenger, which opens a typed conversation
 * — the surface where the search timed out — and its thread answers one word once its search
 * returns. The first row after the question may be a preamble, so the wait runs until the LAST row is the thread's
 * and is one of the three words, and that word must hold through a settle. Whether the search really ran is read
 * from the call store after cleanup, by the driver. `live` here means the typed conversation took the question: it
 * has no mute control to show.
 *
 * @returns what the conversation showed and the thread's one-word answer, for the judge
 */
export const queueSearch: Scenario = async ({ session, step, nonce }) => {
  const opened = await voicePageOf({ session });
  if (opened.isErr()) {
    return { ...nothingYet({ view: undefined }), blocked: opened.error.message };
  }
  const view = opened.value;
  const busy = await typedWhenClear({ session });
  if (busy !== undefined) {
    return { ...nothingYet({ view }), blocked: busy };
  }
  const ownerText = `E2E typed ${nonce}`;
  // A row already carrying the nonce would let an old answer stand for this run's.
  if ((await liveRows({ view })).some((row) => row.text.includes(ownerText))) {
    return { ...nothingYet({ view }), blocked: `a row already showed "${ownerText}" before the question was typed` };
  }
  const typed = await typeToVoice({
    clear: async () => typedSendNotClear({ session }),
    text: queueSearchQuestion({ nonce }),
    view,
  });
  if (typed.isErr()) {
    return { ...nothingYet({ view }), blocked: typed.error.message };
  }
  const deadline = Date.now() + step.capMs;
  const answer = await awaitAnswer({ capMs: step.capMs, ownerText, view });
  const queueSearchAnswer = answer.voiceAnswer ? await settledAnswer({ deadline, ownerText, view }) : undefined;
  const blocked = besideOwnerText({ clearReadMs: typed.value.clearReadMs, ownerText, session });
  return { ...nothingYet({ view }), ...answer, blocked, live: true, queueSearchAnswer };
};

/**
 * The one-word answer once it has stayed the last row, unchanged, for {@link ANSWER_SETTLE_MS} on every read: any
 * change — another word, a sentence, a new row — restarts the clock, so a word the thread goes on to replace never
 * counts. The reads are {@link until}'s, so a change and its reversal inside one interval is not
 * seen. The settle is timed on the monotonic clock, so a wall-clock jump cannot shorten it.
 *
 * @param ownerText what the question's turn contains: the run's nonce
 * @param deadline when the search's cap runs out; a word still settling then gets one settle more
 * @returns the settled word, `undefined` when none settled in time
 */
async function settledAnswer({
  view,
  ownerText,
  deadline,
}: {
  view: VoiceView;
  ownerText: string;
  deadline: number;
}): Promise<E2eQueueSearchAnswer | undefined> {
  let word: E2eQueueSearchAnswer | undefined;
  let sinceMs = performance.now();
  const held = (): boolean => word !== undefined && performance.now() - sinceMs >= ANSWER_SETTLE_MS;
  await until({
    capMs: Math.max(0, deadline - Date.now()) + ANSWER_SETTLE_MS,
    test: async () => {
      const now = queueSearchAnswerOf({ ownerText, rows: await liveRows({ view }) });
      if (now !== word) {
        word = now;
        sinceMs = performance.now();
      }
      return held();
    },
  });
  return held() ? word : undefined;
}
