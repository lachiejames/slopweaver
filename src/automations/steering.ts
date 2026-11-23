/**
 * How an automation has been STEERED: every request the owner sent about it, what became of each, and a timeline
 * from the row's earliest trace to now. Pure — `./read.ts` reads the relay turns and their board rows.
 *
 * ## Every control on the page speaks to the supervisor
 *
 * Nothing on the Automations page mutates a recipe. A reaction, a disable, a run-now is one typed relay (`talk relay --typed`, the
 * console's one steer input) whose `about` names the row as `recipe:<id>`; the supervisor's intake reads it and
 * amends the row itself. So a steer here IS a relay turn, and its answer is the settlement of the board row that
 * relay registered — the supervisor's own recorded word, read, never inferred.
 *
 * ## What the timeline can and cannot say
 *
 * The definition store keeps the row as it is NOW, with no creation row and no revision history. So the timeline
 * opens on the row's earliest trace (its file's birth or its oldest firing, named as which) beside its current
 * wording — never a wording it once had — and after each steer it says two measured things: the first firing that
 * started after it (and what that firing posted), and whether the row's file has been edited since. It never claims a steer CAUSED a change; it puts the evidence beside the steer.
 */
import { CARD_KEY } from "../talk/cardKey.js";
import type { DeliveryKind } from "../talk/deliveryOutcome.js";
import type { FiringView } from "./card.js";
import type { PostingLookup, PostingView } from "./outputs.js";

/** One request the owner sent about this row, and what has become of it. */
export interface SteerView {
  readonly turnId: string;
  /** The board row the relay registered — where the supervisor's answer is recorded. */
  readonly slug: string;
  readonly sentAtIso: string;
  /** The owner's words as typed or said. */
  readonly words: string;
  /** What became of the line typed into the supervisor's chat, or `null` when none was attempted. */
  readonly delivery: { readonly kind: DeliveryKind; readonly detail: string; readonly atIso: string } | null;
  /** The supervisor's recorded answer — the row's settlement — or `null` while it is open. */
  readonly answer: { readonly settlement: string; readonly witness: string | null } | null;
  /** Why the board row could not be read, when it is there and would not parse; `null` otherwise. */
  readonly answerUnreadable: string | null;
  /** Whether the board read and no row claims the steer's slug — the data, so no answer will land, never a failed read. */
  readonly boardRowMissing: boolean;
}

/** The first firing that started after a timeline entry. */
interface FiringAfter {
  readonly slotIso: string;
  readonly startedAtIso: string;
  readonly outcome: FiringView["outcome"];
  readonly posting: PostingView | null;
  /** Why its posting record would not read, when it would not; `null` beside a posting or a firing with none. */
  readonly postingUnreadable: string | null;
}

/**
 * Which record dates a row's earliest trace. The definition store keeps no creation row, so the instant is the row
 * file's birth time or its oldest firing on the ledger, whichever is older, and the card names which one it was.
 */
export type EarliestTrace = "file-born" | "oldest-firing";

/** One dated entry on a row's timeline, oldest first. */
interface TimelineEntry {
  readonly atIso: string;
  readonly kind: "stated" | "steer";
  /** Which record dated a `stated` entry; `null` on a `steer`. */
  readonly earliestFrom: EarliestTrace | null;
  /** The row's current wording on the `stated` entry; the owner's words on a `steer`. */
  readonly text: string;
  readonly steer: SteerView | null;
  readonly firingAfter: FiringAfter | null;
  /** When the row's file was last edited, if that was after this entry; `null` when it was not or is unknown. */
  readonly rowEditedAfterIso: string | null;
}

/** Everything a card says about steering its row. */
export interface AutomationSteering {
  /** The relay `about` a steer of this row carries, or `null` when the id cannot be one. */
  readonly key: string | null;
  /** Why the row cannot be steered from its card, when {@link key} is `null`. */
  readonly keyRefusal: string | null;
  /** Newest first. */
  readonly steers: readonly SteerView[];
  /**
   * How many steers have no recorded answer yet — one whose board row will not read is unread, and one no row claims
   * will never be answered, so neither is awaiting.
   */
  readonly unanswered: number;
  /** When the row next fires on its own cadence, or `null` when it is off or its cadence will not read. */
  readonly nextFiringIso: string | null;
  readonly timeline: readonly TimelineEntry[];
  /** Why the steers above may be missing — the relay store would not read — or `null` when it read. */
  readonly storeGap: string | null;
}

