/**
 * The tags a Queue card carries and how it inherits them: the board rows it belongs to, found by one join, and the
 * union of their tags plus the facets its own record states. Split out of `./queueTags.ts`, which holds the `?tag=`
 * filter over them.
 */

import type { BoardRow, BoardTagsRead } from "../components/live/read";

/** One `key=value` a card carries. Where it came from is dropped: a card has a value or it does not. */
export interface CardTag {
  readonly key: string;
  readonly value: string;
}

/** A card's tags, and how much of what they were inherited from actually read. */
export interface QueueTags {
  readonly tags: readonly CardTag[];
  readonly tagsRead: BoardTagsRead;
}

/**
 * The board as the association sees it: its rows and the documents it could not read, or the fact that it has not
 * read at all. An unreadable document may declare any slug, so it keeps a miss from being proof of absence.
 */
export type BoardReading =
  | { readonly phase: "ready"; readonly rows: readonly BoardRow[]; readonly unreadable: readonly string[] }
  | { readonly phase: "unread" };

/**
 * Add a tag unless the list already holds that key and value.
 *
 * @returns nothing; `into` grows in place
 */
function addTag({ into, tag }: { into: CardTag[]; tag: CardTag }): void {
  if (!into.some((each) => each.key === tag.key && each.value === tag.value)) {
    into.push({ key: tag.key, value: tag.value });
  }
}

/** The rows a card belongs to, and whether finding them was complete. */
interface Association {
  readonly rows: readonly BoardRow[];
  /** A slug matched several rows, or was searched while a document was unreadable, or a `pr=` edge could be hidden. */
  readonly incomplete: boolean;
  /** Each slug the record names that matched several rows: the data is ambiguous, no read failed. */
  readonly ambiguous: readonly string[];
  /** What did not read and may hold a row it belongs to: each unreadable document, each row whose tags did not. */
  readonly unread: readonly string[];
}

/**
 * Find the rows a card belongs to on a read board.
 *
 * A slug matching exactly one row joins it. One matching SEVERAL is ambiguous: which one the record meant is not
 * provable, so none of them lends a tag and the association is incomplete rather than a union of strangers' tags.
 * One matching exactly one, or none, is proof only when every document read: an unreadable one may declare the slug. A pull request joins every row, done or closed too, whose
 * `pr=` names it, and a row whose tags did not wholly read may be hiding that very edge.
 *
 * @returns the rows and whether the search was complete
 */
function associate({
  rows,
  unreadable,
  direct,
  slugs,
  pullRequest,
}: {
  rows: readonly BoardRow[];
  unreadable: readonly string[];
  direct: BoardRow | undefined;
  slugs: readonly string[];
  pullRequest: string | undefined;
}): Association {
  const belongs: BoardRow[] = [];
  const ambiguous: string[] = [];
  const unread = new Set<string>();
  if (direct !== undefined) {
    belongs.push(direct);
  }
  for (const slug of new Set(slugs)) {
    const matches = rows.filter((row) => row.slug === slug);
    const only = matches.at(0);
    if (matches.length === 1 && only !== undefined && !belongs.includes(only)) {
      belongs.push(only);
    }
    if (matches.length > 1) {
      ambiguous.push(slug);
    }
    // An unreadable document may hold a second row under this slug, so a single match is not proof it is the one.
    for (const document of unreadable) {
      unread.add(document);
    }
  }
  if (pullRequest !== undefined) {
    // A done or closed row naming it is still the work it belongs to, and `list --json` publishes every row whatever its
    // section, so skipping one would let `!workstream` claim a pull request a finished row already placed.
    for (const row of rows) {
      const names = row.tags.some((tag) => tag.key === "pr" && tag.value === pullRequest);
      if (names && !belongs.includes(row)) {
        belongs.push(row);
      }
      if (!names && row.tagsRead !== "whole") {
        unread.add(`${row.slug}'s tags`);
      }
    }
    for (const document of unreadable) {
      unread.add(document);
    }
  }
  return {
    ambiguous,
    incomplete: ambiguous.length > 0 || unread.size > 0,
    rows: belongs,
    unread: [...unread],
  };
}

/**
 * The board rows one card belongs to, or the fact that the board has not been read to find them. A ready search names
 * apart what kept it from being whole: a slug matching several rows (`ambiguous`, the data) and what did not read
 * (`unread`, a failed read).
 */
export type CardRows =
  | {
      readonly phase: "ready";
      readonly rows: readonly BoardRow[];
      readonly ambiguous: readonly string[];
      readonly unread: readonly string[];
    }
  | { readonly phase: "unread" };

/**
 * The board rows a card belongs to, found by the one join its tags are inherited through ({@link associate}), so a
 * card's properties and its tags never disagree about which rows it is. A card naming no row is complete with none.
 *
 * @param direct the one row the record IS, when it carries it (an ask)
 * @param slugs the board slugs the record names, exactly as it names them
 * @param pullRequest the pull request the card is, spelled `owner/repo#N`
 * @returns the rows and what kept finding them from being whole, or `unread` while the board is
 */
export function cardRows({
  board,
  direct,
  slugs,
  pullRequest,
}: {
  board: BoardReading;
  direct: BoardRow | undefined;
  slugs: readonly string[];
  pullRequest: string | undefined;
}): CardRows {
  if (direct === undefined && slugs.length === 0 && pullRequest === undefined) {
    return { ambiguous: [], phase: "ready", rows: [], unread: [] };
  }
  if (board.phase === "unread") {
    return { phase: "unread" };
  }
  const { rows, ambiguous, unread } = associate({
    direct,
    pullRequest,
    rows: board.rows,
    slugs,
    unreadable: board.unreadable,
  });
  return { ambiguous, phase: "ready", rows, unread };
}

/**
 * The tags a card inherits from the board rows it belongs to, plus the facets its own record states.
 *
 * A card that can belong to no row reads whole on its own facets. One that could reads `absent` while the board
 * has not read, or publishes no tags on any row: its facets stay true, but what it inherits is unknown. Otherwise it
 * reads whole only when every row it joined read whole AND the search for them was complete ({@link associate}).
 *
 * @param direct the one row the record IS, when it carries it (an ask)
 * @param slugs the board slugs the record names, exactly as it names them
 * @param pullRequest the pull request the card is, spelled `owner/repo#N` as the `pr=` tag spells it
 * @param derived the facets the record itself states, true whatever the board says
 * @returns the card's tags and how much of them read
 */
export function inheritedTags({
  board,
  direct,
  slugs,
  pullRequest,
  derived,
}: {
  board: BoardReading;
  direct: BoardRow | undefined;
  slugs: readonly string[];
  pullRequest: string | undefined;
  derived: readonly CardTag[];
}): QueueTags {
  const tags: CardTag[] = [];
  for (const tag of derived) {
    addTag({ into: tags, tag });
  }
  if (direct === undefined && slugs.length === 0 && pullRequest === undefined) {
    return { tags, tagsRead: "whole" };
  }
  if (board.phase === "unread" || board.rows.every((row) => row.tagsRead === "absent")) {
    return { tags, tagsRead: "absent" };
  }
  const { rows, incomplete } = associate({
    direct,
    pullRequest,
    rows: board.rows,
    slugs,
    unreadable: board.unreadable,
  });
  for (const row of rows) {
    for (const tag of row.tags) {
      addTag({ into: tags, tag });
    }
  }
  if (!incomplete && rows.every((row) => row.tagsRead === "whole")) {
    return { tags, tagsRead: "whole" };
  }
  return { tags, tagsRead: "partial" };
}
