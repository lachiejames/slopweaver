/**
 * Setting the fleet against THE OWNER'S OWN OUTCOMES — the comparison that `../../handover/reconcile.ts` does not make.
 *
 * `../../handover/reconcile.ts` already answers "is the fleet on the board's top five". This answers the
 * question that actually catches a chair out: **for each thing the owner said they expect to be true, how many live
 * sessions are on it, and how many READY rows under it has nobody picked up.** Those two numbers are what
 * `slopweaver supervisor tick-record`'s sweep gate refuses on, and what the derived successor summary
 * carries across a handover.
 *
 * ## The owner's outcomes come from ONE place: the Workstreams register
 *
 * There is one way of doing things. An outcome is a workstream the owner KEPT on the Workstreams register
 * (the store's workstream tables, `../../workstreams/store/`) — never a list checked into this repository.
 * {@link coverageOutcomes} projects the register into what coverage reads: each workstream's name, the owner's words (its
 * `outcome`), the earliest anchor its dated entries cite, and its `boardMembership`, which decides which of today's board rows sit under it. An outcome
 * outlives every row under it, so the rows change and the entry does not.
 *
 * ## An UNSPAWNED row is the finding, not a starving top-band row
 *
 * The reconciliation's `starving` is the same shape read through the ranking: a groomed TOP-FIVE row nobody
 * is working. On a live board that is five rows out of 718, so a shift can clear it while eleven of the owner's
 * twelve outcomes have nobody on them at all. Coverage is scoped
 * by SUBJECT instead, so the count grows with how much of what the owner wants is unattended rather than with how
 * the ranking happened to sort.
 *
 * Pure: rows, sessions and the register in, a record out. No filesystem, no clock.
 */

import type { BoardRow } from "../../handover/rank.js";
import type { PlacedWork } from "../../handover/reconcile.js";
import type { BoardMembership } from "../../workstreams/boardMembership.js";
import { typedWorkstreamDetail } from "../../workstreams/store/decode.js";
import type { WorkstreamAggregate, WorkstreamEntry } from "../../workstreams/store/types.js";

/** One of the owner's kept outcomes, as coverage reads it off the register. */
export interface CoverageOutcome {
  /** The register entry's id. What a `hold-rationale` judgement names when a tick holds one deliberately. */
  readonly id: string;
  /** The entry's name: one line a reader scans. */
  readonly title: string;
  /**
   * THE OWNER'S OWN WORDS — the entry's `outcome`, verbatim. A paraphrase of what the owner wants is the thing that decays between
   * supervisors, and it cannot be checked against the transcript it came from.
   */
  readonly words: string;
  /** Where the owner said it: the earliest checkable citation on the entry's timeline, a link or a bracketed anchor. */
  readonly anchor: string;
  /** Which board rows sit under it; `null` names none, so it is listed with no rows rather than guessed at. */
  readonly membership: BoardMembership | null;
}

/** The register's outcomes as coverage reads them, and every entry that could not be read as one. */
export interface CoverageProjection {
  /** One per active outcome, standing or opted-in linked entry, in the store's order. */
  readonly outcomes: readonly CoverageOutcome[];
  /** The ids of entries that would be outcomes but cite nothing checkable, so no anchor is invented for them. */
  readonly unanchored: readonly string[];
}

/**
 * How one outcome stands right now.
 *
 * @internal — the element type of {@link OutcomeReport.outcomes}; callers read the report, never this alone.
 */
export interface OutcomeCoverage {
  readonly id: string;
  readonly title: string;
  /** The owner's words for it, carried so a reader of the report never rejoins another list to quote them. */
  readonly words: string;
  /** The anchor on the register entry, so a reader can check the owner said it without leaving the report. */
  readonly anchor: string;
  /** Live sessions working a row that sits under this outcome. */
  readonly live: readonly PlacedWork[];
  /** READY rows under this outcome that no live session is on — the fleet's unattended share of it. */
  readonly unspawned: readonly BoardRow[];
  /** Every row under it, ready or not, so a reader can tell "nothing to do" from "nobody doing it". */
  readonly rows: number;
}

/** The whole comparison: one entry per outcome, in the store's order. */
export interface OutcomeReport {
  readonly outcomes: readonly OutcomeCoverage[];
  /** Outcomes with at least one unspawned ready row and no live session — the ones a tick has to answer for. */
  readonly uncovered: readonly string[];
}

