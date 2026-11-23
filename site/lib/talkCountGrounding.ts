/**
 * Whether a count of the owner's Queue the console voice said is one the app shows — and, when it is not, the provenance entry
 * the call keeps for it. Pure: the page folds each of the voice's FINAL segments in, with the counts the app shows at
 * that instant (`./queueShownCounts.ts`), and posts whatever grounding the fold owes.
 *
 * Measured: the voice said "That covers fourteen cards. That's the last one." while the app showed Everything 29,
 * Queue 26, Blocking the fleet 26 and Check-ins 3, and nothing the voice read that call held a
 * fourteen. No hook stops a delegated answer before the voice says it, so the property is detect and explain: a count
 * the app does not show is named on the call file, and kept as provenance the thread answering "where did that come
 * from" reads (`./talkVoiceProvenance.ts`). The voice is never handed it: a correction is one more line the owner did not ask
 * for.
 *
 * ## What reads as a count of the owner's Queue
 *
 * A cardinal — digits, or English words from zero to 999 — followed within a few words by a Queue noun: card, item,
 * ask or check-in, or directly by "waiting" — or said the other way round, a plural Queue noun or "Queue" or
 * "Everything" then "is" (or "stands at", "comes to") and a cardinal ending the clause ("The count of cards on your
 * Queue is 14"). A figure phrased any other way ("you have fourteen there") is not seen; the reading the voice is
 * handed is what keeps such a number from being said. The words around it name which figure it is: "blocking the fleet" is
 * that view's, "waiting" the sidebar badge's, and a bare "cards" the selector's Everything (or the open view's). An
 * ordinal, a money or percentage figure, a number after "top", "first", "next" or "those", and a relative one ("two
 * more cards") are not counts of the Queue, and neither is "nine rules": the property is the owner's Queue, not every number.
 * Nor is a pronoun "one" ("the one it asks for", "that one"), or a noun that is the verb of a clause of its own, its
 * subject pronoun sitting between ("one it asks"). Measured: a call read the first as one ask, and the correction it
 * owed had the voice say "Everything's ninety-three." out of nowhere. A real "the one card left" is the trade: unseen.
 */

import type { QueueShownCounts } from "./queueShownCounts";
import { type QueueView, viewLabel } from "./queueViews";
import { claimFrom } from "./talkCountGroundingClaims";
import { tokensOf } from "./talkCountGroundingTokens";
import type { CountClaim, QueueCountSubject, ShownField } from "./talkCountGroundingTypes";
import type { CountGrounding } from "./talkVoiceRecord";
import { otherContextLabel, type WorkContext } from "./workContext";

/**
 * Every count of the owner's Queue in one stretch of speech.
 *
 * @returns the claims, in the order said
 */
export function countClaimsOf({ text }: { text: string }): readonly CountClaim[] {
  const tokens = tokensOf({ text });
  const claims: CountClaim[] = [];
  let at = 0;
  while (at < tokens.length) {
    const claim = claimFrom({ at, text, tokens });
    if (claim === undefined) {
      at += 1;
    } else {
      claims.push(claim.claim);
      at = claim.next;
    }
  }
  return claims;
}

/**
 * The view's figure, under its selector label.
 *
 * @returns the field
 */
function viewField({ shown, view }: { shown: QueueShownCounts; view: QueueView }): ShownField {
  return { count: shown.views[view], label: viewLabel({ view }) };
}

/**
 * The figures the app prints that a count of this subject may be — never a figure of a different view, so "fourteen
 * cards" is not grounded by some view that happens to hold fourteen.
 *
 * @returns the fields, Everything or the badge first
 */
export function acceptedFields({
  subject,
  shown,
}: {
  subject: QueueCountSubject;
  shown: QueueShownCounts;
}): readonly ShownField[] {
  const everything: ShownField = { count: shown.everything, label: "Everything" };
  const badge: ShownField = { count: shown.waiting, label: "Queue" };
  switch (subject) {
    case "everything": {
      if (shown.view === "all") {
        return [everything];
      }
      return [everything, viewField({ shown, view: shown.view })];
    }
    case "waiting": {
      return [badge];
    }
    case "queue":
    case "asks": {
      // Two deliberate aliases, both residue: "cards on your Queue" may mean the selector or the badge, and "asks" is
      // what the console calls a card waiting on the owner's word, so it may mean every card or the badge's waiting ones.
      return [everything, badge];
    }
    case "review":
    case "check-in":
    case "colleague":
    case "fleet":
    case "urgent":
    case "slack":
    case "finding": {
      return [viewField({ shown, view: subject })];
    }
    case "slopweaver-context":
    case "work-context": {
      // The other context's figure grounds only a count that names it: a bare "fourteen cards" never borrows the
      // fourteen the switch hides. A count naming the context on screen is its Everything.
      const named: WorkContext = subject === "slopweaver-context" ? "slopweaver" : "work";
      if (named !== shown.otherContext.context) {
        return [everything];
      }
      return [{ count: shown.otherContext.count, label: otherContextLabel({ context: named }) }];
    }
    default: {
      const never: never = subject;
      return never;
    }
  }
}

/**
 * The claims the app shows no matching figure for: each is checked against the figures its own words name, and a
 * figure the app prints no number for grounds nothing.
 *
 * @param shown the app's counts at the instant the words were said, or `undefined` when there is no reading at all
 * @returns the ungrounded claims, in the order said
 */
