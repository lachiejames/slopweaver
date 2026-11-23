/**
 * One row on the session-start list, and the identity the next run recognises it by.
 *
 * ## Five fields are mandatory, and a row that cannot fill them is not a row
 *
 * The V1 console's largest measured failure was rows that read as work and were not actionable. So an item
 * carries **who** asked, **where** it lives, **when** it last moved, **what would count as done**, and
 * **what the thing IS** — and a detector that cannot supply all five drops the candidate rather than
 * rendering a blank cell. "Look into JJJJ-441" is the failure this shape exists to make unrepresentable.
 *
 * ## `background` is mandatory because four fields were not enough, measured three times
 *
 * The first four fields all describe STATE or ACTION. None of them says what the thing is, so a row could
 * satisfy every check this module has and still be unanswerable by a reader not already holding the
 * context — the V1 failure surviving in a shape its own gate could not see.
 *
 * The owner reported it three times. A top item whose terms were undefined (a "conflict surface" nobody
 * had defined) was recorded as a vocabulary rule about undefined terms, which
 * is narrower than the owner's point, and a row can obey it perfectly while still being unanswerable. A
 * whole card was rejected twice: one sentence does not give enough to answer a question, because with 50
 * things in flight the owner cannot remember every detail, so a row needs background context.
 *
 * The owner's recorded lock-in replies say it from the other side. Five of twelve carried
 * the literal proposed text `a run waiting on you` — no subject, nothing to answer — and five of the twelve
 * came back already-done or stale.
 *
 * So the field is MANDATORY rather than optional, and that is the whole point: a leg that cannot say what a
 * thing IS now drops the row instead of shipping one nobody can act on. Optional would have left exactly
 * the gap that took three tellings to surface.
 *
 * `where` is a permalink rather than a reference for a reason that is a standing rule elsewhere in this
 * repo: a bare `#<number>` or `SUP-<number>` is refused on every outbound surface, so it is refused here too.
 *
 * ## Identity is source plus native id, never rank and never text
 *
 * Reconciliation between runs turns on this. A rank changes every run by design, and a summary line changes
 * whenever the item's own words change, so keying on either reports movement that did not happen. The
 * native id is the only part of an item that is stable across a state change, which is exactly the case
 * reconciliation exists to name.
 *
 * Pure — no I/O, no clock. Everything here is derived from values the caller already holds.
 */

import type { CodeOwnerSlice } from "../review/codeOwnerSlice.js";

/** Where an item came from. One per detector family, not one per API. */
type ItemSource = "github" | "gmail" | "handover" | "linear" | "slack";

/**
 * One thing the owner might have to do.
 *
 * `state`, `whyItRanked` and `provenance` are optional because a detector may legitimately not know them.
 * The four above them are not: see the module header.
 */
export interface Item {
  readonly source: ItemSource;
  /** The source's own id for this thing — a PR number with its repo, an issue key, a channel and ts. */
  readonly nativeId: string;
  /** The person the ask came from, resolved through the roster to a canonical human. */
  readonly who: string;
  /** The exact permalink. A reader has to land on it in one click. */
  readonly where: string;
  /** When the item last moved, by the SOURCE's own clock, as ISO 8601. */
  readonly whenIso: string;
  /** One concrete sentence. Not "look into it". */
  readonly doneWhen: string;
  /**
   * What this thing IS, for a reader holding no context at all.
   *
   * Two or three sentences: what the subject is, why it exists, and what is at stake. Never the state and
   * never the action — those are {@link Item.state} and {@link Item.doneWhen}, and a `background` that
   * restates either of them is the defect this field was added to fix rather than a filled-in field.
   */
  readonly background: string;
  /** The item's own status in the source's words, when it has one. */
  readonly state?: string;
  /** One clause saying why it ranked where it did, so the owner can argue with it. */
  readonly whyItRanked?: string;
  /** Which detector produced it, so a correction attaches to a rule rather than to a row. */
  readonly provenance?: string;
  /**
   * The subject's own title, when the source names one.
   *
   * `doneWhen` on a ticket or pull-request row already names its key, and a key alone made the owner open
   * every link on a real card to find out what each row was about. Carried separately rather than folded
   * into `doneWhen` so a renderer can put it beside the key rather than reflowing a sentence.
   */
  readonly title?: string;
  /**
   * The repository this item is about, when its source names one.
   *
   * A bare `#<number>` in `doneWhen` means a different pull request in each repository, so anything resolving one
   * has to know which. Optional because most sources name no repository at all.
   */
  readonly repo?: string;
  /**
   * The branch this item's work lives on, when its source names one — a pull request's head branch.
   *
   * It is the join a run journal offers: `handover start` records the branch a run opened on, so a row whose
   * branch matches an open run's is work a session is already inside, and the list can say so instead of
   * ranking it as untouched. Optional because most sources have no branch at all.
   */
  readonly branch?: string;
  /**
   * How much of the one pull request a review ask names is the OWNER's as a code owner, read live by the verify pass.
   *
   * The reason: on a thirty-file pull request the owner was tagged to review, only one line in one file was
   * theirs, and they wanted to know that on opening it. Set only on a Slack ask naming exactly one OPEN
   * pull request, and only from a complete read (`../review/codeOwnerSlice.ts`); absent means not read, never none.
   * Structured rather than a sentence so a page can render each path as code.
   */
  readonly codeOwnerSlice?: CodeOwnerSlice;
  /**
   * Every pull request the source links, deduped, each as `owner/name#n`, when it links any.
   *
   * The count a code-owner slice is gated on. `doneWhen`'s bare `#n` references cannot be that count: they name
   * only the links in {@link Item.repo}, and the reader of them stops at five digits, so a row linking `org/a#1`
   * beside `org/b#2`, or beside `org/a#100000`, would otherwise reach the verify pass looking like an ask about
   * one pull request and earn a slice of it.
   */
  readonly linkedPullRequests?: readonly string[];
}

