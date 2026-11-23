/**
 * Which Queue cards STOP the owner's work, and which of two ways: a card blocking one of the owner's priorities, which
 * leads the page with its reason, and an automation that stopped, which follows the owner's priorities
 * (`./queueFocus.ts` `queueOrdered`).
 *
 * The first thing in the owner's queue is whatever has stopped work on any given day, since the automation stopped
 * running, applied to every priority and not just one: a security-fix top-up stood on the owner's hold for two days
 * with no card, and the cards blocking the owner's two ISO projects sat among ninety others with nothing lifting them. A blocker on the owner's priorities is the first card, and an
 * automation held on the owner's own word ("disabled for now") is not a blocker, so it ranks below the owner's
 * priorities rather than above them.
 *
 * **Two ways in, each a recorded fact, never a word on the card.**
 * - `marked`: a hand step its poster MARKED as stopping the owner's work (`stopsWork`, written only by a monitor whose
 *   registry entry declares it — `src/monitor/registry.ts`): an automation stopped on the owner's own hold, a recipe or a
 *   corpus sync that stopped firing.
 * - `blocks`: a card BLOCKING A PRIORITY: an ask, or a hand step naming the board row it unblocks, whose row waits on
 *   the owner and is named in the `blockedBy:` of a live board row carrying a focus workstream's tag, read whole. It carries
 *   the rank of the highest priority it blocks. Direct only — a blocker of a blocker is not followed — and a focus card
 *   itself is not stopping: it advances the focus, it does not stop it.
 *
 * A check-in never stops anything, and a stopping card shows in both work contexts (`shownOnQueue`). Pure, and the only copy:
 * the chair reads its answer over `/api/queue-stopping` (`./queueStoppingReport.ts`) rather than restating it.
 */
import type { Board, BoardRow } from "../components/live/read";
import type { LiveState } from "../components/live/useLive";
import type { QueueCard } from "./queueCard";
import type { QueueFocus } from "./queueFocus";
import type { QueueRow } from "./queueRows";
import type { Workspace, WorkspacePlacement } from "./workspacePlacementBasis";
import { findingLabel, workspaceOfPlacement } from "./workspacePlacementContext";
import { isOnOwner, isOpen } from "./workstreams";

/** One Queue card, as the stopping predicate reads it. */
export interface StoppingCandidate {
  readonly key: string;
  readonly kind: "ask" | "hand" | "other";
  /** The board row the card is about: an ask's own row, a hand step's `row`. */
  readonly rowSlug: string | undefined;
  /** The poster's mark that the card stops the owner's work — a hand step's `stopsWork`. */
  readonly stopsWork: boolean;
  readonly checkIn: boolean;
}

/** One board row, as the stopping predicate reads it. */
export interface StoppingBoardFact {
  readonly slug: string;
  /** Not done, not shipped, not closed. */
  readonly open: boolean;
  readonly waitsOnOwner: boolean;
  /** Whether its tags read whole — a row whose tags read in part never joins a focus. */
  readonly tagsWhole: boolean;
  readonly workstreams: readonly string[];
  readonly blockedBy: readonly string[];
}

/** How a card stops the owner's work: blocking one of the owner's priorities, by that priority's rank, or marked by its poster. */
export type StoppingStamp =
  { readonly reason: "blocks"; readonly priorityRank: number } | { readonly reason: "marked" };

/**
 * Every card that stops the owner's work, by the two recorded facts this file names, each with how.
 *
 * @param candidates every card, normalised
 * @param board every board row, normalised; empty while the board has not read, which proves no blocker
 * @param focusWorkstreams the `workstream=` tag values of the owner's focus workstreams, the first priority first
 * @returns each stopping card's key and stamp
 */
