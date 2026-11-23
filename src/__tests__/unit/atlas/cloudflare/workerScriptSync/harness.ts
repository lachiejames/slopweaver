/*
 * The fixtures more than one `syncWorkerScriptKind` test file reads: the account and instants a run is stamped
 * at, a real client over a routing fetch, the routes a script's bundle read answers from, the stored kind file a
 * run folds into, two inventory rows and a raw bundle, and the entity shape a run is expected to publish. The
 * client and the stored file are the ones fan-out kinds share, in `../sync/fanoutKind.ts`. A plain module, not a
 * `*.test.ts`, so no test registers twice. It was split out when the Worker script sync suite became one file per
 * behaviour.
 */
import type Cloudflare from "cloudflare";

import { openCloudflareGap } from "../../../../../atlas/cloudflare/gaps.js";
import { cloudflareEntityId } from "../../../../../atlas/cloudflare/identity.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "../../../../../atlas/cloudflare/model.js";
import {
  type CloudflareRawWorkerScript,
  type CloudflareRawWorkerScriptBundle,
  normalizeCloudflareWorkerScriptBundle,
  projectCloudflareWorkerScript,
} from "../../../../../atlas/cloudflare/projection/workerScript.js";
import { type RefusedRoute, resultResponse, routedKeyClient, storedKindFile } from "../sync/fanoutKind.js";
import { jsonResponse } from "../sync/httpResponses.js";

export const AT = "2026-02-01T00:00:00.000Z";
export const OLD = "2026-01-01T00:00:00.000Z";
export const ACCOUNT_ID: string = "a".repeat(32);
export const KIND_SCOPE: string = `account/${ACCOUNT_ID}/worker-script`;
export const SCRIPTS: string = `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`;

/** The remedy text every permission-only boundary carries (`kindFold.ts`'s `CLOUDFLARE_TOKEN_REMEDY`). */
export const TOKEN_REMEDY: string =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/** What the same 403 on any one of a script's eight bundle reads maps to. */
export const BUNDLE_DENIED: string =
  "cloudflare workers-script-bundle: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';

/**
 * One routed response: a refusal at `status`, a JSON envelope carrying `result` (and `resultInfo` as its
 * `result_info`, for a paged read), or the raw JavaScript the plain script-content read returns instead of an
 * envelope.
 */
type Route =
  | { readonly status: number }
  | { readonly result: unknown; readonly resultInfo?: unknown }
  | { readonly script: string };

/**
 * A real client over a routing fetch. Routes are keyed by EXACT `<path>@<page>` (page 1 when the SDK names
 * none), so the bare script-content path can never swallow a longer sub-resource path the way a suffix match
 * would; an unrouted key answers 404 naming it, and every request key is recorded in arrival order.
 *
 * @returns the client, and the request keys it was asked for in arrival order
 */
export function servedClient({ routes }: { routes: Readonly<Record<string, Route>> }): {
  client: Cloudflare;
  requests: string[];
} {
  return routedKeyClient<Exclude<Route, RefusedRoute>>({
    respond: ({ route }) => {
      if ("script" in route) {
        return new Response(route.script, { headers: { "content-type": "application/javascript" }, status: 200 });
      }
      if ("resultInfo" in route) {
        return jsonResponse({
          body: { result: route.result, result_info: route.resultInfo, success: true },
          status: 200,
        });
      }
      return resultResponse({ result: route.result });
    },
    routes,
  });
}

/**
 * The path of one of a script's sub-resources, or of its bare content route when `suffix` is empty.
 *
 * @returns the request path, without a page
 */
export function scriptPath({ name, suffix }: { name: string; suffix: string }): string {
  return `${SCRIPTS}/${name}${suffix}`;
}

/**
 * The eight routes one script's bundle read touches, every one answering from `bundle`: settings,
 * bindings, raw content, deployments, schedules, subdomain, a page-paginated versions list (`result.items`, then
 * an empty terminating page), and a single-page secrets list.
 *
 * @returns the routes, keyed `<path>@<page>`
 */
export function bundleRoutes({
  name,
  bundle,
}: {
  name: string;
  bundle: CloudflareRawWorkerScriptBundle;
}): Record<string, Route> {
  return {
    [`${scriptPath({ name, suffix: "" })}@1`]: { script: bundleContent({ bundle }) },
    [`${scriptPath({ name, suffix: "/script-settings" })}@1`]: { result: bundle.settings },
    [`${scriptPath({ name, suffix: "/settings" })}@1`]: { result: { bindings: bundle.bindings } },
    [`${scriptPath({ name, suffix: "/deployments" })}@1`]: {
      result: { deployments: bundle.deployments },
      resultInfo: { total_count: bundle.deployments.length, total_pages: 1 },
    },
    [`${scriptPath({ name, suffix: "/schedules" })}@1`]: { result: { schedules: bundle.schedules } },
    [`${scriptPath({ name, suffix: "/subdomain" })}@1`]: {
      result: { enabled: bundle.subdomainEnabled, previews_enabled: bundle.subdomainPreviewsEnabled },
    },
    [`${scriptPath({ name, suffix: "/versions" })}@1`]: { result: { items: bundle.versions } },
    [`${scriptPath({ name, suffix: "/versions" })}@2`]: { result: { items: [] } },
    [`${scriptPath({ name, suffix: "/secrets" })}@1`]: { result: bundle.secrets },
  };
}

