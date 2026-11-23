import { describe, expect, it } from "vitest";
import { landingTally, pressable } from "../../../../review/landing.js";
import { landingRowFake } from "../../../landingRowFake.js";
import { row } from "./fixtures.js";

describe("landingTally and pressable", () => {
  it("never presses a row the dispatch layer sends to the OWNER", () => {
    const carded = row({
      over: {
        standingChangesRequested: [
          { atIso: "2026-09-07T03:26:04Z", login: "jonahy-acme", opinion: "changes-requested" },
        ],
      },
    });
    expect(carded.action).toBe("press");
    expect(carded.dispatch).toStrictEqual({
      kind: "act",
      verdict: "needs-owner-judgment",
      why: "jonahy-acme has a standing CHANGES_REQUESTED review that no later review withdrew",
    });
    expect(pressable({ rows: [carded] })).toStrictEqual([]);
  });

  it("never presses a row whose dispatch named a hole, even with all six tests passed", () => {
    const holed = row({ over: { labelsTruncated: true } });
    expect(holed.action).toBe("press");
    expect(holed.ready).toBe(true);
    expect(holed.dispatch.kind).toBe("unread");
    expect(pressable({ rows: [holed] })).toStrictEqual([]);
  });

  it("still presses an ordinary press row with no judgment signal", () => {
    const plain = row();
    expect(plain.action).toBe("press");
    expect(pressable({ rows: [plain] })).toStrictEqual([plain]);
  });

  it("counts the rows by act, commonest first, and reports how many are ready", () => {
    const rows = [
      row(),
      row({ over: { number: 2, undrafted: false } }),
      row({ over: { number: 3, undrafted: false } }),
    ];
    const tally = landingTally({ rows });
    expect(tally.total).toBe(3);
    expect(tally.ready).toBe(1);
    expect(tally.byAction).toEqual([
      { action: "draft", count: 2 },
      { action: "press", count: 1 },
    ]);
  });

  it("selects only the rows whose act is press, lowest number first", () => {
    const rows = [
      row({ over: { number: 99 } }),
      row({ over: { number: 7 } }),
      row({ over: { number: 8, undrafted: false } }),
    ];
    expect(pressable({ rows }).map((selected) => selected.number)).toEqual([7, 99]);
  });

  it("excludes a queued row from the pressable set even though every test passed", () => {
    const rows = [row({ over: { queueEntry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } } })];
    expect(rows[0]!.ready).toBe(true);
    expect(pressable({ rows })).toEqual([]);
  });
});

describe("pressable over a failed build", () => {
  it("refuses a row whose CI failed even if a regressed ladder had called it press", () => {
    const regressed = landingRowFake({
      action: "press",
      ci: "red",
      ciFailure: { kind: "red", required: false },
      ready: false,
    });
    expect(pressable({ rows: [regressed] })).toStrictEqual([]);
  });
});
