/**
 * What `slopweaver queue` PRINTS.
 *
 * A queue nobody can read is a queue nobody can drain, so the reading surface is asserted to the character
 * here rather than left to a reviewer's eye.
 */
import { describe, expect, it } from "vitest";

import type { QueueItem } from "../../../../admit/queue.js";
import { queueListLines, queueListRow, queueShowLines } from "../../../../cli/commands/queue/core.js";

const HELD_ITEM: QueueItem = {
  held: {
    askedBy: "U_COLLEAGUE",
    channel: "C1",
    code: "withhold.reply",
    draft: { kind: "update", tldr: "We render rich_text." },
    question: "what did we decide about the renderer?",
    reason: "the answer applies the owner's lens and U_COLLEAGUE is not the owner",
    surface: "channel",
    threadTs: "1712345678.000100",
  },
  id: "q-aaaa1111",
  state: "held",
  tsIso: "2026-08-06T01:00:00.000Z",
};

const RELEASED_ITEM: QueueItem = {
  ...HELD_ITEM,
  id: "q-bbbb2222",
  note: "looked fine",
  resolvedIso: "2026-08-06T02:00:00.000Z",
  state: "released",
};

describe("queueListRow", () => {
  it("carries the id, the state, the instant, who asked and the question", () => {
    expect(queueListRow({ item: HELD_ITEM })).toBe(
      "q-aaaa1111  held      2026-08-06T01:00:00.000Z  U_COLLEAGUE   what did we decide about the renderer?",
    );
  });

  it("fits a long question to the column, marking that it shortened it", () => {
    const row = queueListRow({ item: { ...HELD_ITEM, held: { ...HELD_ITEM.held, question: "x".repeat(200) } } });
    expect(row.endsWith(`${"x".repeat(55)}…`)).toBe(true);
  });

  it("flattens a multi-line question onto the row", () => {
    const row = queueListRow({ item: { ...HELD_ITEM, held: { ...HELD_ITEM.held, question: "one\n\ntwo" } } });
    expect(row.endsWith("one two")).toBe(true);
  });
});

describe("queueListLines", () => {
  it("says the queue is empty when nothing has ever been withheld", () => {
    expect(queueListLines({ items: [], showResolved: false })).toEqual([
      "nothing has been withheld — the queue is empty",
    ]);
  });

  it("distinguishes a DRAINED queue from an empty one, and names the flag that shows the rest", () => {
    expect(queueListLines({ items: [RELEASED_ITEM], showResolved: false })).toEqual([
      "nothing is held (1 resolved entry — see --all)",
    ]);
  });

  it("pluralises the resolved count", () => {
    expect(queueListLines({ items: [RELEASED_ITEM, RELEASED_ITEM], showResolved: false })[0]!).toContain(
      "2 resolved entries",
    );
  });

  it("shows only held entries by default, and says what it hid", () => {
    const lines = queueListLines({ items: [HELD_ITEM, RELEASED_ITEM], showResolved: false });
    expect(lines.length).toBe(3);
    expect(lines[0]!.startsWith("q-aaaa1111")).toBe(true);
    expect(lines.at(-1)!).toBe("1 shown, 1 resolved and hidden (--all)");
  });

  it("shows everything under --all, and then hides nothing", () => {
    const lines = queueListLines({ items: [HELD_ITEM, RELEASED_ITEM], showResolved: true });
    expect(lines.at(-1)!).toBe("2 shown");
  });
});

describe("queueShowLines", () => {
  it("prints the reason whole — it is the field the whole mechanism exists to produce", () => {
    expect(queueShowLines({ item: HELD_ITEM })).toContain(
      "  because:   the answer applies the owner's lens and U_COLLEAGUE is not the owner",
    );
  });

  it("prints where the reply was bound for, so it can be judged in context", () => {
    expect(queueShowLines({ item: HELD_ITEM })).toContain("  bound for: C1 thread 1712345678.000100 (channel)");
  });

  it("prints the draft itself, indented", () => {
    expect(queueShowLines({ item: HELD_ITEM })).toContain('      "tldr": "We render rich_text."');
  });

  it("says nothing about a resolution while the entry is still held", () => {
    expect(queueShowLines({ item: HELD_ITEM }).filter((line) => line.startsWith("  resolved:"))).toEqual([]);
  });

  it("reports a resolution once there is one", () => {
    expect(queueShowLines({ item: RELEASED_ITEM })).toContain(
      "  resolved:  released 2026-08-06T02:00:00.000Z — looked fine",
    );
  });

  it("says so explicitly when a resolution recorded no note", () => {
    expect(queueShowLines({ item: { ...RELEASED_ITEM, note: "" } })).toContain(
      "  resolved:  released 2026-08-06T02:00:00.000Z — (no note recorded)",
    );
  });
});
