/**
 * The voice's two claims the call can check besides a count: that something was DONE ("Draft sent.") and which PR
 * it is on ("GitHub PR one two three"). The page feeds {@link foldSpokenClaims} what the call says in order — the owner's FINAL
 * sentences, the thinking model's completed messages, the send outcomes the console handed the voice, and the voice's
 * FINAL sentences — and a claim nothing standing grounds is posted as a closed shape the server keeps as provenance
 * ({@link claimGroundingEntry}, `./talkVoiceProvenance.ts`), as a count grounding is (`./talkCountGrounding.ts`), so the
 * thread answering "why did you say that" reads where it came from. A PR number is never handed to the voice: a
 * retraction it was told to make and not discuss is one more line out of nowhere. A done claim is: the call has the
 * voice say one FIXED correction aloud as soon as the owner is not talking
 * (`./talkPlanCompletionCorrection.ts`), because, measured, a call let "…for Acme admin posted and missed the
 * deadline" stand, nothing posted, until the owner said "you're saying it posted, but clearly it didn't". A line the
 * server composes is checked before it is said instead ({@link scriptedCompletionRiskOf}). A third, fleet work the voice
 * promises as its own ("I'll get you that briefing"), is read by `./talkFleetPromises.ts` and corrected aloud the same
 * way, since nothing the thinking model writes can ground it. A fourth,
 * a draft said to be on the owner's running list with no offer landed that the owner has not moved on from, is read by
 * `./talkRunningListClaims.ts` and corrected aloud too.
 *
 * Two failures shape the fold. The owner says "I've just sent that" of their own message; the
 * thinking model writes "Send that bump, park it, or drop it?", its next message is empty, and
 * the voice says "Draft sent." — nothing was sent. So a proposal clears an act the owner's words had stood up,
 * or the bug hides behind the owner's own sentence. And the thinking model writes "You're looking at" a
 * colleague's API pull request with no number, and eleven seconds later the voice says it is on "PR one two three";
 * the real PR has a five-digit number. The prompt already tells the voice never to claim a thing done; it does anyway.
 *
 * Narrow on purpose, and narrower since a done claim owed is said aloud: a wrong correction is worse than a missed one.
 * A done claim is only one of seven past forms ("landed" and "went up" only about an artifact), never in a question,
 * never after a negation, a modal, a future or a "when", never the owner's own act ("you posted the review") or somebody
 * else's, never one read off a record or placed in history ("the card says Ada approved them last year"), never a card
 * "sent back", and never inside quotation marks — a call can go on to discuss "draft sent" and a pull request by its number.
 * MEASURED over every call file carrying a completed message (117 calls, 6,334 FINAL voice sentences), fed
 * in file order with no send outcome: six done claims owed, none of them true — "Draft sent.", a steer-risk line
 * naming a slug, "I've sent a fresh message to the supervisor" when the relay reached only the board,
 * "Claude's linting reply is sent." after "the one you want sent", "It's sent", which the
 * voice took back itself ("the send is still pending"), and "The ten security bumps posted…", tomorrow's
 * plan said as done. The rules after "the owner's own act" cut seven more that restated true things. That replay was a
 * one-off over the operator's own call files. A written synthetic trace in the shape of each of the two failures
 * above — their timing and every word the fold reads kept, every other word invented — replays whole in `yarn vitest run --config
 * config/vitest/unit.ts site/__tests__/unit/talkSpokenClaims.test.ts`.
 */

import { outcomeClaimsOf } from "./talkSpokenClaimsClauses";
import {
  type ClaimGrounding,
  type ClaimShape,
  OUTCOME_ACTS,
  type OutcomeAct,
  type SpokenClaim,
} from "./talkSpokenClaimsTypes";
import { groundingKeyOf } from "./talkVoiceRecord";

export { outcomeClaimsOf, prNumberClaimsOf } from "./talkSpokenClaimsClauses";
export {
  claimShapeOf,
  foldSpokenClaims,
  NO_SPOKEN_CLAIMS,
  type SpokenClaimsInput,
  type SpokenClaimsState,
  spokenClaimsOf,
} from "./talkSpokenClaimsFold";
export {
  type ClaimGrounding,
  type ClaimShape,
  type CorrectableClaimShape,
  OUTCOME_ACTS,
  type OutcomeAct,
  type SentenceClaim,
  type SpokenClaim,
} from "./talkSpokenClaimsTypes";

