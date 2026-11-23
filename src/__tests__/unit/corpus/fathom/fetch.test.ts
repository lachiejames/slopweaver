/**
 * Unit: the Fathom crawl's cursor discipline. The properties that matter are the ones a silent failure
 * would hide — a partial crawl reports a GAP so the pooled cursor cannot move past meetings the API really
 * has, a capped run says it was capped, and a window's plain date is widened into the instant Fathom's own
 * filter expects.
 *
 * The seam is a plain function, not a mock: `FathomApi` is one method, so a fake that returns prepared
 * pages is the whole isolation this needs.
 */
import { describe, expect, it } from "vitest";

import { crawlFathomMeetings, isoBound, MAX_PAGES } from "../../../../corpus/fathom/fetch.js";
import type { FathomMeeting } from "../../../../corpus/fathom/types.js";
import type { IngestError } from "../../../../lib/ingestError.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import type { FathomApi, FathomMeetingPage } from "../../../../live/fathom/api.js";

const WINDOW = { since: "2026-09-01", until: "2026-09-11" } as const;

/**
 * A boundary failure, built as a literal because `IngestError` is the shared boundary shape and has no
 * factory of its own — the domain factory rule governs `FathomErrors`, which is what these tests assert ON.
 */
function boundaryError({ message, status }: { message: string; status?: number }): IngestError {
  return {
    kind: "http",
    message,
    operation: "fathom.meetings.list",
    provider: "fathom",
    ...(status !== undefined ? { status } : {}),
  };
}

function call({ id }: { id: number }): FathomMeeting {
  return {
    attendees: [],
    invitees: [],
    recordingId: id,
    recordingStartIso: "2026-09-09T03:00:00.000Z",
    sharedWith: "single_team",
    transcript: [{ speaker: { displayName: "A" }, text: "hi", timestamp: "00:00:01" }],
    transcriptLanguage: "en",
    url: `https://fathom.video/calls/${String(id)}`,
  };
}

/** A seam that answers each prepared page in order, then refuses if asked for one more. */
function pagesApi({ pages }: { pages: readonly FathomMeetingPage[] }): { api: FathomApi; cursors: string[] } {
  const cursors: string[] = [];
  let index = 0;
  const api: FathomApi = {
    listMeetings: async ({ cursor = "(none)" }) => {
      cursors.push(cursor);
      const page = pages[index];
      index += 1;
      return page === undefined ? err(boundaryError({ message: "asked past the last page" })) : ok(page);
    },
  };
  return { api, cursors };
}

describe("crawlFathomMeetings window filter", () => {
  /** A seam that answers one empty page and records the `created_at` bounds it was handed. */
  function filterApi(): { api: FathomApi; bounds: { createdAfter?: string; createdBefore?: string }[] } {
    const bounds: { createdAfter?: string; createdBefore?: string }[] = [];
    const api: FathomApi = {
      listMeetings: async ({ createdAfter, createdBefore }) => {
        bounds.push({
          ...(createdAfter !== undefined ? { createdAfter } : {}),
          ...(createdBefore !== undefined ? { createdBefore } : {}),
        });
        return ok({ meetings: [] });
      },
    };
    return { api, bounds };
  }

  it("widens a day window into the DISTINCT instants Fathom's created_at filter needs", async () => {
    const { api, bounds } = filterApi();
    await crawlFathomMeetings({ api, window: { since: "2026-09-17", until: "2026-09-18" } });
    expect(bounds).toEqual([{ createdAfter: "2026-09-17T00:00:00Z", createdBefore: "2026-09-18T00:00:00Z" }]);
  });

  // The witness for WHY the pooled cursor is capped at the clock in
  // `../../../../cli/commands/refresh/core.ts#buildRefreshWindows`. A cursor banked from the window's
  // `until` (today+1) comes back as `since`, and this is what the provider is then asked: a zero-width
  // range that no recording can fall inside. Measured on a real home — 0 transcripts
  // stored on the pooled window, 1 on an explicit one over the same account.
  it("collapses to a ZERO-WIDTH range when since == until, which is the defect the cap prevents", async () => {
    const { api, bounds } = filterApi();
    await crawlFathomMeetings({ api, window: { since: "2026-09-18", until: "2026-09-18" } });
    expect(bounds).toEqual([{ createdAfter: "2026-09-18T00:00:00Z", createdBefore: "2026-09-18T00:00:00Z" }]);
  });
});

