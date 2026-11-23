/**
 * `gateway-list` — Zero Trust Gateway Lists, and the one kind whose completeness is not just "did the read
 * succeed".
 *
 * The fan-out is the ordinary parent-fanout shape. What is this kind's own is that a Gateway List DECLARES
 * its own item count, so a read can succeed and still be short: the SDK presents a single page with no
 * further cursor, so a mismatch cannot be resolved by paging further. That opens a fresh
 * `pagination-incomplete` gap rather than being reported complete — which is exactly why this kind cannot
 * use `basicParentFanoutGapInputs`, since a succeeded-but-incomplete list must not recheck its own
 * completeness condition as resolved. See `projection/gatewayList.ts`'s header.
 */
import type Cloudflare from "cloudflare";

import { ok, type Result } from "../../lib/result.js";

import type { ParentCollectionAttempt } from "./fanout.js";
import {
  CLOUDFLARE_GAP_CONDITIONS,
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
} from "./gaps.js";
import {
  buildFanoutCoverageCell,
  flatKindScope,
  foldFailedKindRead,
  foldFanoutResult,
  type KindFoldResult,
} from "./kindFold.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "./model.js";
import { fanOutAndReconcile, parentFanoutScope } from "./parentFanoutFold.js";
import type { reconcileParentFanout } from "./parentFanoutReconcile.js";
import {
  type CloudflareGatewayListItem,
  type CloudflareRawGatewayList,
  type CloudflareRawGatewayListItem,
  isCloudflareGatewayListDetail,
  normalizeCloudflareGatewayListItem,
  projectCloudflareGatewayList,
} from "./projection/gatewayList.js";
import { readCloudflareGatewayListInventory, readCloudflareGatewayListItems } from "./readers/gatewayList.js";

/**
 * Build the observed gaps and rechecks for this run's Gateway List attempt. Unlike `./parentFanoutFold.ts`'s
 * `basicParentFanoutGapInputs`, a succeeded-but-incomplete list opens a fresh `pagination-incomplete`
 * gap instead of rechecking it resolved — the read itself succeeded, but the item count still did not match
 * what the list declared.
 *
 * @param accountId the selected account id
 * @param attempts this run's per-list fan-out attempts
 * @param entities this run's reconciled `gateway-list` entities, keyed by list id inside this function
 * @param at this run's ISO timestamp
 * @returns the gaps this run observed, and the rechecks it earned
 */
function gatewayListGapInputs({
  accountId,
  attempts,
  entities,
  at,
}: {
  accountId: string;
  attempts: readonly ParentCollectionAttempt<CloudflareGatewayListItem>[];
  entities: readonly CloudflareEntity[];
  at: string;
}): { observed: readonly CloudflareGap[]; rechecks: readonly CloudflareGapRecheck[] } {
  const entityByListId = new Map(entities.map((entity) => [entity.providerId, entity]));
  const observed: CloudflareGap[] = [];
  const rechecks: CloudflareGapRecheck[] = [];
  const nonPaginationConditions = CLOUDFLARE_GAP_CONDITIONS.filter(
    (condition) => condition !== "pagination-incomplete",
  );
  for (const attempt of attempts) {
    const scope = parentFanoutScope({ accountId, kind: "gateway-list", parentId: attempt.parentId });
    if (attempt.result.isErr()) {
      observed.push(
        openCloudflareGap({
          at,
          condition: classifyCloudflareClientErrorGap({ error: attempt.result.error }),
          kind: "gateway-list",
          reason: attempt.result.error.message,
          scope,
        }),
      );
      continue;
    }
    nonPaginationConditions.forEach((condition) => rechecks.push({ condition, resolved: true, scope }));
    const entity = entityByListId.get(attempt.parentId);
    const detail = entity !== undefined && isCloudflareGatewayListDetail(entity.detail) ? entity.detail : null;
    if (detail === null || detail.itemsComplete) {
      rechecks.push({ condition: "pagination-incomplete", resolved: true, scope });
    } else {
      observed.push(
        openCloudflareGap({
          at,
          condition: "pagination-incomplete",
          kind: "gateway-list",
          reason: `declared ${String(detail.declaredCount)} item(s), read ${String(detail.items.length)}`,
          scope,
        }),
      );
    }
  }
  return { observed, rechecks };
}

/**
 * Whether this run's Gateway List reconciliation is complete — the fan-out itself succeeding is not
 * enough; every list's own item count must also have matched its declared count.
 *
 * @param reconciliation this run's reconciled `gateway-list` entities
 * @returns overall completeness, and every reason it fell short
 */
function gatewayListCompleteness({
  reconciliation,
}: {
  reconciliation: ReturnType<typeof reconcileParentFanout<CloudflareRawGatewayList, CloudflareGatewayListItem>>;
}): { complete: boolean; reasons: readonly string[] } {
  const incomplete = reconciliation.entities.filter(
    (entity) => isCloudflareGatewayListDetail(entity.detail) && !entity.detail.itemsComplete,
  );
  return {
    complete: reconciliation.complete && incomplete.length === 0,
    reasons: [...reconciliation.reasons, ...incomplete.map((entity) => `${entity.providerId}: item count incomplete`)],
  };
}

/**
 * Read, fan out and fold this run's Gateway List attempt into its stored kind file. A failed list's item
 * read preserves only that list's own items; a list absent from a successful inventory read is pruned. A
 * succeeded read whose item count does not match the list's own declared count opens a `pagination-
 * incomplete` gap rather than being reported complete — see `projection/gatewayList.ts`'s header.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `gateway-list` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncGatewayListKind({
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
  const scope = flatKindScope({ accountId, kind: "gateway-list" });
  const inventory = await readCloudflareGatewayListInventory({ accountId, client });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "gateway-list", scope, stored }));
  }

  const { attempts, reconciliation } = await fanOutAndReconcile<
    CloudflareRawGatewayList,
    CloudflareRawGatewayListItem,
    CloudflareGatewayListItem
  >({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflareGatewayList({ accountId: entityAccountId, at: entityAt, items: children, raw: parent }),
    extractStoredChildren: (entity) => (isCloudflareGatewayListDetail(entity.detail) ? entity.detail.items : null),
    normalizeChild: ({ raw }) => normalizeCloudflareGatewayListItem({ raw }),
    parents: inventory.value,
    readChild: ({ parentId }) => readCloudflareGatewayListItems({ accountId, client, listId: parentId }),
    stored: stored.entities,
  });

  const { complete, reasons } = gatewayListCompleteness({ reconciliation });
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(reconciliation.entities.length)} gateway list(s)`,
  });

  return foldFanoutResult({
    at,
    cell,
    complete,
    entities: reconciliation.entities,
    gapInputs: gatewayListGapInputs({ accountId, at, attempts, entities: reconciliation.entities }),
    kind: "gateway-list",
    kindScopeRead: "succeeded",
    reasons,
    scope,
    stored,
  });
}
