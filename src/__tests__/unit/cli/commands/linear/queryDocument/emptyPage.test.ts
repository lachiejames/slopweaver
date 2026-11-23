/*
 * The text rendering of an empty page: it ends on the no-match line, whatever the match count or verification.
 */
import { describe, expect, it } from "vitest";

import {
  type LinearQueryDocument,
  renderLinearQueryText,
} from "../../../../../../cli/commands/linear/queryDocument.js";

describe("renderLinearQueryText", () => {
  it("ends an empty page on the no-match line, with the unreadable floor and no row or footer", () => {
    const document: LinearQueryDocument = {
      filter: { kind: "issue", state: "state-ember" },
      hits: [],
      matched: 0,
      newestLocalIso: undefined,
      readAtIso: "2026-09-22T00:00:00.000Z",
      rowsScanned: 250,
      source: "linear",
      unreadable: ["/bronze-delta/linear/c.jsonl"],
      verifySkipped: "no-hits",
    };
    expect(renderLinearQueryText({ document })).toBe(
      [
        "linear query: kind=issue state=state-ember",
        "local: 0 match(es) over 250 bronze row(s); newest local record (none)",
        "UNREADABLE (the match count is a floor, not a total): /bronze-delta/linear/c.jsonl",
        "no matching Linear object in the local corpus",
      ].join("\n"),
    );
  });

  it("prints no tally for an empty page even when a verification block is present, and drops an empty labels facet", () => {
    const document: LinearQueryDocument = {
      filter: { kind: "project", labels: [] },
      hits: [],
      // Non-zero behind an empty page: the empty PAGE ends it, never the match count.
      matched: 3,
      newestLocalIso: "2026-09-23T01:02:03.000Z",
      readAtIso: "2026-09-24T00:00:00.000Z",
      rowsScanned: 8,
      source: "linear",
      unreadable: [],
      verification: {
        requests: 1,
        verifications: [{ drifts: [], identifier: "STALE-1", status: "confirmed" }],
        verifiedAtIso: "2026-09-24T00:00:01.000Z",
      },
    };
    expect(renderLinearQueryText({ document })).toBe(
      [
        "linear query: kind=project",
        "local: 3 match(es) over 8 bronze row(s); newest local record 2026-09-23T01:02:03.000Z",
        "no matching Linear object in the local corpus",
      ].join("\n"),
    );
  });
});
