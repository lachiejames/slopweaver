/**
 * One export pass's bounded bookkeeping: gap lines and unknown kinds are capped and what passes a cap is counted,
 * and the note names what an older export left to a newer one.
 */
import { describe, expect, it } from "vitest";

import {
  closeTally,
  emptyTally,
  exportNote,
  liveNote,
  noteGap,
  noteUnknownKinds,
  syncGapLines,
} from "../../../../corpus/chatgpt/passTally.js";

describe("syncGapLines", () => {
  it("names the first fifty gap lines and counts the rest in one line, and passes a short list through whole", () => {
    const lines = Array.from({ length: 53 }, (_, index) => `gap ${String(index)}`);
    const bounded = syncGapLines({ lines });
    expect(bounded.length).toBe(51);
    expect(bounded.slice(48)).toEqual([
      "gap 48",
      "gap 49",
      "chatgpt: and 3 more gap line(s) across the held exports, counted rather than named",
    ]);
    expect(syncGapLines({ lines: ["one", "two"] })).toEqual(["one", "two"]);
    expect(syncGapLines({ lines: [] })).toEqual([]);
  });
});

describe("noteGap and closeTally", () => {
  it("keeps 50 gap lines, counts the rest, and closes with the one line that names the count", () => {
    const tally = emptyTally();
    for (let index = 0; index < 53; index += 1) {
      noteGap({ line: `gap ${String(index)}`, tally });
    }
    closeTally({ tally });
    expect(tally.gaps.length).toBe(51);
    expect(tally.gaps[49]!).toBe("gap 49");
    expect(tally.gaps[50]!).toBe("chatgpt: and 3 more gap(s) in this export, counted rather than named");
  });

  it("names 20 unknown kinds and counts the messages of any past them", () => {
    const tally = emptyTally();
    for (let index = 0; index < 22; index += 1) {
      noteUnknownKinds({ kinds: new Map([[`kind-${String(index)}`, 2]]), tally });
    }
    noteUnknownKinds({ kinds: new Map([["kind-0", 1]]), tally });
    closeTally({ tally });
    expect(tally.unknownKinds.size).toBe(20);
    expect(tally.unknownKinds.get("kind-0")).toBe(3);
    expect(tally.gaps.at(-1)!).toBe("chatgpt: 4 more message(s) carry content kinds past the 20 named — not stored");
  });
});

describe("exportNote", () => {
  it("says how many conversations an export left to the one holding their latest version", () => {
    const tally = { ...emptyTally(), conversations: 1, messages: 2, superseded: 3 };
    const stored = {
      acquiredAtIso: "2026-10-17T00:00:00.000Z",
      contentHash: "a".repeat(64),
      directory: "/nowhere",
      files: ["/nowhere/conversations.json"],
      importedAtIso: "2026-10-17T00:00:00.000Z",
      latestActivityIso: null,
    };
    expect(exportNote({ stored, tally })).toBe(
      "read export aaaaaaaaaaaa (taken in 2026-10-17T00:00:00.000Z): 1 conversation(s) across 1 file(s), " +
        "2 message(s) projected, 0 withheld as not part of what the owner saw, " +
        "3 conversation(s) left to the copy holding their latest version",
    );
  });
});

describe("liveNote", () => {
  it("counts the live copy's conversations against its snapshots", () => {
    const tally = { ...emptyTally(), conversations: 2, messages: 5, withheld: 1 };
    expect(liveNote({ snapshots: 2, tally })).toBe(
      "read the live copy: 2 conversation(s) from 2 snapshot(s), " +
        "5 message(s) projected, 1 withheld as not part of what the owner saw",
    );
  });
});
