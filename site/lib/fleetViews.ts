/**
 * The Fleet page's three views — what the fleet did, what it is doing, and what it works on next — as pure
 * projections of readings the console already polls. The page shows not just what the fleet is working on now, nor
 * only what it worked on previously, but what it will work on next, in order; it is one page with a switch between
 * the past, present and future views rather than three things stacked on one page.
 *
 * **Next is the board's order, never a score the page made.** `handover reconcile` publishes `ready` — every row the
 * fleet could pick up, already ranked by `src/handover/rank.ts` (priority band, the owner's landing rows within p1,
 * rows the owner ruled on, placed rows first, longest-waiting) — and the supervisor walks that list top to bottom when
 * it fills a seat. Which row it seats within a band is judgement over the owner's words (the prioritisation
 * page in `skills/supervisor/reference/`, which no code reads), so this page shows the walked list in the board's order and names it as such. A row a live seat
 * is already on is not "next": it is subtracted, and only off a reading that OBSERVED the fleet — an unobserved one
 * fills its placements from unclosed journals, which prove no living seat.
 *
 * **Past is scoped to what it can prove.** What landed is main's own first-parent history (`fleet landed`), each change
 * beside the owner's words and its proof, so that list is never inferred from the board. A settled row is on the board only
 * until its doc is archived, and its `movedIso` is its run journal's last event rather than a landing instant, so the
 * Settled tile is "settled, still on the board" — a different claim from what landed, drawn beside it.
 *
 * Read-only by construction: nothing here returns a control, and the page draws none, because every steer comes
 * through the one intake.
 */
import type { BoardRow } from "../components/live/read";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { RankedRow, Reconcile } from "../components/live/readWorkstreams";
import { boardRowSource, type CardSource } from "./queueCardSource";

/** The three views, in the order the switch draws them. */
export type FleetView = "past" | "now" | "next";

/** Every view, oldest first, so the switch reads left to right as time does. */
export const FLEET_VIEWS: readonly FleetView[] = ["past", "now", "next"];

/** The query parameter that names the view. */
export const FLEET_VIEW_PARAM = "view";

/** How many rows a view lists before the rest fold behind a click. */
export const FLEET_SHOWN = 10;

/**
 * The view a `?view=` value names. Now is the page's default, because what is running now opens expanded, so an
 * absent or unknown value opens it, deliberately rather than as a fallback.
 *
 * @param param the raw `view` query value, `null` when the address carries none
 * @returns the view to draw
 */
export function fleetViewOf({ param }: { param: string | null }): FleetView {
  const named = FLEET_VIEWS.find((view) => view === param);
  if (named === undefined) {
    return "now";
  }
  return named;
}

/**
 * Whole hours as the verb counts them, with days beside once hours stop being readable.
 *
 * @returns `7h`, or `296h (12.3d)`
 */
export function waitedWords({ hours }: { hours: number }): string {
  if (hours < 48) {
    return `${String(hours)}h`;
  }
  return `${String(hours)}h (${(hours / 24).toFixed(1)}d)`;
}

/** The board as the Fleet page holds it — the slow lane, so loading and unmeasured stay distinct from empty. */
export type FleetBoardRead =
  | { readonly kind: "loading" }
  | { readonly kind: "not-measured"; readonly why: string }
  | { readonly kind: "ready"; readonly rows: readonly BoardRow[] };

/** Where one ranked row came from, joined to the board by exact slug — every way that join can end, named. */
export type FleetSource =
  | { readonly kind: "reading" }
  | { readonly kind: "not-measured"; readonly why: string }
  | { readonly kind: "missing-row" }
  | { readonly kind: "duplicate-row"; readonly matches: number }
  | { readonly kind: "read"; readonly source: CardSource };

/** One row the fleet would pick up next, in the board's order. */
export interface NextUpRow {
  /** 1-based position in the list of rows nobody is on — not the row's rank across the whole board. */
  readonly position: number;
  readonly id: string;
  readonly priority: string;
  /** True only when the board says the band is a backfilled default rather than one anybody chose. */
  readonly defaultPriority: boolean;
  readonly label: string;
  readonly kind: string;
  /** The owner's kept outcomes (the Workstreams register's) this row is a ready, unspawned row under, in the reading's order. */
  readonly outcomeTitles: readonly string[];
  readonly source: FleetSource;
  readonly waitingHours: number;
}

/** A list cut for a page: the rows drawn, and every row past the cut behind a fold. */
export interface Folded<T> {
  readonly shown: readonly T[];
  readonly folded: readonly T[];
}

