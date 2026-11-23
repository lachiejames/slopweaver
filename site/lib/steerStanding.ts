/**
 * Where each steer of the owner's stands — being worked, queued at its place in the order, held, or settled — beside
 * their own words. The owner can see whether any session is working on a steer, whether any is going to, and its
 * priority number in the queue of things to be spawned on the fleet (five, say), so a steer that is queued reads as
 * heard but behind work of higher priority.
 *
 * **A steer is a board row holding the owner's words** (`hisWords` read as `held`): the quote is what makes the row
 * findable by the thing the owner actually said, so a row whose words are missing or unread is not listed here — its Queue card
 * already says so.
 *
 * **The place is the Next list's own position** ({@link openOrderOf}), never a second ranking: the same number the
 * Next up tile prints beside the same row, so the two cannot disagree, and the order is the one the chair walks when
 * it fills a seat. Ordinals only — never when it will be picked up.
 *
 * **The board is the newer reading.** It is read live when the page opens while the order is the supervisor tick's
 * last reconcile, so a row registered since that tick is in neither — it reads "outside the ranking" with the
 * board's own section, never a guessed place.
 *
 * Pure: rows in, a value out.
 */
import type { BoardRow } from "../components/live/read";
import type { BoardRowQuote } from "../components/live/readHisWords";
import type { RankedRow, Reconcile } from "../components/live/readWorkstreams";
import { type Folded, foldAt, type OrderReconcile, openOrderOf } from "./fleetViews";
import { boardRowSource, type CardSource } from "./queueCardSource";

/** The board section a settled row stands in. */
const DONE = "DONE";

/** The standing that means a row is parked on the owner — the board's own word. */
const WAITING_ON_OWNER = "waiting-on-owner";

/** Where one steer stands, each arm a distinct thing a reader can check. */
export type SteerState =
  /** The board files it as done. */
  | { readonly kind: "settled"; readonly reason: string }
  /** A live seat is on it; `standing` is the placed row's own word. */
  | { readonly kind: "working"; readonly sessions: readonly string[]; readonly standing: string | undefined }
  /** Nobody is on it yet: its place in the order the chair walks. */
  | {
      readonly kind: "queued";
      readonly position: number;
      readonly of: number;
      readonly priority: string;
      /** How many rows stand ahead of it in that order. */
      readonly ahead: number;
      /** How many of those rows are steers of the owner's too. */
      readonly aheadYours: number;
    }
  /** Nobody can be on it: parked on the owner, paused, blocked, or a run open with no live seat. */
  | { readonly kind: "held"; readonly standing: string }
  /** The last ranking does not place it, and why. */
  | { readonly kind: "unranked"; readonly why: string };

/** One steer of the owner's, as the page draws it. */
export interface SteerRow {
  readonly id: string;
  readonly quote: BoardRowQuote;
  /** The row's source, for the block that draws the owner's words whole. */
  readonly source: CardSource;
  /** What the fleet calls the work — the ranking's label, else the board's summary, else the slug. */
  readonly label: string;
  readonly state: SteerState;
}

/**
 * What the steers tile can say: every steer of the owner's, grouped by where it stands, or why the order cannot be read.
 *
 * Grouped rather than one newest-first list because of what the board actually holds: MEASURED on this
 * machine, of 1,960 steers 5 were being worked, 37 queued, 1,082 held and 815 settled, and the ten newest were all
 * settled — a single list led with finished work while the owner's question is "is anyone on this, and if not, where is it in
 * line". Re-measure: `slopweaver handover list --json | jq '[.rows[] | select(.ownerWords.words != null)] | group_by(.section) | map({section: .[0].section, n: length})'`.
 */
export type SteersView =
  | {
      readonly kind: "ready";
      /** Steers a live seat is on, newest said first. */
      readonly working: readonly SteerRow[];
      /** Steers nobody is on yet, in their order — the place Next up prints. */
      readonly queued: Folded<SteerRow>;
      /** Steers nobody can be on, newest said first. */
      readonly held: readonly SteerRow[];
      /** Steers the last ranking does not place, newest said first. */
      readonly unranked: readonly SteerRow[];
      /** Steers the board files as done, newest said first. */
      readonly settled: readonly SteerRow[];
      /** Every steer, whatever its state. */
      readonly total: number;
      /** Rows a live seat is on that hold no words of the owner's — what is being worked instead. */
      readonly seatedElsewhere: number;
    }
  | { readonly kind: "unavailable"; readonly why: string };

/** The part of a reconcile reading the steers are placed against. */
export type SteerReconcile = OrderReconcile & Pick<Reconcile, "held">;

/**
 * The words a row holds, when it holds them.
 *
 * @returns the quote, or `undefined` when the row carries none that read
 */
function quoteOf({ row }: { row: BoardRow }): BoardRowQuote | undefined {
  if (row.hisWords.kind !== "held") {
    return undefined;
  }
  return row.hisWords.quote;
}

/**
 * What the fleet calls a row: the ranking's own label when it ranked the row, else the board's summary, else its
 * slug — said here as ifs, since each is a different record rather than a default.
 *
 * @returns the label
 */
