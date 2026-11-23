import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflarePagesProjectChildren,
  readCloudflarePagesProjectInventory,
} from "../../../../../atlas/cloudflare/readers/pages.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The requested URL, however the SDK passed it — never `String(input)`, which would stringify a `Request`
 * via its default `Object` conversion rather than its actual URL. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/** A `fetch` stub matching one pathname substring, returning `items` on the first page and an EMPTY,
 * pagination-terminating page thereafter. A page that keeps returning the same non-empty `result` with no
 * `total_pages` drives the SDK's auto-paginating `for await` iterator into an infinite loop — the incident
 * this fixture once caused, exhausting a worker's heap before any test could complete. */
function singlePagePathFetch({ match, items }: { match: string; items: readonly unknown[] }): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    if (!url.pathname.includes(match)) {
      return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
    }
    const page = requestedPage({ url });
    const result = page === 1 ? items : [];
    return jsonResponse({ body: { result, result_info: { page, total_pages: 1 }, success: true }, status: 200 });
  };
}

describe("readCloudflarePagesProjectInventory", () => {
  it("reads every project's metadata", async () => {
    let calls = 0;
    const singlePage = singlePagePathFetch({
      items: [{ id: "proj-1", name: "my-site", production_branch: "main" }],
      match: "/pages/projects",
    });
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        calls += 1;
        return singlePage(input);
      },
      maxRetries: 0,
    });
    const projects = unwrap(await readCloudflarePagesProjectInventory({ accountId: ACCOUNT_ID, client }));
    expect(projects.map((project) => project.id)).toEqual(["proj-1"]);
    // Exactly page 1 (data) then page 2 (empty, terminating) — a fixture that stops signalling
    // termination would make this exceed 2, not stay at it.
    expect(calls).toBe(2);
  });

  it("skips a project whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: singlePagePathFetch({ items: [{ name: "No id" }], match: "/pages/projects" }),
      maxRetries: 0,
    });
    const projects = unwrap(await readCloudflarePagesProjectInventory({ accountId: ACCOUNT_ID, client }));
    expect(projects).toEqual([]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflarePagesProjectInventory({ accountId: ACCOUNT_ID, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflarePagesProjectChildren", () => {
  it("reads one project's deployments and domains, tagged by which collection they came from", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/pages/projects/my-site/deployments")) {
          const page = requestedPage({ url });
          const result = page === 1 ? [{ id: "dep-1" }] : [];
          return jsonResponse({ body: { result, result_info: { page, total_pages: 1 }, success: true }, status: 200 });
        }
        if (url.pathname.endsWith("/pages/projects/my-site/domains")) {
          return jsonResponse({ body: { result: [{ name: "my-site.example.test" }], success: true }, status: 200 });
        }
        return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
      },
      maxRetries: 0,
    });
    const items = unwrap(
      await readCloudflarePagesProjectChildren({ accountId: ACCOUNT_ID, client, projectName: "my-site" }),
    );
    expect(items).toEqual([
      { deployment: { id: "dep-1" }, itemKind: "deployment" },
      { domain: { name: "my-site.example.test" }, itemKind: "domain" },
    ]);
  });

  it("maps a not-found error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "gone" }], success: false }, status: 404 }),
      maxRetries: 0,
    });
    const result = await readCloudflarePagesProjectChildren({ accountId: ACCOUNT_ID, client, projectName: "my-site" });
    expect(unwrapErr(result).kind).toBe("not-found");
  });
});