describe("crawlFathomMeetings", () => {
  it("follows next_cursor to the end and reports no gap", async () => {
    const { api, cursors } = pagesApi({
      pages: [{ meetings: [call({ id: 1 })], nextCursor: "c2" }, { meetings: [call({ id: 2 })] }],
    });
    const crawled = unwrap(await crawlFathomMeetings({ api, window: WINDOW }));
    expect(crawled.meetings.map((meeting) => meeting.recordingId)).toEqual([1, 2]);
    expect(crawled.gaps).toEqual([]);
    expect(crawled.pages).toBe(2);
    expect(cursors).toEqual(["(none)", "c2"]);
  });

  it("keeps what arrived and reports a GAP when a later page fails", async () => {
    const { api } = pagesApi({ pages: [{ meetings: [call({ id: 1 })], nextCursor: "c2" }] });
    const crawled = unwrap(await crawlFathomMeetings({ api, window: WINDOW }));
    expect(crawled.meetings.length).toBe(1);
    expect(crawled.gaps.length).toBe(1);
    expect(crawled.gaps[0]).toContain("is NOT covered");
  });

  it("fails typed when the very FIRST page refuses, so the lane reports a dead key rather than a gap", async () => {
    const api: FathomApi = {
      listMeetings: async () => err(boundaryError({ message: "request failed", status: 401 })),
    };
    const crawled = await crawlFathomMeetings({ api, window: WINDOW });
    expect(crawled.isErr()).toBe(true);
    expect(crawled._unsafeUnwrapErr().code).toBe("UNAUTHORISED");
  });

  it("reports a transport failure on the first page as FETCH_FAILED, not as a revoked key", async () => {
    const api: FathomApi = {
      listMeetings: async () => err(boundaryError({ message: "socket hang up" })),
    };
    const crawled = await crawlFathomMeetings({ api, window: WINDOW });
    expect(crawled.isErr()).toBe(true);
    expect(crawled._unsafeUnwrapErr().code).toBe("FETCH_FAILED");
  });

  it("stops at the cap and says the run was bounded, so its cursor is held", async () => {
    const { api } = pagesApi({
      pages: [{ meetings: [call({ id: 1 }), call({ id: 2 }), call({ id: 3 })], nextCursor: "c2" }],
    });
    const crawled = unwrap(await crawlFathomMeetings({ api, cap: { maxMeetings: 2 }, window: WINDOW }));
    expect(crawled.meetings.map((meeting) => meeting.recordingId)).toEqual([1, 2]);
    expect(crawled.warnings[0]).toContain("cap");
    expect(crawled.gaps).toEqual([]);
  });

  it("refuses to loop forever on a provider that never stops handing back a cursor", async () => {
    const api: FathomApi = {
      listMeetings: async () => ok({ meetings: [call({ id: 1 })], nextCursor: "always" }),
    };
    const crawled = unwrap(await crawlFathomMeetings({ api, window: WINDOW }));
    expect(crawled.pages).toBe(MAX_PAGES);
    expect(crawled.gaps[0]).toContain("with a cursor still open");
  });
});

describe("isoBound", () => {
  it("widens a plain date into the instant Fathom's own filter documents", () => {
    expect(isoBound({ date: "2026-09-01" })).toBe("2026-09-01T00:00:00Z");
  });

  it("passes an instant through untouched", () => {
    expect(isoBound({ date: "2026-09-01T04:30:00Z" })).toBe("2026-09-01T04:30:00Z");
  });

  it("carries no bound at all for an empty window edge", () => {
    expect(isoBound({ date: "  " })).toBe(undefined);
  });
});
