/**
 * The doctrine panel's second line: the board rows no seat can take, and why — off `handover reconcile`'s own holds
 * (`../components/live/readReconcileHolds.ts`) and the board's parked checkpoints, never a second opinion of either.
 *
 * The chair called the board quiet while 58 relay rows naming no `repo:`, released runs and parked runs sat unseated.
 * This module keeps out of the trap of calling those ready: a row naming no
 * `repo:`, a retired chair and a trunk-moved finding are HELD before they can be ready (`src/handover/rowStanding.ts`),
 * so each is its own group and none is called ready. The one READY reason is a slug more than one doc claims, which
 * `cmux spawn` refuses. This is the board's structural reasons, not a forecast of the next tick's spawns: the
 * supervisor also skips rows it held on a prior tick, which no reading publishes.
 *
 * Where the verb could not look — no chair judged, a trunk unread, a journal unreadable, an older reading — the line
 * says so in a `not checked` group, and a count beside one reads "at least", never as measured.
 */

import { waitsOnOwner } from "../components/live/readBoardWaits";
import {
  boardGapsOf,
  fleetUnobservedWhyOf,
  type HoldIds,
  holdGapsOf,
  holdIdsOf,
  namedOf,
  placedIdsOf,
  unreadSentenceOf,
  unreadWhysOf,
} from "./fleetDoctrineGaps";
import type {
  DoctrineBoard,
  DoctrineGroup,
  DoctrineInput,
  DoctrineItem,
  DoctrineLine,
  DoctrineReason,
  DoctrineReconcile as Reconcile,
} from "./fleetDoctrineTypes";
import { counted } from "./sidebarCountsBasis";

/**
 * Ids as items, sorted and deduplicated.
 *
 * @returns the items
 */
function itemsOf({ ids }: { ids: Iterable<string> }): readonly DoctrineItem[] {
  return [...new Set(ids)].toSorted().map((id) => ({ href: undefined, key: id, text: id }));
}

/**
 * The reasons the verb could not look, as one group's items.
 *
 * @returns the reasons, empty when it looked everywhere
 */
function notCheckedOf({ reconcile, board }: { reconcile: Reconcile; board: DoctrineBoard }): readonly DoctrineReason[] {
  const reasons: DoctrineReason[] = [...boardGapsOf({ board })];
  const unreadParks = board.rows.filter((row) => row.parkedCheckpoint === "unread").map((row) => row.slug);
  if (unreadParks.length > 0) {
    reasons.push(
      `${counted({ count: unreadParks.length, many: "board rows carry", one: "board row carries" })} a parked checkpoint that will not read, so whether each waits on anything was not checked${namedOf({ ids: unreadParks })}`,
    );
  }
  const unknownStanding = unknownStandingOf({ reconcile });
  if (unknownStanding.length > 0) {
    reasons.push(
      `${counted({ count: unknownStanding.length, many: "held rows carry", one: "held row carries" })} a standing that did not read, so whether each is started was not checked${namedOf({ ids: unknownStanding })}`,
    );
  }
  const parked = parkedOrUnknownOf({ board });
  const unshown = startedUnshownOf({ board, parked, reconcile });
  if (unshown.length > 0) {
    reasons.push(
      `a doc the board could not read may park ${counted({ count: unshown.length, many: "started runs", one: "started run" })} with no seat, so whether each is parked was not checked${namedOf({ ids: unshown })}`,
    );
  }
  // A reading with no hold lists, or no held rows, could not check any row it or the board carries, so every one with
  // no live seat on it is named by id rather than the gap alone.
  const candidates = unplacedRowIdsOf({ board, reconcile });
  // Any other row with no seat is just as hideable: an unread doc's no-wake park on it, whatever list carries it, adds
  // it to "parked on nothing". A row a hold list already counts is kept either way, so it is not named.
  const holdIds = holdIdsOf({ reconcile });
  const hidden = parkableUnshownOf({
    board,
    candidates,
    explained: new Set([
      ...parked,
      ...unshown,
      ...unknownStanding,
      ...holdIds.released,
      ...holdIds.repoless,
      ...holdIds.shared,
      ...holdIds.superseded,
      ...holdIds.trunkMoved,
    ]),
  });
  if (hidden.length > 0) {
    reasons.push(
      `a doc the board could not read may park ${counted({ count: hidden.length, many: "other rows", one: "other row" })} with no seat, so whether each is parked on nothing was not checked${namedOf({ ids: hidden })}`,
    );
  }
  reasons.push(...holdGapsOf({ candidates, holds: reconcile.holds }));
  if (reconcile.held === undefined) {
    reasons.push(
      `the reconcile reading predates its held rows, so started runs with no seat were not counted${namedOf({ ids: candidates })}`,
    );
  }
  return reasons;
}

