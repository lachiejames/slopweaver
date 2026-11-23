import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { readCloudflareNotificationDestinations } from "../../../../../atlas/cloudflare/readers/notificationDestination.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

function destinationsFetch({
  webhooks = [],
  pagerduty = [],
}: {
  webhooks?: readonly unknown[];
  pagerduty?: readonly unknown[];
}): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    if (url.pathname.endsWith("/webhooks")) {
      return jsonResponse({ body: { result: webhooks, success: true }, status: 200 });
    }
    return jsonResponse({ body: { result: pagerduty, success: true }, status: 200 });
  };
}

describe("readCloudflareNotificationDestinations", () => {
  it("combines webhooks and pagerduty destinations into one list", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: destinationsFetch({
        pagerduty: [{ id: "pd-1", name: "On-call" }],
        webhooks: [{ id: "hook-1", name: "Slack" }],
      }),
      maxRetries: 0,
    });
    const entities = unwrap(await readCloudflareNotificationDestinations({ accountId: ACCOUNT_ID, at: AT, client }));
    expect(entities.map((entity) => entity.providerId).toSorted()).toEqual(["pagerduty:pd-1", "webhook:hook-1"]);
  });

  it("skips a destination whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: destinationsFetch({ pagerduty: [{ name: "On-call" }], webhooks: [{ name: "Slack" }] }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareNotificationDestinations({ accountId: ACCOUNT_ID, at: AT, client }))).toEqual([]);
  });

  it("fails the whole read when the webhooks list fails", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/webhooks")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return destinationsFetch({})(input);
      },
      maxRetries: 0,
    });
    const result = await readCloudflareNotificationDestinations({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });

  it("fails the whole read when the pagerduty list fails", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/pagerduty")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return destinationsFetch({})(input);
      },
      maxRetries: 0,
    });
    const result = await readCloudflareNotificationDestinations({ accountId: ACCOUNT_ID, at: AT, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});