/**
 * A run of words joined by hyphens, underscores, dots or slashes, a separator repeated or not: a slug, a branch, a row
 * id, its words in any script. A hyphen is any dash punctuation and an underscore any connector, and a word keeps its
 * combining marks. A done word in a `foo--posted--bar`, a `café-posted` or a `foo‐posted` (U+2010) is one an
 * ASCII, single-separator match would pass over.
 */
const COMPOUND = /[\p{L}\p{M}\p{N}]+(?:[\p{Pd}\p{Pc}./]+[\p{L}\p{M}\p{N}]+)+/gu;

/** What {@link COMPOUND} joins its words with, to read the words back out. */
const SEPARATORS = /[\p{Pd}\p{Pc}./]+/u;

/**
 * The done act a line the server is about to hand the voice could be heard as claiming, read BEFORE it is said:
 * a done claim in its words, or a past form inside a slug. A steer-risk line
 * naming the row `vulnfix-top-up-for-acme-admin-posted-in` can have the voice — which paraphrases what it is handed — say "Your
 * steered vuln fix top up for Acme admin posted and missed the deadline" when nothing was posted. The tokenizer reads
 * a hyphenated slug as one word, so the slug's own parts are read here. Wider than {@link outcomeClaimsOf} on purpose:
 * what it costs is a plainer line, never a correction.
 *
 * @returns the act, or `undefined` when nothing in the line could be heard as one done
 */
export function scriptedCompletionRiskOf({ text }: { text: string }): OutcomeAct | undefined {
  const claimed = outcomeClaimsOf({ text }).at(0);
  if (claimed !== undefined) {
    return claimed.act;
  }
  for (const match of text.matchAll(COMPOUND)) {
    const parts = match[0].toLowerCase().split(SEPARATORS);
    const act = OUTCOME_ACTS.find((each) => {
      const words = each.split(" ");
      return parts.some((_, at) => words.every((word, offset) => parts[at + offset] === word));
    });
    if (act !== undefined) {
      return act;
    }
  }
  return undefined;
}

/**
 * Whether a value is an object whose fields can be read.
 *
 * @returns true for a non-null, non-array object
 */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A page's posted claim grounding, or why it is refused: exactly a key, a kind and its one field, an act from the
 * closed set or a whole PR number from 1, or a key and a kind alone for a repeated ask or a fleet promise. No words
 * travel: the entry is {@link claimGroundingEntry}'s.
 *
 * @param value the body's `grounding` field
 * @returns the grounding, or the refusal
 */
export function claimGroundingOf({ value }: { value: unknown }): ClaimGrounding | { readonly refused: string } {
  if (!isObject(value)) {
    return { refused: "grounding must be an object" };
  }
  const key = groundingKeyOf({ value: value["key"] });
  if (typeof key !== "string") {
    return key;
  }
  const keys = Object.keys(value).toSorted().join(",");
  if (value["kind"] === "outcome") {
    const act = OUTCOME_ACTS.find((each) => each === value["act"]);
    if (keys !== "act,key,kind" || act === undefined) {
      return { refused: `an outcome grounding is exactly key, kind and act, one of ${OUTCOME_ACTS.join(", ")}` };
    }
    return { act, key, kind: "outcome" };
  }
  if (value["kind"] === "pr-number") {
    const claimed = value["claimed"];
    if (keys !== "claimed,key,kind" || typeof claimed !== "number" || !Number.isSafeInteger(claimed) || claimed < 1) {
      return { refused: "a PR number grounding is exactly key, kind and claimed, a whole number from 1" };
    }
    return { claimed, key, kind: "pr-number" };
  }
  if (value["kind"] === "repeated-ask" || value["kind"] === "fleet-promise" || value["kind"] === "running-list") {
    if (keys !== "key,kind") {
      return { refused: `a ${value["kind"]} grounding is exactly key and kind` };
    }
    return { key, kind: value["kind"] };
  }
  return { refused: "kind must be outcome, pr-number, repeated-ask, fleet-promise or running-list" };
}

