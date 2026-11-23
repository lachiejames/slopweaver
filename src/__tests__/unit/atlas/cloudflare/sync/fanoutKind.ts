/*
 * What the sync tests of an account-scoped fan-out kind share, whichever kind it is: the real Cloudflare client
 * over a routing fetch keyed by `<path>@<page>`, and the stored kind file a run folds into. A suite keeps its own
 * route shapes and answers them through `respond`, and passes its own kind, scope and instant in. A plain module,
 * not a `*.test.ts`, so no test registers twice.
 */
import type Cloudflare from "cloudflare";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  CLOUDFLARE_VISIBILITY_SCOPE,
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKind,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../../atlas/cloudflare/model.js";
import { requestedPage } from "../requestedPage.js";
import { jsonResponse, requestUrl } from "./httpResponses.js";

/** A routed refusal: the read answers the `denied` error envelope at this `status`, whichever kind is being read. */
export type RefusedRoute = { readonly status: number };

function isRefusedRoute(route: object): route is RefusedRoute {
  return "status" in route;
}

/**
 * The success envelope a plain routed read answers with.
 *
 * @returns a 200 JSON response carrying `result`
 */
export function resultResponse({ result }: { result: unknown }): Response {
  return jsonResponse({ body: { result, success: true }, status: 200 });
}

/**
 * A real client over a routing fetch. Routes are keyed `<path>@<page>` (page 1 when the SDK names none); an
 * unrouted key answers 404 naming it, a {@link RefusedRoute} answers a refusal at its status, and every other
 * route is answered by `respond`. Every request key is recorded in arrival order.
 *
 * @param respond the suite's answer to one routed, unrefused route, {@link resultResponse} for a plain one
 * @returns the client, and the request keys it was asked for in arrival order
 */
export function routedKeyClient<AnsweredRoute extends object>({
  routes,
  respond,
}: {
  routes: Readonly<Record<string, RefusedRoute | AnsweredRoute>>;
  respond: (args: { route: AnsweredRoute }) => Response;
}): { client: Cloudflare; requests: string[] } {
  const requests: string[] = [];
  const client = createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const key = `${url.pathname}@${String(requestedPage({ url }))}`;
      requests.push(key);
      const route = routes[key];
      if (route === undefined) {
        return jsonResponse({ body: { errors: [{ message: `unrouted ${key}` }], success: false }, status: 404 });
      }
      if (isRefusedRoute(route)) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: route.status });
      }
      return respond({ route });
    },
    maxRetries: 0,
  });
  return { client, requests };
}

/**
 * A stored kind file holding the given entities and gaps, plus the kind's earlier synced coverage cell.
 *
 * @param scope the coverage cell's scope, the kind's own account scope
 * @param updatedAt the instant the file and its coverage cell were last written
 * @returns the kind file a run folds into
 */
export function storedKindFile({
  entities,
  gaps,
  kind,
  scope,
  updatedAt,
}: {
  entities: readonly CloudflareEntity[];
  gaps: readonly CloudflareGap[];
  kind: CloudflareKind;
  scope: string;
  updatedAt: string;
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind, updatedAt }),
    coverage: [
      {
        lastSuccessAt: updatedAt,
        latestAttemptFailed: false,
        reason: "reconciled earlier",
        scope,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ],
    entities: [...entities],
    gaps: [...gaps],
  };
}