/**
 * Every row id the reconcile and the board carry that no live seat is on: the places a hold list or the held rows
 * would have checked.
 *
 * @returns the ids, sorted and once each
 */
function unplacedRowIdsOf({ reconcile, board }: { reconcile: Reconcile; board: DoctrineBoard }): readonly string[] {
  const placed = placedIdsOf({ reconcile });
  const holds = holdIdsOf({ reconcile });
  // Every ranked list too: a row the reading ranks anywhere could be the one a gap hid.
  const ids = [
    ...[...reconcile.top, ...reconcile.starving, ...reconcile.staleAsks, ...reconcile.ready].map((row) => row.id),
    ...(reconcile.held === undefined ? [] : reconcile.held.map((row) => row.id)),
    ...board.rows.map((row) => row.slug),
    ...holds.released,
    ...holds.repoless,
    ...holds.shared,
    ...holds.superseded,
    ...holds.trunkMoved,
  ];
  return [...new Set(ids.filter((id) => !placed.has(id)))].toSorted();
}

/** One reason's group, and the few words the sentence names it by. */
interface Reason {
  readonly short: string;
  readonly group: DoctrineGroup;
}

/**
 * The rows with a run open and no live seat that neither a park nor a release explains.
 *
 * @returns the ids, empty when the reading carries no held rows
 */
function startedNobodyOf({
  reconcile,
  explained,
}: {
  reconcile: Reconcile;
  explained: ReadonlySet<string>;
}): readonly string[] {
  if (reconcile.held === undefined) {
    return [];
  }
  return reconcile.held.filter((row) => row.standing === "in-flight" && !explained.has(row.id)).map((row) => row.id);
}

/**
 * The standings `handover reconcile` prints: `src/handover/rowStanding.ts`'s `RowStanding`, restated since `site/`
 * imports nothing from `src/`.
 */
const ROW_STANDINGS: ReadonlySet<string> = new Set(["in-flight", "ready", "waiting-on-owner", "paused", "blocked"]);

/**
 * The held rows with no live seat whose standing is outside the verb's vocabulary. Such a word could mean started,
 * so the row is named under not checked rather than read as not started.
 *
 * @returns the ids, empty when every standing read
 */
function unknownStandingOf({ reconcile }: { reconcile: Reconcile }): readonly string[] {
  if (reconcile.held === undefined) {
    return [];
  }
  const placed = placedIdsOf({ reconcile });
  return reconcile.held.filter((row) => !ROW_STANDINGS.has(row.standing) && !placed.has(row.id)).map((row) => row.id);
}

/**
 * The started runs with no seat that a board with a gap did not show parked. A doc the board could not read could
 * carry that row's parked checkpoint, whether or not the board showed a row under that slug — a doc's slug is its
 * front-matter's, so an unread doc can be a second one claiming a shown slug. Counting such a
 * row as started with nobody on it would break the line's floor; it is named under not checked instead.
 *
 * @returns the ids, empty on a complete board
 */