/** What the Next view can say: the ordered list, or why the reading cannot support one. */
export type NextUpView =
  | {
      readonly kind: "ready";
      readonly rows: Folded<NextUpRow>;
      /** How many ready rows a live seat is already on, and so are not next. */
      readonly seated: number;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * Cut a list at `shown`, keeping every row — the rest go behind a fold, never away.
 *
 * @param shown how many rows stay above the fold
 * @returns the two halves, in the list's own order
 */
export function foldAt<T>({ rows, shown }: { rows: readonly T[]; shown: number }): Folded<T> {
  return { folded: rows.slice(shown), shown: rows.slice(0, shown) };
}

/**
 * The ids that appear more than once in a list, each named once.
 *
 * @returns the repeated ids, in first-seen order
 */
function repeatedIds({ ids }: { ids: readonly string[] }): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      repeated.add(id);
    }
    seen.add(id);
  }
  return [...repeated];
}

/**
 * One ranked row's source, joined to the board by exact slug — the Next up list's and the forecast's both.
 *
 * @returns the source, or the named reason the join could not give one
 */
export function sourceOf({ id, board }: { id: string; board: FleetBoardRead }): FleetSource {
  if (board.kind === "loading") {
    return { kind: "reading" };
  }
  if (board.kind === "not-measured") {
    return { kind: "not-measured", why: board.why };
  }
  const matches = board.rows.filter((row) => row.slug === id);
  if (matches.length === 0) {
    return { kind: "missing-row" };
  }
  if (matches.length > 1) {
    return { kind: "duplicate-row", matches: matches.length };
  }
  return { kind: "read", source: boardRowSource({ row: matches[0] }) };
}

/**
 * Whether the board marks a row's band as a backfilled default — only on the positive word, since an absent
 * `priorityFrom` may equally be an older board.
 *
 * @returns true when the band is the kind's default written down
 */
function defaultBandOf({ id, board }: { id: string; board: FleetBoardRead }): boolean {
  if (board.kind !== "ready") {
    return false;
  }
  const matches = board.rows.filter((row) => row.slug === id);
  return matches.length === 1 && matches[0].priorityFrom === "default";
}

/**
 * Every outcome title each ready row sits under, in the reading's outcome order and each title once.
 *
 * @returns titles by row id
 */
function outcomeTitlesById({ outcomes }: { outcomes: Reconcile["outcomes"] }): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, string[]>();
  for (const outcome of outcomes) {
    for (const row of outcome.unspawned) {
      const titles = byId.get(row.id);
      if (titles === undefined) {
        byId.set(row.id, [outcome.title]);
        continue;
      }
      if (!titles.includes(outcome.title)) {
        titles.push(outcome.title);
      }
    }
  }
  return byId;
}

/**
 * One row's outcome titles. A row under no outcome is a real state — most of the board serves none — so it is
 * an empty list said here, not a fallback.
 *
 * @returns the titles, empty when the row sits under no outcome
 */
function titlesOf({ id, titles }: { id: string; titles: ReadonlyMap<string, readonly string[]> }): readonly string[] {
  const found = titles.get(id);
  if (found === undefined) {
    return [];
  }
  return found;
}

/** The part of a reconcile reading the open order is drawn from. */
export type OrderReconcile = Pick<Reconcile, "aligned" | "fleet" | "misaligned" | "ready" | "unprioritised">;

