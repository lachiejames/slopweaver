/**
 * The fold over a call's turns that finds the done claims nothing standing grounds, the per-sentence claim reader it
 * runs, and the closed shape a claim is posted as. Split out of `./talkSpokenClaims.ts`, which re-exports them.
 */

import { maskQuotes } from "./spokenQuotes";
import { fleetPromiseClaimsOf } from "./talkFleetPromises";
import { runningListClaimsOf } from "./talkRunningListClaims";
import { actMentionsOf, outcomeClaimsOf, prNumberClaimsOf } from "./talkSpokenClaimsClauses";
import type { ClaimShape, OutcomeAct, SentenceClaim, SpokenClaim } from "./talkSpokenClaimsTypes";
import { SAME_ACT } from "./talkSpokenClaimsWords";

/**
 * Every claim in one of the voice's sentences the call can check.
 *
 * @returns the done claims, PR numbers, fleet promises and running-list claims, in the order said
 */
export function spokenClaimsOf({ text }: { text: string }): readonly SentenceClaim[] {
  return [
    ...outcomeClaimsOf({ text }),
    ...prNumberClaimsOf({ text }),
    ...fleetPromiseClaimsOf({ text }),
    ...runningListClaimsOf({ text }),
  ].toSorted((a, b) => a.start - b.start);
}

/**
 * Every PR number a message names: after "PR" or "pull request", or as `#NNNNN` or `/pull/NNNNN`.
 *
 * @returns the numbers
 */