function startedUnshownOf({
  reconcile,
  board,
  parked,
}: {
  reconcile: Reconcile;
  board: DoctrineBoard;
  parked: readonly string[];
}): readonly string[] {
  if (boardGapsOf({ board }).length === 0) {
    return [];
  }
  const placed = placedIdsOf({ reconcile });
  const explained = new Set([...parked, ...holdIdsOf({ reconcile }).released]);
  return startedNobodyOf({ explained, reconcile }).filter((id) => !placed.has(id));
}

/**
 * The rows with no seat, from any list either reading carries, that a board with a gap did not show parked and no
 * other gap already names: an unread doc could park any of them on nothing.
 *
 * @param candidates every row id with no live seat on it
 * @param explained the ids a park, a release or another named gap already accounts for
 * @returns the ids, empty on a complete board
 */
function parkableUnshownOf({
  board,
  candidates,
  explained,
}: {
  board: DoctrineBoard;
  candidates: readonly string[];
  explained: ReadonlySet<string>;
}): readonly string[] {
  if (boardGapsOf({ board }).length === 0) {
    return [];
  }
  return candidates.filter((id) => !explained.has(id));
}

/**
 * The board rows whose checkpoint is a park or did not read, both kept out of "started, nobody on it".
 *
 * @returns the slugs
 */
function parkedOrUnknownOf({ board }: { board: DoctrineBoard }): readonly string[] {
  return board.rows.filter((row) => row.parkedCheckpoint !== undefined).map((row) => row.slug);
}

/**
 * The reasons rows no seat can take, each with its group, empty ones dropped.
 *
 * @returns the reasons
 */
function reasonsOf({ reconcile, board }: { reconcile: Reconcile; board: DoctrineBoard }): readonly Reason[] {
  const rows = board.rows;
  // A row a live seat is on is never kept from one, whichever list names it.
  const placed = placedIdsOf({ reconcile });
  const unplaced = (list: readonly string[]): readonly string[] => list.filter((id) => !placed.has(id));
  const all = holdIdsOf({ reconcile });
  const ids: HoldIds = {
    released: unplaced(all.released),
    repoless: unplaced(all.repoless),
    shared: all.shared,
    superseded: unplaced(all.superseded),
    trunkMoved: unplaced(all.trunkMoved),
  };
  const shared = new Set(ids.shared);
  const readyShared = unplaced(reconcile.ready.map((row) => row.id).filter((id) => shared.has(id)));
  const parkedNowhere = unplaced(
    rows
      .filter((row) => row.parkedCheckpoint === "no-wake" && !waitsOnOwner({ ownerWait: row.ownerWait }))
      .map((row) => row.slug),
  );
  // A checkpoint that will not read is neither a park nor its absence: it is kept out of "started, nobody on it"
  // and named under not checked instead.
  const parkedOrUnknown = parkedOrUnknownOf({ board });
  const unshown = startedUnshownOf({ board, parked: parkedOrUnknown, reconcile });
  const startedNobody = unplaced(
    startedNobodyOf({ explained: new Set([...parkedOrUnknown, ...ids.released, ...unshown]), reconcile }),
  );
  const reasons: Reason[] = [
    {
      group: {
        items: itemsOf({ ids: readyShared }),
        label: "ready, but more than one doc claims the slug, so cmux spawn refuses it",
      },
      short: "slug claimed twice",
    },
    {
      group: { items: itemsOf({ ids: ids.repoless }), label: "name no repo:, so no worktree can be opened" },
      short: "no repo",
    },
    {
      group: { items: itemsOf({ ids: ids.superseded }), label: "a supervisor chair a later one already retired" },
      short: "retired chair",
    },
    {
      group: { items: itemsOf({ ids: ids.trunkMoved }), label: "a finding the trunk moved under since it was asked" },
      short: "trunk moved",
    },
    {
      group: { items: itemsOf({ ids: ids.released }), label: "started, then released by its seat: nobody holds it" },
      short: "released",
    },
    {
      group: {
        items: itemsOf({ ids: parkedNowhere }),
        label: "parked with no wake and not on you: waiting on nothing",
      },
      short: "parked on nothing",
    },
    {
      group: { items: itemsOf({ ids: startedNobody }), label: "started, and no live seat is on it" },
      short: "started, nobody on it",
    },
  ];
  return reasons.filter((reason) => reason.group.items.length > 0);
}