export function stoppingKeys({
  candidates,
  board,
  focusWorkstreams,
}: {
  candidates: readonly StoppingCandidate[];
  board: readonly StoppingBoardFact[];
  focusWorkstreams: readonly string[];
}): ReadonlyMap<string, StoppingStamp> {
  // Every row under a slug, never the last: a DONE duplicate must not hide the open row a card stands on.
  const bySlug = new Map<string, StoppingBoardFact[]>();
  for (const fact of board) {
    const seen = bySlug.get(fact.slug);
    if (seen === undefined) {
      bySlug.set(fact.slug, [fact]);
    } else {
      seen.push(fact);
    }
  }
  // Each blocked slug, with the rank of the highest priority among the focus rows naming it.
  const blocksAFocus = new Map<string, number>();
  for (const fact of board) {
    const ranks = fact.workstreams.map((value) => focusWorkstreams.indexOf(value)).filter((rank) => rank !== -1);
    if (!fact.open || !fact.tagsWhole || ranks.length === 0) {
      continue;
    }
    const rank = Math.min(...ranks);
    for (const slug of fact.blockedBy) {
      const seen = blocksAFocus.get(slug);
      if (seen === undefined || rank < seen) {
        blocksAFocus.set(slug, rank);
      }
    }
  }
  const keys = new Map<string, StoppingStamp>();
  for (const candidate of candidates) {
    if (candidate.checkIn) {
      continue;
    }
    if (candidate.kind === "hand" && candidate.stopsWork) {
      keys.set(candidate.key, { reason: "marked" });
      continue;
    }
    if (candidate.kind === "other" || candidate.rowSlug === undefined) {
      continue;
    }
    const priorityRank = blocksAFocus.get(candidate.rowSlug);
    if (priorityRank === undefined) {
      continue;
    }
    if (bySlug.get(candidate.rowSlug)?.some((fact) => fact.open && fact.waitsOnOwner) === true) {
      keys.set(candidate.key, { priorityRank, reason: "blocks" });
    }
  }
  return keys;
}

/**
 * One board row as the predicate reads it.
 *
 * @returns the normalised fact
 */
export function boardFactOf({ row }: { row: BoardRow }): StoppingBoardFact {
  return {
    blockedBy: row.blockedBy,
    // The workstream band's own reading of open, so a focus row is open on both pages or neither.
    open: isOpen({ row }),
    slug: row.slug,
    tagsWhole: row.tagsRead === "whole",
    waitsOnOwner: isOnOwner({ row }),
    workstreams: row.tags.filter((tag) => tag.key === "workstream").map((tag) => tag.value),
  };
}

/**
 * One Queue card as the predicate reads it.
 *
 * @returns the normalised candidate
 */
export function candidateOf({ row }: { row: Pick<QueueRow, "key" | "record" | "tier"> }): StoppingCandidate {
  const checkIn = row.tier === "check-in";
  if (row.record.kind === "hand") {
    const { step } = row.record;
    return { checkIn, key: row.key, kind: "hand", rowSlug: step.row, stopsWork: step.stopsWork === true };
  }
  if (row.record.kind === "ask") {
    return { checkIn, key: row.key, kind: "ask", rowSlug: row.record.row.slug, stopsWork: false };
  }
  return { checkIn, key: row.key, kind: "other", rowSlug: undefined, stopsWork: false };
}

/**
 * The Queue's rows, each card that stops the owner's work stamped `stopping` with how, over its board reading and their focus.
 * Taken over every row before a view filters them, so the page, its triage pass and the voice's `action_items` read one
 * stamp.
 *
 * @param rows every card some view draws
 * @param board the board reading; until it reads, only a marked hand step stops anything
 * @param focuses the workstreams lifted now, the first priority first
 * @returns the rows, a stopping one stamped; the same list when none stops anything
 */
export function withStopping<
  T extends Pick<QueueRow, "key" | "record" | "tier"> & { readonly stopping?: StoppingStamp },
>({
  rows,
  board,
  focuses,
}: {
  rows: readonly T[];
  board: LiveState<Board>;
  focuses: readonly QueueFocus[];
}): readonly T[] {
  let facts: readonly StoppingBoardFact[] = [];
  if (board.phase === "ready") {
    facts = board.value.rows.map((row) => boardFactOf({ row }));
  }
  const keys = stoppingKeys({
    board: facts,
    candidates: rows.map((row) => candidateOf({ row })),
    focusWorkstreams: focuses.map((focus) => focus.queueWorkstream),
  });
  if (keys.size === 0) {
    return rows;
  }
  return rows.map((row) => {
    const stopping = keys.get(row.key);
    return stopping === undefined ? row : { ...row, stopping };
  });
}

/**
 * Whether the Queue shows a row in the context the owner is looking at. A card stopping the owner's work shows in BOTH: one hidden
 * behind the switcher is buried, and voice triage already walks every context, so the page and `action_items` agree
 * with it.
 *
 * @param shows the context's own filter over a row's placement
 * @returns true when the row stops the owner's work or the context shows it
 */
