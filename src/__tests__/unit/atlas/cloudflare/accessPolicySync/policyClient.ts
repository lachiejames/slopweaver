/*
 * The real Cloudflare client every `syncAccessPolicyKind` test file drives, over a fake fetch serving the
 * application inventory, the account-level reusable list and one policy list per application. A plain module,
 * not a `*.test.ts`, so no test registers twice. It was split out when the Access policy sync suite became one
 * file per behaviour.
 */
import type Cloudflare from "cloudflare";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { requestedPage } from "../requestedPage.js";
import { APPS_PATH, appPoliciesPath, REUSABLE_PATH } from "./harness.js";

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function deniedResponse(): Response {
  return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
}

/** The requested URL, however the SDK passed it. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/**
 * A page-number paginated envelope: the SDK's `V4PagePaginationArray` asks for the next `page` until one comes
 * back empty, so page 1 carries the items and every later page is empty. A fake that always returned the items
 * would never terminate.
 */
function pagedResponse({ url, items }: { url: URL; items: readonly unknown[] }): Response {
  const page = requestedPage({ url });
  const result = page === 1 ? items : [];
  return jsonResponse({ body: { result, result_info: { count: result.length, page }, success: true }, status: 200 });
}

/**
 * A client serving the application inventory, the account-level reusable list, and one policy list per
 * application. `failApps` refuses the inventory, `failReusable` the reusable list, and each application named in
 * `failAppPolicies` refuses its own policy list. Every path requested is pushed onto `requests`, and any other
 * path is a 500 so a module wiring the wrong endpoint fails loudly.
 *
 * @returns a real Cloudflare client over that fake fetch
 */
export function policyClient({
  applications,
  reusable,
  policiesByApp,
  requests,
  failApps = false,
  failReusable = false,
  failAppPolicies = [],
}: {
  applications: readonly string[];
  reusable: readonly unknown[];
  policiesByApp: Record<string, readonly unknown[]>;
  requests: string[];
  failApps?: boolean;
  failReusable?: boolean;
  failAppPolicies?: readonly string[];
}): Cloudflare {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      // Each endpoint is asked once per page; recording only page 1 keeps `requests` one entry per read.
      if (url.searchParams.get("page") === null || url.searchParams.get("page") === "1") {
        requests.push(url.pathname);
      }
      if (url.pathname === APPS_PATH) {
        if (failApps) {
          return deniedResponse();
        }
        return pagedResponse({ items: applications.map((id) => ({ id, name: id })), url });
      }
      if (url.pathname === REUSABLE_PATH) {
        if (failReusable) {
          return deniedResponse();
        }
        return pagedResponse({ items: reusable, url });
      }
      const applicationId = Object.keys(policiesByApp).find(
        (candidate) => url.pathname === appPoliciesPath({ applicationId: candidate }),
      );
      if (applicationId === undefined) {
        return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
      }
      if (failAppPolicies.includes(applicationId)) {
        return deniedResponse();
      }
      const policies = policiesByApp[applicationId];
      if (policies === undefined) {
        // An application the test gave no policies to holds none.
        return pagedResponse({ items: [], url });
      }
      return pagedResponse({ items: policies, url });
    },
    maxRetries: 0,
  });
}
