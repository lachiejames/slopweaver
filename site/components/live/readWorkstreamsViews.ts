/**
 * What the workstreams page draws off one reconciliation: the seat list, the held groups, the word for `starving`,
 * the fleet and partition claims, and the ready fold. A sibling of `./readWorkstreams.ts`, under every rule its
 * module doc states: it ranks nothing and judges nothing the verb did not already say.
 */

import type { HeldRow, Placed, RankedRow, Reconcile } from "./readWorkstreamsTypes";

/** How many rows a long list shows before the rest fold behind a reader's own click. */
export const SHOWN = 8;

/**
 * One live session and where the verb placed it.
 *
 * The page's whole claim is "where is each item" — so the four lists the verb publishes separately
 * (`aligned`, `misaligned`, `unprioritised`, `unregistered`) are ONE list here, because a reader asking
 * where the fleet is does not want to visit four headings to find out. Nothing is judged in the joining:
 * `where` is one fixed phrase per list, so the page judges nothing a list did not already say.
 */
export interface Seat {
  readonly session: string;
  /** The fixed phrase for this placement's list — the same words for every session on it. */
  readonly where: string;
  /** The row this session is on, when the board claims one at all. */
  readonly row: RankedRow | undefined;
  /** The row's 1-based rank of the whole ranked board, when it has one. */
  readonly rank: number | undefined;
}

/**
 * Every live session the verb read, in placement order: on the top band first, then
 * lower down, then on an unplaced row, then on nothing the board claims.
 *
 * @param reconcile the reconciliation, whose four placement lists are the whole fleet between them
 * @returns one seat per live session
 */
export function seatsOf({ reconcile }: { reconcile: Reconcile }): readonly Seat[] {
  const placed = ({ list, where }: { list: readonly Placed[]; where: string }): readonly Seat[] =>
    list.map((one) => ({ rank: one.rank, row: one.row, session: one.session, where }));
  return [
    ...placed({ list: reconcile.aligned, where: `on the board's top ${String(reconcile.top.length)}` }),
    ...placed({ list: reconcile.misaligned, where: "lower down" }),
    ...placed({ list: reconcile.unprioritised, where: "on an unplaced row" }),
    ...reconcile.unregistered.map((session) => ({
      rank: undefined,
      row: undefined,
      session,
      where: "on nothing the board knows",
    })),
  ];
}

/**
 * Held rows gathered by the verb's own standing word, biggest group first.
 *
 * @param held every ranked row nobody is on and nobody can be on
 * @returns one entry per standing the rows actually carry
 */
export function heldByStanding({ held }: { held: readonly HeldRow[] }): readonly {
  readonly standing: string;
  readonly rows: readonly HeldRow[];
}[] {
  const groups = new Map<string, HeldRow[]>();
  for (const row of held) {
    const seen = groups.get(row.standing);
    if (seen === undefined) {
      groups.set(row.standing, [row]);
      continue;
    }
    seen.push(row);
  }
  return [...groups.entries()]
    .map(([standing, rows]) => ({ rows, standing }))
    .toSorted((a, b) => b.rows.length - a.rows.length);
}

/**
 * What `starving` may be CALLED on this particular reading, short and long.
 *
 * The count is the same number either way; the word for it is not, and that is the whole defect this change
 * exists to stop repeating. On a current reading `starving` holds rows a session could pick up right now, so
 * "ready" is true of them. On an older producer's — {@link Reconcile.held} absent — it still holds the OLD
 * meaning, a merely GROOMED top-band row nobody is on, and each surface counting it would print "ready"
 * over it: this tile's stat and the band's own heading. One function so they cannot drift, and so a test can pin the word rather than a
 * renderer nothing in the lanes can mount.
 *
 * @returns the two phrasings, the short one for a stat cell and the long one for a figure or a title
 */
export function starvingWords({ reconcile }: { reconcile: Reconcile }): {
  readonly short: string;
  readonly long: string;
} {
  if (reconcile.held === undefined) {
    return {
      long: "top-band rows with nobody on them (this reading is too old to say they are ready)",
      short: "on the top band, nobody on it",
    };
  }
  return { long: "top-band rows ready with nobody on them", short: "ready, nobody on it" };
}

/** Which of the three things a reading can say about how its seat list was obtained. */
export type FleetClaim =
  /** The fleet was observed: a seat is a living session. */
  | "observed"
  /** The producer predates the field, so the reading says nothing either way. */
  | "predates-field"
  /** The fleet could not be observed, so a seat is an unclosed journal rather than a living session. */
  | "not-observed";

