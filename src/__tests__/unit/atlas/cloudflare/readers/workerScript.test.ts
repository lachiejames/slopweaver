import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareWorkerScriptBundle,
  readCloudflareWorkerScriptInventory,
} from "../../../../../atlas/cloudflare/readers/workerScript.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { requestedPage } from "../requestedPage.js";

const ACCOUNT_ID = "a".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** One deployment carrying every field the SDK declares required, as the live wire sends it. */
function wireDeployment({ id, ...over }: { id: string; readonly [key: string]: unknown }): Record<string, unknown> {
  return {
    created_on: "2026-06-30T06:22:13.249692Z",
    id,
    source: "terraform",
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: `ver-${id}` }],
    ...over,
  };
}

/** One full page of deployments, `dep-<from>` onward. */
function hundredDeployments({ from }: { from: number }): Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, index) => wireDeployment({ id: `dep-${String(from + index)}` }));
}

/**
 * One page of a deployments answer, the way the live endpoint pages it: the requested `page` of `per_page`
 * deployments under `result.deployments`, with the whole list's `total_count` and `total_pages` declared.
 */
function deploymentPageResponse({ deployments, url }: { deployments: readonly unknown[]; url: URL }): Response {
  const page = requestedPage({ url });
  const perPage = Number(url.searchParams.get("per_page"));
  const pageDeployments = deployments.slice((page - 1) * perPage, page * perPage);
  return jsonResponse({
    body: {
      result: { deployments: pageDeployments },
      result_info: {
        count: pageDeployments.length,
        page,
        per_page: perPage,
        total_count: deployments.length,
        total_pages: Math.ceil(deployments.length / perPage),
      },
      success: true,
    },
    status: 200,
  });
}

function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/** A `fetch` stub covering every endpoint one script's combined bundle read touches. Route checks that match
 * a longer, more specific pathname MUST run before the bare `/workers/scripts/{name}` content fallback,
 * since every other endpoint's path is that one plus a trailing segment. */
function scriptBundleFetch({
  settingsBody = {},
  bindings = [],
  content = "",
  deployments = [],
  schedules = [],
  secrets = [],
  versions = [],
  subdomain = { enabled: false, previews_enabled: false },
}: {
  settingsBody?: unknown;
  bindings?: readonly unknown[];
  content?: string;
  deployments?: readonly unknown[];
  schedules?: readonly unknown[];
  secrets?: readonly unknown[];
  versions?: readonly unknown[];
  subdomain?: { enabled: boolean; previews_enabled: boolean };
}): typeof globalThis.fetch {
  return async (input) => {
    const url = requestUrl({ input });
    // `settings.get()` (the plain ScriptSetting read) hits `/script-settings`; `scriptAndVersionSettings.get()`
    // (the one carrying `bindings`) hits the shorter `/settings` — check the longer, more specific path first.
    if (url.pathname.endsWith("/script-settings")) {
      return jsonResponse({ body: { result: settingsBody, success: true }, status: 200 });
    }
    if (url.pathname.endsWith("/settings")) {
      return jsonResponse({ body: { result: { bindings }, success: true }, status: 200 });
    }
    if (url.pathname.endsWith("/deployments")) {
      return deploymentPageResponse({ deployments, url });
    }
    if (url.pathname.endsWith("/schedules")) {
      return jsonResponse({ body: { result: { schedules }, success: true }, status: 200 });
    }
    if (url.pathname.endsWith("/subdomain")) {
      return jsonResponse({ body: { result: subdomain, success: true }, status: 200 });
    }
    if (url.pathname.endsWith("/versions")) {
      // V4PagePagination (unlike the V4PagePaginationArray every other cursor-style reader here uses) reads
      // paginated items from `result.items`, not a bare array under `result` itself.
      const page = requestedPage({ url });
      const items = page === 1 ? versions : [];
      return jsonResponse({
        body: { result: { items }, result_info: { count: items.length, page }, success: true },
        status: 200,
      });
    }
    if (url.pathname.endsWith("/secrets")) {
      return jsonResponse({ body: { result: secrets, success: true }, status: 200 });
    }
    // The plain script-content read sends `Accept: application/javascript` and gets back the script's raw
    // text directly — never the standard `{result, success}` JSON envelope every other endpoint here uses.
    return new Response(content, { headers: { "content-type": "application/javascript" }, status: 200 });
  };
}

