import { describe, expect, it } from "vitest";

import {
  captureWasTruncated,
  classifyNotionSkip,
  countSkipsByReason,
  enumerationWasIncomplete,
  type NotionSkip,
  notionCoverageGaps,
  requestStatusSkip,
  skipIsFatal,
  skipWithholdsCursor,
  summariseNotionSkips,
} from "../../../../corpus/notion/skips.js";
import type { IngestError } from "../../../../lib/ingestError.js";

/** A typed boundary failure, defaults overridden per case (the shape `safeProviderCall` hands back). */
const error = (over: Partial<IngestError> = {}): IngestError => ({
  kind: "http",
  message: "boom",
  operation: "notion.blocks.children.list",
  provider: "notion",
  ...over,
});

describe("classifyNotionSkip", () => {
  it("classifies the real failure that killed the run — object_not_found — as unshared", () => {
    expect(
      classifyNotionSkip({
        error: error({
          code: "object_not_found",
          message: "Could not find block with ID. Make sure the relevant pages and databases are shared.",
          status: 404,
        }),
      }),
    ).toBe("unshared");
  });

  it("keeps restricted_resource APART from unshared — it is a sharing setting the owner can change", () => {
    expect(classifyNotionSkip({ error: error({ code: "restricted_resource", status: 403 }) })).toBe("restricted");
  });

  it("classifies a rejected token as auth, not as an unreadable page", () => {
    expect(classifyNotionSkip({ error: error({ code: "unauthorized", status: 401 }) })).toBe("auth");
  });

  it("classifies a rate limit from the typed kind, which carries no HTTP status on some SDKs", () => {
    expect(classifyNotionSkip({ error: error({ code: "rate_limited", kind: "rate-limit" }) })).toBe("rate-limit");
  });

  it("classifies a network failure as network", () => {
    expect(classifyNotionSkip({ error: error({ code: "ECONNRESET", kind: "network" }) })).toBe("network");
  });

  it("falls back to status when no code is present", () => {
    expect(classifyNotionSkip({ error: error({ status: 404 }) })).toBe("unshared");
    expect(classifyNotionSkip({ error: error({ status: 403 }) })).toBe("restricted");
    expect(classifyNotionSkip({ error: error({ status: 401 }) })).toBe("auth");
  });

  it("classifies an unrecognised failure as unknown rather than assuming it benign", () => {
    expect(classifyNotionSkip({ error: error({ code: "validation_error", status: 400 }) })).toBe("unknown");
  });
});

describe("skipWithholdsCursor", () => {
  it("holds the cursor for a transient reason so the next refresh re-scans", () => {
    expect(skipWithholdsCursor({ reason: "rate-limit" })).toBe(true);
    expect(skipWithholdsCursor({ reason: "network" })).toBe(true);
  });

  it("does NOT hold the cursor for a permanently unshared page — that would wedge the lane forever", () => {
    expect(skipWithholdsCursor({ reason: "unshared" })).toBe(false);
    expect(skipWithholdsCursor({ reason: "restricted" })).toBe(false);
    expect(skipWithholdsCursor({ reason: "depth-cap" })).toBe(false);
  });

  it("does NOT hold the cursor for our own item-deadline bound — re-scanning hits the same deadline again", () => {
    expect(skipWithholdsCursor({ reason: "item-deadline" })).toBe(false);
  });
});

describe("skipIsFatal", () => {
  it("is fatal only for auth — a bad token is a property of the run, not of one page", () => {
    expect(skipIsFatal({ reason: "auth" })).toBe(true);
    expect(skipIsFatal({ reason: "unshared" })).toBe(false);
    expect(skipIsFatal({ reason: "rate-limit" })).toBe(false);
    expect(skipIsFatal({ reason: "unknown" })).toBe(false);
  });
});

const skip = ({ reason }: { reason: NotionSkip["reason"] }): NotionSkip => ({
  operation: "notion.blocks.children.list",
  reason,
  subject: "nested block",
});

