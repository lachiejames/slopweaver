/*
 * The running list's unread dot (`site/lib/runningListDraw.ts`): the seen cursor this browser keeps, how every read
 * squares it with the list — a list file recreated under it numbers again from 1 — and the count it is held against.
 */
import { describe, expect, it } from "vitest";

import type { RunningListItem } from "../../lib/runningList";
import {
  isSeenCursor,
  RUNNING_LIST_SEEN_KEY,
  RUNNING_LIST_SEEN_UNSET,
  runningListUnread,
  type StorageRead,
  seenCursorAfterRead,
  seenCursorFromStorage,
  seenCursorOf,
  seenCursorOnOpen,
  seenOf,
  storageEventIsNews,
} from "../../lib/runningListDraw";

/** One decoded item. */
function item(over: Partial<RunningListItem> = {}): RunningListItem {
  return { atIso: "2026-10-12T09:00:00.000Z", id: "req-1", origin: "voice", seq: 3, text: "*on it*", ...over };
}

/** An item at a minute past the base hour, numbered `seq`. */
function at({ seq, minute }: { seq: number; minute: number }): RunningListItem {
  return item({ atIso: `2026-11-04T09:${String(minute).padStart(2, "0")}:00.000Z`, id: `req-${String(seq)}`, seq });
}

/** The read repair an hour after the base hour, after every item below. */
function afterRead({ cursor, items }: { cursor: string; items: readonly RunningListItem[] }): string | undefined {
  return seenCursorAfterRead({ cursor, items, nowIso: "2026-11-04T10:00:00.000Z" });
}

describe("the seen cursor", () => {
  it("lives under a key of its own, never the one an older console replays over the preference channel", () => {
    expect(RUNNING_LIST_SEEN_KEY).toBe("slopweaver.talk.runningListSeenAt");
  });

  it("accepts unset and a number with its item's time", () => {
    expect([
      isSeenCursor(RUNNING_LIST_SEEN_UNSET),
      isSeenCursor("0@2026-11-04T09:00:00.000Z"),
      isSeenCursor("42@2026-11-04T09:00:00.000Z"),
    ]).toEqual([true, true, true]);
  });

  it("refuses a bare number, a leading zero, a negative, an unsafe number, a bad time, a missing half, two separators, a number", () => {
    expect([
      isSeenCursor("22"),
      isSeenCursor("042@2026-11-04T09:00:00.000Z"),
      isSeenCursor("-1"),
      isSeenCursor("9999999999999999"),
      isSeenCursor("4@not-a-time"),
      isSeenCursor("4@"),
      isSeenCursor("@2026-11-04T09:00:00.000Z"),
      isSeenCursor("4@2026-11-04T09:00:00.000Z@x"),
      isSeenCursor(42),
    ]).toEqual([false, false, false, false, false, false, false, false, false]);
  });

  it("reads unset and a bare number as nothing seen, and a cursor whole", () => {
    expect([
      seenOf({ cursor: RUNNING_LIST_SEEN_UNSET }),
      seenOf({ cursor: "7" }),
      seenOf({ cursor: "7@2026-11-04T09:00:00.000Z" }),
    ]).toEqual([
      { atIso: undefined, seq: undefined },
      { atIso: undefined, seq: undefined },
      { atIso: "2026-11-04T09:00:00.000Z", seq: 7 },
    ]);
  });

  it("spells an item as its number and its own time", () => {
    expect(seenCursorOf({ item: at({ minute: 5, seq: 12 }) })).toBe("12@2026-11-04T09:05:00.000Z");
  });
});

