/**
 * `card-read-typed`: `card-read`'s question TYPED into the orb messenger with no call up, so the typed path answers it
 * — the same request word for word behind the run's marker, the same challenge once the first answer is in, and the
 * same call-file witness (`./e2eCallCardReadScenario.ts`). The owner's own typed ask is the surface it mirrors: both
 * surfaces, never assumed the same.
 *
 * **Never beside the owner's conversation.** A typed conversation REPLACES an older one (`site/lib/talkArbiter.ts`), so the
 * request waits until no call lease is live and no typed conversation of the owner's is open; the challenge goes into the
 * test's OWN conversation, so only one of somebody else's stops it; and afterwards the scenario says whether one was
 * written to beside it, exactly as `queue-search` does.
 */
import { cardReadChallenge } from "../../../desktop/e2eCallPlan.js";
import { typedCardReadRequest } from "../../../desktop/e2eCardReadPlan.js";
import { awaitProgress, shortOf } from "./e2eCallCardReadScenario.js";
import { openTypedConversations } from "./e2eCallEvidenceRead.js";
import { liveRows, typeToVoice } from "./e2eCallPage.js";
import { besideOwnerText, heldAtSend, typedSendNotClear, typedWhenClear } from "./e2eCallQueueSearchScenario.js";
import { nothingYet, type Scenario } from "./e2eCallScenarios.js";
import { type CallSession, voicePageOf } from "./e2eCallSession.js";

/**
 * One read of what the challenge would disturb: the owner on a call — the whole on-call hold, a lease that does not parse
 * and the real microphone included — or a typed conversation open that is not this instance's own.
 * The test's typed conversation holds no lease and never opens the real microphone, so the hold is never its own.
 *
 * @returns `undefined` when clear, else what is up, or why either could not be read
 */
function othersNotClear({ session }: { session: CallSession }): string | undefined {
  // Read at the send itself, so a hold is recorded and stops the leg (`heldAtSend`).
  const onCall = heldAtSend({ session });
  if (onCall !== undefined) {
    return onCall;
  }
  const typed = openTypedConversations({ home: session.spec.home, nowMs: Date.now() });
  if (typed.isErr()) {
    return typed.error.message;
  }
  const own = new Set(session.tracker.transcriptCallIds);
  const others = typed.value.filter((id) => !own.has(id));
  if (others.length === 0) {
    return undefined;
  }
  return `typed conversation(s) not the test's: ${others.join(", ")}`;
}

/**
 * `card-read-typed`: the request typed, the named card read and answered, the challenge typed into the same
 * conversation, the card read again and answered once more. `live` means the typed conversation took the request.
 *
 * @returns what the conversation showed, for the judge: the owner's turn and the answer only once the whole witness is in
 */
export const cardReadTyped: Scenario = async ({ session, step, nonce }) => {
  const deadline = Date.now() + step.capMs;
  const { cardKey } = step;
  if (cardKey === undefined) {
    const blocked = "card-read-typed was placed with no card to read; the planner places it only beside --call-card";
    return { ...nothingYet({ view: undefined }), blocked };
  }
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
  if ((await liveRows({ view })).some((row) => row.text.includes(ownerText))) {
    return { ...nothingYet({ view }), blocked: `a row already showed "${ownerText}" before the request was typed` };
  }
  const typed = await typeToVoice({
    clear: async () => typedSendNotClear({ session }),
    text: typedCardReadRequest({ cardKey, nonce }),
    view,
  });
  if (typed.isErr()) {
    return { ...nothingYet({ view }), blocked: typed.error.message };
  }
  const challenge = cardReadChallenge({ nonce });
  const waits = { cardKey, challenge, deadline, session };
  const settled = ({ blocked }: { blocked: string | undefined }): string | undefined => {
    const beside = besideOwnerText({ clearReadMs: typed.value.clearReadMs, ownerText, session });
    const problems = [blocked, beside].filter((problem) => problem !== undefined);
    return problems.length > 0 ? problems.join("; ") : undefined;
  };
  const first = await awaitProgress({ ...waits, reach: "ready-for-challenge" });
  if (first.kind === "unread" || first.progress !== "ready-for-challenge") {
    const blocked = shortOf({ awaited: first, capMs: step.capMs, reach: "ready-for-challenge" });
    return { ...nothingYet({ view }), blocked: settled({ blocked }), live: true };
  }
  const pushed = await typeToVoice({ clear: async () => othersNotClear({ session }), text: challenge, view });
  if (pushed.isErr()) {
    return { ...nothingYet({ view }), blocked: settled({ blocked: pushed.error.message }), live: true };
  }
  const second = await awaitProgress({ ...waits, reach: "complete" });
  if (second.kind === "unread" || second.progress !== "complete") {
    const ownerTurn = second.kind === "read" && second.progress !== "ready-for-challenge";
    const blocked = shortOf({ awaited: second, capMs: step.capMs, reach: "complete" });
    return { ...nothingYet({ view }), blocked: settled({ blocked }), live: true, ownerTurn };
  }
  return {
    ...nothingYet({ view }),
    blocked: settled({ blocked: undefined }),
    live: true,
    ownerTurn: true,
    voiceAnswer: true,
  };
};