describe("readCloudflareWorkerScriptInventory", () => {
  it("reads every script's metadata", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { result: [{ id: "my-worker" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    const scripts = unwrap(await readCloudflareWorkerScriptInventory({ accountId: ACCOUNT_ID, client }));
    expect(scripts.map((script) => script.id)).toEqual(["my-worker"]);
  });

  it("skips a script whose response omits an id", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { result: [{ usage_model: "standard" }], success: true }, status: 200 }),
      maxRetries: 0,
    });
    expect(unwrap(await readCloudflareWorkerScriptInventory({ accountId: ACCOUNT_ID, client }))).toEqual([]);
  });

  it("maps a permission error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareWorkerScriptInventory({ accountId: ACCOUNT_ID, client });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareWorkerScriptBundle", () => {
  it("combines all eight reads into one bundle", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: scriptBundleFetch({
        bindings: [{ name: "API_KEY", type: "secret_text" }],
        content: "export default { fetch() {} }",
        deployments: [wireDeployment({ id: "dep-1" })],
        schedules: [{ cron: "0 0 * * *" }],
        secrets: [{ name: "API_KEY", type: "secret_text" }],
        versions: [{ id: "ver-1" }],
      }),
      maxRetries: 0,
    });
    const bundles = unwrap(
      await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" }),
    );
    expect(bundles).toHaveLength(1);
    const bundle = bundles[0]!;
    expect(bundle.content).toBe("export default { fetch() {} }");
    expect(bundle.bindings).toEqual([{ name: "API_KEY", type: "secret_text" }]);
    expect(bundle.deployments.map((deployment) => deployment.id)).toEqual(["dep-1"]);
    expect(bundle.schedules).toEqual([{ cron: "0 0 * * *" }]);
    expect(bundle.secrets).toEqual([{ name: "API_KEY", type: "secret_text" }]);
    expect(bundle.versions.map((version) => version.id)).toEqual(["ver-1"]);
    expect(bundle.subdomainEnabled).toBe(false);
    expect(bundle.subdomainPreviewsEnabled).toBe(false);
  });

  it("reads a version whose settings response omits bindings as declaring none", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/settings") && !url.pathname.endsWith("/script-settings")) {
          return jsonResponse({ body: { result: {}, success: true }, status: 200 });
        }
        return scriptBundleFetch({})(input);
      },
      maxRetries: 0,
    });
    const bundles = unwrap(
      await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" }),
    );
    expect(bundles[0]!.bindings).toEqual([]);
  });

  it("reads deployments from result.deployments, not the result.items the 7.2.0 SDK's pager would read", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: scriptBundleFetch({
        deployments: [
          wireDeployment({ annotations: { "workers/triggered_by": "upload" }, id: "dep-1" }),
          wireDeployment({ author_email: "dev@example.test", id: "dep-2" }),
        ],
      }),
      maxRetries: 0,
    });
    const bundles = unwrap(
      await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" }),
    );
    expect(bundles[0]!.deployments.map((deployment) => deployment.id)).toEqual(["dep-1", "dep-2"]);
  });

  it("pages every deployment past the newest page, 100 at a time", async () => {
    const deployments = Array.from({ length: 150 }, (_, index) => wireDeployment({ id: `dep-${String(index)}` }));
    const deploymentPages: number[] = [];
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/deployments")) {
          deploymentPages.push(requestedPage({ url }));
        }
        return scriptBundleFetch({ deployments })(input);
      },
      maxRetries: 0,
    });
    const bundles = unwrap(
      await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" }),
    );
    expect(bundles[0]!.deployments.map((deployment) => deployment.id)).toEqual(
      deployments.map((deployment) => deployment["id"]),
    );
    expect(deploymentPages).toEqual([1, 2]);
  });

  it.each([
    {
      body: () => ({
        result: { deployments: hundredDeployments({ from: 0 }) },
        result_info: { total_count: 150, total_pages: 2 },
        success: true,
      }),
      cause: "page 2 repeats deployment dep-0, so the pages shifted mid-read",
      why: "a wire that ignores page and repeats itself",
    },
    {
      body: () => ({
        result: { deployments: [wireDeployment({ id: "dep-1" })] },
        result_info: { total_count: 1, total_pages: 1_000_000_000 },
        success: true,
      }),
      cause: "result_info declares 1000000000 pages for 1 deployments at 100 a page",
      why: "a wire declaring a billion pages for one deployment",
    },
    {
      body: ({ page }: { page: number }) => ({
        result: { deployments: page === 1 ? [] : [wireDeployment({ id: "dep-1" })] },
        result_info: { total_count: 0, total_pages: 2 },
        success: true,
      }),
      cause: "result_info declares 2 pages for 0 deployments at 100 a page",
      why: "an empty first page declaring a second page its zero total cannot fill",
    },
    {
      body: () => ({
        result: { deployments: [wireDeployment({ id: "dep-1" })] },
        result_info: { total_count: 1, total_pages: 0 },
        success: true,
      }),
      cause: "result_info declares 0 pages for 1 deployments at 100 a page",
      why: "a non-empty page declaring zero pages",
    },
    {
      body: ({ page }: { page: number }) => ({
        result: { deployments: page === 1 ? hundredDeployments({ from: 0 }) : [] },
        result_info: { total_count: 150, total_pages: 2 },
        success: true,
      }),
      cause: "read 100 of the 150 deployments the endpoint declares",
      why: "a page that comes back empty before the declared total",
    },
    {
      body: ({ page }: { page: number }) => ({
        result: { deployments: page === 1 ? hundredDeployments({ from: 0 }) : [] },
        result_info: { total_count: page === 1 ? 150 : 149, total_pages: 2 },
        success: true,
      }),
      cause: "page 2 declares 149 deployments over 2 pages, page 1 declared 150 over 2",
      why: "a declared total that shrinks mid-read",
    },
    {
      body: ({ page }: { page: number }) => ({
        result: { deployments: hundredDeployments({ from: page === 1 ? 0 : 99 }).slice(0, page === 1 ? 100 : 51) },
        result_info: { total_count: 150, total_pages: 2 },
        success: true,
      }),
      cause: "page 2 repeats deployment dep-99, so the pages shifted mid-read",
      why: "a later page repeating a deployment while the total holds",
    },
    {
      body: () => ({
        result: { deployments: [wireDeployment({ id: "dep-a" }), wireDeployment({ id: "dep-a" })] },
        result_info: { total_count: 2, total_pages: 1 },
        success: true,
      }),
      cause: "page 1 repeats deployment dep-a, so the pages shifted mid-read or a page doubled an entry",
      why: "one page doubling a deployment in place of another",
    },
    {
      body: () => ({ result: { deployments: [wireDeployment({ id: "dep-1" })] }, success: true }),
      cause: "expected result_info to declare a numeric total_count and total_pages",
      why: "a page declaring no paging",
    },
  ])("refuses $why as a schema error rather than storing a short or doubled history", async ({ body, cause }) => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/deployments")) {
          return jsonResponse({ body: body({ page: requestedPage({ url }) }), status: 200 });
        }
        return scriptBundleFetch({})(input);
      },
      maxRetries: 0,
    });
    const error = unwrapErr(
      await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" }),
    );
    expect(error.kind).toBe("schema");
    expect(error.operation).toBe("workers-script-deployments-list");
    expect(error.message).toContain(cause);
  });

  it.each([
    {
      cause: "expected result.deployments to be an array, got result keys: items",
      result: { items: [{ deployments: [wireDeployment({ id: "dep-1" })] }] },
      why: "a pager-shaped result.items wire",
    },
    {
      cause: "deployment 1 lacks a string id",
      result: { deployments: [wireDeployment({ id: "dep-1" }), { source: "api" }] },
      why: "a deployment with no id",
    },
    {
      cause: "deployment 0 lacks a string id or carries a malformed field",
      result: { deployments: [wireDeployment({ id: "dep-1", versions: [{ percentage: "100" }] })] },
      why: "a malformed version",
    },
    {
      cause: "deployment 0 lacks a string id or carries a malformed field",
      result: { deployments: [{ id: "dep-1" }] },
      why: "a deployment missing the fields the SDK declares required",
    },
    {
      cause: "deployment 0 lacks a string id or carries a malformed field",
      result: { deployments: [wireDeployment({ id: "dep-1", strategy: "bogus" })] },
      why: "a strategy the SDK has not declared",
    },
  ])("refuses $why as a schema error rather than reading zero deployments", async ({ result, cause }) => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/deployments")) {
          return jsonResponse({ body: { result, success: true }, status: 200 });
        }
        return scriptBundleFetch({})(input);
      },
      maxRetries: 0,
    });
    const error = unwrapErr(
      await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" }),
    );
    expect(error.kind).toBe("schema");
    expect(error.operation).toBe("workers-script-deployments-list");
    expect(error.message).toContain(cause);
  });

  it("fails the whole bundle when any one of the eight reads fails", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/secrets")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return scriptBundleFetch({})(input);
      },
      maxRetries: 0,
    });
    const result = await readCloudflareWorkerScriptBundle({ accountId: ACCOUNT_ID, client, scriptName: "my-worker" });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});
