import { describe, expect, it } from "vitest";

import {
  forcedPagination,
  insightsCursor,
  insightsPageIsLast,
  JUMPCLOUD_OFFSET_SORT,
  JUMPCLOUD_PAGE_SIZE,
  offsetWalkComplete,
  pageQuery,
} from "../../../../atlas/jumpcloud/paging.js";

describe("pageQuery", () => {
  it("pins a total, stable sort on an offset walker, so a page cannot omit a record", () => {
    expect(pageQuery({ alreadyRead: 200, cursor: null, pagination: "limit-skip" })).toEqual({
      limit: String(JUMPCLOUD_PAGE_SIZE),
      skip: "200",
      sort: JUMPCLOUD_OFFSET_SORT,
    });
  });

  it("offsets by records READ, not by page index — the first page can come back short", () => {
    expect(pageQuery({ alreadyRead: 100, cursor: null, pagination: "limit-skip" })["skip"]).toBe("100");
  });

  it("pins the same sort on the offset spelling of the same walk", () => {
    expect(pageQuery({ alreadyRead: 0, cursor: null, pagination: "limit-offset" })["sort"]).toBe(JUMPCLOUD_OFFSET_SORT);
  });

  it("sends nothing at all for an operation the registry says is not paged", () => {
    expect(pageQuery({ alreadyRead: 0, cursor: null, pagination: "none" })).toEqual({});
  });

  it("carries a cursor on a token walker once one exists", () => {
    expect(pageQuery({ alreadyRead: 0, cursor: "abc", pagination: "token" })["pageToken"]).toBe("abc");
  });
});

describe("forcedPagination", () => {
  it("switches an operation the specification calls unpaged when the provider pages it anyway", () => {
    // MEASURED live: GET /api/systems is generated `none` and answers a default page of 100 against a larger
    // declared totalCount. The total here is synthetic.
    expect(forcedPagination({ declared: "none", observed: 100, totalCount: 250 })).toBe("limit-skip");
  });

  it("leaves an operation alone when the first page already carried everything", () => {
    expect(forcedPagination({ declared: "none", observed: 250, totalCount: 250 })).toBe(null);
  });

  it("leaves an operation alone when the provider declared no total to compare against", () => {
    expect(forcedPagination({ declared: "none", observed: 100, totalCount: null })).toBe(null);
  });

  it("never overrides a shape the registry already describes as paged", () => {
    expect(forcedPagination({ declared: "limit-skip", observed: 100, totalCount: 250 })).toBe(null);
  });

  it("does not page an empty answer", () => {
    expect(forcedPagination({ declared: "none", observed: 0, totalCount: 5 })).toBe(null);
  });
});

describe("offsetWalkComplete", () => {
  it("keeps walking while a full page comes back", () => {
    const walked = offsetWalkComplete({ observed: 100, pageRecords: JUMPCLOUD_PAGE_SIZE, totalCount: 240 });
    expect(walked.ended).toBe(false);
    expect(walked.complete).toBe(false);
  });

  it("refuses to call a short page complete when the provider declared more", () => {
    const walked = offsetWalkComplete({ observed: 200, pageRecords: 50, totalCount: 240 });
    expect(walked.ended).toBe(true);
    expect(walked.complete).toBe(false);
    expect(walked.reason).toContain("unstable page order");
  });

  it("calls a short page complete once the declared total is reached", () => {
    const walked = offsetWalkComplete({ observed: 240, pageRecords: 40, totalCount: 240 });
    expect(walked.complete).toBe(true);
    expect(walked.reason).toContain("matching the 240");
  });

  it("rests completeness on paging alone when the provider declared no total, and says so", () => {
    const walked = offsetWalkComplete({ observed: 12, pageRecords: 12, totalCount: null });
    expect(walked.complete).toBe(true);
    expect(walked.reason).toContain("declared no total");
  });
});

describe("insightsPageIsLast", () => {
  it("does NOT terminate on the cursor, which Directory Insights sends on the last page too", () => {
    const headers = { "x-limit": "100", "x-result-count": "100", "x-search_after": "still-here" };
    expect(insightsPageIsLast({ headers, requestedLimit: 100 })).toBe(false);
    expect(insightsCursor({ headers })).toBe("still-here");
  });

  it("terminates on a page shorter than the limit it asked for", () => {
    expect(insightsPageIsLast({ headers: { "x-limit": "100", "x-result-count": "37" }, requestedLimit: 100 })).toBe(
      true,
    );
  });

  it("stops rather than looping when the provider sends no count header at all", () => {
    expect(insightsPageIsLast({ headers: {}, requestedLimit: 100 })).toBe(true);
  });

  it("falls back to the requested limit when the provider echoes none", () => {
    expect(insightsPageIsLast({ headers: { "x-result-count": "50" }, requestedLimit: 100 })).toBe(true);
  });
});

describe("reaching the declared total ends the walk", () => {
  it("calls a walk complete when it lands exactly on the total with a FULL last page", () => {
    // MEASURED live: a System Insights table read in pages of 1,000 can reach its declared total on a full
    // last page. The total here is synthetic, a whole number of pages.
    const walked = offsetWalkComplete({ observed: 54_000, pageRecords: 1000, pageSize: 1000, totalCount: 54_000 });
    expect(walked.ended).toBe(true);
    expect(walked.complete).toBe(true);
  });

  it("still keeps walking when the total has not been reached and the page was full", () => {
    const walked = offsetWalkComplete({ observed: 2000, pageRecords: 1000, pageSize: 1000, totalCount: 54_000 });
    expect(walked.ended).toBe(false);
    expect(walked.complete).toBe(false);
  });
});
