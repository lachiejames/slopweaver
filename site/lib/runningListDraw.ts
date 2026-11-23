/**
 * How the console draws the running list (`./runningList.ts` is the wire): who an item is from in words, the unread
 * count and the seen cursor it is counted against, and the order and follow rule the list is drawn by. Pure.
 */
import type { RunningListItem } from "./runningList";

/**
 * Where the newest item the owner has seen is kept, in this browser: the dot's cursor, `<seq>@<atIso>`. A key of its own,
 * written only by the running list and never through the console's preference channel: that channel replays any write
 * it has heard from another open window, so a console still running an older build could put its own cursor back
 * over this one. The key an older console wrote, `slopweaver.talk.runningListSeen`, is never read.
 */
export const RUNNING_LIST_SEEN_KEY = "slopweaver.talk.runningListSeenAt";

/** The seen cursor before this browser has read the list once. */
export const RUNNING_LIST_SEEN_UNSET = "unset";

/**
 * Who an item is from, as the list names it.
 *
 * @returns "you", "the voice", or the fleet session's name
 */
export function runningListWho({ item }: { item: Pick<RunningListItem, "origin" | "from"> }): string {
  if (item.origin === "owner") {
    return "you";
  }
  if (item.origin === "voice") {
    return "the voice";
  }
  if (item.from === undefined) {
    return "the fleet";
  }
  return item.from;
}

/** A seen cursor read: the newest number the owner has seen, and that item's own time when the cursor carries one. */
export interface SeenCursor {
  readonly seq: number | undefined;
  readonly atIso: string | undefined;
}

/** How far past this window's clock a cursor's time may sit before it reads as from the future: one day. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/** A sequence number as the cursor spells it: a whole number, no leading zero. */
const SEQ = /^(0|[1-9][0-9]{0,15})$/;

/** A stored cursor's halves, `<seq>@<atIso>`. Anything else, `unset` included, reads as `undefined`. */
function parsedCursor({ cursor }: { cursor: string }): { seq: number; atIso: string } | undefined {
  const separator = cursor.indexOf("@");
  if (separator < 0) {
    return undefined;
  }
  const seqText = cursor.slice(0, separator);
  const atIso = cursor.slice(separator + 1);
  if (atIso.includes("@") || !SEQ.test(seqText)) {
    return undefined;
  }
  const seq = Number(seqText);
  if (!Number.isSafeInteger(seq) || !Number.isFinite(Date.parse(atIso))) {
    return undefined;
  }
  return { atIso, seq };
}

/**
 * Whether a stored value is a seen cursor: unset, or the newest number the owner has seen with that item's time
 * (`<seq>@<atIso>`).
 *
 * @returns true for `unset` or `<seq>@<atIso>`
 */
export function isSeenCursor(value: unknown): value is string {
  return (
    value === RUNNING_LIST_SEEN_UNSET || (typeof value === "string" && parsedCursor({ cursor: value }) !== undefined)
  );
}

/**
 * The newest number the owner has seen and its time. Both are `undefined` before this browser has read the list, and for a
 * value `isSeenCursor` refuses, which the preference never hands back.
 *
 * @param cursor the stored cursor
 * @returns the cursor's halves
 */
export function seenOf({ cursor }: { cursor: string }): SeenCursor {
  const parsed = parsedCursor({ cursor });
  if (parsed === undefined) {
    return { atIso: undefined, seq: undefined };
  }
  return parsed;
}

/** One read of the cursor's storage: what it held, `null` for nothing, or that the read itself was refused. */
export type StorageRead = { readonly readable: true; readonly value: string | null } | { readonly readable: false };

/**
 * The cursor a window reads, from storage and from the last cursor it knew. While its last write was refused and
 * storage still holds exactly what it held then, nothing has written since, so its own write stands: a denied or full
 * storage otherwise reads back unset or a stale cursor it cannot replace, and the dot never
 * lights. Storage holding a cursor no older than its own means another window's write landed, so storage works again
 * and wins; an older one is a stale window's write, and its own write still stands.
 * A read refused now, or refused at the refusal itself, proves nothing about what storage holds, so its own write
 * stands until a write lands, here or — heard as another window's storage event — elsewhere. Every fallback is
 * the last cursor this window knew from either side, never only its own last write, which another window's later
 * write may have passed.
 *
 * @param stored what storage holds now
 * @param storedAtRefusal what storage held when this window's last write was refused, `undefined` if it landed
 * @param lastKnown the last cursor this window wrote or read from storage, unset before any
 * @returns the cursor, and whether the refusal still stands
 */
export function seenCursorFromStorage({
  stored,
  storedAtRefusal,
  lastKnown,
}: {
  stored: StorageRead;
  storedAtRefusal: StorageRead | undefined;
  lastKnown: string;
}): { cursor: string; refusalStands: boolean } {
  const refused = storedAtRefusal !== undefined;
  if (!stored.readable) {
    return { cursor: lastKnown, refusalStands: refused };
  }
  // While its write is refused, storage wins only with a cursor no older than this window's own. One no older is
  // another window's later write, and masking it would let this window's next write lower it. An older one
  // is a stale window's write landing after the refusal, and taking it would bring an item opened here back.
  if (refused && !storageEventIsNews({ lastKnown, newValue: stored.value })) {
    return { cursor: lastKnown, refusalStands: true };
  }
  if (isSeenCursor(stored.value)) {
    return { cursor: stored.value, refusalStands: false };
  }
  return { cursor: lastKnown, refusalStands: false };
}

