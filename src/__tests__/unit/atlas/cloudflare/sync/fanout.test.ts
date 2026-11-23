import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { cloudflareAtlasPaths, readCloudflareKindFile } from "../../../../../atlas/cloudflare/store.js";
import { syncCloudflareAtlas } from "../../../../../atlas/cloudflare/sync.js";
import { unwrap } from "../../../../../lib/result.js";
import { AT, FLAT_KINDS, LATER, noopProgress, outcomeFor, SELECTION, WIRE_DEPLOYMENT } from "./fixtures.js";
import { allKindsFetch, freshHome, removeFixtureHomes } from "./harness.js";
import {
  filterListItemsListId,
  jsonResponse,
  pagesDeploymentsProjectName,
  pagesDomainsProjectName,
  perAppPolicyApplicationId,
  requestUrl,
  workerScriptSubresourceName,
} from "./httpResponses.js";

describe("syncCloudflareAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(removeFixtureHomes);

  it("keeps an unattached reusable policy in the atlas", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ reusablePolicies: [{ id: "pol-1", decision: "allow", reusable: true }] }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    expect(outcomeFor({ kind: "access-policy", kinds: report.kinds })).toEqual({
      complete: true,
      entityCount: 1,
      kind: "access-policy",
      reasons: [],
    });

    const paths = cloudflareAtlasPaths({ home });
    const policyFile = unwrap(readCloudflareKindFile({ kind: "access-policy", paths }));
    expect(policyFile?.entities.map((entity) => entity.providerId)).toEqual(["pol-1"]);
  });

  it("re-syncing the same access-policy fan-out is idempotent — no duplicate entities", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        applications: [{ id: "app-1", name: "App" }],
        policiesByApplication: { "app-1": [{ id: "pol-1", decision: "allow", precedence: 1 }] },
      }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const policyFile = unwrap(readCloudflareKindFile({ kind: "access-policy", paths }));
    expect(policyFile?.entities).toHaveLength(1);
  });

  it("a failed per-application policy read reports an incomplete access-policy outcome without failing any other kind", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (perAppPolicyApplicationId({ pathname: url.pathname }) !== null) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({ applications: [{ id: "app-1", name: "App" }] })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const policyOutcome = outcomeFor({ kind: "access-policy", kinds: report.kinds });
    expect(policyOutcome?.complete).toBe(false);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const policyFile = unwrap(readCloudflareKindFile({ kind: "access-policy", paths }));
    expect(policyFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("re-syncing the same gateway lists and filter lists is idempotent — no duplicate entities", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        filterLists: [{ id: "filter-1", kind: "ip", name: "blocklist", num_items: 1, num_referencing_filters: 0 }],
        filterListItemsByList: { "filter-1": [{ id: "item-1", ip: "10.0.0.1" }] },
        gatewayLists: [{ count: 1, id: "gw-1", name: "IPs" }],
        gatewayListItemsByList: { "gw-1": [{ value: "10.0.0.1" }] },
      }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    expect(unwrap(readCloudflareKindFile({ kind: "gateway-list", paths }))?.entities).toHaveLength(1);
    expect(unwrap(readCloudflareKindFile({ kind: "account-filter-list", paths }))?.entities).toHaveLength(1);
  });

  it("a gateway list whose item count falls short of its declared count opens a pagination-incomplete gap", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        gatewayLists: [{ count: 5, id: "gw-1", name: "IPs" }],
        gatewayListItemsByList: { "gw-1": [{ value: "10.0.0.1" }] },
      }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    expect(outcomeFor({ kind: "gateway-list", kinds: report.kinds })?.complete).toBe(false);

    const paths = cloudflareAtlasPaths({ home });
    const gatewayListFile = unwrap(readCloudflareKindFile({ kind: "gateway-list", paths }));
    expect(
      gatewayListFile?.gaps.some((gap) => gap.status === "open" && gap.condition === "pagination-incomplete"),
    ).toBe(true);
    expect(gatewayListFile?.entities[0]?.detail).toMatchObject({ items: [{ description: null, value: "10.0.0.1" }] });
  });

  it("a failed filter-list item read preserves that list's own items without failing any other kind", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (filterListItemsListId({ pathname: url.pathname }) !== null) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({
          filterLists: [{ id: "filter-1", kind: "ip", name: "blocklist", num_items: 1, num_referencing_filters: 0 }],
        })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const filterListOutcome = outcomeFor({ kind: "account-filter-list", kinds: report.kinds });
    expect(filterListOutcome?.complete).toBe(false);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const filterListFile = unwrap(readCloudflareKindFile({ kind: "account-filter-list", paths }));
    expect(filterListFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("re-syncing the same Pages project is idempotent — no duplicate entities", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        pagesDeploymentsByProject: { "my-site": [{ environment: "production", id: "dep-1" }] },
        pagesDomainsByProject: { "my-site": [{ name: "my-site.example.test", status: "active" }] },
        pagesProjects: [
          { domains: ["my-site.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
        ],
      }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const pagesFile = unwrap(readCloudflareKindFile({ kind: "pages-project", paths }));
    expect(pagesFile?.entities).toHaveLength(1);
  });

  it("a Pages project whose domain count falls short of its declared domains opens a pagination-incomplete gap", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        pagesDomainsByProject: { "my-site": [] },
        pagesProjects: [
          { domains: ["my-site.example.test"], id: "proj-1", name: "my-site", production_branch: "main" },
        ],
      }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    expect(outcomeFor({ kind: "pages-project", kinds: report.kinds })?.complete).toBe(false);

    const paths = cloudflareAtlasPaths({ home });
    const pagesFile = unwrap(readCloudflareKindFile({ kind: "pages-project", paths }));
    expect(pagesFile?.gaps.some((gap) => gap.status === "open" && gap.condition === "pagination-incomplete")).toBe(
      true,
    );
  });

  it("a failed Pages project children read preserves that project's own deployments/domains without failing any other kind", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (
          pagesDeploymentsProjectName({ pathname: url.pathname }) !== null ||
          pagesDomainsProjectName({ pathname: url.pathname }) !== null
        ) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({
          pagesProjects: [{ id: "proj-1", name: "my-site", production_branch: "main" }],
        })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const pagesOutcome = outcomeFor({ kind: "pages-project", kinds: report.kinds });
    expect(pagesOutcome?.complete).toBe(false);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const pagesFile = unwrap(readCloudflareKindFile({ kind: "pages-project", paths }));
    expect(pagesFile?.entities).toHaveLength(1);
    expect(pagesFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });

  it("re-syncing the same Worker script is idempotent — no duplicate entities", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        workerScripts: [{ id: "my-worker" }],
        workerScriptsByName: { "my-worker": { deployments: [WIRE_DEPLOYMENT] } },
      }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const scriptFile = unwrap(readCloudflareKindFile({ kind: "worker-script", paths }));
    expect(scriptFile?.entities).toHaveLength(1);
  });

  it("a failed Worker script bundle read preserves that script's own state without failing any other kind", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (workerScriptSubresourceName({ pathname: url.pathname, segment: "secrets" }) !== null) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({ workerScripts: [{ id: "my-worker" }] })(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    const scriptOutcome = outcomeFor({ kind: "worker-script", kinds: report.kinds });
    expect(scriptOutcome?.complete).toBe(false);
    for (const kind of FLAT_KINDS) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const scriptFile = unwrap(readCloudflareKindFile({ kind: "worker-script", paths }));
    expect(scriptFile?.entities).toHaveLength(1);
    expect(scriptFile?.gaps.some((gap) => gap.status === "open")).toBe(true);
  });
});
