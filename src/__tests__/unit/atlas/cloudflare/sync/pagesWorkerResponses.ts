/**
 * The Pages and Workers routers of the `syncCloudflareAtlas` all-kinds `fetch` stub: the per-project Pages
 * children, the Worker account endpoints, and one Worker script's combined bundle.
 */

import type { FetchRouter, WorkerScriptBundleFixture } from "./harnessTypes.js";
import {
  jsonResponse,
  listPage,
  pagesDeploymentsProjectName,
  pagesDomainsProjectName,
  workerScriptSubresourceName,
} from "./httpResponses.js";

/**
 * Route one of the three Pages endpoints (per-project deployments, per-project domains, or the project
 * inventory).
 *
 * @returns the matching fixture response, or `null` if this pathname is not a Pages endpoint
 */
export const pagesFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { pagesProjects, pagesDeploymentsByProject, pagesDomainsByProject },
    request: { pathname, page },
  } = options;
  const deploymentsProjectName = pagesDeploymentsProjectName({ pathname });
  if (deploymentsProjectName !== null) {
    const items = pagesDeploymentsByProject[deploymentsProjectName];
    // A project the case declared no deployments for answers an empty page.
    if (items == null) {
      return jsonResponse({ body: listPage({ items: [], page }), status: 200 });
    }
    return jsonResponse({ body: listPage({ items, page }), status: 200 });
  }
  const domainsProjectName = pagesDomainsProjectName({ pathname });
  if (domainsProjectName !== null) {
    const result = pagesDomainsByProject[domainsProjectName];
    // A project the case declared no domains for answers an empty list.
    if (result == null) {
      return jsonResponse({ body: { result: [], success: true }, status: 200 });
    }
    return jsonResponse({ body: { result, success: true }, status: 200 });
  }
  if (pathname.includes("/pages/projects")) {
    return jsonResponse({ body: listPage({ items: pagesProjects, page }), status: 200 });
  }
  return null;
};

/** One fixed-shape bundle sub-resource response, given the fixture already resolved for its script. */
const WORKER_SCRIPT_SEGMENT_BODY: Record<string, (fixture: WorkerScriptBundleFixture) => unknown> = {
  // A bundle that names none of these answers an empty list for it.
  deployments: ({ deployments }) => {
    if (deployments == null) {
      return { deployments: [] };
    }
    return { deployments };
  },
  schedules: ({ schedules }) => {
    if (schedules == null) {
      return { schedules: [] };
    }
    return { schedules };
  },
  "script-settings": () => ({}),
  secrets: ({ secrets }) => {
    if (secrets == null) {
      return [];
    }
    return secrets;
  },
  settings: ({ bindings }) => {
    if (bindings == null) {
      return { bindings: [] };
    }
    return { bindings };
  },
  subdomain: () => ({ enabled: false, previews_enabled: false }),
};

/** The bundle a case described for one script — an empty one when it described none. */
function scriptBundleFixture({
  scriptName,
  workerScriptsByName,
}: {
  scriptName: string;
  workerScriptsByName: Record<string, WorkerScriptBundleFixture>;
}): WorkerScriptBundleFixture {
  const fixture = workerScriptsByName[scriptName];
  if (fixture === undefined) {
    return {};
  }
  return fixture;
}

/**
 * The response envelope for one single-shot sub-resource. Deployments are paged; every fixture fits one page,
 * so the one page declares itself the whole list.
 */
function singleShotEnvelope({
  segment,
  fixture,
  result,
}: {
  segment: string;
  fixture: WorkerScriptBundleFixture;
  result: unknown;
}): unknown {
  if (segment !== "deployments") {
    return { result, success: true };
  }
  const total = fixture.deployments === undefined ? 0 : fixture.deployments.length;
  const resultInfo = { count: total, page: 1, per_page: 100, total_count: total, total_pages: total > 0 ? 1 : 0 };
  return { result, result_info: resultInfo, success: true };
}

/**
 * Route one of the six single-shot bundle sub-resources (every one but the cursor-paginated versions list
 * and the plain-text content read, each handled separately by {@link workerScriptBundleFetchResponse}).
 */
const workerScriptSingleShotResponse: FetchRouter = ({ fixture: { workerScriptsByName }, request: { pathname } }) => {
  for (const [segment, buildBody] of Object.entries(WORKER_SCRIPT_SEGMENT_BODY)) {
    const scriptName = workerScriptSubresourceName({ pathname, segment });
    if (scriptName !== null) {
      const fixture = scriptBundleFixture({ scriptName, workerScriptsByName });
      const body = singleShotEnvelope({ fixture, result: buildBody(fixture), segment });
      return jsonResponse({ body, status: 200 });
    }
  }
  return null;
};

/** One script's versions. A script the case described no bundle for, or whose bundle names no versions, has
 * none — the same empty bundle {@link workerScriptSingleShotResponse} answers for it. */
function scriptVersions({ fixture }: { fixture: WorkerScriptBundleFixture | undefined }): readonly unknown[] {
  const versions = fixture?.versions;
  if (versions === undefined) {
    return [];
  }
  return versions;
}

/** Route one script's eight combined bundle endpoints, or its own inventory-list entry. */
const workerScriptBundleFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { workerScriptsByName },
    request: { pathname, page },
  } = options;
  const singleShotResponse = workerScriptSingleShotResponse(options);
  if (singleShotResponse !== null) {
    return singleShotResponse;
  }
  const versionsScriptName = workerScriptSubresourceName({ pathname, segment: "versions" });
  if (versionsScriptName !== null) {
    const items = page === 1 ? scriptVersions({ fixture: workerScriptsByName[versionsScriptName] }) : [];
    return jsonResponse({
      body: { result: { items }, result_info: { count: items.length, page }, success: true },
      status: 200,
    });
  }
  const marker = "/workers/scripts/";
  const start = pathname.indexOf(marker);
  const rest = start === -1 ? "" : pathname.slice(start + marker.length);
  if (rest.length > 0 && !rest.includes("/")) {
    const content = workerScriptsByName[rest]?.content;
    // oxlint-disable-next-line prefer-nullish-coalescing -- house-rules bans `?? ""`; this ternary is the honest form
    return new Response(content === undefined ? "" : content, {
      headers: { "content-type": "application/javascript" },
      status: 200,
    });
  }
  return null;
};

/**
 * Route every Workers endpoint (account settings/subdomain, account-level domains, script inventory, and
 * one script's combined bundle).
 *
 * @returns the matching fixture response, or `null` if this pathname is not a Workers endpoint
 */
export const workersFetchResponse: FetchRouter = (options) => {
  const {
    fixture: { workerAccountSetting, workerDomains, workerScripts },
    request: { pathname, page },
  } = options;
  if (pathname.endsWith("/workers/account-settings")) {
    return jsonResponse({ body: { result: workerAccountSetting, success: true }, status: 200 });
  }
  if (pathname.endsWith("/workers/subdomain")) {
    return jsonResponse({ body: { result: { subdomain: "my-team" }, success: true }, status: 200 });
  }
  if (pathname.includes("/workers/domains")) {
    return jsonResponse({ body: { result: workerDomains, success: true }, status: 200 });
  }
  const bundleResponse = workerScriptBundleFetchResponse(options);
  if (bundleResponse !== null) {
    return bundleResponse;
  }
  if (pathname.endsWith("/workers/scripts")) {
    return jsonResponse({ body: listPage({ items: workerScripts, page }), status: 200 });
  }
  return null;
};