describe("seenCursorAfterRead", () => {
  // A measured list: numbered 3 to 12 after the file was recreated, newest first.
  const restarted = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((seq) => at({ minute: seq, seq }));

  it("stores the newest on the first read, so what is there is not news, and 0 at now for an empty list", () => {
    expect([
      afterRead({ cursor: RUNNING_LIST_SEEN_UNSET, items: restarted }),
      afterRead({ cursor: RUNNING_LIST_SEEN_UNSET, items: [] }),
    ]).toEqual(["12@2026-11-04T09:12:00.000Z", "0@2026-11-04T10:00:00.000Z"]);
  });

  it("re-baselines a value that is not a cursor, the measured bare 22 included, onto the list's newest", () => {
    expect([afterRead({ cursor: "22", items: restarted }), afterRead({ cursor: "22", items: [] })]).toEqual([
      "12@2026-11-04T09:12:00.000Z",
      "0@2026-11-04T10:00:00.000Z",
    ]);
  });

  it("is settled by its own empty-list baseline: the next read keeps it", () => {
    expect(afterRead({ cursor: "0@2026-11-04T10:00:00.000Z", items: [] })).toBe(undefined);
  });

  it("keeps a timed cursor over its own list, newer items included", () => {
    expect(afterRead({ cursor: "8@2026-11-04T09:08:00.000Z", items: restarted })).toBe(undefined);
  });

  it("keeps a timed cursor over an older read from another window, which shows no restart", () => {
    // The other window opened the list on 13 at 09:13; this one's read still ends at 12.
    expect(afterRead({ cursor: "13@2026-11-04T09:13:00.000Z", items: restarted })).toBe(undefined);
  });

  it("keeps a timed cursor over an empty list, which shows nothing", () => {
    expect(afterRead({ cursor: "22@2026-11-04T09:30:00.000Z", items: [] })).toBe(undefined);
  });

  it("rebases onto what was added before the cursor's time once a lower number carries a later time", () => {
    // Seen 22 at 09:06; the list restarted, and 3..5 are older than that look while 6..12 came at or after it.
    expect(afterRead({ cursor: "22@2026-11-04T09:06:00.000Z", items: restarted })).toBe("5@2026-11-04T09:06:00.000Z");
  });

  it("rebases to 0 when every item came after the cursor's time", () => {
    // Stamped with the first new item's time, 3 at 09:03, which this read has seen.
    expect(afterRead({ cursor: "22@2026-11-04T08:00:00.000Z", items: restarted })).toBe("0@2026-11-04T09:03:00.000Z");
  });

  it("undoes a stale window's open over a repair on the next read, so a false dark lasts one poll", () => {
    // Repaired to 0@09:02; a window still holding the old list then opened its 23@09:02:30, above every new number.
    expect(afterRead({ cursor: "23@2026-11-04T09:02:30.000Z", items: restarted })).toBe("0@2026-11-04T09:03:00.000Z");
  });

  it("is settled by its own rebase: the next read keeps it", () => {
    const rebased = afterRead({ cursor: "22@2026-11-04T09:06:00.000Z", items: restarted })!;
    expect(afterRead({ cursor: rebased, items: restarted })).toBe(undefined);
  });

  it("reads another item in the cursor's own millisecond as a restart, so it counts", () => {
    // The recreated list's 12 was added in the same millisecond as the old list's 22 the owner had seen.
    expect(afterRead({ cursor: "22@2026-11-04T09:12:00.000Z", items: restarted })).toBe("11@2026-11-04T09:12:00.000Z");
  });

  it("keeps a cursor over its own item, never reading that item as a restart", () => {
    expect(afterRead({ cursor: "12@2026-11-04T09:12:00.000Z", items: restarted })).toBe(undefined);
  });

  it("keeps a cursor whose own item shares its millisecond with a lower one from the same list", () => {
    // 1 and 2 were added in one millisecond and the owner opened the list through 2; 2 is still listed, so no restart.
    const sameMs = [2, 1].map((seq) => at({ minute: 5, seq }));
    expect(afterRead({ cursor: "2@2026-11-04T09:05:00.000Z", items: sameMs })).toBe(undefined);
  });

  it("stops the rebase at the first item after the cursor's time, even when a later one steps the clock back", () => {
    const stepped = [at({ minute: 2, seq: 5 }), at({ minute: 9, seq: 4 }), at({ minute: 1, seq: 3 })];
    expect(afterRead({ cursor: "20@2026-11-04T09:05:00.000Z", items: stepped })).toBe("3@2026-11-04T09:09:00.000Z");
  });

  it("re-baselines a cursor dated more than a day after now, which no item would follow", () => {
    expect([
      afterRead({ cursor: "9007199254740991@+275760-09-13T00:00:00.000Z", items: restarted }),
      afterRead({ cursor: "3@2026-11-05T10:00:00.001Z", items: [] }),
    ]).toEqual(["12@2026-11-04T09:12:00.000Z", "0@2026-11-04T10:00:00.000Z"]);
  });

  it("keeps another window's fresh cursor when this clock has stepped back a moment", () => {
    // The other window raised it to 13 at 10:00:00.001; this window's clock reads 10:00:00.000 and holds up to 12.
    expect([
      afterRead({ cursor: "13@2026-11-04T10:00:00.001Z", items: restarted }),
      afterRead({ cursor: "13@2026-11-05T10:00:00.000Z", items: restarted }),
      afterRead({ cursor: "12@2026-11-04T10:00:00.000Z", items: restarted }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("seenCursorOnOpen", () => {
  const newest = at({ minute: 12, seq: 12 });

  it("writes the newest when every reading of the cursor is below it, or holds none", () => {
    expect(seenCursorOnOpen({ held: ["6@2026-11-04T09:06:00.000Z", "6", null, RUNNING_LIST_SEEN_UNSET], newest })).toBe(
      "12@2026-11-04T09:12:00.000Z",
    );
  });

  it("writes nothing when another window already opened the list on a newer read", () => {
    // This window drew 6 and reads 12; storage already holds the other window's 13.
    expect(seenCursorOnOpen({ held: ["6@2026-11-04T09:06:00.000Z", "13@2026-11-04T09:13:00.000Z"], newest })).toBe(
      undefined,
    );
  });

  it("writes nothing from a read older than a restart, whose numbers outrun the newer list's", () => {
    // This window still holds the old list up to 22 at 09:22; the other opened the restarted list on 5 at 09:45.
    expect(seenCursorOnOpen({ held: ["5@2026-11-04T09:45:00.000Z"], newest: at({ minute: 22, seq: 22 }) })).toBe(
      undefined,
    );
  });

  it("refuses a window still holding the list from before a restart, so its open tray cannot undo each repair", () => {
    // The old list ended at 22, 09:00; the recreated 3..12 came from 09:03, and another window's read repaired to that.
    const repaired = afterRead({
      cursor: "22@2026-11-04T09:00:00.000Z",
      items: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((seq) => at({ minute: seq, seq })),
    })!;
    expect([repaired, seenCursorOnOpen({ held: [repaired], newest: at({ minute: 0, seq: 22 }) })]).toEqual([
      "0@2026-11-04T09:03:00.000Z",
      undefined,
    ]);
  });

  it("raises a repaired cursor in its own millisecond, so opening the list clears the dot", () => {
    // Repaired to 11 at the time of the recreated list's 12, which the owner now opens.
    expect(seenCursorOnOpen({ held: ["11@2026-11-04T09:12:00.000Z"], newest: at({ minute: 12, seq: 12 }) })).toBe(
      "12@2026-11-04T09:12:00.000Z",
    );
  });

  it("lets the next read undo a stale open over a same-millisecond cursor, lighting that item once", () => {
    // The old list's 22 and the recreated list's 5 were both added at 09:05; a stale window opened 22 over 5.
    const raised = seenCursorOnOpen({ held: ["5@2026-11-04T09:05:00.000Z"], newest: at({ minute: 5, seq: 22 }) })!;
    const recreated = [5, 4, 3].map((seq) => at({ minute: seq, seq }));
    expect([raised, afterRead({ cursor: raised, items: recreated })]).toEqual([
      "22@2026-11-04T09:05:00.000Z",
      "4@2026-11-04T09:05:00.000Z",
    ]);
  });

  it("writes nothing when the cursor already sits on the newest, or the list is empty", () => {
    expect([
      seenCursorOnOpen({ held: ["12@2026-11-04T09:12:00.000Z"], newest }),
      seenCursorOnOpen({ held: [null], newest: undefined }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("seenCursorFromStorage", () => {
  const mine = "5@2026-11-04T09:05:00.000Z";
  const held = ({ value }: { value: string | null }): StorageRead => ({ readable: true, value });
  const unreadable: StorageRead = { readable: false };

  it("reads storage while this window's writes land", () => {
    expect(
      seenCursorFromStorage({
        stored: held({ value: "12@2026-11-04T09:12:00.000Z" }),
        storedAtRefusal: undefined,
        lastKnown: mine,
      }),
    ).toEqual({ cursor: "12@2026-11-04T09:12:00.000Z", refusalStands: false });
  });

  it("reads its own write while storage refuses and reads back nothing", () => {
    expect(
      seenCursorFromStorage({
        stored: held({ value: null }),
        storedAtRefusal: held({ value: null }),
        lastKnown: mine,
      }),
    ).toEqual({ cursor: mine, refusalStands: true });
  });

  it("reads its own write over a stale cursor storage can no longer replace", () => {
    const stale = held({ value: "22@2026-11-04T09:00:00.000Z" });
    expect(seenCursorFromStorage({ stored: stale, storedAtRefusal: stale, lastKnown: mine })).toEqual({
      cursor: mine,
      refusalStands: true,
    });
  });

  it("reads storage again once another window's write has landed there", () => {
    expect(
      seenCursorFromStorage({
        stored: held({ value: "6@2026-11-04T09:06:00.000Z" }),
        storedAtRefusal: held({ value: "22@2026-11-04T09:00:00.000Z" }),
        lastKnown: mine,
      }),
    ).toEqual({ cursor: "6@2026-11-04T09:06:00.000Z", refusalStands: false });
  });

  it("keeps its own write when a stale window's older write lands after the refusal", () => {
    // Storage held 5 when this window's raise to 10 was refused; a window still drawing through 6 then stored 6.
    expect(
      seenCursorFromStorage({
        lastKnown: "10@2026-11-04T09:10:00.000Z",
        stored: held({ value: "6@2026-11-04T09:06:00.000Z" }),
        storedAtRefusal: held({ value: mine }),
      }),
    ).toEqual({ cursor: "10@2026-11-04T09:10:00.000Z", refusalStands: true });
  });

  it("reads storage again once it holds a cursor no older than its own, whatever the refusal saw", () => {
    // Another window stored 100 at 10:00 while this one's reads were refused; they recover before its event arrives.
    expect([
      seenCursorFromStorage({
        lastKnown: mine,
        stored: held({ value: "100@2026-11-04T10:00:00.000Z" }),
        storedAtRefusal: unreadable,
      }),
      seenCursorFromStorage({
        lastKnown: mine,
        stored: held({ value: "100@2026-11-04T10:00:00.000Z" }),
        storedAtRefusal: held({ value: null }),
      }),
    ]).toEqual([
      { cursor: "100@2026-11-04T10:00:00.000Z", refusalStands: false },
      { cursor: "100@2026-11-04T10:00:00.000Z", refusalStands: false },
    ]);
  });

  it("keeps its own write when the refusal's read was refused too, and storage reads back an older one", () => {
    expect(
      seenCursorFromStorage({
        stored: held({ value: "4@2026-11-04T09:04:00.000Z" }),
        storedAtRefusal: unreadable,
        lastKnown: mine,
      }),
    ).toEqual({ cursor: mine, refusalStands: true });
  });

  it("keeps its own write, and the refusal, while a read is refused now", () => {
    expect(
      seenCursorFromStorage({ stored: unreadable, storedAtRefusal: held({ value: null }), lastKnown: mine }),
    ).toEqual({
      cursor: mine,
      refusalStands: true,
    });
  });

  it("falls back to its own write when a read is refused with no refusal standing", () => {
    expect(seenCursorFromStorage({ stored: unreadable, storedAtRefusal: undefined, lastKnown: mine })).toEqual({
      cursor: mine,
      refusalStands: false,
    });
  });

  it("falls back to the cursor it last read, never an older own write, once storage empties", () => {
    // It wrote 5 long ago; another window then stored 10, which it read; then the key was removed.
    const opened = "10@2026-11-04T09:10:00.000Z";
    const first = seenCursorFromStorage({
      lastKnown: mine,
      stored: held({ value: opened }),
      storedAtRefusal: undefined,
    });
    const second = seenCursorFromStorage({
      lastKnown: first.cursor,
      stored: held({ value: null }),
      storedAtRefusal: undefined,
    });
    expect([first.cursor, second.cursor]).toEqual([opened, opened]);
  });

  it("falls back to its own write when storage holds no cursor", () => {
    expect(
      seenCursorFromStorage({ stored: held({ value: "22" }), storedAtRefusal: undefined, lastKnown: mine }),
    ).toEqual({
      cursor: mine,
      refusalStands: false,
    });
  });
});

describe("storageEventIsNews", () => {
  const opened = "10@2026-11-04T09:10:00.000Z";

  it("takes another window's newer cursor, a raise in the same millisecond, and the same cursor", () => {
    expect([
      storageEventIsNews({ lastKnown: opened, newValue: "11@2026-11-04T09:11:00.000Z" }),
      storageEventIsNews({ lastKnown: opened, newValue: "11@2026-11-04T09:10:00.000Z" }),
      storageEventIsNews({ lastKnown: opened, newValue: opened }),
    ]).toEqual([true, true, true]);
  });

  it("refuses an older cursor, an event delivered late from before this window's own raise", () => {
    expect(storageEventIsNews({ lastKnown: opened, newValue: "5@2026-11-04T09:05:00.000Z" })).toBe(false);
  });

  it("refuses a lower number in the same millisecond, a late event from the same list", () => {
    expect(storageEventIsNews({ lastKnown: opened, newValue: "9@2026-11-04T09:10:00.000Z" })).toBe(false);
  });

  it("refuses a removed key and a value that is not a cursor", () => {
    expect([
      storageEventIsNews({ lastKnown: opened, newValue: null }),
      storageEventIsNews({ lastKnown: opened, newValue: "22" }),
    ]).toEqual([false, false]);
  });

  it("takes any cursor while this window knows none", () => {
    expect(storageEventIsNews({ lastKnown: RUNNING_LIST_SEEN_UNSET, newValue: "5@2026-11-04T09:05:00.000Z" })).toBe(
      true,
    );
  });
});

describe("runningListUnread", () => {
  const items = [
    item({ ...at({ minute: 9, seq: 9 }), origin: "owner" }),
    item({ ...at({ minute: 8, seq: 8 }), origin: "fleet" }),
    at({ minute: 7, seq: 7 }),
    at({ minute: 6, seq: 6 }),
  ];

  it("counts the voice's and the fleet's above the cursor, never the owner's", () => {
    expect(runningListUnread({ items, seen: seenOf({ cursor: "6@2026-11-04T09:06:00.000Z" }) })).toBe(2);
  });

  it("counts nothing once the owner has seen the newest", () => {
    expect(runningListUnread({ items, seen: seenOf({ cursor: "9@2026-11-04T09:09:00.000Z" }) })).toBe(0);
  });

  it("counts nothing before the first read in this browser", () => {
    expect(runningListUnread({ items, seen: seenOf({ cursor: RUNNING_LIST_SEEN_UNSET }) })).toBe(0);
  });

  it("counts nothing older than the cursor, from a list a window has held since a restart", () => {
    // Another window opened the recreated list on 2 at 10:02; this window's reads have failed since, holding 6..9.
    expect(runningListUnread({ items, seen: seenOf({ cursor: "2@2026-11-04T10:02:00.000Z" }) })).toBe(0);
  });

  it("lights for the next fleet item once the measured 22 is brought down, and not before", () => {
    const restarted = [12, 11, 10].map((seq) => at({ minute: seq, seq }));
    const landed = [item({ ...at({ minute: 13, seq: 13 }), origin: "fleet" }), ...restarted];
    const repaired = seenOf({ cursor: afterRead({ cursor: "22", items: restarted })! });
    expect([
      runningListUnread({ items: landed, seen: seenOf({ cursor: "22@2026-11-04T09:00:00.000Z" }) }),
      runningListUnread({ items: landed, seen: repaired }),
    ]).toEqual([0, 1]);
  });

  it("stays dark when only the owner's own items follow the repair", () => {
    const restarted = [12, 11, 10].map((seq) => at({ minute: seq, seq }));
    const ownerItems = [item({ ...at({ minute: 13, seq: 13 }), origin: "owner" }), ...restarted];
    const repaired = seenOf({ cursor: afterRead({ cursor: "22", items: restarted })! });
    expect(runningListUnread({ items: ownerItems, seen: repaired })).toBe(0);
  });
});