describe("countSkipsByReason", () => {
  it("reports most-actionable first and the expected `unshared` case last, whatever order they arrived in", () => {
    const counts = countSkipsByReason({
      skips: [
        skip({ reason: "unshared" }),
        skip({ reason: "depth-cap" }),
        skip({ reason: "unshared" }),
        skip({ reason: "rate-limit" }),
      ],
    });
    expect(counts).toEqual([
      { count: 1, reason: "rate-limit" },
      { count: 1, reason: "depth-cap" },
      { count: 2, reason: "unshared" },
    ]);
  });

  it("returns nothing for no skips", () => {
    expect(countSkipsByReason({ skips: [] })).toEqual([]);
  });
});

describe("summariseNotionSkips", () => {
  it("states a real zero explicitly — silence would be indistinguishable from never checking", () => {
    expect(summariseNotionSkips({ skips: [] })).toEqual([
      "unreadable: 0 page(s) — every node reached was readable in full",
    ]);
  });

  it("reports the total then a per-reason breakdown that says what each reason MEANS", () => {
    expect(
      summariseNotionSkips({
        skips: [skip({ reason: "unshared" }), skip({ reason: "unshared" }), skip({ reason: "depth-cap" })],
      }),
    ).toEqual([
      "unreadable: 3 node(s) skipped across 2 reason(s)",
      "  depth-cap: 1 — nested deeper than the block-depth cap, so the body is TRUNCATED",
      "  unshared: 2 — not shared with the integration",
    ]);
  });

  it("distinguishes the three reasons the owner asked to see apart, in one report", () => {
    const lines = summariseNotionSkips({
      skips: [skip({ reason: "unshared" }), skip({ reason: "restricted" }), skip({ reason: "rate-limit" })],
    });
    expect(lines).toEqual([
      "unreadable: 3 node(s) skipped across 3 reason(s)",
      "  rate-limit: 1 — rate-limited past the retry budget",
      "  restricted: 1 — shared but access-restricted — a sharing setting you can change",
      "  unshared: 1 — not shared with the integration",
    ]);
  });

  it("reports the per-item request budget being spent in its own line", () => {
    expect(summariseNotionSkips({ skips: [skip({ reason: "item-deadline" })] })).toEqual([
      "unreadable: 1 node(s) skipped across 1 reason(s)",
      "  item-deadline: 1 — exceeded its own per-item request budget — body/comments TRUNCATED at the cutoff, not read in full",
    ]);
  });
});

describe("notionCoverageGaps", () => {
  it("emits a gap ONLY for transient reasons, collapsed to one line per reason", () => {
    expect(
      notionCoverageGaps({
        skips: [
          skip({ reason: "unshared" }),
          skip({ reason: "rate-limit" }),
          skip({ reason: "rate-limit" }),
          skip({ reason: "network" }),
        ],
      }),
    ).toEqual([
      "notion: 2 node(s) unread (rate-limit) — cursor held back so the next refresh re-scans",
      "notion: 1 node(s) unread (network) — cursor held back so the next refresh re-scans",
    ]);
  });

  it("emits no gap for an unshared page, so the cursor still advances", () => {
    expect(
      notionCoverageGaps({
        skips: [skip({ reason: "unshared" }), skip({ reason: "restricted" }), skip({ reason: "depth-cap" })],
      }),
    ).toEqual([]);
  });

  it("emits no gap for our own item-deadline bound either — re-scanning cannot clear it", () => {
    expect(notionCoverageGaps({ skips: [skip({ reason: "item-deadline" })] })).toEqual([]);
  });
});

describe("requestStatusSkip reads the truncation signal Notion sends", () => {
  it("raises a result-limit skip when Notion declares its own result set incomplete", () => {
    expect(
      requestStatusSkip({
        operation: "notion.search.pages",
        requestStatus: { incomplete_reason: "query_result_limit_reached", type: "incomplete" },
      }),
    ).toEqual({
      operation: "notion.search.pages",
      reason: "result-limit",
      subject: "query_result_limit_reached",
    });
  });

  it("falls back to a generic subject when Notion gives no reason", () => {
    expect(requestStatusSkip({ operation: "notion.search.pages", requestStatus: { type: "incomplete" } })).toEqual({
      operation: "notion.search.pages",
      reason: "result-limit",
      subject: "incomplete result",
    });
  });

  it("raises nothing for a complete result, or for an absent/odd status", () => {
    expect(
      requestStatusSkip({ operation: "notion.search.pages", requestStatus: { type: "complete" } }),
    ).toBeUndefined();
    expect(requestStatusSkip({ operation: "notion.search.pages", requestStatus: undefined })).toBeUndefined();
    expect(requestStatusSkip({ operation: "notion.search.pages", requestStatus: "incomplete" })).toBeUndefined();
  });
});