export function shownOnQueue<T extends { readonly placement: WorkspacePlacement; readonly stopping?: StoppingStamp }>({
  row,
  shows,
}: {
  row: T;
  shows: (row: T) => boolean;
}): boolean {
  return row.stopping !== undefined || shows(row);
}

/**
 * The workspace a stopping card belongs to when the view the owner is looking at draws it ONLY because it stops their work —
 * the one exception `shownOnQueue` makes to drawing each row in its one workspace — so the row can say whose card it
 * is and why it is here instead of reading as this view's own.
 *
 * @param shows the context's own filter over a row's placement
 * @returns the card's own workspace, or `undefined` when the row is this view's own or not drawn here at all
 */
export function stoppingElsewhere<
  T extends { readonly placement: WorkspacePlacement; readonly stopping?: StoppingStamp },
>({ row, shows }: { row: T; shows: (row: T) => boolean }): Workspace | undefined {
  if (row.stopping === undefined || shows(row)) {
    return undefined;
  }
  return workspaceOfPlacement({ placement: row.placement });
}

/**
 * The workspace mark one view says on a card: its finding mark, led by whose card it is whenever this view does not
 * draw it as its own — a stopping card it draws only because it stops the owner's work, or any card the voice reaches by key
 * from this view though only the other view draws it. One function, so the row, the open
 * panel and every voice reading say the same words.
 *
 * @param shows the context's own filter over a row's placement
 * @returns the mark's short label and its fuller title, or `undefined` on a card of this view placed plainly
 */
export function markInView<T extends { readonly placement: WorkspacePlacement; readonly stopping?: StoppingStamp }>({
  row,
  shows,
}: {
  row: T;
  shows: (row: T) => boolean;
}): { readonly label: string; readonly title: string } | undefined {
  const finding = findingLabel({ placement: row.placement });
  if (shows(row)) {
    return finding;
  }
  const elsewhere = workspaceOfPlacement({ placement: row.placement });
  let why = "drawn only in that workspace's view, not this one";
  if (row.stopping !== undefined) {
    why = "in this view only because it stops the owner's work";
  }
  const own = { label: `the ${elsewhere} workspace's card`, title: why };
  if (finding === undefined) {
    return own;
  }
  return { label: `${own.label} · ${finding.label}`, title: `${own.title} · ${finding.title}` };
}

/**
 * How many of the rows a fold or a cap hides wear a mark in this view — a finding, or a stopping card's "whose card" —
 * so a fold says marked rows sit behind it whichever mark they wear.
 *
 * @param rows the rows behind the fold or past the cap
 * @param shows whether the view the owner is looking at draws a row by its placement
 * @returns the count
 */
export function markedInView<T extends { readonly placement: WorkspacePlacement; readonly stopping?: StoppingStamp }>({
  rows,
  shows,
}: {
  rows: readonly T[];
  shows: (row: T) => boolean;
}): number {
  return rows.filter((row) => markInView({ row, shows }) !== undefined).length;
}

/** The decision a stopping card draws on its collapsed row, before the owner opens it. */
export interface StoppingFold {
  readonly problem: string;
  readonly options: readonly { readonly letter: string; readonly sentence: string }[];
  readonly lean: string | undefined;
}

/**
 * The decision and options a stopping card draws above the fold — on its collapsed row, never by opening the card for
 * the owner — as the card's own recorded fields: a hand step's decision, or an ask's problem, options and lean. Each option
 * is its letter and sentence; its trade-off waits inside the card, so the row stays short (rule 7).
 *
 * @param card the card the row draws
 * @returns the decision, or `undefined` on a card that records no problem or no option
 */
export function stoppingFold({ card }: { card: QueueCard }): StoppingFold | undefined {
  if (card.kind === "step") {
    if (card.decision === undefined || card.decision.options.length === 0) {
      return undefined;
    }
    const { problem, options, lean } = card.decision;
    return { lean, options: options.map(({ letter, sentence }) => ({ letter, sentence })), problem };
  }
  if (card.problem === undefined || card.options.length === 0) {
    return undefined;
  }
  return {
    lean: card.lean,
    options: card.options.map(({ letter, sentence }) => ({ letter, sentence })),
    problem: card.problem,
  };
}
