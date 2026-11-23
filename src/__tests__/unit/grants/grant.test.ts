import { describe, expect, it } from "vitest";

import {
  type GrantEntry,
  grantRowsOf,
  parseGrantEnvelope,
  parseGrantLine,
  parseGrantRow,
  parsePerformance,
  parseRefusal,
  performancesOf,
  refusalsOf,
  renderTarget,
} from "../../../grants/grant.js";

const ROW = {
  anchor: "transcript:a0000006-0000-4000-8000-000000000006#22222222-2222-2222-2222-222222222222",
  change: "TIMEOUT = 30",
  changeKind: "literal",
  id: "g-1a2b3c4d",
  pinnedAtRecord: true,
  recordedAtIso: "2026-09-04T01:00:00.000Z",
  recordedBySessionId: "session-a",
  target: { kind: "file", path: "src/config.ts" },
} as const;

describe("parseGrantRow", () => {
  it("reads a complete row", () => {
    expect(parseGrantRow({ value: ROW })).toEqual(ROW);
  });

  it("refuses a row with no change rather than defaulting one", () => {
    const { change: _dropped, ...withoutChange } = ROW;
    expect(parseGrantRow({ value: withoutChange })).toBe(undefined);
  });

  it("refuses a row with no anchor", () => {
    const { anchor: _dropped, ...withoutAnchor } = ROW;
    expect(parseGrantRow({ value: withoutAnchor })).toBe(undefined);
  });

  it("refuses a changeKind outside the two spellings", () => {
    expect(parseGrantRow({ value: { ...ROW, changeKind: "summary" } })).toBe(undefined);
  });

  it("refuses a pinnedAtRecord that is not a boolean, so a missing pin never reads as true", () => {
    expect(parseGrantRow({ value: { ...ROW, pinnedAtRecord: "yes" } })).toBe(undefined);
  });

  it("refuses a target with no kind", () => {
    expect(parseGrantRow({ value: { ...ROW, target: { path: "src/config.ts" } } })).toBe(undefined);
  });

  it("reads a system target", () => {
    const row = parseGrantRow({ value: { ...ROW, target: { kind: "system", name: "linear" } } });
    expect(row!.target).toEqual({ kind: "system", name: "linear" });
  });

  it("refuses a blank id", () => {
    expect(parseGrantRow({ value: { ...ROW, id: "   " } })).toBe(undefined);
  });
});

describe("parsePerformance and parseRefusal", () => {
  it("reads a performance", () => {
    const performance = {
      grantId: "g-1a2b3c4d",
      performedAtIso: "2026-09-04T01:05:00.000Z",
      performedBySessionId: "session-b",
      wrote: "TIMEOUT = 30",
    };
    expect(parsePerformance({ value: performance })).toEqual(performance);
  });

  it("refuses a performance with no read-back", () => {
    expect(
      parsePerformance({
        value: { grantId: "g-1", performedAtIso: "2026-09-04T01:05:00.000Z", performedBySessionId: "s" },
      }),
    ).toBe(undefined);
  });

  it("reads a refusal", () => {
    const refusal = {
      code: "RAIL_CROSSED",
      grantId: "g-1a2b3c4d",
      refusedAtIso: "2026-09-04T01:06:00.000Z",
      refusedBySessionId: "session-b",
      why: "this would widen access",
    };
    expect(parseRefusal({ value: refusal })).toEqual(refusal);
  });

  it("refuses a refusal with no code — an unnamed refusal is the shape being closed", () => {
    expect(
      parseRefusal({
        value: { grantId: "g-1", refusedAtIso: "2026-09-04T01:06:00.000Z", refusedBySessionId: "s", why: "no" },
      }),
    ).toBe(undefined);
  });
});

describe("parseGrantLine", () => {
  it("reads a grant line", () => {
    expect(parseGrantLine({ line: JSON.stringify({ grant: ROW, kind: "grant" }) })).toEqual({
      grant: ROW,
      kind: "grant",
    });
  });

  it("answers undefined on a blank line", () => {
    expect(parseGrantLine({ line: "   " })).toBe(undefined);
  });

  it("answers undefined on unparseable JSON", () => {
    expect(parseGrantLine({ line: "{not json" })).toBe(undefined);
  });

  it("answers undefined on an unknown entry kind", () => {
    expect(parseGrantLine({ line: JSON.stringify({ kind: "revocation" }) })).toBe(undefined);
  });
});

describe("parseGrantEnvelope", () => {
  it("decodes an already-parsed envelope — the shape a grant_row entry column holds", () => {
    expect(parseGrantEnvelope({ value: { grant: ROW, kind: "grant" } })).toEqual({ grant: ROW, kind: "grant" });
  });

  it("answers undefined for a value that is not an object", () => {
    expect(parseGrantEnvelope({ value: "grant" })).toBe(undefined);
  });

  it("answers undefined for an envelope whose inner row is incomplete", () => {
    const { anchor: _dropped, ...withoutAnchor } = ROW;
    expect(parseGrantEnvelope({ value: { grant: withoutAnchor, kind: "grant" } })).toBe(undefined);
  });
});

describe("grantRowsOf, performancesOf and refusalsOf", () => {
  const entries: readonly GrantEntry[] = [
    { grant: ROW, kind: "grant" },
    {
      kind: "performance",
      performance: {
        grantId: "g-1a2b3c4d",
        performedAtIso: "2026-09-04T01:05:00.000Z",
        performedBySessionId: "session-b",
        wrote: "TIMEOUT = 30",
      },
    },
    {
      kind: "refusal",
      refusal: {
        code: "ROW_MISSING",
        grantId: "g-nope",
        refusedAtIso: "2026-09-04T01:06:00.000Z",
        refusedBySessionId: "session-b",
        why: "nothing carries that id",
      },
    },
  ];

  it("separates the three shapes, each in written order", () => {
    expect(grantRowsOf({ entries }).map((row) => row.id)).toEqual(["g-1a2b3c4d"]);
    expect(performancesOf({ entries }).map((p) => p.wrote)).toEqual(["TIMEOUT = 30"]);
    expect(refusalsOf({ entries }).map((r) => r.code)).toEqual(["ROW_MISSING"]);
  });

  it("answers empty lists for an empty journal", () => {
    expect(grantRowsOf({ entries: [] })).toEqual([]);
    expect(refusalsOf({ entries: [] })).toEqual([]);
  });
});

describe("renderTarget", () => {
  it("renders a file target", () => {
    expect(renderTarget({ target: { kind: "file", path: "src/config.ts" } })).toBe("file src/config.ts");
  });

  it("renders a system target", () => {
    expect(renderTarget({ target: { kind: "system", name: "linear" } })).toBe("system linear");
  });
});
