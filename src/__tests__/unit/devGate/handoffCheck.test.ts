import { describe, expect, it } from "vitest";

import { handoffVerdict, observeHandoff } from "../../../devGate/handoffCheck.js";

describe("observeHandoff", () => {
  it("counts two records into two shards, one kept, one cross-shard and one unquoted rejection, one missing shard", () => {
    expect(observeHandoff().observation).toEqual({
      kept: 1,
      missingShards: 1,
      packedRecords: 2,
      rejectedNotInShard: 1,
      rejectedQuoteNotInRecord: 1,
      shards: 2,
    });
  });

  it("harvests the kept finding, both rejections with their reasons, and the unanswered shard", () => {
    const { harvest } = observeHandoff();

    expect(harvest.kept).toEqual([
      {
        finding: { id: "c-alpha/handoff-1", quote: "the staging pool exhausted at 04:10", why: "names the incident" },
        record: {
          author: "person-a",
          clipped: false,
          container: "c-alpha",
          id: "c-alpha/handoff-1",
          source: "slack",
          text: "the staging pool exhausted at 04:10 and the pgbouncer max_client_conn was the ceiling",
          title: "staging pool",
          tsIso: "2026-09-01T04:10:00.000Z",
          url: "https://example.invalid/handoff-1",
        },
        shard: "s1",
      },
    ]);
    expect(harvest.rejected).toEqual([
      { id: "c-beta/handoff-2", reason: "not-in-shard", shard: "s1" },
      { id: "c-alpha/handoff-1", reason: "quote-not-in-record", shard: "s1" },
    ]);
    expect(harvest.missingShards).toEqual(["s2"]);
  });
});

describe("handoffVerdict", () => {
  it("passes the observed handoff with the grounding-accounting summary", () => {
    expect(handoffVerdict({ observation: observeHandoff().observation })).toEqual({
      ok: true,
      summary:
        "evidence handoff accounted for: 2 record(s) into 2 shard(s), 1 quoted finding kept, 1 cross-shard and 1 unquoted finding refused, 1 unanswered shard reported (this is grounding accounting, NOT retrieval quality)",
    });
  });

  it("names both of two wrong fields in summary order rather than stopping at the first", () => {
    const observation = { ...observeHandoff().observation, kept: 3, shards: 1 };

    expect(handoffVerdict({ observation })).toEqual({ ok: false, summary: "kept 3 ≠ 1; shards 1 ≠ 2" });
  });
});