/**
 * Which claim a reading supports about its own seat list.
 *
 * Split out of the note that prints it because the three arms are the behaviour and the paragraph is only
 * its rendering — and because nothing in the unit lanes mounts a component, so a test can reach this and
 * could not reach the note. The residue is stated rather than implied: this pins WHICH claim is made, never
 * that a page still prints it.
 *
 * @returns the claim
 */
export function fleetClaim({ reconcile }: { reconcile: Reconcile }): FleetClaim {
  if (reconcile.fleet === "observed") {
    return "observed";
  }
  if (reconcile.fleet === undefined) {
    return "predates-field";
  }
  return "not-observed";
}

/**
 * The ready rows the band does NOT already show, and the exact word for where each of them stands.
 *
 * The band above the fold is `starving`, so the fold is the rest of `ready` — and calling that rest "below
 * the top band" is false of part of it. `ready` is a standing and `starving` is an availability, so a
 * `RUN NOW` row a session is already sitting on is in `top` and in `ready` and in NEITHER list the band
 * draws: it falls into the fold wearing a label the reading contradicts. The two groups are derivable, so
 * the summary names both instead of asserting the commoner one over each.
 *
 * It owns the CUT as well as the words. Both lists this page draws run to the hundreds, so the fold shows
 * the first {@link SHOWN} and says how many it did not — and that sentence is a claim about a count like
 * every other one here, which puts it where a test can reach it rather than inside a renderer no lane
 * mounts.
 *
 * @returns the rows to draw, the summary over all of them, and the line for the ones past the cut
 */
export function readyFold({ reconcile }: { reconcile: Reconcile }): {
  readonly rows: readonly RankedRow[];
  readonly summary: string;
  /** The count past the cut, as a sentence — absent when the fold shows every row it has. */
  readonly past: string | undefined;
  /** Every folded row's id, drawn or past the cut, so the page can count the marked ones on the closed fold. */
  readonly foldedIds: readonly string[];
  /** The ids past the cut, drawn nowhere, so the page can say how many of them wear a mark. */
  readonly pastIds: readonly string[];
} {
  const open = new Set(reconcile.starving.map((row) => row.id));
  const band = new Set(reconcile.top.map((row) => row.id));
  const folded = reconcile.ready.filter((row) => !open.has(row.id));
  const seated = folded.filter((row) => band.has(row.id)).length;
  const below = folded.length - seated;
  const rows = folded.slice(0, SHOWN);
  const foldedIds = folded.map((row) => row.id);
  const pastIds = folded.slice(SHOWN).map((row) => row.id);
  const past =
    folded.length > SHOWN ? `and ${String(folded.length - SHOWN)} more, in \`slopweaver handover list\`` : undefined;
  if (seated === 0) {
    return { foldedIds, past, pastIds, rows, summary: `and ${String(below)} more ready, below the top band` };
  }
  if (below === 0) {
    return {
      foldedIds,
      past,
      pastIds,
      rows,
      summary: `and ${String(seated)} more ready, on the top band with a session already on it`,
    };
  }
  return {
    foldedIds,
    past,
    pastIds,
    rows,
    summary: `and ${String(folded.length)} more ready: ${String(below)} below the top band, ${String(seated)} on it with a session already on them`,
  };
}

/**
 * Whether a reading can be split into what is ready and what is held — carrying the held rows when it can.
 *
 * The held list rides the `split` arm rather than being re-read beside it, so the page cannot take the
 * decision from here and the rows from somewhere the decision did not look.
 */
export type PartitionClaim =
  { readonly kind: "unsplittable" } | { readonly kind: "split"; readonly held: readonly HeldRow[] };

/**
 * Whether this reading supports the ready/held split at all.
 *
 * {@link Reconcile.held} is what tells the two vintages apart: without it, `starving` still carries the OLD
 * meaning — see {@link starvingWords} — so drawing those rows under "ready to pick up" would make the very
 * claim this change exists to stop. Split out for the reason `fleetClaim` is: the decision is the behaviour,
 * the section is its rendering, and nothing in the unit lanes mounts a component.
 *
 * @returns which of the two the page may draw, with the rows on the arm that has them
 */
export function partitionClaim({ reconcile }: { reconcile: Reconcile }): PartitionClaim {
  const held = reconcile.held;
  if (held === undefined) {
    return { kind: "unsplittable" };
  }
  return { held, kind: "split" };
}