/**
 * An act as the words saying it happened: "was posted", "went up".
 *
 * @returns the words
 */
export function doneWordsOf({ act }: { act: OutcomeAct }): string {
  return act === "went up" ? act : `was ${act}`;
}

/**
 * The provenance a claim grounding is kept as: what the voice claimed, and that nothing on the call said it first.
 * Nothing here is handed to the voice; a done claim's correction aloud is the call's own fixed sentence
 * (`./talkPlanCompletionCorrection.ts`).
 *
 * @returns the entry's text and why
 */
export function claimGroundingEntry({ grounding }: { grounding: ClaimShape }): { text: string; why: string } {
  if (grounding.kind === "outcome") {
    const done = doneWordsOf({ act: grounding.act });
    return {
      text: `the voice said something ${done}`,
      why:
        `nothing the thinking model wrote said it ${done}, and no send outcome confirmed it, so it is the realtime ` +
        "voice's own; the call owes a correction aloud, said once the floor is clear",
    };
  }
  if (grounding.kind === "repeated-ask") {
    return {
      text: "the voice asked the owner again a question it had already put to them on this card",
      why:
        "the owner had spoken since it first asked, and no answer the thinking model wrote since asked it, so the repeat is " +
        "the realtime voice's own; nobody took it back aloud",
    };
  }
  if (grounding.kind === "fleet-promise") {
    return {
      text: "the voice promised fleet work as its own",
      why:
        "a briefing, an investigation or a carried requirement is the fleet's to do, never the voice's, whatever the " +
        "thinking model wrote; the call owes a correction aloud naming the fleet, said once the floor is clear",
    };
  }
  if (grounding.kind === "running-list") {
    return {
      text: "the voice said it put a draft on the owner's running list",
      why:
        "no offer landed on the list that the owner has not moved on from, so the line is the realtime voice's own; the " +
        "call owes a correction aloud, said once the floor is clear",
    };
  }
  return {
    text: `the voice named PR ${String(grounding.claimed)}`,
    why: "no answer the thinking model wrote and nothing the owner said gave that number, so it is the realtime voice's own",
  };
}

/** What happened to a claim, for the call file's `spoken-grounding` line. */
export type SpokenGroundingNote =
  | { readonly kind: "ungrounded"; readonly claim: SpokenClaim }
  | { readonly kind: "recorded"; readonly claim: SpokenClaim }
  | { readonly kind: "not-recorded"; readonly claim: SpokenClaim; readonly why: string };

/**
 * A note as the call file's `spoken-grounding` tool line says it.
 *
 * @returns the line's detail
 */
export function spokenGroundingDetail({ note }: { note: SpokenGroundingNote }): string {
  const said = `"${note.claim.words}"`;
  switch (note.kind) {
    case "ungrounded": {
      if (note.claim.kind === "outcome") {
        const done = doneWordsOf({ act: note.claim.act });
        return `said ${said}: nothing the thinking model wrote said it ${done}, and no send outcome confirmed it`;
      }
      if (note.claim.kind === "repeated-ask") {
        return `said ${said}: asked again after the owner spoke, and nothing the thinking model wrote since asked it`;
      }
      if (note.claim.kind === "fleet-promise") {
        return `said ${said}: promised fleet work as the voice's own`;
      }
      if (note.claim.kind === "running-list") {
        return `said ${said}: no offer landed on the owner's running list that they have not moved on from`;
      }
      return `said ${said}: PR ${String(note.claim.claimed)} is in nothing the thinking model wrote`;
    }
    case "recorded": {
      if (note.claim.kind === "outcome" || note.claim.kind === "fleet-promise" || note.claim.kind === "running-list") {
        return `recorded where ${said} came from, for the thinking model; the call owes the voice a correction aloud`;
      }
      return `recorded where ${said} came from, for the thinking model; the voice was not told`;
    }
    case "not-recorded": {
      return `could not record where ${said} came from: ${note.why}`;
    }
    default: {
      const never: never = note;
      return never;
    }
  }
}
