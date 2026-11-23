/**
 * Read, fan out and fold the `worker-script` kind — split into its own module for the same reason
 * `pagesSync.ts` is: registering a fifth non-flat kind directly inside `sync.ts` would have pushed that file back
 * over the repo's `max-lines` ratchet. Simpler than `pagesSync.ts` in one respect — a script's `id` IS its
 * name (Workers addresses every sub-resource by name), so there is no separate id-to-name lookup map to
 * build — and simpler than `gateway-list`'s own gap handling too, since none of this kind's reads carry a
 * declared count to compare against; `basicParentFanoutGapInputs` covers it exactly as it already does for
 * `account-filter-list`.
 */
import type Cloudflare from "cloudflare";

import { ok, type Result } from "../../lib/result.js";
import {
  buildFanoutCoverageCell,
  flatKindScope,
  foldFailedKindRead,
  foldFanoutResult,
  type KindFoldResult,
} from "./kindFold.js";
import type { CloudflareKindFile } from "./model.js";
import { basicParentFanoutGapInputs, fanOutAndReconcile } from "./parentFanoutFold.js";
import {
  type CloudflareRawWorkerScript,
  type CloudflareRawWorkerScriptBundle,
  type CloudflareWorkerScriptBundleDetail,
  extractCloudflareWorkerScriptBundle,
  isCloudflareWorkerScriptDetail,
  normalizeCloudflareWorkerScriptBundle,
  projectCloudflareWorkerScript,
} from "./projection/workerScript.js";
import { readCloudflareWorkerScriptBundle, readCloudflareWorkerScriptInventory } from "./readers/workerScript.js";

/** The bundle a script reads as, when neither this run nor any prior generation ever held one for it — a
 * script with no valid stored fallback still needs SOME bundle to build an entity from. */
const EMPTY_WORKER_SCRIPT_BUNDLE: CloudflareWorkerScriptBundleDetail = {
  bindings: [],
  content: null,
  deployments: [],
  schedules: [],
  secrets: [],
  settings: {},
  subdomainEnabled: null,
  subdomainPreviewsEnabled: null,
  versions: [],
};

/** A script's one resolved bundle, or {@link EMPTY_WORKER_SCRIPT_BUNDLE} when its fan-out resolved none. */
function scriptBundle({
  children,
}: {
  children: readonly CloudflareWorkerScriptBundleDetail[];
}): CloudflareWorkerScriptBundleDetail {
  const first = children[0];
  if (first == null) {
    return EMPTY_WORKER_SCRIPT_BUNDLE;
  }
  return first;
}

/**
 * Fan out and reconcile this run's Worker script bundles against a fresh script inventory — pulled out of
 * {@link syncWorkerScriptKind} purely to keep that function's own body short.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param at this run's ISO timestamp
 * @param parents this run's fresh script inventory
 * @param stored every entity this kind's file already holds
 * @returns this run's per-script attempts and the reconciled result
 */
async function reconcileWorkerScripts({
  client,
  accountId,
  at,
  parents,
  stored,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
  parents: readonly CloudflareRawWorkerScript[];
  stored: CloudflareKindFile;
}): ReturnType<
  typeof fanOutAndReconcile<
    CloudflareRawWorkerScript,
    CloudflareRawWorkerScriptBundle,
    CloudflareWorkerScriptBundleDetail
  >
> {
  return fanOutAndReconcile<
    CloudflareRawWorkerScript,
    CloudflareRawWorkerScriptBundle,
    CloudflareWorkerScriptBundleDetail
  >({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflareWorkerScript({
        accountId: entityAccountId,
        at: entityAt,
        bundle: scriptBundle({ children }),
        raw: parent,
      }),
    extractStoredChildren: (entity) =>
      isCloudflareWorkerScriptDetail(entity.detail)
        ? extractCloudflareWorkerScriptBundle({ detail: entity.detail })
        : null,
    normalizeChild: ({ raw }) => normalizeCloudflareWorkerScriptBundle({ raw }),
    parents,
    readChild: ({ parentId }) => readCloudflareWorkerScriptBundle({ accountId, client, scriptName: parentId }),
    stored: stored.entities,
  });
}

/**
 * Read, fan out and fold this run's Worker script attempt into its stored kind file. A failed script's own
 * bundle read preserves only that script's previous settings/bindings/content/deployments/versions/
 * schedules/secrets/subdomain state; a script absent from a successful inventory read is pruned.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `worker-script` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncWorkerScriptKind({
  client,
  accountId,
  stored,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  stored: CloudflareKindFile;
  at: string;
}): Promise<Result<KindFoldResult>> {
  const scope = flatKindScope({ accountId, kind: "worker-script" });
  const inventory = await readCloudflareWorkerScriptInventory({ accountId, client });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "worker-script", scope, stored }));
  }

  const { attempts, reconciliation } = await reconcileWorkerScripts({
    accountId,
    at,
    client,
    parents: inventory.value,
    stored,
  });

  const cell = buildFanoutCoverageCell({
    at,
    complete: reconciliation.complete,
    reasons: reconciliation.reasons,
    scope,
    stored,
    successReason: `reconciled ${String(reconciliation.entities.length)} Worker script(s)`,
  });

  return foldFanoutResult({
    at,
    cell,
    complete: reconciliation.complete,
    entities: reconciliation.entities,
    gapInputs: basicParentFanoutGapInputs({ accountId, at, attempts, kind: "worker-script" }),
    kind: "worker-script",
    kindScopeRead: "succeeded",
    reasons: reconciliation.reasons,
    scope,
    stored,
  });
}
