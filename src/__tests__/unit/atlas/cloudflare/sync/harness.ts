/**
 * The `syncCloudflareAtlas` test harness: the all-kinds `fetch` stub composed from the per-family routers,
 * and the throwaway state homes the cases publish into.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requestedPage } from "../requestedPage.js";
import {
  accountStateFetchResponse,
  auditLogFetchResponse,
  flatKindFetchResponse,
  nonFlatFetchResponse,
  notificationsFetchResponse,
  rulesetFetchResponse,
} from "./accountResponses.js";
import { resolveAllKindsFixture } from "./fixtures.js";
import type { AllKindsFixture, FetchRouter } from "./harnessTypes.js";
import { jsonResponse, requestUrl } from "./httpResponses.js";
import { pagesFetchResponse, workersFetchResponse } from "./pagesWorkerResponses.js";
import { zeroTrustFetchResponse } from "./zeroTrustResponses.js";
import {
  apiGatewayFetchResponse,
  zoneAnalyticsFetchResponse,
  zoneCertificateFetchResponse,
} from "./zoneExtendedResponses.js";
import { deepZoneFetchResponse, firewallWafFetchResponse } from "./zoneResponses.js";

/**
 * Every router, in dispatch order. Order is the whole contract — every per-parent items check precedes its
 * own kind's generic inventory check, and the Zero Trust router runs FIRST (its own header names the
 * `/certificates` collision that requires).
 */
const ROUTERS: readonly FetchRouter[] = [
  zeroTrustFetchResponse,
  rulesetFetchResponse,
  flatKindFetchResponse,
  nonFlatFetchResponse,
  pagesFetchResponse,
  workersFetchResponse,
  notificationsFetchResponse,
  auditLogFetchResponse,
  accountStateFetchResponse,
  deepZoneFetchResponse,
  firewallWafFetchResponse,
  zoneCertificateFetchResponse,
  apiGatewayFetchResponse,
  zoneAnalyticsFetchResponse,
];

/**
 * A `fetch` stub covering every flat kind's endpoint plus every non-flat kind's fan-out (Access-policy,
 * Gateway List, account filter-list), defaulting to zero entities for whichever kinds a test does not care
 * about — every fixture must still terminate pagination (see `readers/zone.ts`'s own header on why a
 * fixture that never empties will pagination-loop the real SDK).
 *
 * @returns a `fetch` answering each endpoint from the collections `fixture` names
 */
export function allKindsFetch(fixture: AllKindsFixture): typeof globalThis.fetch {
  const resolved = resolveAllKindsFixture({ fixture });
  return async (input, init) => {
    const url = requestUrl({ input });
    const request = { init, page: requestedPage({ url }), pathname: url.pathname };
    for (const route of ROUTERS) {
      const response = route({ fixture: resolved, request });
      if (response !== null) {
        return response;
      }
    }
    return jsonResponse({
      body: { errors: [{ message: `unexpected path ${request.pathname}` }], success: false },
      status: 500,
    });
  };
}

const createdHomes: string[] = [];

/**
 * A fresh throwaway state home for one case, removed by {@link removeFixtureHomes}.
 *
 * @returns the new directory's path
 */
export function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-sync-"));
  createdHomes.push(dir);
  return dir;
}

/**
 * Remove every home {@link freshHome} made since the last call. Every home is attempted even when one
 * removal fails; a home that could not be removed stays registered, and the first failure is rethrown
 * once all have been tried.
 */
export function removeFixtureHomes(): void {
  const failed: string[] = [];
  const errors: unknown[] = [];
  for (const dir of createdHomes.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch (error) {
      failed.push(dir);
      errors.push(error);
    }
  }
  createdHomes.push(...failed);
  if (errors.length > 0) {
    throw errors[0];
  }
}