export function ungroundedCounts({
  claims,
  shown,
}: {
  claims: readonly CountClaim[];
  shown: QueueShownCounts | undefined;
}): readonly CountClaim[] {
  if (shown === undefined) {
    return claims;
  }
  return claims.filter(
    (claim) => !acceptedFields({ shown, subject: claim.subject }).some((field) => field.count === claim.count),
  );
}

/** The figures a wrong count should have been, read. */
type ExpectedFigures = CountGrounding["expected"];

/** What happened to a count, for the call file's `count-grounding` line. */
export type CountGroundingNote =
  | {
      readonly kind: "ungrounded";
      readonly claim: CountClaim;
      readonly expected: ExpectedFigures;
      /** Whether the thinking model's words in the turn carried the same number. */
      readonly fromThread: boolean;
    }
  | { readonly kind: "recorded"; readonly claim: CountClaim }
  | { readonly kind: "not-recorded"; readonly claim: CountClaim; readonly why: string };

/** A wrong count owed a provenance entry: the claim, and the grounding the page posts for it. */
export interface OwedCountGrounding {
  readonly claim: CountClaim;
  readonly grounding: CountGrounding;
}

/** The fold's state: the voice segments already checked. */
export interface CountGroundingState {
  readonly checked: readonly string[];
}

/** The state of a call that has said nothing yet. */
export const NO_COUNT_GROUNDING: CountGroundingState = { checked: [] };

/** How many checked segment ids the fold keeps — a final segment is folded once, and only recent ones repeat. */
const CHECKED_KEPT = 64;

/**
 * Fold one of the voice's FINAL segments: every count in it the app does not show is owed one provenance entry, in the
 * order said, and written on the call file. Nothing is handed to the voice — a correction it was told to make and not
 * discuss is what put "Everything's ninety-three." in the owner's ear with no question before it — so there is nothing to listen for
 * afterwards.
 *
 * @param id the segment's id, which is folded once
 * @param text the segment, as said
 * @param shown the app's counts as it was said, or `undefined` when there is no reading at all
 * @param written the thinking model's newest completed messages on the call, for the attribution
 * @returns the next state, the groundings to post and the notes to write
 */
export function foldCountGrounding({
  state,
  id,
  text,
  shown,
  written,
}: {
  state: CountGroundingState;
  id: string;
  text: string;
  shown: QueueShownCounts | undefined;
  written: readonly string[];
}): {
  state: CountGroundingState;
  owed: readonly OwedCountGrounding[];
  notes: readonly CountGroundingNote[];
} {
  if (state.checked.includes(id)) {
    return { notes: [], owed: [], state };
  }
  const next = { checked: [...state.checked.slice(-(CHECKED_KEPT - 1)), id] };
  const owed = ungroundedCounts({ claims: countClaimsOf({ text }), shown }).map((claim): OwedCountGrounding => {
    const grounding = {
      claimed: claim.count,
      expected: expectedOf({ claim, shown }),
      fromThread: threadCarried({ claim, written }),
      key: `${id}:${String(claim.start)}`,
      subject: claim.subject,
    };
    return { claim, grounding };
  });
  const notes = owed.map(({ claim, grounding }): CountGroundingNote => ({
    claim,
    expected: grounding.expected,
    fromThread: grounding.fromThread,
    kind: "ungrounded",
  }));
  return { notes, owed, state: next };
}

/**
 * Whether what the thinking model wrote in the turn carried the same count — the attribution the call file never had
 * for one call's "fourteen cards": the thread's own words, or the voice's.
 *
 * @param written the thread's newest completed messages on the call
 * @returns whether any of them states a count of cards, items or asks with the same number
 */
function threadCarried({ claim, written }: { claim: CountClaim; written: readonly string[] }): boolean {
  return written.some((text) => countClaimsOf({ text }).some((each) => each.count === claim.count));
}

/**
 * The figures a wrong count should have been, read.
 *
 * @returns the read fields its words name; empty when the app prints none of them
 */
function expectedOf({ claim, shown }: { claim: CountClaim; shown: QueueShownCounts | undefined }): ExpectedFigures {
  if (shown === undefined) {
    return [];
  }
  return acceptedFields({ shown, subject: claim.subject }).flatMap(({ count, label }) =>
    count === undefined ? [] : [{ count, label }],
  );
}

/**
 * A note as the call file's `count-grounding` tool line says it.
 *
 * @returns the line's detail
 */
export function countGroundingDetail({ note }: { note: CountGroundingNote }): string {
  const said = `"${note.claim.words}"`;
  switch (note.kind) {
    case "ungrounded": {
      const source = note.fromThread
        ? "the thinking model wrote the same number"
        : "nothing the thinking model wrote said it";
      return `said ${said}, which the app does not show: ${expectedWords({ expected: note.expected })}; ${source}`;
    }
    case "recorded": {
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

/**
 * The figures as words.
 *
 * @returns e.g. `the app shows Everything 29`, or that it shows no figure for it yet
 */
export function expectedWords({ expected }: { expected: ExpectedFigures }): string {
  if (expected.length === 0) {
    return "the app shows no figure for it yet";
  }
  return `the app shows ${expected.map(({ count, label }) => `${label} ${String(count)}`).join(", ")}`;
}
