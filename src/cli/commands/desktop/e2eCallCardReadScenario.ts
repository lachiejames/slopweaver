/**
 * `card-read`: a live call reads the card whose key `--call-card` named — `read_card`, or `open_card` while it is on
 * the owner's Queue — and says it, is challenged by a typed turn, reads the same card again either way, and answers once
 * more. A card the owner already took off their Queue is read with `read_card` both times, since `open_card` opens nothing
 * for one. The two failures of a misread card the console's prompt lines name
 * are what it exercises — a card said in the voice's terms rather than the card's, and a challenge conceded
 * without re-reading.
 *
 * **Two turns, never one.** The microphone says only the opening request, then a silence longer than the whole cap,
 * so it is heard once. The challenge is TYPED into the live call only once the call file shows the exact card read
 * or opened and a first answer written, so it can never reach the voice before that answer.
 *
 * **The call file is the witness, never the tray.** The session-details tray is a picture of work; the call file's
 * ordered tool and segment lines (`src/desktop/e2eCallCardRead.ts`) say which card was opened and read, and that an
 * answer followed each. Whether either answer was faithful to the card is not judged here.
 */
import { ok, type Result } from "#lib/result.js";
import type { E2eCardReadProgress } from "../../../desktop/e2eCallCardRead.js";
import type { E2eCallError } from "../../../desktop/e2eCallErrors.js";
import { cardReadChallenge } from "../../../desktop/e2eCallPlan.js";
import { cardReadProgressFromCalls } from "./e2eCallEvidenceRead.js";
import { typeIntoCall, until } from "./e2eCallPage.js";
import { nothingYet, type Scenario, startLive } from "./e2eCallScenarios.js";
import type { CallSession } from "./e2eCallSession.js";

/**
 * The transcript calls that hold `card-read`'s whole ordered witness, read for `card-read` and `card-read-typed`
 * only, and only over this instance's own transcript calls.
 *
 * @param session the session, cleaned up
 * @param nonce the run's token, whose typed marker the challenge carries
 * @returns the calls, none for any other scenario, or why one could not be read
 */
export function cardReadWitnessOf({
  session,
  nonce,
}: {
  session: CallSession;
  nonce: string;
}): Result<readonly string[], E2eCallError> {
  const { step } = session.spec;
  const witnessed = step.id === "card-read" || step.id === "card-read-typed";
  if (!witnessed || step.cardKey === undefined) {
    return ok([]);
  }
  return cardReadProgressFromCalls({
    callIds: session.tracker.transcriptCallIds,
    cardKey: step.cardKey,
    challenge: cardReadChallenge({ nonce }),
    home: session.spec.home,
  }).map((read) => read.completeCallIds);
}

/** What waiting on the call file came to: the state it stood at, or why it could not be read. */
export type Awaited =
  | { readonly kind: "read"; readonly progress: E2eCardReadProgress }
  | { readonly kind: "unread"; readonly message: string };

/**
 * Wait, against the scenario's one absolute deadline, for this instance's own calls to reach a progress state.
 *
 * @param session the session, whose tracker names this instance's transcript calls
 * @param cardKey the card the witness is judged against
 * @param challenge the whole typed challenge a final line of the owner's must carry
 * @param reach the state to wait for
 * @param deadline the epoch millisecond past which it stops waiting
 * @returns the last state read, or why the call file could not be read
 */
export async function awaitProgress({
  session,
  cardKey,
  challenge,
  reach,
  deadline,
}: {
  session: CallSession;
  cardKey: string;
  challenge: string;
  reach: E2eCardReadProgress;
  deadline: number;
}): Promise<Awaited> {
  let awaited: Awaited = { kind: "read", progress: "waiting-for-open" };
  await until({
    capMs: Math.max(0, deadline - Date.now()),
    test: async () => {
      const read = cardReadProgressFromCalls({
        callIds: session.tracker.transcriptCallIds,
        cardKey,
        challenge,
        home: session.spec.home,
      });
      if (read.isErr()) {
        awaited = { kind: "unread", message: read.error.message };
        return true;
      }
      awaited = { kind: "read", progress: read.value.progress };
      return read.value.progress === reach;
    },
  });
  return awaited;
}

/**
 * Why the witness stopped short, in words a seat reads.
 *
 * @param capMs the scenario's cap
 * @param awaited what the last read came to
 * @param reach the state it waited for
 * @returns the sentence
 */
export function shortOf({
  capMs,
  awaited,
  reach,
}: {
  capMs: number;
  awaited: Awaited;
  reach: E2eCardReadProgress;
}): string {
  if (awaited.kind === "unread") {
    return awaited.message;
  }
  return (
    `the call file never reached ${reach} within the ${String(capMs / 1000)}s cap; its furthest call stood at ` +
    awaited.progress
  );
}

/**
 * `card-read`: the named card read or opened, a first answer, the typed challenge, the card read or opened again, a
 * second answer.
 *
 * @returns what the call showed, for the judge: the owner's turn and the voice's answer only once the whole witness is in
 */
export const cardRead: Scenario = async ({ session, step, nonce }) => {
  // One absolute deadline from the scenario's start, which the microphone's silence outlasts (`e2eCallPlan.ts`).
  const deadline = Date.now() + step.capMs;
  const { cardKey } = step;
  if (cardKey === undefined) {
    const blocked = "card-read was placed with no card to read; the planner places it only beside --call-card";
    return { ...nothingYet({ view: undefined }), blocked };
  }
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  const challenge = cardReadChallenge({ nonce });
  const waits = { cardKey, challenge, deadline, session };
  const first = await awaitProgress({ ...waits, reach: "ready-for-challenge" });
  if (first.kind === "unread" || first.progress !== "ready-for-challenge") {
    return {
      ...nothingYet({ view }),
      blocked: shortOf({ awaited: first, capMs: step.capMs, reach: "ready-for-challenge" }),
      live: true,
    };
  }
  const typed = await typeIntoCall({ text: challenge, view });
  if (typed.isErr()) {
    return { ...nothingYet({ view }), blocked: typed.error.message, live: true };
  }
  const second = await awaitProgress({ ...waits, reach: "complete" });
  if (second.kind === "unread" || second.progress !== "complete") {
    const ownerTurn = second.kind === "read" && second.progress !== "ready-for-challenge";
    return {
      ...nothingYet({ view }),
      blocked: shortOf({ awaited: second, capMs: step.capMs, reach: "complete" }),
      ownerTurn,
      live: true,
    };
  }
  return { ...nothingYet({ view }), ownerTurn: true, live: true, voiceAnswer: true };
};
