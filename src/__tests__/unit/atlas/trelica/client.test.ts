import { describe, expect, it } from "vitest";
import { z } from "zod";

import { TRELICA_AI_TABLE_TAKE, TRELICA_AI_USAGE_READS } from "../../../../atlas/trelica/aiUsage.js";
import { TRELICA_AI_USAGE_BOUNDARIES } from "../../../../atlas/trelica/aiUsageBoundaries.js";
import {
  createTrelicaClient,
  TRELICA_PAGE_SIZE,
  type TrelicaHttp,
  type TrelicaPage,
} from "../../../../atlas/trelica/client.js";
import { TrelicaAtlasErrors } from "../../../../atlas/trelica/errors.js";
import {
  TRELICA_FIRST_PARTY_READS,
  type TrelicaFirstPartyPage,
} from "../../../../atlas/trelica/firstPartyBoundaries.js";
import { TRELICA_CALLS, type TrelicaCall } from "../../../../atlas/trelica/inventory.js";
import type { TrelicaAiUsageDimension } from "../../../../atlas/trelica/model.js";
import { TRELICA_XSRF_HEADER, type TrelicaSession } from "../../../../atlas/trelica/session.js";
import { defineTrelicaBoundary, type TrelicaBoundary } from "../../../../atlas/trelica/trelicaBoundary.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

/** A call bound to a page of bare ids, for the tests about paging and requests rather than any one call's record. */
function idRead({ call }: { call: TrelicaCall }): {
  boundary: TrelicaBoundary<TrelicaFirstPartyPage>;
  call: TrelicaCall;
} {
  const schema = z.strictObject({ items: z.array(z.strictObject({ id: z.string() })), total: z.number() });
  return { boundary: defineTrelicaBoundary({ callId: call.id, endpoint: "GET /test/ids", schema }), call };
}

/** A call bound to a `FilterItems` page of bare ids, the shape `list` walks. */
function listRead({ call }: { call: TrelicaCall }): {
  boundary: TrelicaBoundary<TrelicaPage<{ id: string }>>;
  call: TrelicaCall;
} {
  const item = z.strictObject({ id: z.string() });
  const schema = z.strictObject({ items: z.array(item), resultsTruncated: z.boolean(), total: z.number() });
  return { boundary: defineTrelicaBoundary({ callId: call.id, endpoint: "POST /test/list", schema }), call };
}

/** The roles call with its real boundary. */
const ROLES = TRELICA_FIRST_PARTY_READS.find((read) => read.call.id === TRELICA_CALLS.roles.id)!;

const TENANT = "https://team-example.trelica.app";

const SESSION: TrelicaSession = {
  antiforgery: "an-antiforgery-token",
  cookie: ".AspNetCore.Identity.Application=a-session",
  profileDirectory: "Default",
};

/** Every request the fake saw, so a test can assert what went out rather than what came back. */
interface SeenRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

/** An HTTP fake answering scripted pages, recording every request it was handed. */
function fakeHttp({ pages }: { pages: readonly { statusCode: number; text: string }[] }): {
  http: TrelicaHttp;
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  let index = 0;
  const http: TrelicaHttp = async ({ url, method, headers, body }) => {
    seen.push({ body, headers, method, url });
    const next = pages[index];
    index += 1;
    return next === undefined
      ? err(TrelicaAtlasErrors.transportFailed({ callId: "fake", cause: "the fake ran out of pages" }))
      : ok(next);
  };
  return { http, seen };
}

/** A page of n synthetic records, shaped like the provider's own `{items, total}` answer. */
function page({ count, total, from = 0 }: { count: number; total: number; from?: number }): {
  statusCode: number;
  text: string;
} {
  return {
    statusCode: 200,
    text: JSON.stringify({
      items: Array.from({ length: count }, (_ignored: unknown, offset: number) => ({
        id: `app-${String(from + offset)}`,
      })),
      total,
    }),
  };
}

