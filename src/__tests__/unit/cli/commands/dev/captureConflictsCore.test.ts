/**
 * `dev capture-conflicts`'s tally. What it has to get right is the GUARD: only a partial and a complete row
 * of the SAME entity at the SAME instant with the SAME text are the population the marker tie-break decides,
 * and counting anything wider would overstate what that rule rescues.
 */
import { describe, expect, it } from "vitest";

import {
  absorbCaptureRecord,
  captureVersionKey,
  deriveCaptureConflicts,
  emptyCaptureConflictTally,
  parseCaptureConflictsSource,
  parseDevCaptureConflictsArgs,
  renderCaptureConflicts,
} from "../../../../../cli/commands/dev/captureConflictsCore.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

function record({
  sourceId = "page:abc:chunk:0",
  text = "the first chunk",
  tsIso = "2026-01-01T00:00:00.000Z",
  partial = false,
}: {
  sourceId?: string;
  text?: string;
  tsIso?: string;
  partial?: boolean;
}): CorpusRecord {
  return {
    container: "notion",
    kind: "page",
    refs: [],
    source: "notion",
    sourceId,
    text,
    tsIso,
    url: "https://example.invalid/x",
    ...(partial ? { attrs: { capture: "partial" } } : {}),
  };
}

const countFrom = ({ records }: { records: readonly CorpusRecord[] }) => {
  const tally = emptyCaptureConflictTally();
  for (const one of records) {
    absorbCaptureRecord({ record: one, tally });
  }
  return deriveCaptureConflicts({ source: "notion", tally, unreadable: [] });
};

describe("captureVersionKey", () => {
  it("keys two rows of one entity at one instant with one body together", () => {
    expect(captureVersionKey({ record: record({ partial: true }) })).toBe(captureVersionKey({ record: record({}) }));
  });

  it("keys a DIFFERENT body apart, so a genuinely fuller repair is not counted as a marker-only pair", () => {
    expect(captureVersionKey({ record: record({ text: "more of the body" }) })).not.toBe(
      captureVersionKey({ record: record({}) }),
    );
  });

  it("keys a different instant apart", () => {
    expect(captureVersionKey({ record: record({ tsIso: "2026-02-01T00:00:00.000Z" }) })).not.toBe(
      captureVersionKey({ record: record({}) }),
    );
  });
});

describe("deriveCaptureConflicts", () => {
  it("counts a partial + complete pair of one entity as one marker-decided group", () => {
    const count = countFrom({ records: [record({ partial: true }), record({})] });

    expect(count.rows).toBe(2);
    expect(count.partialRows).toBe(1);
    expect(count.versions).toBe(1);
    expect(count.decidedByMarker).toBe(1);
  });

  it("counts nothing when only the partial row exists — there is no repair to choose between", () => {
    expect(countFrom({ records: [record({ partial: true }), record({ partial: true })] }).decidedByMarker).toBe(0);
  });

  it("counts nothing when the two rows carry different bodies — length decides those, not the marker", () => {
    const count = countFrom({ records: [record({ partial: true }), record({ text: "a fuller body" })] });

    expect(count.versions).toBe(2);
    expect(count.decidedByMarker).toBe(0);
  });

  it("counts nothing when the two rows are at different instants — the newest wins outright", () => {
    expect(
      countFrom({ records: [record({ partial: true }), record({ tsIso: "2026-02-01T00:00:00.000Z" })] })
        .decidedByMarker,
    ).toBe(0);
  });

  it("keeps two entities apart", () => {
    const count = countFrom({
      records: [
        record({ partial: true }),
        record({}),
        record({ partial: true, sourceId: "page:def:chunk:0" }),
        record({ sourceId: "page:def:chunk:0" }),
      ],
    });

    expect(count.versions).toBe(2);
    expect(count.decidedByMarker).toBe(2);
  });

  it("is zero on an empty source", () => {
    const count = countFrom({ records: [] });

    expect(count.rows).toBe(0);
    expect(count.decidedByMarker).toBe(0);
  });
});

describe("renderCaptureConflicts", () => {
  it("prints the corpus line, the marker line, and one line per unreadable path", () => {
    const tally = emptyCaptureConflictTally();
    absorbCaptureRecord({ record: record({ partial: true }), tally });
    absorbCaptureRecord({ record: record({}), tally });

    expect(
      renderCaptureConflicts({ count: deriveCaptureConflicts({ source: "notion", tally, unreadable: ["/x"] }) }),
    ).toEqual([
      "source: notion — 2 row(s), 1 declaring capture=partial, 1 distinct (identity, instant, text) group(s)",
      "marker tie-break: 1 group(s) hold BOTH a partial and a complete row — the repaired row wins each of them, and won none of them before the rule",
      "unreadable: /x — this count covers less than the source holds",
    ]);
  });
});

describe("parseCaptureConflictsSource", () => {
  it("requires a source rather than picking one", () => {
    expect(unwrapErr(parseCaptureConflictsSource({ value: undefined }))[0]).toContain("--source is required");
  });

  it("refuses a source bronze does not hold", () => {
    expect(unwrapErr(parseCaptureConflictsSource({ value: "jira" }))[0]).toContain("got jira");
  });

  it("accepts notion", () => {
    expect(unwrap(parseCaptureConflictsSource({ value: "notion" }))).toBe("notion");
  });
});

describe("parseDevCaptureConflictsArgs", () => {
  it("parses the three flags the verb accepts", () => {
    const parsed = unwrap(parseDevCaptureConflictsArgs({ rest: ["--source", "notion", "--home", "/h", "--json"] }));

    expect(parsed.values["source"]).toBe("notion");
    expect(parsed.values["home"]).toBe("/h");
    expect(parsed.values["json"]).toBe(true);
  });
});