/** The order the chair walks: the ready rows nobody is on, in the board's order — or why it cannot be drawn. */
export type OpenOrder =
  | {
      readonly kind: "open";
      /** The ready rows no live seat is on, in the board's ranked order — position N is index N−1. */
      readonly open: readonly RankedRow[];
      /** Every row id a live seat is placed on. */
      readonly seatedIds: ReadonlySet<string>;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * The board's ranked ready rows minus every row a live seat is already on — the one order both the Next list and
 * the owner's steers' places are read off, so the two cannot disagree.
 *
 * Refused whole, never half-made, when the reading did not observe the fleet (its placements are journals, not
 * seats) or carries one id on two ready rows (the board's open duplicate-slug defect, which breaks the seat
 * subtraction in both directions — `src/handover/reconcile.ts`'s `held` says how).
 *
 * @param reconcile the supervisor tick's last `handover reconcile` reading
 * @returns the open order, or why there is none
 */
export function openOrderOf({ reconcile }: { reconcile: OrderReconcile }): OpenOrder {
  if (reconcile.fleet === undefined) {
    return {
      kind: "unavailable",
      why: "the reconcile reading predates the field saying whether it observed the fleet, so which rows already have a seat cannot be told",
    };
  }
  if (reconcile.fleet !== "observed") {
    return {
      kind: "unavailable",
      why: "the reconcile reading could not observe the fleet, so which rows already have a seat cannot be told",
    };
  }
  const repeated = repeatedIds({ ids: reconcile.ready.map((row) => row.id) });
  if (repeated.length > 0) {
    return {
      kind: "unavailable",
      why: `the board carries ${repeated.join(", ")} on more than one ready row, so the order cannot be drawn without guessing which`,
    };
  }
  const seatedIds = new Set(
    [...reconcile.aligned, ...reconcile.misaligned, ...reconcile.unprioritised].map((placed) => placed.row.id),
  );
  return { kind: "open", open: reconcile.ready.filter((row) => !seatedIds.has(row.id)), seatedIds };
}

/**
 * What the fleet works on next: the board's ranked ready rows, minus every row a live seat is already on, in the
 * board's own order — {@link openOrderOf}, with each row's band, outcomes and source.
 *
 * @param reconcile the supervisor tick's last `handover reconcile` reading
 * @param board the board read, for the owner's words and the default-band mark
 * @param shown how many rows stay above the fold
 * @returns the list, or why there is none
 */
export function nextUpOf({
  reconcile,
  board,
  shown,
}: {
  reconcile: OrderReconcile & Pick<Reconcile, "outcomes">;
  board: FleetBoardRead;
  shown: number;
}): NextUpView {
  const order = openOrderOf({ reconcile });
  if (order.kind === "unavailable") {
    return order;
  }
  const titles = outcomeTitlesById({ outcomes: reconcile.outcomes });
  const open = order.open;
  const rows = open.map((row, index): NextUpRow => ({
    defaultPriority: defaultBandOf({ board, id: row.id }),
    id: row.id,
    kind: row.kind,
    label: row.label,
    outcomeTitles: titlesOf({ id: row.id, titles }),
    position: index + 1,
    priority: row.priority,
    source: sourceOf({ board, id: row.id }),
    waitingHours: row.waitingHours,
  }));
  return { kind: "ready", rows: foldAt({ rows, shown }), seated: reconcile.ready.length - open.length };
}

/** One settled board row, as the Past view draws it. */
export interface SettledRow {
  readonly id: string;
  readonly summary: string | undefined;
  /** Why the board calls it done — its evidence line, not a release note. */
  readonly reason: string;
  /** When its run journal last moved — the closest instant the board holds, not a landing time. */
  readonly movedIso: string;
  readonly source: CardSource;
}

/** The Past view: what settled while still on the board, and what the fleet did without asking. */
export interface PastView {
  readonly settled: Folded<SettledRow>;
  /** Settled rows the board holds no readable instant for, so they cannot be placed in time — counted, not dropped. */
  readonly settledUntimed: number;
  readonly acts: Folded<AutonomyRow>;
}

/** The board section a settled row stands in. */
const DONE = "DONE";

/**
 * What the fleet did: the board's settled rows newest first by when each last moved, and the autonomy ledger in
 * the order the register prints it (newest first).
 *
 * @param rows every board row; only the settled ones are drawn
 * @param acts the autonomy ledger, as `readAutonomy` returns it
 * @param shown how many of each list stay above the fold
 * @returns the view
 */
export function pastOf({
  rows,
  acts,
  shown,
}: {
  rows: readonly BoardRow[];
  acts: readonly AutonomyRow[];
  shown: number;
}): PastView {
  const done = rows.filter((row) => row.section === DONE);
  const timed: { row: BoardRow; movedIso: string; at: number }[] = [];
  for (const row of done) {
    if (row.movedIso === undefined) {
      continue;
    }
    const at = Date.parse(row.movedIso);
    if (Number.isNaN(at)) {
      continue;
    }
    timed.push({ at, movedIso: row.movedIso, row });
  }
  const settled = timed
    .toSorted((left, right) => right.at - left.at || left.row.slug.localeCompare(right.row.slug))
    .map(({ row, movedIso }): SettledRow => ({
      id: row.slug,
      movedIso,
      reason: row.reason,
      source: boardRowSource({ row }),
      summary: row.summary,
    }));
  return {
    acts: foldAt({ rows: acts, shown }),
    settled: foldAt({ rows: settled, shown }),
    settledUntimed: done.length - timed.length,
  };
}
