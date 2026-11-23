import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareApiGatewayConfiguration,
  readCloudflareApiGatewayLabels,
  readCloudflareApiGatewayOperations,
  readCloudflareApiGatewaySchemas,
  readCloudflareApiGatewaySettings,
  readCloudflareDiscoveryOperations,
  readCloudflareDiscoverySchemas,
  readCloudflareUserSchemas,
} from "../../../../../atlas/cloudflare/readers/apiGateway.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function listPage({ page, items }: { page: number; items: readonly unknown[] }) {
  const result = page === 1 ? items : [];
  return { result, result_info: { count: result.length, page }, success: true };
}

function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

function pagedClient({ items }: { items: readonly unknown[] }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const page = requestedPage({ url: requestUrl({ input }) });
      return jsonResponse({ body: listPage({ items, page }), status: 200 });
    },
    maxRetries: 0,
  });
}

function errorClient({ status }: { status: number }) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status }),
    maxRetries: 0,
  });
}

describe("readCloudflareApiGatewayOperations", () => {
  it("reads every operation", async () => {
    const client = pagedClient({ items: [{ operation_id: "op-1" }] });
    const entities = unwrap(
      await readCloudflareApiGatewayOperations({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["operation:op-1"]);
  });

  it("skips an operation whose response omits an operation_id", async () => {
    const client = pagedClient({ items: [{ endpoint: "/x" }] });
    expect(
      unwrap(await readCloudflareApiGatewayOperations({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID })),
    ).toEqual([]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareApiGatewayOperations({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 401 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});

describe("readCloudflareDiscoveryOperations", () => {
  it("reads every discovered operation", async () => {
    const client = pagedClient({ items: [{ id: "disc-1" }] });
    const entities = unwrap(
      await readCloudflareDiscoveryOperations({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["discovery-operation:disc-1"]);
  });
});

describe("readCloudflareDiscoverySchemas", () => {
  it("reads the singleton schema collection", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { result: { schemas: [{ path: "/a" }], timestamp: "2026-01-01T00:00:00Z" }, success: true },
          status: 200,
        }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareDiscoverySchemas({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["discovery-schema"]);
  });

  it("maps an HTTP error to the typed client error", async () => {
    const result = await readCloudflareDiscoverySchemas({
      accountId: ACCOUNT_ID,
      at: AT,
      client: errorClient({ status: 403 }),
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareApiGatewaySchemas", () => {
  it("reads the singleton schema collection", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: { schemas: [] }, success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareApiGatewaySchemas({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["schema"]);
  });
});

describe("readCloudflareApiGatewayLabels", () => {
  it("reads every label", async () => {
    const client = pagedClient({ items: [{ name: "public" }] });
    const entities = unwrap(
      await readCloudflareApiGatewayLabels({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["label:public"]);
  });
});

describe("readCloudflareApiGatewaySettings", () => {
  it("reads the singleton", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { result: { validation_default_mitigation_action: "log" }, success: true }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareApiGatewaySettings({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["settings"]);
  });
});

describe("readCloudflareApiGatewayConfiguration", () => {
  it("reads the singleton", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { result: { auth_id_characteristics: [{ name: "authorization", type: "header" }] }, success: true },
          status: 200,
        }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareApiGatewayConfiguration({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["configuration"]);
  });
});

describe("readCloudflareUserSchemas", () => {
  it("reads every schema", async () => {
    const client = pagedClient({ items: [{ schema_id: "sch-1" }] });
    const entities = unwrap(
      await readCloudflareUserSchemas({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["user-schema:sch-1"]);
  });

  it("skips a schema whose response omits a schema_id", async () => {
    const client = pagedClient({ items: [{ name: "no-id-here" }] });
    expect(unwrap(await readCloudflareUserSchemas({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }))).toEqual(
      [],
    );
  });
});