/**
 * The stable identity two runs compare items by.
 *
 * @param item the item to key
 * @returns `<source>:<nativeId>`, which survives every state change the item can undergo
 */
export function itemIdentity({ item }: { item: Item }): string {
  return `${item.source}:${item.nativeId}`;
}

/**
 * What a detector produced before the mandatory fields were checked.
 *
 * Modelled as a partial rather than as a second interface because a detector builds one of these field by
 * field as it reads a record, and the check below is the single place that decides whether it became an
 * item.
 */
export type Candidate = Partial<Item> & Pick<Item, "nativeId" | "source">;

/**
 * Which mandatory fields a candidate is missing.
 *
 * Reported as a list rather than a boolean so a detector's own diagnostics can say what it could not
 * resolve. A field present but blank counts as missing — a row rendering an empty cell is the failure, and
 * an empty string reaches the reader looking exactly like a value nobody supplied.
 *
 * @param candidate what a detector produced
 * @returns the names of the mandatory fields it cannot fill, empty when it is a complete item
 */
export function missingMandatory({ candidate }: { candidate: Candidate }): readonly string[] {
  const required = ["who", "where", "whenIso", "doneWhen", "background"] as const;
  return required.filter((field) => {
    const value = candidate[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/**
 * Promote a candidate to an item, or refuse it.
 *
 * The refusal is the point of the function. A detector calls this instead of asserting its own output is
 * complete, so the drop happens once, in one place, with a reason attached.
 *
 * @param candidate what a detector produced
 * @returns the item, or undefined when a mandatory field is missing
 */
export function asItem({ candidate }: { candidate: Candidate }): Item | undefined {
  const { who, where, whenIso, doneWhen, background } = candidate;
  if (
    who === undefined ||
    where === undefined ||
    whenIso === undefined ||
    doneWhen === undefined ||
    background === undefined
  ) {
    return undefined;
  }
  if (missingMandatory({ candidate }).length > 0) {
    return undefined;
  }
  return {
    background,
    doneWhen,
    nativeId: candidate.nativeId,
    source: candidate.source,
    whenIso,
    where,
    who,
    ...(candidate.branch === undefined ? {} : { branch: candidate.branch }),
    ...(candidate.codeOwnerSlice === undefined ? {} : { codeOwnerSlice: candidate.codeOwnerSlice }),
    ...(candidate.linkedPullRequests === undefined ? {} : { linkedPullRequests: candidate.linkedPullRequests }),
    ...(candidate.provenance === undefined ? {} : { provenance: candidate.provenance }),
    ...(candidate.repo === undefined ? {} : { repo: candidate.repo }),
    ...(candidate.state === undefined ? {} : { state: candidate.state }),
    ...(candidate.title === undefined ? {} : { title: candidate.title }),
    ...(candidate.whyItRanked === undefined ? {} : { whyItRanked: candidate.whyItRanked }),
  };
}
