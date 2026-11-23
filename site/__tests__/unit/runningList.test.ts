/*
 * The running list's wire, as the console reads and writes it: the snapshot, the receipt and the route's two answers
 * decoded strictly, the POST
 * body read into one add, and the argv each add runs with. Then `runningListDraw.ts`: who an item is from, and the
 * order and follow rule the tray draws it by. The dot's cursor and count are `runningListSeen.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  type RunningListItem,
  receiptHoldsAdd,
  runningListAddArgv,
  runningListAddOf,
  runningListAddResultOf,
  runningListItemFold,
  runningListItemOf,
  runningListReadOf,
  runningListReceiptOf,
  runningListSnapshotOf,
} from "../../lib/runningList";
import { runningListArrival, runningListItemsOldestFirst, runningListWho } from "../../lib/runningListDraw";

/** One item as `talk list --json` prints it, any field overridden. */
function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { atIso: "2026-10-12T09:00:00.000Z", id: "req-1", origin: "voice", seq: 3, text: "*on it*", ...over };
}

/** One decoded item. */
function item(over: Partial<RunningListItem> = {}): RunningListItem {
  return { atIso: "2026-10-12T09:00:00.000Z", id: "req-1", origin: "voice", seq: 3, text: "*on it*", ...over };
}

describe("runningListItemOf", () => {
  it("reads a whole item, its label kept", () => {
    expect(runningListItemOf({ value: wire({ label: "reply to Ari" }) })).toEqual(item({ label: "reply to Ari" }));
  });

  it("keeps the fleet session a fleet item names", () => {
    expect(runningListItemOf({ value: wire({ from: "the-chair", origin: "fleet" }) })).toEqual(
      item({ from: "the-chair", origin: "fleet" }),
    );
  });

  it("refuses a sender on an item that is not the fleet's", () => {
    expect(runningListItemOf({ value: wire({ from: "the-chair" }) })).toBe(undefined);
  });

  it("refuses an origin it does not know", () => {
    expect(runningListItemOf({ value: wire({ origin: "someone" }) })).toBe(undefined);
  });

  it("refuses an empty text, a zero sequence and an unreadable time", () => {
    expect([
      runningListItemOf({ value: wire({ text: "" }) }),
      runningListItemOf({ value: wire({ seq: 0 }) }),
      runningListItemOf({ value: wire({ atIso: "yesterday" }) }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses an empty label rather than dropping it", () => {
    expect(runningListItemOf({ value: wire({ label: "" }) })).toBe(undefined);
  });

  it("keeps a fold on a line of the text past its first, and refuses one on the first", () => {
    expect([
      runningListItemOf({ value: wire({ foldLine: 2, text: "head\nrest" }) }),
      runningListItemOf({ value: wire({ foldLine: 1, text: "head\nrest" }) }),
    ]).toEqual([item({ foldLine: 2, text: "head\nrest" }), undefined]);
  });

  // A field the list never prints was dropped silently rather than refused.
  it("refuses an item, a list or a receipt carrying a field the list never prints", () => {
    expect([
      runningListItemOf({ value: wire({ withheld: "a secret survived" }) }),
      runningListSnapshotOf({ value: { extra: true, items: [], newestSeq: 0 } }),
      runningListReceiptOf({ value: { appended: true, extra: true, item: wire() } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("runningListSnapshotOf", () => {
  it("reads a list newest first", () => {
    expect(
      runningListSnapshotOf({ value: { items: [wire({ seq: 5 }), wire({ id: "req-0", seq: 2 })], newestSeq: 5 } }),
    ).toEqual({ items: [item({ seq: 5 }), item({ id: "req-0", seq: 2 })], newestSeq: 5 });
  });

  it("reads an empty list that never held anything", () => {
    expect(runningListSnapshotOf({ value: { items: [], newestSeq: 0 } })).toEqual({ items: [], newestSeq: 0 });
  });

  it("refuses a list out of order", () => {
    expect(runningListSnapshotOf({ value: { items: [wire({ seq: 2 }), wire({ seq: 5 })], newestSeq: 5 } })).toBe(
      undefined,
    );
  });

  // The store holds one item per id, so a list carrying one twice is not one it printed.
  it("refuses a list holding the same id twice", () => {
    expect(runningListSnapshotOf({ value: { items: [wire({ seq: 2 }), wire({ seq: 1 })], newestSeq: 2 } })).toBe(
      undefined,
    );
  });

  it("refuses an item above the newest number", () => {
    expect(runningListSnapshotOf({ value: { items: [wire({ seq: 6 })], newestSeq: 5 } })).toBe(undefined);
  });

  it("refuses the whole list over one bad item", () => {
    expect(
      runningListSnapshotOf({ value: { items: [wire({ seq: 5 }), wire({ seq: 4, text: "" })], newestSeq: 5 } }),
    ).toBe(undefined);
  });
});

describe("runningListReceiptOf", () => {
  it("reads a receipt", () => {
    expect(runningListReceiptOf({ value: { appended: false, item: wire() } })).toEqual({
      appended: false,
      item: item(),
    });
  });

  it("refuses a receipt with no appended flag", () => {
    expect(runningListReceiptOf({ value: { item: wire() } })).toBe(undefined);
  });
});

describe("runningListReadOf", () => {
  it("reads the list, and why a read failed", () => {
    expect([
      runningListReadOf({ value: { outcome: "read", snapshot: { items: [wire()], newestSeq: 3 } } }),
      runningListReadOf({ value: { outcome: "unread", why: "talk list timed out" } }),
    ]).toEqual([
      { outcome: "read", snapshot: { items: [item()], newestSeq: 3 } },
      { outcome: "unread", why: "talk list timed out" },
    ]);
  });

  it("refuses an outcome it never sends, a list that is not one, and a failure with no reason", () => {
    expect([
      runningListReadOf({ value: { outcome: "maybe", why: "x" } }),
      runningListReadOf({ value: { outcome: "read", snapshot: { items: [wire({ seq: 9 })], newestSeq: 3 } } }),
      runningListReadOf({ value: { outcome: "unread" } }),
      runningListReadOf({ value: [] }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  // An unread answer carrying a snapshot read as unread, a shape the route never sends.
  it("refuses an answer carrying a field from the other arm", () => {
    expect([
      runningListReadOf({ value: { outcome: "unread", snapshot: { items: [], newestSeq: 0 }, why: "timed out" } }),
      runningListReadOf({ value: { outcome: "read", snapshot: { items: [], newestSeq: 0 }, why: "timed out" } }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("runningListAddResultOf", () => {
  it("reads an add, its untold reason absent when the call was told", () => {
    expect([
      runningListAddResultOf({ value: { outcome: "added", receipt: { appended: true, item: wire() } } }),
      runningListAddResultOf({
        value: { outcome: "added", receipt: { appended: true, item: wire() }, untold: "no call is up" },
      }),
    ]).toEqual([
      { outcome: "added", receipt: { appended: true, item: item() }, untold: undefined },
      { outcome: "added", receipt: { appended: true, item: item() }, untold: "no call is up" },
    ]);
  });

  it("reads a refusal and an unknown, each with its reason", () => {
    expect([
      runningListAddResultOf({ value: { outcome: "refused", why: "there is nothing to add" } }),
      runningListAddResultOf({ value: { outcome: "unknown", why: "talk list-add timed out" } }),
    ]).toEqual([
      { outcome: "refused", why: "there is nothing to add" },
      { outcome: "unknown", why: "talk list-add timed out" },
    ]);
  });

  it("refuses an add with no whole receipt, an untold that is not words, and a refusal with no reason", () => {
    expect([
      runningListAddResultOf({ value: { outcome: "added", receipt: { item: wire() } } }),
      runningListAddResultOf({ value: { outcome: "added", receipt: { appended: true, item: wire() }, untold: 3 } }),
      runningListAddResultOf({ value: { outcome: "refused" } }),
      runningListAddResultOf({ value: "added" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses an add answer carrying a field from another arm", () => {
    expect([
      runningListAddResultOf({
        value: { outcome: "refused", receipt: { appended: true, item: wire() }, why: "there is nothing to add" },
      }),
      runningListAddResultOf({
        value: { outcome: "added", receipt: { appended: true, item: wire() }, why: "there is nothing to add" },
      }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("runningListAddOf", () => {
  it("reads the owner's add, with the call it was made on", () => {
    expect(runningListAddOf({ body: { callId: "call-1", id: "req-9", origin: "owner", text: " keep this " } })).toEqual(
      {
        add: { callId: "call-1", id: "req-9", origin: "owner", text: " keep this " },
        kind: "add",
      },
    );
  });

  it("reads the voice's add with its label, and drops a blank label", () => {
    expect([
      runningListAddOf({ body: { id: "tool-1", label: "reply", origin: "voice", text: "hi" } }),
      runningListAddOf({ body: { id: "tool-1", label: "  ", origin: "voice", text: "hi" } }),
    ]).toEqual([
      { add: { id: "tool-1", label: "reply", origin: "voice", text: "hi" }, kind: "add" },
      { add: { id: "tool-1", origin: "voice", text: "hi" }, kind: "add" },
    ]);
  });

  it("refuses the fleet, which adds through the CLI", () => {
    expect(runningListAddOf({ body: { id: "x", origin: "fleet", text: "hi" } })).toEqual({
      kind: "refused",
      why: "origin must be the owner or the voice",
    });
  });

  it("refuses whitespace alone", () => {
    expect(runningListAddOf({ body: { id: "x", origin: "owner", text: " \n " } })).toEqual({
      kind: "refused",
      why: "there is nothing to add",
    });
  });

  it("refuses an id across two lines", () => {
    expect(runningListAddOf({ body: { id: "a\nb", origin: "owner", text: "hi" } })).toEqual({
      kind: "refused",
      why: "id must be a request id of one line",
    });
  });

  it("takes the text cap exactly, and refuses one over it", () => {
    expect([
      runningListAddOf({ body: { id: "x", origin: "owner", text: "a".repeat(8192) } }).kind,
      runningListAddOf({ body: { id: "x", origin: "owner", text: "a".repeat(8193) } }),
    ]).toEqual(["add", { kind: "refused", why: "the text is over 8192 characters" }]);
  });

  it("refuses a label over its cap and an empty call id", () => {
    expect([
      runningListAddOf({ body: { id: "x", label: "l".repeat(81), origin: "owner", text: "hi" } }),
      runningListAddOf({ body: { callId: "", id: "x", origin: "owner", text: "hi" } }),
    ]).toEqual([
      { kind: "refused", why: "label must be at most 80 characters" },
      { kind: "refused", why: "callId must be the id of the call or conversation up, or left out" },
    ]);
  });

  it("keeps the voice's fold on a line past the first", () => {
    expect(runningListAddOf({ body: { foldLine: 2, id: "t", origin: "voice", text: "head\nrest" } })).toEqual({
      add: { foldLine: 2, id: "t", origin: "voice", text: "head\nrest" },
      kind: "add",
    });
  });

  it("refuses a fold from the owner, on the first line, past the last, or that is not a number", () => {
    const why = "foldLine must be a line of the voice's text past its first, or left out";
    expect([
      runningListAddOf({ body: { foldLine: 2, id: "t", origin: "owner", text: "head\nrest" } }),
      runningListAddOf({ body: { foldLine: 1, id: "t", origin: "voice", text: "head\nrest" } }),
      runningListAddOf({ body: { foldLine: 3, id: "t", origin: "voice", text: "head\nrest" } }),
      runningListAddOf({ body: { foldLine: "2", id: "t", origin: "voice", text: "head\nrest" } }),
    ]).toEqual(Array.from({ length: 4 }, () => ({ kind: "refused", why })));
  });
});

describe("receiptHoldsAdd", () => {
  const add = { foldLine: 2, id: "req-1", origin: "voice", text: "head\nrest" } as const;

  it("holds an add whose item carries its origin, text and fold", () => {
    expect(
      receiptHoldsAdd({ add, receipt: { appended: false, item: item({ foldLine: 2, text: "head\nrest" }) } }),
    ).toBe(true);
  });

  // A retry of a held id answers the stored item, which may carry other words under the same id.
  it("refuses a held item under the same id with other text, another fold or another origin", () => {
    expect([
      receiptHoldsAdd({ add, receipt: { appended: false, item: item({ foldLine: 2, text: "old\nrest" }) } }),
      receiptHoldsAdd({ add, receipt: { appended: false, item: item({ text: "head\nrest" }) } }),
      receiptHoldsAdd({
        add,
        receipt: { appended: false, item: item({ foldLine: 2, origin: "owner", text: "head\nrest" }) },
      }),
    ]).toEqual([false, false, false]);
  });
});

describe("runningListItemFold", () => {
  it("shows a whole item at once when it has no fold", () => {
    expect(runningListItemFold({ item: { text: "head\nrest" } })).toEqual({ belowFold: undefined, head: "head\nrest" });
  });

  it("splits at the fold line, and the two rejoin to the stored text exactly", () => {
    const text = "*Heads up*\nstaging is back\n\n• one\n• two";
    const { belowFold, head } = runningListItemFold({ item: { foldLine: 4, text } });
    expect([head, belowFold, `${head}\n${belowFold!}`]).toEqual([
      "*Heads up*\nstaging is back\n",
      "• one\n• two",
      text,
    ]);
  });
});

describe("runningListAddArgv", () => {
  it("names the origin and id, never the text", () => {
    expect(runningListAddArgv({ add: { id: "req-9", origin: "owner", text: "secret words" } })).toEqual([
      "talk",
      "list-add",
      "--origin",
      "owner",
      "--id",
      "req-9",
      "--json",
    ]);
  });

  it("carries a label", () => {
    expect(runningListAddArgv({ add: { id: "t", label: "reply", origin: "voice", text: "hi" } }).slice(-2)).toEqual([
      "--label",
      "reply",
    ]);
  });

  it("carries a fold line", () => {
    expect(
      runningListAddArgv({ add: { foldLine: 2, id: "t", origin: "voice", text: "head\nrest" } }).slice(-2),
    ).toEqual(["--fold-line", "2"]);
  });
});

describe("runningListWho", () => {
  it("names each origin", () => {
    expect([
      runningListWho({ item: { origin: "owner" } }),
      runningListWho({ item: { origin: "voice" } }),
      runningListWho({ item: { from: "the-chair", origin: "fleet" } }),
      runningListWho({ item: { origin: "fleet" } }),
    ]).toEqual(["you", "the voice", "the-chair", "the fleet"]);
  });
});

describe("runningListItemsOldestFirst", () => {
  it("draws the newest-first wire oldest first, newest at the bottom like Messenger, leaving the wire as it was", () => {
    const items = [item({ seq: 9 }), item({ seq: 8 }), item({ seq: 7 })];
    expect([runningListItemsOldestFirst({ items }).map((one) => one.seq), items.map((one) => one.seq)]).toEqual([
      [7, 8, 9],
      [9, 8, 7],
    ]);
  });

  it("is empty for an empty list", () => {
    expect(runningListItemsOldestFirst({ items: [] })).toEqual([]);
  });
});

describe("runningListArrival", () => {
  it("is nothing while the newest is the one drawn, or the list is empty", () => {
    expect([
      runningListArrival({ drawnSeq: 9, following: true, newestSeq: 9 }),
      runningListArrival({ drawnSeq: undefined, following: false, newestSeq: undefined }),
    ]).toEqual(["none", "none"]);
  });

  it("follows a new item to the bottom while the owner is there, and holds their place with the button when they scrolled up", () => {
    expect([
      runningListArrival({ drawnSeq: 8, following: true, newestSeq: 9 }),
      runningListArrival({ drawnSeq: 8, following: false, newestSeq: 9 }),
      runningListArrival({ drawnSeq: undefined, following: false, newestSeq: 1 }),
    ]).toEqual(["follow", "hold", "hold"]);
  });
});