function namedPrNumbers({ text }: { text: string }): readonly number[] {
  const masked = maskQuotes({ text });
  const linked = [...masked.matchAll(/(?:#|\/pull\/)(\d+)/gu)].map((match) => Number(match[1]));
  return [...prNumberClaimsOf({ text }).map((claim) => claim.claimed), ...linked];
}

/** One act something on the call said was done, and how many completed messages have been written since. */
interface StandingAct {
  readonly act: OutcomeAct;
  readonly since: number;
}

/**
 * The fold's state: every input already read, by kind and id, so a FINAL segment or completed message repeated is read
 * once; the acts that stand as done; the PR numbers the call has named; and where the last offer to land on the owner's running
 * list stands: `unanswered` until the voice finishes a sentence, `answered` after, and `none` once the owner begins one
 * after that, which is the owner moving on.
 */
export interface SpokenClaimsState {
  readonly checked: readonly string[];
  readonly standing: readonly StandingAct[];
  readonly prNumbers: readonly number[];
  readonly offerLanding: "none" | "unanswered" | "answered";
}

/** The state of a call that has said nothing yet. */
export const NO_SPOKEN_CLAIMS: SpokenClaimsState = { checked: [], offerLanding: "none", prNumbers: [], standing: [] };

/**
 * What the fold is fed, in the order the page sees it: one of the voice's FINAL sentences, one of the owner's, a completed
 * message of the thinking model's, the acts a send outcome the console handed the voice confirmed, an offer of the
 * thinking model's landing on the owner's running list, or the owner starting a new sentence. A segment's id is its
 * speech id and a message's is its item id, so a repeated one is read once.
 *
 * The running list's boundary is where the owner's sentence BEGAN, never its FINAL: an offer made while the owner was
 * still talking answers that sentence, and reading the boundary at its FINAL would correct the voice's true line about
 * it. And it counts only once the voice has answered the landing, because a noise is a sentence of the owner's too:
 * "[lip smack] Okay." beginning between a landing and the line about it must not correct that line.
 */
export type SpokenClaimsInput =
  | { readonly kind: "said"; readonly id: string; readonly text: string }
  | { readonly kind: "heard"; readonly id: string; readonly text: string }
  | { readonly kind: "wrote"; readonly id: string; readonly text: string }
  | { readonly kind: "confirmed"; readonly acts: readonly OutcomeAct[] }
  | { readonly kind: "offer-landed" }
  | { readonly kind: "owner-began" };

/**
 * Whether a standing act is the act mentioned or the one {@link SAME_ACT} pairs it with, so a "posted" grounds a "sent"
 * and a proposal to send clears a "posted" too: "the one you want sent" after a send outcome
 * confirmed both.
 *
 * @param act the act mentioned
 * @param each the standing act
 * @returns true when either names the other
 */
function sameActAs({ act, each }: { act: OutcomeAct; each: OutcomeAct }): boolean {
  return each === act || each === SAME_ACT[act];
}

/** How many completed messages an act said done stands for: the newest four, as the count check reads. */
const STANDING_FOR = 4;

/**
 * The standing acts after a text's mentions, in order: each mention clears its act, and one said done stands again.
 * So "I've just sent that" followed by "Send that bump?" leaves nothing sent.
 *
 * @param byOwner whether the owner spoke the text, so "you sent it" is the console's act rather than the owner's
 * @returns the acts that stand
 */
function afterMentions({
  standing,
  text,
  byOwner,
}: {
  standing: readonly StandingAct[];
  text: string;
  byOwner: boolean;
}): readonly StandingAct[] {
  let next = standing;
  for (const mention of actMentionsOf({ byOwner, text })) {
    next = next.filter((each) => !sameActAs({ act: mention.act, each: each.act }));
    if (mention.done) {
      next = [...next, { act: mention.act, since: 0 }];
    }
  }
  return next;
}

/**
 * Read one of the voice's segments in order. A proposal or attempt clears its act from that point on, so "Should I send
 * it again? The other draft was sent." owes the second sentence; a done claim is checked against what stands at its
 * own place and changes nothing, since the voice's say-so neither grounds an act nor spends one.
 *
 * @returns where each done claim nothing stood for starts, and the acts that stand after the segment
 */
function readVoiceSegment({ standing, text }: { standing: readonly StandingAct[]; text: string }): {
  ungrounded: readonly number[];
  standing: readonly StandingAct[];
} {
  let next = standing;
  const ungrounded: number[] = [];
  for (const mention of actMentionsOf({ byOwner: false, text })) {
    if (!mention.done) {
      next = next.filter((each) => !sameActAs({ act: mention.act, each: each.act }));
    } else if (!next.some((each) => sameActAs({ act: mention.act, each: each.act }))) {
      ungrounded.push(mention.start);
    }
  }
  return { standing: next, ungrounded };
}

/**
 * Whether something on the call grounds one claim: a done claim the acts standing at its place, a PR number one the
 * thinking model wrote or the owner said, a running-list claim an offer landed that the owner has not moved on from. A fleet promise
 * is never grounded: whatever the thinking model wrote, fleet work is the fleet's to do, so the voice saying it will do
 * it is its own line.
 *
 * @param ungrounded where each done claim nothing stood for starts, from `readVoiceSegment`
 * @returns true when the call grounds it
 */
function groundedAt({
  claim,
  state,
  ungrounded,
}: {
  claim: SentenceClaim;
  state: SpokenClaimsState;
  ungrounded: readonly number[];
}): boolean {
  switch (claim.kind) {
    case "outcome": {
      return !ungrounded.includes(claim.start);
    }
    case "pr-number": {
      return state.prNumbers.includes(claim.claimed);
    }
    case "fleet-promise": {
      return false;
    }
    case "running-list": {
      // Stands however many times the voice says so: the landing is on the owner's list until the owner has moved on, and a second
      // true line corrected is worse than a second false one missed.
      return state.offerLanding !== "none";
    }
    default: {
      const never: never = claim;
      return never;
    }
  }
}

/**
 * The claims in one of the voice's segments nothing grounds, one per shape.
 *
 * @param ungrounded where each done claim nothing stood for starts, from `readVoiceSegment`
 * @returns the claims owed a provenance entry, in order
 */
function owedOf({
  state,
  text,
  ungrounded,
}: {
  state: SpokenClaimsState;
  text: string;
  ungrounded: readonly number[];
}): readonly SentenceClaim[] {
  const seen = new Set<string>();
  return spokenClaimsOf({ text }).filter((claim) => {
    const grounded = groundedAt({ claim, state, ungrounded });
    const key = JSON.stringify(claimShapeOf({ claim }));
    if (grounded || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Fold one thing the call said. A done claim of the voice's is grounded only by the same act standing as done — said
 * so by the thinking model or by the owner, or confirmed by a send outcome — within the newest four completed messages and
 * with no mention since raising it as still to happen; a PR number only by one the thinking model wrote or the owner said.
 * The voice's own sentences ground nothing, but a proposal in one clears its act. A fleet promise is always owed, and a
 * running-list claim unless an offer landed that the owner has not moved on from. Each claim owed is recorded once per
 * segment; a done claim, a fleet promise or a running-list claim is also corrected aloud by the server, a PR number
 * never handed to the voice.
 *
 * @returns the next state and the claims owed a provenance entry
 */
export function foldSpokenClaims({ state, input }: { state: SpokenClaimsState; input: SpokenClaimsInput }): {
  state: SpokenClaimsState;
  owed: readonly SentenceClaim[];
} {
  if (input.kind === "confirmed") {
    const kept = state.standing.filter((each) => !input.acts.includes(each.act));
    const standing = [...kept, ...input.acts.map((act) => ({ act, since: 0 }))];
    return { owed: [], state: { ...state, standing } };
  }
  if (input.kind === "offer-landed") {
    return { owed: [], state: { ...state, offerLanding: "unanswered" } };
  }
  if (input.kind === "owner-began") {
    const moved = state.offerLanding === "answered";
    return { owed: [], state: moved ? { ...state, offerLanding: "none" } : state };
  }
  // Every one read is kept for the whole call: a repeat of an old one, the owner's above all, would raise an act a later
  // proposal cleared. A call's ids are few enough to hold.
  const key = `${input.kind}:${input.id}`;
  if (state.checked.includes(key)) {
    return { owed: [], state };
  }
  const checked = [...state.checked, key];
  switch (input.kind) {
    case "said": {
      const { standing, ungrounded } = readVoiceSegment({ standing: state.standing, text: input.text });
      const owed = owedOf({ state, text: input.text, ungrounded });
      const offerLanding = state.offerLanding === "unanswered" ? "answered" : state.offerLanding;
      return { owed, state: { ...state, checked, offerLanding, standing } };
    }
    case "heard":
    case "wrote": {
      const aged =
        input.kind === "wrote"
          ? state.standing
              .map((each) => ({ ...each, since: each.since + 1 }))
              .filter((each) => each.since < STANDING_FOR)
          : state.standing;
      // Every distinct number for the whole call: a call names few, and one named early stays named.
      const prNumbers = [...new Set([...state.prNumbers, ...namedPrNumbers({ text: input.text })])];
      return {
        owed: [],
        state: {
          ...state,
          checked,
          prNumbers,
          standing: afterMentions({ byOwner: input.kind === "heard", standing: aged, text: input.text }),
        },
      };
    }
    default: {
      const never: never = input;
      return never;
    }
  }
}

/**
 * The closed shape a claim is posted as.
 *
 * @returns the act, or the number, and nothing the voice said
 */
export function claimShapeOf({ claim }: { claim: SpokenClaim }): ClaimShape {
  switch (claim.kind) {
    case "outcome": {
      return { act: claim.act, kind: "outcome" };
    }
    case "pr-number": {
      return { claimed: claim.claimed, kind: "pr-number" };
    }
    case "repeated-ask":
    case "fleet-promise":
    case "running-list": {
      return { kind: claim.kind };
    }
    default: {
      const never: never = claim;
      return never;
    }
  }
}