/**
 * Whether another window's storage event carries news for this one: a cursor no older than the last one it knew.
 * Every write a window makes moves the cursor's time forward — opening raises it to a newer item, a repair stamps the
 * first new item's time — so an older one is an event delivered late, from before this window's own raise, and taking
 * it would bring an opened item back.
 *
 * @param newValue the cursor the event carries, `null` when the key was removed
 * @param lastKnown the last cursor this window wrote or read
 * @returns whether to take the event's cursor
 */
export function storageEventIsNews({ newValue, lastKnown }: { newValue: string | null; lastKnown: string }): boolean {
  if (newValue === null) {
    return false;
  }
  const incoming = parsedCursor({ cursor: newValue });
  if (incoming === undefined) {
    return false;
  }
  const known = parsedCursor({ cursor: lastKnown });
  if (known === undefined) {
    return true;
  }
  const incomingMs = Date.parse(incoming.atIso);
  const knownMs = Date.parse(known.atIso);
  // In one millisecond, only a raise is news: a lower number there is a late event too, since a repair that
  // lowers the number stamps the first new item's later time.
  return incomingMs > knownMs || (incomingMs === knownMs && incoming.seq >= known.seq);
}

/**
 * The cursor that says the owner has seen up to this item: its number and its own time, the one spelling both the read
 * repair and opening the list write.
 *
 * @param item the newest item the owner has seen
 * @returns `<seq>@<atIso>`
 */
export function seenCursorOf({ item }: { item: Pick<RunningListItem, "seq" | "atIso"> }): string {
  return `${String(item.seq)}@${item.atIso}`;
}

/**
 * The cursor opening the list writes, or `undefined` to write nothing. It only ever RAISES the cursor: each value
 * passed in `held` is a reading of it — what this window last drew, and storage read at this instant — and a write is
 * refused when any of them is already at or past the newest item — by number, or by its item's time, since a window
 * still holding the list from before a restart has bigger numbers than the newer list. Another window
 * may have opened the list on a newer read a moment before this one heard of it, and a write from this
 * window's older read would bring the dot back for an item the owner has opened. Bringing it down is `seenCursorAfterRead`'s
 * alone. A window still holding the list from before a restart that opens it after another window's repair can still
 * raise the cursor above the newer list; every window's next read, at most one poll later, finds the
 * newer list's items added after that cursor's time and brings it back down, so the dot is dark for one poll at most.
 *
 * @param newest the newest item this window's read holds, `undefined` for an empty list
 * @param held readings of the stored cursor, `null` where storage held none
 * @returns the cursor to write, or `undefined`
 */
export function seenCursorOnOpen({
  newest,
  held,
}: {
  newest: Pick<RunningListItem, "seq" | "atIso"> | undefined;
  held: readonly (string | null)[];
}): string | undefined {
  if (newest === undefined) {
    return undefined;
  }
  const newestMs = Date.parse(newest.atIso);
  // Reached by number within one list, or by time across a restart: a cursor whose own item is newer than this
  // window's newest came from a newer read, whatever its number. A cursor in the very same millisecond
  // is not reached: refusing it would leave a repaired cursor's dot lit through every open. Across a restart that tie
  // lets a stale window raise it, and the next read sees the newer list's item in that millisecond as a
  // restart and brings it back down, lighting that item once.
  const reached = held.some((cursor) => {
    if (cursor === null) {
      return false;
    }
    const { seq, atIso } = seenOf({ cursor });
    if (seq === undefined) {
      return false;
    }
    return seq >= newest.seq || (atIso !== undefined && Date.parse(atIso) > newestMs);
  });
  if (reached) {
    return undefined;
  }
  return seenCursorOf({ item: newest });
}

/**
 * The cursor to store after a read, or `undefined` to keep the one stored. A list file that is recreated numbers
 * again from 1, so a cursor from the list before it sits above every item and the dot never lights again — measured, a stored `22` over a list numbered 3 to 12 (`slopweaver talk list --json`). Two windows share this
 * cursor and each reads on its own clock, so a window whose read is merely OLDER than the cursor must never pull it
 * back: only a positive sign of a restart moves it down.
 *
 * - Unset (the first read in this browser, or a value that is not a cursor): the newest item, so what is already
 *   there is not news; `0@<now>` for none, so the first item added after counts.
 * - A cursor, when the list holds another item numbered at or below it but added at or after its time: within one
 *   list the numbers and the times rise together, so that item is from a newer list. Rebased to the last item, oldest
 *   first, before the first one added at or after the cursor's time, so everything added since the owner last looked counts,
 *   and stamped with that first new item's time: this read has seen it, so a window still holding the list from before
 *   the restart, whose newest is older, cannot open its way back over the repair, which with its tray open it would do
 *   after every repair. Only a restart in the old newest item's own millisecond leaves that open. This is
 *   an inference from the clock, not a proof: a clock stepped backwards can delay it or
 *   fake one, and two items of one list added in the cursor's own millisecond read as a restart, lighting the dot
 *   once for items the owner has seen — a tie fails lit, never dark. An empty list, or one wholly older than the cursor,
 *   shows nothing and keeps it.
 * - A cursor dated more than a day after now: nothing will be added after it for that long, so it is re-baselined
 *   like an unset one. The day's slack is so a clock stepped back a moment does not read another
 *   window's fresh cursor as from the future and lower it; only a step back of more than a day can.
 *
 * @param cursor the stored cursor
 * @param items the list as just read, newest first
 * @param nowIso this instant, which a cursor's time may not be more than a day past
 * @returns the cursor to store, or `undefined` to keep it
 */
