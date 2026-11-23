/**
 * The LIVE cut of a parked Slack draft: where a dropped draft's re-cut chain ends.
 *
 * ## Why this exists
 *
 * A hand card named a draft that had been dropped with the note "re-cut as sd-1cdf3a4c …", and that one was
 * dropped as "superseded by sd-19bcb871, sent to #defects …". The card drew the first cut, and the owner approved
 * "draft looks excellent, post" on words that were no longer the draft. A card, or a
 * gate, that meets a dropped id has to follow the register to the cut that stands.
 *
 * ## The criterion
 *
 * A DROPPED row's successor is the first whole minted id (`sd-` and eight lowercase hex digits) its drop note names
 * that is not its own id and that the register holds. Every drop note in the register naming an id names its
 * successor ("re-cut as", "superseded by", "re-recorded into its thread as", "duplicate of"); a note naming none —
 * "moot: …", "refuted, not re-cut: …" — has no successor, so the dropped row is its own live cut.
 *
 * The link is FORWARD only. A later draft's `why` sometimes says "supersedes sd-…", but as often "PROOF copy of
 * sd-…", which is not a re-cut: reading it backward would hand a card a proof copy as the draft.
 *
 * Held and released rows have no successor. `site/lib/slackDraftIds.ts` restates this, because the console cannot
 * import `src/`. Pure: rows in, one chain out.
 */

/** One folded row, as far as the chain cares — a `SlackDraftItem` is one. */
export interface ChainRow {
  readonly id: string;
  readonly state: string;
  /** The drop note on a dropped row; the release coordinates on a released one. */
  readonly outcome?: string | undefined;
}

/** A whole minted draft id — no neighbouring letter, digit or hyphen. */
const MINTED_ID = /(?<![A-Za-z0-9-])sd-[0-9a-f]{8}(?![A-Za-z0-9-])/gu;

/**
 * The row a dropped row was re-cut as, or `undefined` when it was not dropped or its note names no row the
 * register holds.
 *
 * @param row the row to follow
 * @param items every folded row
 * @returns the successor row
 */
export function draftSuccessor<Row extends ChainRow>({
  row,
  items,
}: {
  row: Row;
  items: readonly Row[];
}): Row | undefined {
  if (row.state !== "dropped" || row.outcome === undefined) {
    return undefined;
  }
  for (const match of row.outcome.matchAll(MINTED_ID)) {
    const found = items.find((item) => item.id === match[0] && item.id !== row.id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Every other whole minted id a dropped row's note names, whether or not the register holds it. A chain that ends on a
 * dropped cut may end there only because the successor its note names did not read on this build.
 *
 * @param row the row whose note to read
 * @returns the ids its drop note names, empty for any row that is not dropped
 */
export function dropNoteIds({ row }: { row: ChainRow }): readonly string[] {
  if (row.state !== "dropped" || row.outcome === undefined) {
    return [];
  }
  return [...row.outcome.matchAll(MINTED_ID)].map((match) => match[0]).filter((id) => id !== row.id);
}

/**
 * Every whole minted draft id a text names, in order, each once — how a relay's words name a draft exactly.
 *
 * @param text any text: the owner's words, a row, a card
 * @returns the ids it names
 */
export function mintedDraftIds({ text }: { text: string }): readonly string[] {
  return [...new Set([...text.matchAll(MINTED_ID)].map((match) => match[0]))];
}

/** Where one named draft's chain ends, and every dropped cut passed on the way. */
export interface LiveCut<Row> {
  /** The cut that stands: held, released, or the last dropped cut when no successor is named. */
  readonly live: Row;
  /** The dropped cuts that led to it, the named one first — empty when the named row is its own live cut. */
  readonly superseded: readonly Row[];
}

/**
 * Follow a named draft through its drop notes to the cut that stands. A note chain that loops ends at the row that
 * would revisit one already passed, rather than walking forever.
 *
 * @param id the id a card or a question names
 * @param items every folded row
 * @returns the live cut and the chain to it, or `undefined` when the register holds no such id
 */
export function liveCutOf<Row extends ChainRow>({
  id,
  items,
}: {
  id: string;
  items: readonly Row[];
}): LiveCut<Row> | undefined {
  const named = items.find((item) => item.id === id);
  if (named === undefined) {
    return undefined;
  }
  let current: Row = named;
  const superseded: Row[] = [];
  const passed = new Set<string>([current.id]);
  for (;;) {
    const next: Row | undefined = draftSuccessor({ items, row: current });
    if (next === undefined || passed.has(next.id)) {
      return { live: current, superseded };
    }
    superseded.push(current);
    passed.add(next.id);
    current = next;
  }
}