/** A bracketed anchor closing an entry's text, as `../../workstreams/candidateTile.ts` writes one. */
const BRACKETED_ANCHOR = /\[([^\]\s][^\]]*)\]\s*$/u;

/**
 * The earliest checkable citation on a workstream's dated entries: by date, then story order, the first entry carrying
 * a link, or text closing in a bracketed anchor (a transcript turn has no link, so a kept candidate keeps it there).
 *
 * @returns the citation, or `undefined` when no entry carries one
 */
function earliestAnchor({ entries }: { entries: readonly WorkstreamEntry[] }): string | undefined {
  const dated = entries.toSorted((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  for (const entry of dated) {
    if (entry.href !== null) {
      return entry.href;
    }
    const bracketed = BRACKETED_ANCHOR.exec(entry.text);
    if (bracketed?.[1] !== undefined) {
      return bracketed[1];
    }
  }
  return undefined;
}

/**
 * Whether a workstream is one of the owner's outcomes for coverage: an outcome or standing workstream that has not ended, or
 * a linked one that has not ended and names its board rows — a linked workstream is somebody else's to lead, so it is
 * supervised only when it says which rows are its. A local note or a closing workstream never is.
 *
 * @returns its board membership, or `undefined` when it is not supervised
 */
function supervised({
  aggregate,
}: {
  aggregate: WorkstreamAggregate;
}): { readonly membership: BoardMembership | null } | undefined {
  const typed = typedWorkstreamDetail({ aggregate });
  if (typed.kind === "local" || typed.kind === "closing") {
    return undefined;
  }
  if (typed.detail.ending !== null) {
    return undefined;
  }
  if (typed.kind === "linked" && typed.detail.boardMembership === null) {
    return undefined;
  }
  return { membership: typed.detail.boardMembership };
}

/**
 * Project the register into the outcomes coverage reads: name, the owner's words, anchor and board membership, in the order
 * given. A workstream that would be an outcome but cites nothing checkable is named in `unanchored`, never given an
 * anchor nobody can check.
 *
 * @param workstreams every workstream the store holds
 * @returns the outcomes, and the ids left out for want of an anchor
 */
export function coverageOutcomes({ workstreams }: { workstreams: readonly WorkstreamAggregate[] }): CoverageProjection {
  const outcomes: CoverageOutcome[] = [];
  const unanchored: string[] = [];
  for (const aggregate of workstreams) {
    const held = supervised({ aggregate });
    if (held !== undefined) {
      const anchor = earliestAnchor({ entries: aggregate.entries });
      if (anchor === undefined) {
        unanchored.push(aggregate.id);
      } else {
        outcomes.push({
          anchor,
          id: aggregate.id,
          membership: held.membership,
          title: aggregate.name,
          // The store refuses an outcome, standing or linked workstream that states no outcome.
          words: aggregate.outcome!,
        });
      }
    }
  }
  return { outcomes, unanchored };
}

/**
 * The text one row is matched against: its id and its label, lowercased, with every run of non-alphanumeric
 * characters collapsed to one space and a space at each end.
 *
 * The padding is what makes {@link matches} a WORD test rather than a substring test. MEASURED on the live
 * 718-row board while this was being built: a bare `String.includes` for the matcher `iso` hit 378 rows,
 * because "decision", "revision" and "precision" all contain it, and an outcome that matches half the board
 * covers nothing. Slugs spell a subject with hyphens and summaries spell it with spaces, so both normalise to
 * the same shape here and one matcher reaches both.
 */
function haystack({ row }: { row: BoardRow }): string {
  return ` ${`${row.id} ${row.label}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim()} `;
}

/**
 * Whether one matcher occurs in a row's text as a whole word or phrase.
 *
 * @param matcher the outcome's lowercase matcher
 * @param text the row's normalised, space-padded text
 * @returns true when it occurs on both-side word boundaries
 */
function matches({ matcher, text }: { matcher: string; text: string }): boolean {
  return text.includes(` ${matcher.replaceAll(/[^a-z0-9]+/gu, " ").trim()} `);
}

/**
 * Whether one row sits under one outcome.
 *
 * @param row the board row
 * @param rank the row's 1-based position in the ranked board, which is what a rank-band outcome reads
 * @param membership how the outcome decides its rows; `null` decides none
 * @param botHandles the install's own bot handles, matched as well by an outcome that names the bot
 * @returns true when the row belongs to it
 */
function belongs({
  row,
  rank,
  membership,
  botHandles,
}: {
  row: BoardRow;
  rank: number;
  membership: BoardMembership | null;
  botHandles: readonly string[];
}): boolean {
  if (membership === null) {
    return false;
  }
  if (membership.kind === "rank-band") {
    // Over the whole ranked board, NOT over the ready rows alone. Measured while building this: scoping the
    // band to ready rows made the outcome permanently report zero live sessions, because a row whose run is
    // OPEN composes to IN FLIGHT and is therefore not ready — so the one outcome about the top of the board
    // could never be covered by anybody. Check that a rank-band outcome still has seats under it with
    // `slopweaver handover reconcile --json`, reading each outcome's `live`; a rank-band entry stuck at zero while
    // sessions are live is that scoping back. `unspawned` below applies readiness where it belongs. A live SEAT is a
    // different claim from an open run, so a `RUN NOW` row a session sits on is ready AND worked;
    // `../../handover/rowStanding.ts` carries why they differ.
    return rank <= membership.band;
  }
  const text = haystack({ row });
  const handles = membership.namesTheBot === true ? botHandles.map((handle) => handle.toLowerCase()) : [];
  return [...membership.matchers, ...handles].some((matcher) => matches({ matcher, text }));
}

/**
 * Set every live session and every ready row against the owner's kept outcomes.
 *
 * @param ranked the whole ranked board, most urgent first — the order a rank-band outcome reads
 * @param placed every live session that resolved to a board row, whatever bucket it landed in
 * @param outcomes the owner's kept outcomes, projected off the register by {@link coverageOutcomes}
 * @param botHandles the install's own bot handles (`profile.json`'s `slackBot.selfHandles`), which an outcome
 *   naming the bot matches as well; empty, it matches by its own matchers alone
 * @returns one coverage entry per outcome, and the ids of the ones nobody is on
 */
export function outcomeCoverage({
  ranked,
  placed,
  outcomes,
  botHandles,
}: {
  ranked: readonly BoardRow[];
  placed: readonly PlacedWork[];
  outcomes: readonly CoverageOutcome[];
  botHandles: readonly string[];
}): OutcomeReport {
  const rankOfId = new Map(ranked.map((row, index) => [row.id, index + 1]));
  /** A row the ranked list does not hold sits past its end, so no rank band ever reaches it. */
  const rankFor = ({ id }: { id: string }): number => {
    const found = rankOfId.get(id);
    if (found === undefined) {
      return ranked.length + 1;
    }
    return found;
  };
  const workedIds = new Set(placed.map((item) => item.row.id));
  const covered = outcomes.map((outcome): OutcomeCoverage => {
    const rows = ranked.filter((row) =>
      belongs({ botHandles, membership: outcome.membership, rank: rankFor({ id: row.id }), row }),
    );
    return {
      anchor: outcome.anchor,
      id: outcome.id,
      live: placed.filter((item) =>
        belongs({ botHandles, membership: outcome.membership, rank: rankFor({ id: item.row.id }), row: item.row }),
      ),
      rows: rows.length,
      title: outcome.title,
      unspawned: rows.filter((row) => row.ready && !workedIds.has(row.id)),
      words: outcome.words,
    };
  });
  return { outcomes: covered, uncovered: uncoveredIds({ outcomes: covered }) };
}

/**
 * The outcomes with a ready row waiting and nobody on them, in their own order — the one definition reconcile emits
 * as `uncoveredOutcomes` and the strict reader (`./reconciledOutcomes.ts`) checks that list against.
 *
 * @param outcomes coverage entries, each with its live seats and unspawned rows
 * @returns the ids of the entries a tick has to answer for
 */
export function uncoveredIds({
  outcomes,
}: {
  outcomes: readonly {
    readonly id: string;
    readonly live: readonly unknown[];
    readonly unspawned: readonly unknown[];
  }[];
}): readonly string[] {
  return outcomes.filter((entry) => entry.live.length === 0 && entry.unspawned.length > 0).map((entry) => entry.id);
}