export function seenCursorAfterRead({
  cursor,
  items,
  nowIso,
}: {
  cursor: string;
  items: readonly Pick<RunningListItem, "seq" | "atIso">[];
  nowIso: string;
}): string | undefined {
  const newest = items.at(0);
  let baseline = seenCursorOf({ item: { atIso: nowIso, seq: 0 } });
  if (newest !== undefined) {
    baseline = seenCursorOf({ item: newest });
  }
  const seen = parsedCursor({ cursor });
  if (seen === undefined) {
    return baseline;
  }
  const seenAtIso = seen.atIso;
  const seenMs = Date.parse(seenAtIso);
  if (seenMs > Date.parse(nowIso) + FUTURE_SLACK_MS) {
    // Seen at a time well past now: no item would be added after it, so the dot would stay dark until then.
    return baseline;
  }
  // After the cursor's own time, or in its very millisecond when the cursor's own item is gone: an item from a
  // recreated list can share the old cursor's millisecond, and reading it as seen kept the dot dark until a later one
  // came. While the cursor's own item is still listed, a same-millisecond neighbour is one the same list
  // added beside it, never a restart.
  const ownItemListed = items.some((item) => item.seq === seen.seq && Date.parse(item.atIso) === seenMs);
  const addedSince = (item: Pick<RunningListItem, "seq" | "atIso">): boolean => {
    const atMs = Date.parse(item.atIso);
    return atMs > seenMs || (atMs === seenMs && item.seq !== seen.seq && !ownItemListed);
  };
  if (!items.some((item) => item.seq <= seen.seq && addedSince(item))) {
    return undefined;
  }
  let safeSeq = 0;
  let firstNewAtIso = seenAtIso;
  for (const item of items.toReversed()) {
    if (addedSince(item)) {
      firstNewAtIso = item.atIso;
      break;
    }
    safeSeq = item.seq;
  }
  return `${String(safeSeq)}@${firstNewAtIso}`;
}

/**
 * How many items wait for the owner: the voice's and the fleet's above the newest the owner has seen, and added at or after that
 * item's time. Within one list the two go together; a window still holding a list older than the cursor — its reads
 * failing since a restart — has numbers above a newer list's cursor that are older than it, and counting those would
 * light the dot for items the owner opened there, with no open able to clear it. The owner's own never wait, since
 * they know what they added. Before the list has been read once nothing waits, and the caller stores the newest then.
 *
 * @param items the list, newest first
 * @param seen the cursor read, both halves `undefined` before the first read
 * @returns the count
 */
export function runningListUnread({ items, seen }: { items: readonly RunningListItem[]; seen: SeenCursor }): number {
  const { seq, atIso } = seen;
  if (seq === undefined || atIso === undefined) {
    return 0;
  }
  const seenMs = Date.parse(atIso);
  return items.filter((item) => item.seq > seq && Date.parse(item.atIso) >= seenMs && item.origin !== "owner").length;
}

/**
 * The list in the order it is drawn: oldest at the top and newest at the bottom, as Messenger draws a conversation.
 * The wire and the store stay newest first.
 *
 * @param items the list, newest first
 * @returns the same items, oldest first
 */
export function runningListItemsOldestFirst({
  items,
}: {
  items: readonly RunningListItem[];
}): readonly RunningListItem[] {
  return items.toReversed();
}

/**
 * What the list does as it draws: `follow` when a newer item has arrived and the owner is at the foot, so it scrolls to it;
 * `hold` when one arrived while the owner reads older ones, so it stays put and says a new one is below, as
 * Messenger does; `none`
 * when nothing newer arrived.
 *
 * @param newestSeq the newest item's number now, `undefined` for an empty list
 * @param drawnSeq the newest number the list last drew
 * @param following whether the list is at its foot
 * @returns what the list does
 */
export function runningListArrival({
  newestSeq,
  drawnSeq,
  following,
}: {
  newestSeq: number | undefined;
  drawnSeq: number | undefined;
  following: boolean;
}): "none" | "follow" | "hold" {
  if (newestSeq === undefined || newestSeq === drawnSeq) {
    return "none";
  }
  if (following) {
    return "follow";
  }
  return "hold";
}
