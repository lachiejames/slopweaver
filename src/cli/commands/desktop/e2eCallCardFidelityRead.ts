/**
 * The card-fidelity judgement of a card scenario's own calls, read from the talk store after cleanup: the effectful
 * edge of `src/desktop/cardFidelity.ts`, which is pure. Only the instance's own transcript calls are read, so a
 * conversation of the owner's is never judged.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type CardFidelityObservation, cardFidelityObservation } from "../../../desktop/cardFidelity.js";
import { segmentsOf } from "../../../desktop/cardFidelitySegments.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { cardReadChallenge, type E2eCallStep } from "../../../desktop/e2eCallPlan.js";
import { readCallEntries } from "../../../talk/callStore.js";

/**
 * Judge each of a card scenario's calls against its card, keeping every call that said or heard anything: one with
 * no segment carrying words — none at all, or only blank ones — is an offer that never went live or a call where
 * nothing was said, which proves nothing either way, and has no segment a failure could be anchored to.
 *
 * @param callIds the instance's own transcript calls
 * @param step the scenario, whose id names the surface and whose key names the card
 * @param nonce the run's token, which the challenge carries
 * @param home the state home holding the talk store
 * @returns the judgements, none for a scenario that reads no card, or why a call could not be read
 */
export function cardFidelityFromCalls({
  callIds,
  step,
  nonce,
  home,
}: {
  callIds: readonly string[];
  step: E2eCallStep;
  nonce: string;
  home: string;
}): Result<readonly CardFidelityObservation[], E2eCallError> {
  const { cardKey } = step;
  if (cardKey === undefined || (step.id !== "card-read" && step.id !== "card-read-typed")) {
    return ok([]);
  }
  const surface = step.id === "card-read" ? "spoken" : "typed";
  const challenge = cardReadChallenge({ nonce });
  const observations: CardFidelityObservation[] = [];
  for (const callId of callIds) {
    const read = readCallEntries({ callId, home });
    if (read.isErr()) {
      return err(E2eCallErrors.evidenceUnreadable({ detail: read.error.message, path: `talk call ${callId}` }));
    }
    // The judge's own fold decides, so a call kept here always has a segment with words to anchor to (r3-rail-v34).
    if (segmentsOf({ lines: read.value }).length > 0) {
      observations.push(cardFidelityObservation({ callId, cardKey, challenge, entries: read.value, surface }));
    }
  }
  return ok(observations);
}