/**
 * The second line: how many rows no seat can take, by reason, and where the verb could not look.
 *
 * @returns the line
 */
export function unseatableLineOf({
  reconcile,
  board,
}: {
  reconcile: DoctrineInput<Reconcile>;
  board: DoctrineInput<DoctrineBoard>;
}): DoctrineLine {
  if (reconcile.kind === "unread" || board.kind === "unread") {
    // Both are named when both did not arrive, since either could change the count.
    return {
      groups: [],
      key: "unseatable",
      ...unreadSentenceOf({
        reasons: unreadWhysOf({ inputs: [reconcile, board] }),
        subject: "Board rows kept from a seat",
      }),
      tone: "unread",
    };
  }
  if (reconcile.value.fleet !== "observed") {
    // Every other gap can only hide a row, so its count is a floor. A live fleet nobody saw cuts both ways: a seat it
    // missed takes a row out, a seat it invented keeps one in, so no bound holds and the line is not read.
    // Every other place not checked is named beside it, never dropped behind it.
    const why = [
      fleetUnobservedWhyOf({ reconcile: reconcile.value }),
      ...notCheckedOf({ board: board.value, reconcile: reconcile.value }),
    ];
    // A seat the reconcile did not see could be on any row it or the board carries, so each is named.
    const unseen = unplacedRowIdsOf({ board: board.value, reconcile: reconcile.value });
    return {
      groups:
        unseen.length === 0
          ? []
          : [
              {
                items: itemsOf({ ids: unseen }),
                label: "no live seat placed, and whether one is on it was not checked",
              },
            ],
      key: "unseatable",
      ...unreadSentenceOf({ reasons: why, subject: "Board rows kept from a seat" }),
      tone: "unread",
    };
  }
  const reasons = reasonsOf({ board: board.value, reconcile: reconcile.value });
  const groups = reasons.map((reason) => reason.group);
  const total = new Set(groups.flatMap((group) => group.items.map((item) => item.key))).size;
  const notChecked = notCheckedOf({ board: board.value, reconcile: reconcile.value });
  let sentence = `${counted({ count: total, many: "board rows", one: "board row" })} kept from a seat`;
  if (notChecked.length > 0 && total > 0) {
    sentence = `At least ${sentence}`;
  } else if (notChecked.length > 0) {
    sentence = "None of the board rows looked at is kept from a seat";
  }
  if (reasons.length > 0) {
    sentence = `${sentence}: ${reasons.map((reason) => `${String(reason.group.items.length)} ${reason.short}`).join(", ")}`;
  }
  sentence = `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  const withNotes = [...groups];
  if (notChecked.length > 0) {
    sentence = `${sentence} ${counted({ count: notChecked.length, many: "places", one: "place" })} not checked.`;
    withNotes.push({ items: notChecked.map((reason) => notCheckedItemOf({ reason })), label: "not checked" });
  }
  // A floor above zero is a measured finding ("At least"), so it carries attention even with places not checked;
  // only a zero floor reads unread.
  let tone: DoctrineLine["tone"] = "ok";
  if (total > 0) {
    tone = "attention";
  } else if (notChecked.length > 0) {
    tone = "unread";
  }
  return { groups: withNotes, key: "unseatable", quoted: [], sentence, tone };
}

/**
 * One place not checked, as an item: the console's words, or its words quoting a read's reason with the reason apart,
 * so the panel says it plainly and folds the raw message (steer 7).
 *
 * @returns the item
 */
function notCheckedItemOf({ reason }: { reason: DoctrineReason }): DoctrineItem {
  if (typeof reason === "string") {
    return { href: undefined, key: reason, text: reason };
  }
  return { href: undefined, key: reason.lead, text: reason.lead, why: reason.why };
}
