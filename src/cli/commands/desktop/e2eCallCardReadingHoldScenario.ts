/**
 * `card-reading-hold`: a live call opens the card `--call-card` named, the owner says they only just started reading it and
 * "let me just keep reading", and then nothing may move them off it — no resume, no console-started turn of its own, no
 * other card and no triage step — for a whole window (`src/desktop/e2eCallCardReadingHold.ts`). A measured call
 * showed the opposite: the page resumed 5s into the owner's silence and the thinking model re-pitched the card.
 *
 * One saying, then a silence longer than the cap, so the microphone is heard once. The call file is the witness; a
 * voice answer is allowed and never judged.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type CardReadingHold, cardReadingHold } from "../../../desktop/e2eCallCardReadingHold.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { type E2eCallEvidence, NO_CALL_EVIDENCE } from "../../../desktop/e2eCallOutcome.js";
import { readCallEntries } from "../../../talk/callStore.js";
import { until } from "./e2eCallPage.js";
import { nothingYet, type Scenario, startLive } from "./e2eCallScenarios.js";
import type { CallSession } from "./e2eCallSession.js";

/** What every one of a scenario's calls came to against the witness. */
export interface ReadingHoldRead {
  readonly heldCallIds: readonly string[];
  /** Each move, naming its call. */
  readonly moves: readonly string[];
  /** Why the last call read is still waiting, which matters only when none held or moved. */
  readonly waiting: string;
}

/**
 * Judge each of this instance's calls against the witness at an instant.
 *
 * @param home the state home the calls were written under
 * @param callIds this instance's own transcript calls
 * @param cardKey the card the owner was reading
 * @param nowMs the instant judged at
 * @returns what each came to, or why a call file could not be read
 */
export function readingHoldFromCalls({
  home,
  callIds,
  cardKey,
  nowMs,
}: {
  home: string;
  callIds: readonly string[];
  cardKey: string;
  nowMs: number;
}): Result<ReadingHoldRead, E2eCallError> {
  const heldCallIds: string[] = [];
  const moves: string[] = [];
  let waiting = "no transcript call of this instance yet";
  for (const callId of callIds) {
    const entries = readCallEntries({ callId, home });
    if (entries.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: entries.error.message, path: `call ${callId}` }));
    }
    const verdict: CardReadingHold = cardReadingHold({ cardKey, entries: entries.value, nowMs });
    if (verdict.kind === "held") {
      heldCallIds.push(callId);
    } else if (verdict.kind === "moved") {
      moves.push(`call ${callId}: ${verdict.reason}`);
    } else {
      waiting = verdict.reason;
    }
  }
  return ok({ heldCallIds, moves, waiting });
}

/**
 * `card-reading-hold`'s witness over a session's own transcript calls, judged now, after cleanup; read for that
 * scenario only, so every other step's evidence carries the empty record.
 *
 * @param session the session, cleaned up
 * @returns the calls that held and every move, or why one could not be read
 */
export function readingHoldOf({
  session,
}: {
  session: CallSession;
}): Result<E2eCallEvidence["readingHold"], E2eCallError> {
  const { step } = session.spec;
  if (step.id !== "card-reading-hold" || step.cardKey === undefined) {
    return ok(NO_CALL_EVIDENCE.readingHold);
  }
  return readingHoldFromCalls({
    callIds: session.tracker.transcriptCallIds,
    cardKey: step.cardKey,
    home: session.spec.home,
    nowMs: Date.now(),
  }).map(({ heldCallIds, moves }) => ({ heldCallIds, moves }));
}

/**
 * `card-reading-hold`: the named card up, the owner's words that they are still reading it, then a window with nothing moving them.
 *
 * @returns what the call showed, for the judge: the owner's turn once the witness decided; the hold itself is the evidence's
 */
export const cardReadingHoldDrive: Scenario = async ({ session, step }) => {
  const deadline = Date.now() + step.capMs;
  const { cardKey } = step;
  if (cardKey === undefined) {
    const blocked = "card-reading-hold was placed with no card to read; the planner places it only beside --call-card";
    return { ...nothingYet({ view: undefined }), blocked };
  }
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  let last: Result<ReadingHoldRead, E2eCallError> = ok({ heldCallIds: [], moves: [], waiting: "nothing read yet" });
  await until({
    capMs: Math.max(0, deadline - Date.now()),
    test: () => {
      last = readingHoldFromCalls({
        callIds: session.tracker.transcriptCallIds,
        cardKey,
        home: session.spec.home,
        nowMs: Date.now(),
      });
      return Promise.resolve(last.isErr() || last.value.moves.length > 0 || last.value.heldCallIds.length > 0);
    },
  });
  if (last.isErr()) {
    return { ...nothingYet({ view }), blocked: last.error.message, live: true };
  }
  const { heldCallIds, moves, waiting } = last.value;
  if (moves.length === 0 && heldCallIds.length === 0) {
    const short = `the call file never decided within the ${String(step.capMs / 1000)}s cap: ${waiting}`;
    return { ...nothingYet({ view }), blocked: short, live: true };
  }
  return { ...nothingYet({ view }), ownerTurn: true, live: true };
};
