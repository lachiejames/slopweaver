/**
 * `card-next`: a live call opens the card `--call-card` named, the owner then says "All right, next card please", and the walk
 * must take that card down inside a window (`src/desktop/e2eCallCardNext.ts`). A measured call showed
 * the opposite: the voice said it was pulling the next one up, handed nothing over, and the card stayed up 40s.
 *
 * One saying with `say`'s own pause inside it, then a silence longer than the cap, so the microphone is heard once. The
 * call file is the witness; a voice answer is allowed and never judged.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type CardNextMove, cardNextMove } from "../../../desktop/e2eCallCardNext.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { type E2eCallEvidence, NO_CALL_EVIDENCE } from "../../../desktop/e2eCallOutcome.js";
import { readCallEntries } from "../../../talk/callStore.js";
import { until } from "./e2eCallPage.js";
import { nothingYet, type Scenario, startLive } from "./e2eCallScenarios.js";
import type { CallSession } from "./e2eCallSession.js";

/** What every one of a scenario's calls came to against the witness. */
export interface CardNextRead {
  /** Each line that took the card down, naming its call and the path that moved it. */
  readonly moves: readonly string[];
  /** Each call whose card stayed up past the window, naming it. */
  readonly stuck: readonly string[];
  /** Why the last call read is still waiting, which matters only when none moved or stuck. */
  readonly waiting: string;
}

/**
 * Judge each of this instance's calls against the witness at an instant.
 *
 * @param home the state home the calls were written under
 * @param callIds this instance's own transcript calls
 * @param cardKey the card the owner asked to leave
 * @param nowMs the instant judged at
 * @returns what each came to, or why a call file could not be read
 */
export function cardNextFromCalls({
  home,
  callIds,
  cardKey,
  nowMs,
}: {
  home: string;
  callIds: readonly string[];
  cardKey: string;
  nowMs: number;
}): Result<CardNextRead, E2eCallError> {
  const moves: string[] = [];
  const stuck: string[] = [];
  let waiting = "no transcript call of this instance yet";
  for (const callId of callIds) {
    const entries = readCallEntries({ callId, home });
    if (entries.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: entries.error.message, path: `call ${callId}` }));
    }
    const verdict: CardNextMove = cardNextMove({ cardKey, entries: entries.value, nowMs });
    if (verdict.kind === "moved") {
      moves.push(`call ${callId}: ${verdict.reason}`);
    } else if (verdict.kind === "stuck") {
      stuck.push(`call ${callId}: ${verdict.reason}`);
    } else {
      waiting = verdict.reason;
    }
  }
  return ok({ moves, stuck, waiting });
}

/**
 * `card-next`'s witness over a session's own transcript calls, judged now, after cleanup; read for that scenario only,
 * so every other step's evidence carries the empty record.
 *
 * @param session the session, cleaned up
 * @returns every move and every stall, or why a call file could not be read
 */
export function cardNextOf({ session }: { session: CallSession }): Result<E2eCallEvidence["cardNext"], E2eCallError> {
  const { step } = session.spec;
  if (step.id !== "card-next" || step.cardKey === undefined) {
    return ok(NO_CALL_EVIDENCE.cardNext);
  }
  return cardNextFromCalls({
    callIds: session.tracker.transcriptCallIds,
    cardKey: step.cardKey,
    home: session.spec.home,
    nowMs: Date.now(),
  }).map(({ moves, stuck }) => ({ moves, stuck }));
}

/**
 * `card-next`: the named card up, the owner's ask for the next one, then the card taken down inside a window.
 *
 * @returns what the call showed, for the judge: the owner's turn once the witness decided; the move itself is the evidence's
 */
export const cardNextDrive: Scenario = async ({ session, step }) => {
  const deadline = Date.now() + step.capMs;
  const { cardKey } = step;
  if (cardKey === undefined) {
    const blocked = "card-next was placed with no card to open; the planner places it only beside --call-card";
    return { ...nothingYet({ view: undefined }), blocked };
  }
  const start = await startLive({ session });
  if (start.kind === "stopped") {
    return start.outcome;
  }
  const { view } = start;
  let last: Result<CardNextRead, E2eCallError> = ok({ moves: [], stuck: [], waiting: "nothing read yet" });
  await until({
    capMs: Math.max(0, deadline - Date.now()),
    test: () => {
      last = cardNextFromCalls({
        callIds: session.tracker.transcriptCallIds,
        cardKey,
        home: session.spec.home,
        nowMs: Date.now(),
      });
      return Promise.resolve(last.isErr() || last.value.moves.length > 0 || last.value.stuck.length > 0);
    },
  });
  if (last.isErr()) {
    return { ...nothingYet({ view }), blocked: last.error.message, live: true };
  }
  const { moves, stuck, waiting } = last.value;
  if (moves.length === 0 && stuck.length === 0) {
    const short = `the call file never decided within the ${String(step.capMs / 1000)}s cap: ${waiting}`;
    return { ...nothingYet({ view }), blocked: short, live: true };
  }
  return { ...nothingYet({ view }), ownerTurn: true, live: true };
};