function labelOf({ row, ranked }: { row: BoardRow; ranked: RankedRow | undefined }): string {
  if (ranked !== undefined) {
    return ranked.label;
  }
  if (row.summary !== undefined && row.summary !== "") {
    return row.summary;
  }
  return row.slug;
}

/** Every reconcile list a row id can be found in, indexed once. */
interface Placement {
  readonly sessionsById: ReadonlyMap<string, { readonly sessions: string[]; readonly row: RankedRow }>;
  readonly positionById: ReadonlyMap<string, number>;
  readonly heldById: ReadonlyMap<string, RankedRow & { readonly standing: string }> | undefined;
}

/**
 * Index the order, the seats and the held rows by id.
 *
 * @param open the open order, position N at index N−1
 * @returns the index
 */
function placementOf({ reconcile, open }: { reconcile: SteerReconcile; open: readonly RankedRow[] }): Placement {
  const sessionsById = new Map<string, { sessions: string[]; row: RankedRow }>();
  for (const placed of [...reconcile.aligned, ...reconcile.misaligned, ...reconcile.unprioritised]) {
    const known = sessionsById.get(placed.row.id);
    if (known === undefined) {
      sessionsById.set(placed.row.id, { row: placed.row, sessions: [placed.session] });
      continue;
    }
    known.sessions.push(placed.session);
  }
  const positionById = new Map(open.map((row, index) => [row.id, index + 1]));
  let heldById: Placement["heldById"];
  if (reconcile.held !== undefined) {
    heldById = new Map(reconcile.held.map((row) => [row.id, row]));
  }
  return { heldById, positionById, sessionsById };
}

/**
 * Where one steer stands. Precedence, single and exhaustive: settled on the board, then a live seat, then its place
 * in the open order, then held, then not ranked.
 *
 * @param yours the ids of every steer of the owner's, for counting how many ahead are theirs too
 * @returns the state, with the ranked row it was read off when there was one
 */
function stateOf({
  row,
  open,
  placement,
  yours,
}: {
  row: BoardRow;
  open: readonly RankedRow[];
  placement: Placement;
  yours: ReadonlySet<string>;
}): { readonly state: SteerState; readonly ranked: RankedRow | undefined } {
  if (row.section === DONE) {
    return { ranked: undefined, state: { kind: "settled", reason: row.reason } };
  }
  const seated = placement.sessionsById.get(row.slug);
  if (seated !== undefined) {
    return {
      ranked: seated.row,
      state: { kind: "working", sessions: seated.sessions, standing: seated.row.standing },
    };
  }
  const position = placement.positionById.get(row.slug);
  if (position !== undefined) {
    // The index was built off this same list, so the position always names a row in it.
    const ranked = open[position - 1];
    const ahead = open.slice(0, position - 1);
    return {
      ranked,
      state: {
        ahead: ahead.length,
        aheadYours: ahead.filter((one) => yours.has(one.id)).length,
        kind: "queued",
        of: open.length,
        position,
        priority: ranked.priority,
      },
    };
  }
  if (placement.heldById === undefined) {
    return {
      ranked: undefined,
      state: { kind: "unranked", why: "the last ranking is too old to say which rows are held" },
    };
  }
  const held = placement.heldById.get(row.slug);
  if (held !== undefined) {
    return { ranked: held, state: { kind: "held", standing: held.standing } };
  }
  let filed = `the board files it under ${row.section}`;
  if (row.reason !== "") {
    filed = `${filed}: ${row.reason}`;
  }
  return { ranked: undefined, state: { kind: "unranked", why: `the last ranking does not carry it: ${filed}` } };
}

/**
 * Every steer of the owner's on the board, grouped by where it stands against the order the chair walks.
 *
 * Refused whole exactly when the Next list is ({@link openOrderOf}): a place read off an order that cannot be drawn
 * would be the "rank that disagrees with what the fleet seats next" the row named as the risk.
 *
 * @param rows every board row; only those holding the owner's words are listed
 * @param reconcile the supervisor tick's last `handover reconcile` reading
 * @param shown how many queued steers stay above the fold
 * @returns the view, or why there is none
 */
export function steerStandingOf({
  rows,
  reconcile,
  shown,
}: {
  rows: readonly BoardRow[];
  reconcile: SteerReconcile;
  shown: number;
}): SteersView {
  const order = openOrderOf({ reconcile });
  if (order.kind === "unavailable") {
    return order;
  }
  const said = rows.flatMap((row) => {
    const quote = quoteOf({ row });
    if (quote === undefined) {
      return [];
    }
    return [{ at: Date.parse(quote.atIso), quote, row }];
  });
  const yours = new Set(said.map((one) => one.row.slug));
  const placement = placementOf({ open: order.open, reconcile });
  const steers = said
    .toSorted((left, right) => right.at - left.at || left.row.slug.localeCompare(right.row.slug))
    .map(({ row, quote }): SteerRow => {
      const { state, ranked } = stateOf({ open: order.open, placement, row, yours });
      return { id: row.slug, label: labelOf({ ranked, row }), quote, source: boardRowSource({ row }), state };
    });
  const inState = ({ kind }: { kind: SteerState["kind"] }): readonly SteerRow[] =>
    steers.filter((steer) => steer.state.kind === kind);
  const queued = steers
    .flatMap((steer) => (steer.state.kind === "queued" ? [{ position: steer.state.position, steer }] : []))
    .toSorted((left, right) => left.position - right.position)
    .map(({ steer }) => steer);
  return {
    held: inState({ kind: "held" }),
    kind: "ready",
    queued: foldAt({ rows: queued, shown }),
    seatedElsewhere: [...order.seatedIds].filter((id) => !yours.has(id)).length,
    settled: inState({ kind: "settled" }),
    total: steers.length,
    unranked: inState({ kind: "unranked" }),
    working: inState({ kind: "working" }),
  };
}

