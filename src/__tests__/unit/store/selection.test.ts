/**
 * Selecting store records for one validated query, with the database read replaced by a typed row-lister
 * fake and an inert client that nothing touches: the query is run once on the caller's client, placed rows
 * become records in store order, a row whose container did not resolve is counted as unplaced rather than
 * dropped, and a store failure is forwarded unchanged.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { ContentWithNames, listContentWithNames, StoreClient } from "../../../store/client.js";
import { StoreErrors } from "../../../store/errors.js";
import { storeQuerySchema } from "../../../store/query.js";
import type { ContentRow } from "../../../store/schema/content.js";
import { selectStoreRecords } from "../../../store/selection.js";

// Nothing in this module reads the client — it is handed straight to the lister — so a structural cast of an
// empty connection is the whole fixture.
const CLIENT = { close: async (): Promise<void> => {}, db: {} } as unknown as StoreClient;

const QUERY = storeQuerySchema.parse({ limit: 3, source: "slack" });

/** One stored Slack message row, distinguished by its id, body and instant. */
function row({ sourceId, body, occurredAtIso }: { sourceId: string; body: string; occurredAtIso: string }): ContentRow {
  return {
    authorId: null,
    authorIsBot: false,
    authorNativeId: null,
    body,
    containerId: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    dataClass: null,
    id: `id-${sourceId}`,
    kind: "message",
    metadata: {},
    occurredAt: new Date(occurredAtIso),
    parentId: null,
    parentSourceId: null,
    searchable: null,
    source: "slack",
    sourceId,
    title: null,
    url: `https://example.invalid/${sourceId}`,
    visibility: "public",
  };
}

const ROWS: readonly ContentWithNames[] = [
  {
    author: "seth",
    container: "slack/C0ONE",
    row: row({ body: "the pool exhausted", occurredAtIso: "2026-10-02T03:00:00.000Z", sourceId: "C0ONE:1.1" }),
  },
  {
    author: null,
    container: null,
    row: row({ body: "an orphaned reply", occurredAtIso: "2026-10-02T04:00:00.000Z", sourceId: "C0LOST:2.2" }),
  },
  {
    author: null,
    container: "slack/C0TWO",
    row: row({ body: "raised the pool to 40", occurredAtIso: "2026-10-02T05:00:00.000Z", sourceId: "C0TWO:3.3" }),
  },
];

describe("selectStoreRecords", () => {
  it("runs the query once on the caller's client and returns the placed rows as records in store order, counting one unplaced", async () => {
    const calls: Parameters<typeof listContentWithNames>[0][] = [];
    const listRows: typeof listContentWithNames = async (input) => {
      calls.push(input);
      return ok(ROWS);
    };

    const selection = unwrap(await selectStoreRecords({ client: CLIENT, listRows, query: QUERY }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.client).toBe(CLIENT);
    expect(calls[0]!.query).toBe(QUERY);
    expect(selection).toEqual({
      query: { limit: 3, offset: 0, source: "slack" },
      records: [
        {
          author: "seth",
          container: "slack/C0ONE",
          kind: "message",
          refs: [],
          source: "slack",
          sourceId: "C0ONE:1.1",
          text: "the pool exhausted",
          tsIso: "2026-10-02T03:00:00.000Z",
          url: "https://example.invalid/C0ONE:1.1",
          visibility: "public",
        },
        {
          container: "slack/C0TWO",
          kind: "message",
          refs: [],
          source: "slack",
          sourceId: "C0TWO:3.3",
          text: "raised the pool to 40",
          tsIso: "2026-10-02T05:00:00.000Z",
          url: "https://example.invalid/C0TWO:3.3",
          visibility: "public",
        },
      ],
      unplaced: 1,
    });
  });

  it("answers no records and none unplaced when the query returns no rows", async () => {
    const listRows: typeof listContentWithNames = async () => ok([]);

    expect(unwrap(await selectStoreRecords({ client: CLIENT, listRows, query: QUERY }))).toEqual({
      query: { limit: 3, offset: 0, source: "slack" },
      records: [],
      unplaced: 0,
    });
  });

  it("forwards the store's STORE_QUERY_FAILED unchanged", async () => {
    const cause = new Error('relation "content" does not exist');
    const listRows: typeof listContentWithNames = async () =>
      err(StoreErrors.queryFailed({ cause, what: "listing content" }));

    const error = unwrapErr(await selectStoreRecords({ client: CLIENT, listRows, query: QUERY }));

    expect(error.code).toBe("STORE_QUERY_FAILED");
    expect(error.message).toBe('listing content failed: relation "content" does not exist');
    expect(error).toEqual(StoreErrors.queryFailed({ cause, what: "listing content" }));
  });
});
