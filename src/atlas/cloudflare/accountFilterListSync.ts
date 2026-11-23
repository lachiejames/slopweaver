/**
 * `account-filter-list` — the plainest parent-fanout kind in this atlas, and the shape the shared
 * `fanOutAndReconcile` was extracted for.
 *
 * One inventory read lists the account's filter lists; one child read per list fetches that list's items,
 * which are embedded back into that same list's own entity. A failed list's item read preserves only that
 * list's own items; a list absent from a successful inventory read is pruned.
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
  type CloudflareAccountFilterListItem,
  type CloudflareRawAccountFilterList,
  type CloudflareRawAccountFilterListItem,
  isCloudflareAccountFilterListDetail,
  normalizeCloudflareAccountFilterListItem,
  projectCloudflareAccountFilterList,
} from "./projection/accountFilterList.js";
import {
  readCloudflareAccountFilterListInventory,
  readCloudflareAccountFilterListItems,
} from "./readers/accountFilterList.js";

/**
 * Read, fan out and fold this run's Account filter-list attempt into its stored kind file. A failed list's
 * item read preserves only that list's own items; a list absent from a successful inventory read is pruned.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `account-filter-list` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncAccountFilterListKind({
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
  const scope = flatKindScope({ accountId, kind: "account-filter-list" });
  const inventory = await readCloudflareAccountFilterListInventory({ accountId, client });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "account-filter-list", scope, stored }));
  }

  const { attempts, reconciliation } = await fanOutAndReconcile<
    CloudflareRawAccountFilterList,
    CloudflareRawAccountFilterListItem,
    CloudflareAccountFilterListItem
  >({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflareAccountFilterList({ accountId: entityAccountId, at: entityAt, items: children, raw: parent }),
    extractStoredChildren: (entity) =>
      isCloudflareAccountFilterListDetail(entity.detail) ? entity.detail.items : null,
    normalizeChild: ({ raw }) => normalizeCloudflareAccountFilterListItem({ raw }),
    parents: inventory.value,
    readChild: ({ parentId }) => readCloudflareAccountFilterListItems({ accountId, client, listId: parentId }),
    stored: stored.entities,
  });

  const cell = buildFanoutCoverageCell({
    at,
    complete: reconciliation.complete,
    reasons: reconciliation.reasons,
    scope,
    stored,
    successReason: `reconciled ${String(reconciliation.entities.length)} filter list(s)`,
  });

  return foldFanoutResult({
    at,
    cell,
    complete: reconciliation.complete,
    entities: reconciliation.entities,
    gapInputs: basicParentFanoutGapInputs({ accountId, at, attempts, kind: "account-filter-list" }),
    kind: "account-filter-list",
    kindScopeRead: "succeeded",
    reasons: reconciliation.reasons,
    scope,
    stored,
  });
}