describe("createTrelicaClient", () => {
  it("presents the antiforgery token this platform demands on a POST", async () => {
    const { http, seen } = fakeHttp({ pages: [page({ count: 1, total: 1 })] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    await client.call(idRead({ call: TRELICA_CALLS.appInventory }));
    expect(seen[0]!.headers[TRELICA_XSRF_HEADER]).toBe("an-antiforgery-token");
    expect(seen[0]!.headers["cookie"]).toBe(SESSION.cookie);
  });

  it("sends the row's own body and never a caller's", async () => {
    const { http, seen } = fakeHttp({ pages: [page({ count: 1, total: 1 })] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    await client.call(idRead({ call: TRELICA_CALLS.appInventory }));
    expect(seen[0]!.body).toBe("{}");
    expect(seen[0]!.method).toBe("POST");
  });

  it("sends no body at all on a GET row", async () => {
    const { http, seen } = fakeHttp({ pages: [{ statusCode: 200, text: JSON.stringify({ items: [], total: 0 }) }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    await client.call(idRead({ call: TRELICA_CALLS.roles }));
    expect(seen[0]!.body).toBe(undefined);
    expect(seen[0]!.method).toBe("GET");
  });

  it("posts a POST row's own non-empty filter exactly as the row declares it", async () => {
    const { http, seen } = fakeHttp({ pages: [{ statusCode: 200, text: JSON.stringify({ items: [], total: 0 }) }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    await client.call(idRead({ call: TRELICA_CALLS.aiBudgets }));
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toBe(
      '{"clauses":[{"fieldIdentifierPath":[{"fieldId":"BudgetStatus","fieldType":"SingleOptionField"}],' +
        '"operator":"In","optionValue":["Past","Active","Future"]}],"type":"And"}',
    );
  });

  it("walks every page until the provider's own total is reached", async () => {
    const { http, seen } = fakeHttp({
      pages: [
        page({ count: TRELICA_PAGE_SIZE, from: 0, total: 450 }),
        page({ count: TRELICA_PAGE_SIZE, from: 200, total: 450 }),
        page({ count: 50, from: 400, total: 450 }),
      ],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const answered = unwrap(await client.call(idRead({ call: TRELICA_CALLS.appInventory })));
    expect(answered.items.length).toBe(450);
    expect(answered.total).toBe(450);
    expect(seen.length).toBe(3);
    expect(seen[1]!.url).toContain(`skip=${String(TRELICA_PAGE_SIZE)}`);
  });

  it("stops at an empty page rather than looping forever on a provider that keeps answering", async () => {
    const { http, seen } = fakeHttp({
      pages: [page({ count: 10, total: 999 }), { statusCode: 200, text: JSON.stringify({ items: [], total: 999 }) }],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const answered = unwrap(await client.call(idRead({ call: TRELICA_CALLS.appInventory })));
    expect(answered.items.length).toBe(10);
    expect(seen.length).toBe(2);
  });

  it("makes exactly one request for an unpaged row", async () => {
    const { http, seen } = fakeHttp({
      pages: [{ statusCode: 200, text: JSON.stringify({ items: [{ id: "role-1" }], total: 9 }) }],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const answered = unwrap(await client.call(idRead({ call: TRELICA_CALLS.roles })));
    expect(seen.length).toBe(1);
    expect(seen[0]!.url).toBe(`${TENANT}/Id/AdminApi/Roles`);
    expect(answered.items.length).toBe(1);
  });

  it("turns a non-success status into a refusal naming the call and the status", async () => {
    const { http } = fakeHttp({ pages: [{ statusCode: 403, text: "" }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const answered = await client.call(idRead({ call: TRELICA_CALLS.appInventory }));
    expect(answered.isErr()).toBe(true);
    expect(answered._unsafeUnwrapErr().code).toBe("CALL_REFUSED");
    expect(answered._unsafeUnwrapErr().message).toContain("403");
  });

  it("turns an unparseable body into a refusal that names the call and never quotes the body", async () => {
    const { http } = fakeHttp({
      pages: [
        { statusCode: 200, text: "S3cr3t!" },
        { statusCode: 200, text: "S3cr3t!" },
      ],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const called = (await client.call(idRead({ call: TRELICA_CALLS.appInventory })))._unsafeUnwrapErr();
    const paged = (await client.list(listRead({ call: TRELICA_CALLS.appInventory })))._unsafeUnwrapErr();
    expect([called.code, paged.code]).toEqual(["BODY_UNPARSEABLE", "BODY_UNPARSEABLE"]);
    expect(called.message).toBe(
      `${TRELICA_CALLS.appInventory.id} answered a body that is not the JSON it declares; the body is not held`,
    );
    expect(JSON.stringify([called, paged])).not.toContain("S3cr3t");
  });

  it("refuses a list page whose shape drifted before paging on its count, so no further page is asked for", async () => {
    const drifted = { items: [{ id: "app-0" }], next: "cursor", resultsTruncated: false, total: 999 };
    const { http, seen } = fakeHttp({
      pages: [{ statusCode: 200, text: JSON.stringify(drifted) }, page({ count: 1, total: 999 })],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const refused = (await client.list(listRead({ call: TRELICA_CALLS.appInventory })))._unsafeUnwrapErr();
    expect(refused.code).toBe("BODY_SHAPE_CHANGED");
    expect(refused.message).toBe(
      `${TRELICA_CALLS.appInventory.id} answered a shape this version does not read, so nothing it answered is held: new field "next"`,
    );
    expect(seen.length).toBe(1);
  });

  it("walks a list's admitted pages to the total the provider stated", async () => {
    const listPage = ({ count, from }: { count: number; from: number }) => {
      const items = Array.from({ length: count }, (_ignored: unknown, offset: number) => ({
        id: `app-${String(from + offset)}`,
      }));
      return { statusCode: 200, text: JSON.stringify({ items, resultsTruncated: false, total: 250 }) };
    };
    const { http, seen } = fakeHttp({
      pages: [listPage({ count: TRELICA_PAGE_SIZE, from: 0 }), listPage({ count: 50, from: 200 })],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const answered = unwrap(await client.list(listRead({ call: TRELICA_CALLS.appInventory })));
    expect(answered.pages.map((admitted) => admitted.items.length)).toEqual([TRELICA_PAGE_SIZE, 50]);
    expect(seen.length).toBe(2);
  });

  it("carries the row's own verb out, so a projection names the operation the way it was made", async () => {
    const { http } = fakeHttp({ pages: [{ statusCode: 200, text: JSON.stringify({ items: [], total: 0 }) }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    expect(unwrap(await client.call(idRead({ call: TRELICA_CALLS.roles }))).httpMethod).toBe("GET");
  });

  it("sends a row's fixed query after paging's own parameters", async () => {
    const { http, seen } = fakeHttp({ pages: [{ statusCode: 200, text: JSON.stringify({ items: [], total: 0 }) }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    await client.call(idRead({ call: TRELICA_CALLS.aiAlertsSpike }));
    expect(seen[0]!.url).toBe(
      `${TENANT}/AppsApi/AppAIAlert/History?skip=0&take=${String(TRELICA_PAGE_SIZE)}&type=Spike`,
    );
  });

  it("holds each record as its census view: what the boundary reads, and a declared-unread key as null", async () => {
    const role = {
      concurrencyStamp: "stamp-1",
      id: "role-1",
      isSystemRole: true,
      name: "Admin",
      normalizedName: "ADMIN",
    };
    const { http } = fakeHttp({ pages: [{ statusCode: 200, text: JSON.stringify({ items: [role], total: 1 }) }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const answered = unwrap(await client.call(ROLES));
    expect(answered.items).toEqual([
      { concurrencyStamp: null, id: "role-1", isSystemRole: true, name: "Admin", normalizedName: null },
    ]);
    expect(answered.total).toBe(1);
  });

  it("refuses a boundary bound to another call on every read, before any request is made", async () => {
    const { http, seen } = fakeHttp({ pages: [page({ count: 1, total: 1 })] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const call = TRELICA_CALLS.appInventory;
    const called = (await client.call({ boundary: ROLES.boundary, call }))._unsafeUnwrapErr();
    const listed = (
      await client.list({ boundary: listRead({ call: TRELICA_CALLS.roles }).boundary, call })
    )._unsafeUnwrapErr();
    const one = (
      await client.one({ boundary: idRead({ call: TRELICA_CALLS.roles }).boundary, call })
    )._unsafeUnwrapErr();
    expect([called.code, listed.code, one.code]).toEqual(["BOUNDARY_UNBOUND", "BOUNDARY_UNBOUND", "BOUNDARY_UNBOUND"]);
    expect(called.message).toBe(
      `${call.id} was asked to admit its answer through ${TRELICA_CALLS.roles.id}'s boundary; nothing was requested`,
    );
    expect(seen.length).toBe(0);
  });

  it("binds every first-party read's boundary to its own call", () => {
    expect(TRELICA_FIRST_PARTY_READS.length).toBeGreaterThan(0);
    expect(TRELICA_FIRST_PARTY_READS.filter((read) => read.boundary.callId !== read.call.id)).toEqual([]);
  });

  it("refuses the whole call when a page answers a key its boundary does not declare, naming the key", async () => {
    const role = { id: "role-1", isSystemRole: false, name: "Admin", permissions: ["all"] };
    const { http } = fakeHttp({ pages: [{ statusCode: 200, text: JSON.stringify({ items: [role], total: 1 }) }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const refused = (await client.call(ROLES))._unsafeUnwrapErr();
    expect(refused.code).toBe("BODY_SHAPE_CHANGED");
    expect(refused.message).toBe(
      `${TRELICA_CALLS.roles.id} answered a shape this version does not read, so nothing it answered is held: new field "items[0].permissions"`,
    );
  });
});

/** The ten figures every row carries, all zero but its spend. */
function metrics({ spend }: { spend: number }): Record<string, number> {
  return {
    cachedInputTokens: 0,
    cachedOutputTokens: 0,
    credits: 0,
    inputTokens: 0,
    linesOfCodeAdded: 0,
    linesOfCodeRemoved: 0,
    outputTokens: 0,
    requests: 0,
    spend,
    totalTokens: 0,
  };
}

/** What names a row in each dimension these tests read. */
const IDENTITY = {
  "api-key": {
    apiKey: { name: "Build key" },
    customerAppApiKeyId: "key-1",
    customerAppId: "ca-1",
    customerAppName: "Example AI",
  },
  app: { customerAppId: "ca-1", customerAppName: "Example AI" },
  "cost-center": { costCenterId: "cc-1" },
  model: { customerAppId: "ca-1", customerAppName: "Example AI", model: "model-1" },
  person: { person: { email: "someone@example.com", name: "Some One" }, personId: "person-1" },
  team: { memberId: "team-1", memberName: "Engineering" },
} as const satisfies Record<TrelicaAiUsageDimension, Record<string, unknown>>;

/** What a table row carries beyond its identity, where the series row does not: a team row's subtree. */
const TABLE_ONLY: Partial<Record<TrelicaAiUsageDimension, Record<string, unknown>>> = { team: { children: [] } };

/** One cost-explorer page: `count` table rows spending `spend` each, out of `total`. */
function usagePage({
  dimension,
  count,
  total,
  spend,
  row = {},
}: {
  dimension: keyof typeof IDENTITY;
  count: number;
  total: number;
  spend: number;
  row?: Record<string, unknown>;
}): { statusCode: number; text: string } {
  return {
    statusCode: 200,
    text: JSON.stringify({
      granularity: "Monthly",
      rows: {
        items: Array.from({ length: count }, () => ({
          ...IDENTITY[dimension],
          ...TABLE_ONLY[dimension],
          metrics: metrics({ spend }),
          ...row,
        })),
        resultsTruncated: false,
        total,
      },
      usageByDate: [{ ...IDENTITY[dimension], spendByDate: { "2026-09": spend, "2026-10": null } }],
    }),
  };
}

const WINDOW = { endDate: "2026-10-02", startDate: "2024-10-02" };

describe("createTrelicaClient usage", () => {
  it("pages the table inside the body until the explorer's own total is reached", async () => {
    const { http, seen } = fakeHttp({
      pages: [
        usagePage({ count: TRELICA_AI_TABLE_TAKE, dimension: "app", spend: 5, total: 250 }),
        usagePage({ count: 50, dimension: "app", spend: 5, total: 250 }),
      ],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const read = unwrap(await client.usage({ dimension: "app", stopBelowSpend: null, window: WINDOW }));
    expect(read.rows.length).toBe(250);
    expect(read.total).toBe(250);
    expect(read.granularity).toBe("Monthly");
    expect(read.stoppedAtFloor).toBe(false);
    expect(seen.map((request) => (JSON.parse(request.body!) as { tableSkip: number }).tableSkip)).toEqual([0, 200]);
    expect(seen[0]!.url).toBe(`${TENANT}/AppsApi/AppAIUsage/UsageByApp`);
  });

  it("holds both cost-explorer tables frozen, so neither a path nor a boundary can be swapped at run time", () => {
    expect(Object.isFrozen(TRELICA_AI_USAGE_READS)).toBe(true);
    expect(Object.values(TRELICA_AI_USAGE_READS).filter((read) => !Object.isFrozen(read))).toEqual([]);
    expect(Object.isFrozen(TRELICA_AI_USAGE_BOUNDARIES)).toBe(true);
  });

  it("requests each dimension's own table and admits it through that dimension's boundary", async () => {
    const dimensions = Object.values(TRELICA_AI_USAGE_READS).map((read) => read.dimension);
    expect(dimensions.length).toBeGreaterThan(0);
    for (const dimension of dimensions) {
      const { http, seen } = fakeHttp({ pages: [usagePage({ count: 1, dimension, spend: 2, total: 1 })] });
      const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
      const read = unwrap(await client.usage({ dimension, stopBelowSpend: null, window: WINDOW }));
      expect(seen.map((request) => request.url)).toEqual([`${TENANT}${TRELICA_AI_USAGE_READS[dimension].path}`]);
      expect(read.path).toBe(TRELICA_AI_USAGE_READS[dimension].path);
      expect(TRELICA_AI_USAGE_BOUNDARIES[dimension].callId).toBe(`ai-usage:${dimension}`);
      expect(read.dimension).toBe(dimension);
      expect(read.rows.length).toBe(1);
    }
  });

  it("stops at the first page holding a row below the spend floor", async () => {
    const { http, seen } = fakeHttp({
      pages: [
        usagePage({ count: TRELICA_AI_TABLE_TAKE, dimension: "api-key", spend: 3, total: 1000 }),
        usagePage({ count: TRELICA_AI_TABLE_TAKE, dimension: "api-key", spend: 0.001, total: 1000 }),
        usagePage({ count: TRELICA_AI_TABLE_TAKE, dimension: "api-key", spend: 0.001, total: 1000 }),
      ],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const read = unwrap(await client.usage({ dimension: "api-key", stopBelowSpend: 1, window: WINDOW }));
    expect(seen.length).toBe(2);
    expect(read.rows.length).toBe(400);
    expect(read.stoppedAtFloor).toBe(true);
  });

  it("names the dimension when the explorer refuses", async () => {
    const { http } = fakeHttp({ pages: [{ statusCode: 403, text: "" }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const read = await client.usage({ dimension: "person", stopBelowSpend: null, window: WINDOW });
    expect(read._unsafeUnwrapErr().code).toBe("CALL_REFUSED");
    expect(read._unsafeUnwrapErr().message).toContain("ai-usage:person");
  });

  it("holds each row and series entry as the dimension boundary's census view", async () => {
    const { http } = fakeHttp({
      pages: [
        usagePage({ count: 1, dimension: "app", row: { products: ["a product"], sortField: 4 }, spend: 2, total: 1 }),
      ],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const read = unwrap(await client.usage({ dimension: "app", stopBelowSpend: null, window: WINDOW }));
    expect(read.rows).toEqual([
      {
        customerAppId: "ca-1",
        customerAppName: "Example AI",
        metrics: metrics({ spend: 2 }),
        products: null,
        sortField: null,
      },
    ]);
    expect(read.series).toEqual([
      { customerAppId: "ca-1", customerAppName: "Example AI", spendByDate: { "2026-09": 2, "2026-10": null } },
    ]);
  });

  it("refuses a row in a shape its dimension does not read, naming the dimension and the key", async () => {
    const { http } = fakeHttp({
      pages: [usagePage({ count: 1, dimension: "person", row: { department: "Engineering" }, spend: 2, total: 1 })],
    });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const read = await client.usage({ dimension: "person", stopBelowSpend: null, window: WINDOW });
    expect(read._unsafeUnwrapErr().code).toBe("BODY_SHAPE_CHANGED");
    expect(read._unsafeUnwrapErr().message).toBe(
      `ai-usage:person answered a shape this version does not read, so nothing it answered is held: new field "rows.items[0].department"`,
    );
  });

  it("refuses an unparseable explorer body without quoting it", async () => {
    const { http } = fakeHttp({ pages: [{ statusCode: 200, text: "S3cr3t!" }] });
    const client = createTrelicaClient({ http, session: SESSION, tenantOrigin: TENANT });
    const read = await client.usage({ dimension: "person", stopBelowSpend: null, window: WINDOW });
    expect(read._unsafeUnwrapErr().code).toBe("BODY_UNPARSEABLE");
    expect(JSON.stringify(read._unsafeUnwrapErr())).not.toContain("S3cr3t");
  });
});
