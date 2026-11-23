/**
 * What an automation PRODUCED, per firing: where it posted, the finding a failure filed, the readings and floating
 * notes it left. Pure — `./read.ts` reads each store once and hands the rows in.
 *
 * Every join is by a key the producer wrote, never by a guess. A firing's posting is the record the executor wrote
 * for that slot (`../live/automation/postingLedger.ts`); a failure's finding is the slug the failure hold derives
 * (`failureFindingSlug`), never a prefix match on the board; a reading or a floating note carries `recipe:<id>` in
 * its own `by`/`postedBy`. Where a kind's output is recorded nowhere this page can join, the card says exactly
 * that, per kind, rather than "nothing posted".
 */
import type { FiringPosting } from "../live/automation/postingLedger.js";
import type { FiringView } from "./card.js";

/** The kinds whose executor records each firing's post (`../cli/commands/automation/cardPostingNote.ts`). */
const POSTING_RECORDED_KINDS: ReadonlySet<string> = new Set(["alert-summary", "datadog-alert-digest", "investigate"]);

/** How many readings and floating notes a card carries. */
export const RECENT_OUTPUTS = 5;

/** A firing's post, as recorded when it was confirmed. */
export interface PostingView {
  readonly channel: string;
  readonly ts: string;
  readonly postedAtIso: string;
}

/** The board row a failed firing filed, as it reads now. */
interface FindingView {
  readonly slug: string;
  /** The row's own summary or problem line, or `null` when it carries neither. */
  readonly summary: string | null;
  readonly status: string;
  /** How the row ended, or `null` while it is open. */
  readonly settlement: string | null;
}

/** What one firing produced. */
interface FiringOutput {
  readonly slotIso: string;
  readonly posting: PostingView | null;
  /**
   * Why the ledger holds no posting, when it read and holds none; `null` beside a posting, beside one that would not
   * read, and for a kind that records none (the card's `postingsNote` says that once).
   */
  readonly postingNote: string | null;
  /** Why the posting record would not read, when it is there and would not; `null` otherwise. */
  readonly postingUnreadable: string | null;
  readonly finding: FindingView | null;
  /** Why the finding could not be read, when its row is there and would not parse. */
  readonly findingNote: string | null;
}

/** A reading a firing of this row took. */
export interface ReadingOutput {
  readonly atIso: string;
  readonly producer: string;
  readonly file: string;
  readonly bytes: number;
}

/** A floating note a firing of this row put up. */
export interface NoteOutput {
  readonly atIso: string;
  readonly what: string;
  readonly url: string | null;
}

/** Everything a card says about what its row produced. */
export interface AutomationOutputs {
  /** Per firing, aligned with the card's `recentFirings`. */
  readonly firings: readonly FiringOutput[];
  /** Why no firing of this KIND shows a posting, or `null` when its executor records one per firing. */
  readonly postingsNote: string | null;
  readonly readings: readonly ReadingOutput[];
  readonly notes: readonly NoteOutput[];
  /** Why the readings or notes above may be missing rows — their store would not read — or `null` when both read. */
  readonly storeGap: string | null;
}

/** What a posting lookup found for one firing. */
export type PostingLookup =
  | { readonly kind: "found"; readonly posting: FiringPosting }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly why: string };

/** What a finding lookup found for one failed firing. */
export type FindingLookup =
  | { readonly kind: "found"; readonly finding: FindingView }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly why: string };

/** Why a firing's ledger holds no posting, in the reader's terms; a record that would not read is not this. */
function postingNoteOf({
  kind,
  firing,
  lookup,
}: {
  kind: string;
  firing: FiringView;
  lookup: PostingLookup;
}): string | null {
  if (lookup.kind !== "none") {
    return null;
  }
  if (!POSTING_RECORDED_KINDS.has(kind)) {
    return null;
  }
  // The post and its record are two writes, so a process stopped between them leaves a real post with no record.
  // No record on a firing that did not succeed is therefore never proof that nothing went out.
  if (firing.outcome !== "succeeded") {
    return "no posting recorded — it may not have posted, or it stopped before the record was written";
  }
  return "no posting recorded — it fired before postings were recorded, or the record could not be written";
}

/**
 * Fold one row's per-firing lookups and its keyed readings and notes into what the card shows.
 *
 * @param kind the row's kind, which decides whether a missing posting is a gap or the kind's nature
 * @param firings the card's recent firings, newest first
 * @param postingFor what the posting ledger holds for one firing
 * @param findingFor what the board holds for one failed firing, `none` for a firing that did not fail
 * @param readings readings whose `by` names this row, any order
 * @param notes floating notes whose `postedBy` names this row, any order
 * @param storeGap why the readings or notes store would not read, or `null` when both read
 * @returns the card's outputs
 */
export function automationOutputs({
  kind,
  firings,
  postingFor,
  findingFor,
  readings,
  notes,
  storeGap,
}: {
  kind: string;
  firings: readonly FiringView[];
  postingFor: (args: { slotIso: string }) => PostingLookup;
  findingFor: (args: { firing: FiringView }) => FindingLookup;
  readings: readonly ReadingOutput[];
  notes: readonly NoteOutput[];
  storeGap: string | null;
}): AutomationOutputs {
  return {
    firings: firings.map((firing) => {
      const posted = postingFor({ slotIso: firing.slotIso });
      const found = findingFor({ firing });
      return {
        finding: found.kind === "found" ? found.finding : null,
        findingNote: found.kind === "unreadable" ? found.why : null,
        posting:
          posted.kind === "found"
            ? { channel: posted.posting.channel, postedAtIso: posted.posting.postedAtIso, ts: posted.posting.ts }
            : null,
        postingNote: postingNoteOf({ firing, kind, lookup: posted }),
        postingUnreadable: posted.kind === "unreadable" ? posted.why : null,
        slotIso: firing.slotIso,
      };
    }),
    notes: notes.toSorted((a, b) => b.atIso.localeCompare(a.atIso)).slice(0, RECENT_OUTPUTS),
    postingsNote: POSTING_RECORDED_KINDS.has(kind)
      ? null
      : `a row of kind ${kind} records no per-firing posting this page can join to a firing — what it wrote shows in its readings, notes and run detail`,
    readings: readings.toSorted((a, b) => b.atIso.localeCompare(a.atIso)).slice(0, RECENT_OUTPUTS),
    storeGap,
  };
}

/**
 * The `by`/`postedBy` value a firing of a row stamps on what it leaves.
 *
 * @param recipeId the row
 * @returns `recipe:<id>`
 */
export function recipeActor({ recipeId }: { recipeId: string }): string {
  return `recipe:${recipeId}`;
}