describe("captureWasTruncated", () => {
  it("is false for an item with no skips at all", () => {
    expect(captureWasTruncated({ skips: [] })).toBe(false);
  });

  it("is true when the block tree hit the depth cap", () => {
    expect(
      captureWasTruncated({
        skips: [{ operation: "notion.blocks.children.list", reason: "depth-cap", subject: "nested block" }],
      }),
    ).toBe(true);
  });

  it("is true when the item ran out of its own time budget", () => {
    expect(
      captureWasTruncated({
        skips: [{ operation: "notion.comments.list", reason: "item-deadline", subject: "page comments" }],
      }),
    ).toBe(true);
  });

  it("is true when a comments PAGE failed on the network mid-thread — a later crawl can get the rest", () => {
    expect(
      captureWasTruncated({
        skips: [{ operation: "notion.comments.list", reason: "network", subject: "page comments" }],
      }),
    ).toBe(true);
  });

  it("is true for a rate-limited read, which a later crawl retries successfully", () => {
    expect(
      captureWasTruncated({
        skips: [{ operation: "notion.dataSources.query", reason: "rate-limit", subject: "data source rows" }],
      }),
    ).toBe(true);
  });

  it("is true for an unclassified failure, because the safe answer is that repair is possible", () => {
    expect(
      captureWasTruncated({ skips: [{ operation: "notion.comments.list", reason: "unknown", subject: "x" }] }),
    ).toBe(true);
  });

  it("is FALSE for a node the integration cannot see — a re-fetch gets the same nothing", () => {
    expect(
      captureWasTruncated({
        skips: [{ operation: "notion.blocks.children.list", reason: "unshared", subject: "nested block" }],
      }),
    ).toBe(false);
  });

  it("is FALSE for a restricted comments read — the capability every page lacks, not a repairable gap", () => {
    expect(
      captureWasTruncated({
        skips: [{ operation: "notion.comments.list", reason: "restricted", subject: "page comments" }],
      }),
    ).toBe(false);
  });

  it("is true when a repairable skip sits alongside an unimprovable one", () => {
    expect(
      captureWasTruncated({
        skips: [
          { operation: "notion.blocks.children.list", reason: "unshared", subject: "nested block" },
          { operation: "notion.blocks.children.list", reason: "depth-cap", subject: "nested block" },
        ],
      }),
    ).toBe(true);
  });
});

describe("enumerationWasIncomplete", () => {
  it("is false when nothing was skipped at all", () => {
    expect(enumerationWasIncomplete({ skips: [] })).toBe(false);
  });

  it("is true for a data-source query that failed recoverably — its rows were never seen", () => {
    expect(
      enumerationWasIncomplete({
        skips: [{ operation: "notion.dataSources.query", reason: "unknown", subject: "data source rows" }],
      }),
    ).toBe(true);
  });

  it("is true for a search page that never came back", () => {
    expect(
      enumerationWasIncomplete({
        skips: [{ operation: "notion.search.pages", reason: "network", subject: "search" }],
      }),
    ).toBe(true);
  });

  it("is FALSE for a per-item truncation, which carries its own marker instead", () => {
    expect(
      enumerationWasIncomplete({
        skips: [{ operation: "notion.blocks.children.list", reason: "depth-cap", subject: "nested block" }],
      }),
    ).toBe(false);
  });

  it("is FALSE for a data source this integration may never query, which would block coverage forever", () => {
    expect(
      enumerationWasIncomplete({
        skips: [{ operation: "notion.dataSources.query", reason: "restricted", subject: "data source rows" }],
      }),
    ).toBe(false);
  });
});
