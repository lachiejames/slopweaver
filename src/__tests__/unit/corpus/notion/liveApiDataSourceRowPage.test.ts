/*
 * One `dataSources.query` page's rows and a refused query's skip, over synthetic fixtures.
 *
 * The Notion client is a plain object answering an empty comment thread and counting how often it was
 * asked, passed through the seam the lane already takes. A fake, not a mock.
 */
import type { Client } from "@notionhq/client";
import { describe, expect, it } from "vitest";

import { DEFAULT_NOTION_CAPTURE_CAPS } from "../../../../corpus/notion/caps.js";
import { dataSourceFailureSkip, rowsFromQueryPage } from "../../../../corpus/notion/liveApiDataSourceRowPage.js";
import { createNotionCrawlMeter } from "../../../../corpus/notion/meter.js";
import { notionSeenIndexFrom } from "../../../../corpus/notion/seenIndex.js";
import type { IngestError } from "../../../../lib/ingestError.js";

const DATA_SOURCE = "0e2f4a1b-1111-4222-8333-444455556660";
const FRESH = "0e2f4a1b-1111-4222-8333-444455556661";
const HELD = "0e2f4a1b-1111-4222-8333-444455556662";
const OLD = "0e2f4a1b-1111-4222-8333-444455556663";
const CUTOFF = Date.parse("2026-05-01T00:00:00.000Z");

/** A client whose every comment thread is empty, and the count of comment reads it answered. */
const countingClient = (): { client: Client; asked: { count: number } } => {
  const asked = { count: 0 };
  const list = async (): Promise<{ next_cursor: null; results: readonly unknown[] }> => {
    asked.count += 1;
    return { next_cursor: null, results: [] };
  };
  return { asked, client: { comments: { list } } as unknown as Client };
};

const row = ({ id, at }: { id: string; at: string }): Record<string, unknown> => ({
  id,
  last_edited_time: at,
  object: "page",
  properties: {},
});

const queryFailure = ({ status }: { status: number }): IngestError => ({
  kind: "http",
  message: `HTTP ${status}`,
  operation: "notion.dataSources.query",
  provider: "notion",
  status,
});

const heldSeen = notionSeenIndexFrom({
  coveredSinceIso: "1970-01-01",
  rows: [{ sourceId: `page:${HELD}`, tsIso: "2026-05-09T00:00:00.000Z" }],
});

describe("rowsFromQueryPage", () => {
  it("drops id-less, out-of-window and held-unchanged rows without a single request", async () => {
    const { asked, client } = countingClient();
    const meter = createNotionCrawlMeter();
    const page = await rowsFromQueryPage({
      call: (task) => task(),
      caps: DEFAULT_NOTION_CAPTURE_CAPS,
      client,
      cutoff: CUTOFF,
      dataSourceId: DATA_SOURCE,
      meter,
      results: [
        { object: "page" },
        row({ at: "2026-04-01T00:00:00.000Z", id: OLD }),
        row({ at: "2026-05-09T00:00:00.000Z", id: HELD }),
      ],
      scopeId: "test",
      seen: heldSeen,
    });
    expect(page).toEqual({ notes: [], rows: [], skips: [] });
    expect(asked.count).toBe(0);
    expect(meter.read()).toEqual({ calls: 0, skippedUnchanged: 1 });
  });

  it("fetches the comments of only the in-window row bronze does not already hold", async () => {
    const { asked, client } = countingClient();
    const page = await rowsFromQueryPage({
      call: (task) => task(),
      caps: DEFAULT_NOTION_CAPTURE_CAPS,
      client,
      cutoff: CUTOFF,
      dataSourceId: DATA_SOURCE,
      meter: createNotionCrawlMeter(),
      results: [row({ at: "2026-05-10T00:00:00.000Z", id: FRESH }), row({ at: "2026-05-09T00:00:00.000Z", id: HELD })],
      scopeId: "test",
      seen: heldSeen,
    });
    expect(page.rows.map((one) => one.id)).toEqual([FRESH]);
    expect(page.skips).toEqual([]);
    expect(page.notes).toEqual([]);
    expect(asked.count).toBe(1);
  });
});

describe("dataSourceFailureSkip", () => {
  it("records a data source the token cannot see as a non-fatal unshared skip", () => {
    expect(dataSourceFailureSkip({ error: queryFailure({ status: 404 }) })).toEqual({
      operation: "notion.dataSources.query",
      reason: "unshared",
      subject: "data source rows",
    });
  });

  it("records a refused data source as a restricted skip", () => {
    expect(dataSourceFailureSkip({ error: queryFailure({ status: 403 }) }).reason).toBe("restricted");
  });

  it("throws on an auth failure, since every other request would fail the same way", () => {
    expect(() => dataSourceFailureSkip({ error: queryFailure({ status: 401 }) })).toThrow("HTTP 401");
  });
});