/** The raw content a fixture bundle serves — every fixture here carries a string, never `null`. */
function bundleContent({ bundle }: { bundle: CloudflareRawWorkerScriptBundle }): string {
  if (bundle.content === null) {
    throw new Error("a served fixture bundle must carry content");
  }
  return bundle.content;
}

/**
 * A stored entity, projected by the module's own projection at the earlier timestamp from a raw bundle.
 *
 * @returns the projected entity, stamped `OLD`
 */
export function storedScript({
  raw,
  bundle,
}: {
  raw: CloudflareRawWorkerScript;
  bundle: CloudflareRawWorkerScriptBundle;
}): CloudflareEntity {
  return projectCloudflareWorkerScript({
    accountId: ACCOUNT_ID,
    at: OLD,
    bundle: normalizeCloudflareWorkerScriptBundle({ raw: bundle }),
    raw,
  });
}

/**
 * A stored kind file holding the given entities and gaps, plus the kind's earlier synced coverage cell.
 *
 * @returns the kind file a run folds into
 */
export function storedFile({
  entities,
  gaps,
}: {
  entities: readonly CloudflareEntity[];
  gaps: readonly CloudflareGap[];
}): CloudflareKindFile {
  return storedKindFile({ entities, gaps, kind: "worker-script", scope: KIND_SCOPE, updatedAt: OLD });
}

/**
 * A gap a previous run opened, stamped at the earlier timestamp.
 *
 * @returns the open gap
 */
export function storedGap({
  condition,
  scope,
}: {
  condition: "permission-refused" | "not-found";
  scope: string;
}): CloudflareGap {
  return openCloudflareGap({ at: OLD, condition, kind: "worker-script", reason: "stored", scope });
}

/**
 * The script-metadata half of a stored detail for a script whose inventory row carried only its id.
 *
 * @returns the detail's metadata fields, every one absent but `kind` and `name`
 */
export function bareMetadata({ name }: { name: string }): Record<string, unknown> {
  return {
    compatibilityDate: null,
    compatibilityFlags: [],
    config: {},
    createdOn: null,
    hasAssets: null,
    hasModules: null,
    kind: "worker-script",
    lastDeployedFrom: null,
    logpush: null,
    migrationTag: null,
    modifiedOn: null,
    name,
    tag: null,
    tags: [],
    usageModel: null,
  };
}

/**
 * The entity this run is expected to publish, written out field by field rather than projected.
 *
 * @returns the entity, observed at `AT` by the Worker script fan-out
 */
export function expectedEntity({
  providerId,
  detail,
  firstSeenAt,
}: {
  providerId: string;
  detail: Record<string, unknown>;
  firstSeenAt: string;
}): CloudflareEntity {
  return {
    detail,
    firstSeenAt,
    id: cloudflareEntityId({ components: { accountId: ACCOUNT_ID, providerId }, kind: "worker-script" }),
    kind: "worker-script",
    lastSeenAt: AT,
    providerId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: AT, operation: "workers-scripts-fanout" },
    state: "observed",
  };
}

/** Script `worker-a`'s inventory row, carrying metadata the detail must carry through. */
export const SCRIPT_A: CloudflareRawWorkerScript = {
  compatibility_date: "2026-01-01",
  id: "worker-a",
  tag: "tag-a",
  usage_model: "standard",
};
/** Script `worker-b`'s inventory row, carrying only its id. */
export const SCRIPT_B: CloudflareRawWorkerScript = { id: "worker-b" };

/**
 * A fully populated raw bundle, every field distinguishable by `marker`.
 *
 * @returns the raw bundle, as the provider's reads would serve it
 */
export function rawBundle({ marker }: { marker: string }): CloudflareRawWorkerScriptBundle {
  return {
    bindings: [{ name: `KV_${marker}`, namespace_id: `ns-${marker}`, type: "kv_namespace" }],
    content: `export default { fetch() { return "${marker}"; } }`,
    deployments: [
      {
        annotations: { "workers/message": `ship ${marker}` },
        author_email: "dev@example.test",
        created_on: "2026-01-15T00:00:00Z",
        id: `dep-${marker}`,
        source: "wrangler",
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: `ver-${marker}` }],
      },
    ],
    schedules: [{ cron: `0 ${marker.length} * * *` }],
    secrets: [{ name: `SECRET_${marker}`, type: "secret_text" }],
    settings: { logpush: true, marker },
    subdomainEnabled: true,
    subdomainPreviewsEnabled: false,
    versions: [{ id: `ver-${marker}`, metadata: { author_email: "dev@example.test" }, number: 3 }],
  };
}