/**
 * The relay `about` for one row, or why it cannot have one.
 *
 * @param recipeId the row
 * @returns the key, or the refusal
 */
export function recipeSteerKey({ recipeId }: { recipeId: string }): { key: string } | { refusal: string } {
  const key = `recipe:${recipeId}`;
  if (!CARD_KEY.test(key)) {
    return {
      refusal: `the row id ${JSON.stringify(recipeId)} is not a card key (letters, digits, '.', '_', '-'), so a steer cannot name it — tell the supervisor in the Queue's steer box instead`,
    };
  }
  return { key };
}

/** The first firing, oldest first, that started strictly after an instant. */
function firingAfterOf({
  firings,
  atIso,
  postingFor,
}: {
  firings: readonly FiringView[];
  atIso: string;
  postingFor: (args: { slotIso: string }) => PostingLookup;
}): FiringAfter | null {
  const after = firings
    .filter((firing) => firing.startedAtIso > atIso)
    .toSorted((a, b) => a.startedAtIso.localeCompare(b.startedAtIso))[0];
  if (after === undefined) {
    return null;
  }
  const looked = postingFor({ slotIso: after.slotIso });
  return {
    outcome: after.outcome,
    posting:
      looked.kind === "found"
        ? { channel: looked.posting.channel, postedAtIso: looked.posting.postedAtIso, ts: looked.posting.ts }
        : null,
    postingUnreadable: looked.kind === "unreadable" ? looked.why : null,
    slotIso: after.slotIso,
    startedAtIso: after.startedAtIso,
  };
}

/**
 * Fold one row's steers, firings and file dates into what its card shows.
 *
 * @param recipeId the row
 * @param what the row's current wording
 * @param steers every relay about this row, any order
 * @param firings every firing the ledger holds for it, any order
 * @param postingFor what the posting ledger holds for one firing
 * @param earliest the row's earliest trace and which record dates it, or `null` when neither is known
 * @param editedIso when the row's file was last written, or `null` when unknown
 * @param nextFiringIso when the row next fires, or `null`
 * @param storeGap why the relay store would not read, or `null` when it read
 * @returns the steering section of the card
 */
export function automationSteering({
  recipeId,
  what,
  steers,
  firings,
  postingFor,
  earliest,
  editedIso,
  nextFiringIso,
  storeGap,
}: {
  recipeId: string;
  what: string;
  steers: readonly SteerView[];
  firings: readonly FiringView[];
  postingFor: (args: { slotIso: string }) => PostingLookup;
  earliest: { atIso: string; from: EarliestTrace } | null;
  editedIso: string | null;
  nextFiringIso: string | null;
  storeGap: string | null;
}): AutomationSteering {
  const keyed = recipeSteerKey({ recipeId });
  const editedAfter = ({ atIso }: { atIso: string }): string | null =>
    editedIso !== null && editedIso > atIso ? editedIso : null;
  const oldestFirst = steers.toSorted((a, b) => a.sentAtIso.localeCompare(b.sentAtIso));
  const timeline: TimelineEntry[] = [];
  if (earliest !== null) {
    timeline.push({
      atIso: earliest.atIso,
      earliestFrom: earliest.from,
      firingAfter: firingAfterOf({ atIso: earliest.atIso, firings, postingFor }),
      kind: "stated",
      rowEditedAfterIso: editedAfter({ atIso: earliest.atIso }),
      steer: null,
      text: what,
    });
  }
  for (const steer of oldestFirst) {
    timeline.push({
      atIso: steer.sentAtIso,
      earliestFrom: null,
      firingAfter: firingAfterOf({ atIso: steer.sentAtIso, firings, postingFor }),
      kind: "steer",
      rowEditedAfterIso: editedAfter({ atIso: steer.sentAtIso }),
      steer,
      text: steer.words,
    });
  }
  return {
    key: "key" in keyed ? keyed.key : null,
    keyRefusal: "refusal" in keyed ? keyed.refusal : null,
    nextFiringIso,
    steers: oldestFirst.toReversed(),
    storeGap,
    timeline,
    unanswered: steers.filter(
      (steer) => steer.answer === null && steer.answerUnreadable === null && !steer.boardRowMissing,
    ).length,
  };
}
