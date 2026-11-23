import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import { DISTIL_RECORD_CHARS, promptBodies, recordBody } from "../../../gold/recordBody.js";

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "acme/widgets",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "body",
  tsIso: "2026-08-01T00:00:00.000Z",
  url: "https://example.invalid/1",
  ...over,
});

const body = ({ chars, sourceId }: { chars: number; sourceId: string }): CorpusRecord =>
  rec({ sourceId, text: "a".repeat(chars) });

describe("recordBody", () => {
  it("joins the title to the text, so a title consumes the same budget the prompt shows it in", () => {
    expect(recordBody({ record: rec({ text: "body", title: "Title" }) })).toBe("Title\nbody");
  });
});

describe("promptBodies", () => {
  it("gives a lone record exactly the flat share, so a one-record batch is unchanged", () => {
    const [only] = promptBodies({ records: [body({ chars: 5_000, sourceId: "#1" })] });

    expect(only?.keptChars).toBe(DISTIL_RECORD_CHARS);
    expect(only?.droppedChars).toBe(5_000 - DISTIL_RECORD_CHARS);
  });

  it("hands a short record's unspent share to the long record beside it", () => {
    const [short, long] = promptBodies({
      records: [body({ chars: 100, sourceId: "#1" }), body({ chars: 5_000, sourceId: "#2" })],
    });

    expect(short?.keptChars).toBe(100);
    expect(short?.droppedChars).toBe(0);
    expect(long?.keptChars).toBe(2_300);
    expect(long?.droppedChars).toBe(2_700);
  });

  it("prompts a whole batch whole when the budget covers it, however lopsided the records are", () => {
    const bodies = promptBodies({
      records: [
        body({ chars: 10, sourceId: "#1" }),
        body({ chars: 10, sourceId: "#2" }),
        body({ chars: 3_000, sourceId: "#3" }),
      ],
    });

    expect(bodies.map((entry) => entry.droppedChars)).toStrictEqual([0, 0, 0]);
    expect(bodies.map((entry) => entry.keptChars)).toStrictEqual([10, 10, 3_000]);
  });

  it("never gives a record LESS than the flat cap would have — the property that makes this a strict win", () => {
    const records = [
      body({ chars: 40_000, sourceId: "#1" }),
      body({ chars: 39_000, sourceId: "#2" }),
      body({ chars: 38_000, sourceId: "#3" }),
      body({ chars: 1, sourceId: "#4" }),
    ];

    const kept = promptBodies({ records }).map((entry) => entry.keptChars);

    expect(kept).toStrictEqual([1_600, 1_600, 1_599, 1]);
    expect(kept.filter((n, i) => n < Math.min(records[i]!.text.length, DISTIL_RECORD_CHARS))).toStrictEqual([]);
  });

  it("spends no more than the batch budget, so the prompt never grows", () => {
    const records = [body({ chars: 9_000, sourceId: "#1" }), body({ chars: 9_000, sourceId: "#2" })];

    const spent = promptBodies({ records }).reduce((total, entry) => total + entry.keptChars, 0);

    expect(spent).toBe(2 * DISTIL_RECORD_CHARS);
  });

  it("returns entries in the RECORDS' order, not the order the budget was spent in", () => {
    const bodies = promptBodies({
      records: [body({ chars: 5_000, sourceId: "#long" }), body({ chars: 7, sourceId: "#short" })],
    });

    expect(bodies[0]?.body.length).toBe(2_393);
    expect(bodies[1]?.body).toBe("aaaaaaa");
  });

  it("is a TOTAL order over equal-length records, so the cache key it feeds cannot depend on a tie", () => {
    const equal = [body({ chars: 3_000, sourceId: "#1" }), body({ chars: 3_000, sourceId: "#2" })];

    expect(promptBodies({ records: equal }).map((entry) => entry.keptChars)).toStrictEqual([1_200, 1_200]);
  });

  it("measures nothing for an empty batch rather than dividing by zero", () => {
    expect(promptBodies({ records: [] })).toStrictEqual([]);
  });
});