/**
 * An ordinal as a reader says it.
 *
 * @param n a positive whole number
 * @returns `1st`, `2nd`, `3rd`, `4th`, `11th`, `22nd`, `113th`
 */
export function ordinal({ n }: { n: number }): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${String(n)}th`;
  }
  const last = n % 10;
  if (last === 1) {
    return `${String(n)}st`;
  }
  if (last === 2) {
    return `${String(n)}nd`;
  }
  if (last === 3) {
    return `${String(n)}rd`;
  }
  return `${String(n)}th`;
}

/** How a steer's state reads: the short tag before the row, and the one line its fold opens on. */
export interface SteerStateWords {
  readonly tag: string;
  readonly line: string;
}

/**
 * The seats on a steer, as a clause.
 *
 * @returns `a seat is on it (workspace:408)`, or `2 seats are on it (workspace:4, workspace:9)`
 */
function seatsClause({ sessions }: { sessions: readonly string[] }): string {
  if (sessions.length === 1) {
    return `a seat is on it (${sessions.join(", ")})`;
  }
  return `${String(sessions.length)} seats are on it (${sessions.join(", ")})`;
}

/**
 * What stands ahead of a queued steer, as a clause.
 *
 * @returns the clause
 */
function aheadClause({ ahead, aheadYours }: { ahead: number; aheadYours: number }): string {
  if (ahead === 0) {
    return "nothing ahead of it";
  }
  const rows = ahead === 1 ? "1 row" : `${String(ahead)} rows`;
  return `${rows} ahead of it, ${String(aheadYours)} of them yours`;
}

/** The held standings' own words: the tag, and the line. */
const HELD_WORDS: Readonly<Partial<Record<string, SteerStateWords>>> = {
  blocked: { line: "held behind something it needs first, so no seat can start it yet", tag: "blocked" },
  "in-flight": { line: "a run is open on it, and no live seat is on it", tag: "started, nobody on it" },
  paused: { line: "paused on a named person, so no seat can start it", tag: "paused" },
  [WAITING_ON_OWNER]: { line: "its row is waiting on your answer; it is on your Queue", tag: "waiting on you" },
};

/**
 * The tag and the line for a steer's state — ordinals and counts only, never when anything will happen.
 *
 * @returns the words
 */
export function steerStateWords({ state }: { state: SteerState }): SteerStateWords {
  switch (state.kind) {
    case "settled": {
      return { line: `settled: ${state.reason}`, tag: "settled" };
    }
    case "working": {
      if (state.standing === WAITING_ON_OWNER) {
        return { line: `${seatsClause({ sessions: state.sessions })}, and it is waiting on you`, tag: "asking you" };
      }
      return { line: seatsClause({ sessions: state.sessions }), tag: "working" };
    }
    case "queued": {
      const place = ordinal({ n: state.position });
      return {
        line: `${place} of ${String(state.of)} in the order nobody is on yet (${state.priority}): ${aheadClause({ ahead: state.ahead, aheadYours: state.aheadYours })}`,
        tag: `queued ${place}`,
      };
    }
    case "held": {
      const known = HELD_WORDS[state.standing];
      if (known === undefined) {
        return { line: `held: ${state.standing}`, tag: state.standing };
      }
      return known;
    }
    case "unranked": {
      return { line: state.why, tag: "outside the ranking" };
    }
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/**
 * The owner's words as one line beside a row: the quote verbatim, or nothing when the row holds no words of theirs.
 *
 * @param source the row's source
 * @returns the words, or `undefined`
 */
export function wordsBeside({ source }: { source: CardSource }): string | undefined {
  if (source.kind !== "words") {
    return undefined;
  }
  return source.quote.words;
}

/**
 * The owner's words for each board row that holds them, by slug — what a seat's line quotes beside the work it is on, with
 * the anchor they were said at. A slug two rows share is left out: whose words are behind it cannot be told.
 *
 * @param rows every board row
 * @returns the quote by slug
 */
export function quotesBySlug({ rows }: { rows: readonly BoardRow[] }): ReadonlyMap<string, BoardRowQuote> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slug)) {
      shared.add(row.slug);
    }
    seen.add(row.slug);
  }
  const bySlug = new Map<string, BoardRowQuote>();
  for (const row of rows) {
    const quote = quoteOf({ row });
    if (quote !== undefined && !shared.has(row.slug)) {
      bySlug.set(row.slug, quote);
    }
  }
  return bySlug;
}
