/**
 * `ruleset` and `zone-ruleset` — modern Rulesets at both scopes, each with the rules it contains.
 *
 * The same parent-fanout shape `account-certificate` uses, run twice: `rulesets.list` returns metadata
 * only, so each ruleset's RULES are one `rulesets.get`, and a ruleset whose `get` fails costs that
 * ruleset's rules rather than the whole kind's read. MEASURED: one zone ruleset's `get` can fail while its
 * siblings in the same zone read cleanly — the fan-out is what keeps that one failure from staling them.
 *
 * Why this kind exists at all, and why account and zone scope are two kinds rather than one, is in
 * `projection/ruleset.ts`'s header along with the volume measurement that retired the three Rulesets
 * exclusions this atlas carried with no recorded reason.
 *
 * `zone-ruleset` reads the configured DEEP zone only, like every other zone-scoped kind here, so it uses the
 * `withOtherZonesRetained` / `entitiesInZone` pair rather than replacing the kind file wholesale: a per-zone
 * publication that dropped every other zone's rulesets would delete data nothing else holds.
 */
import type Cloudflare from "cloudflare";

import { ok, type Result } from "../../lib/result.js";

import {
  buildFanoutCoverageCell,
  deepZoneKindScope,
  entitiesInZone,
  flatKindScope,
  foldFailedKindRead,
  foldFanoutResult,
  type KindFoldResult,
  withOtherZonesRetained,
} from "./kindFold.js";
import type { CloudflareEntity, CloudflareKindFile } from "./model.js";
import { basicParentFanoutGapInputs, fanOutAndReconcile } from "./parentFanoutFold.js";
import {
  type CloudflareRawRuleset,
  type CloudflareRulesetRule,
  isCloudflareRulesetDetail,
  projectCloudflareRuleset,
} from "./projection/ruleset.js";
import {
  type CloudflareRulesetScopeParams,
  readCloudflareRulesetInventory,
  readCloudflareRulesetRules,
} from "./readers/ruleset.js";

/** Fan one rules read out per ruleset and reconcile the result against what is already stored. */
async function fanOutRulesets({
  client,
  accountId,
  zoneId,
  at,
  stored,
  parents,
  params,
  operation,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string | null;
  at: string;
  stored: readonly CloudflareEntity[];
  parents: readonly CloudflareRawRuleset[];
  params: CloudflareRulesetScopeParams;
  operation: string;
}): ReturnType<typeof fanOutAndReconcile<CloudflareRawRuleset, CloudflareRulesetRule, CloudflareRulesetRule>> {
  return fanOutAndReconcile<CloudflareRawRuleset, CloudflareRulesetRule, CloudflareRulesetRule>({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflareRuleset({ accountId: entityAccountId, at: entityAt, raw: parent, rules: children, zoneId }),
    extractStoredChildren: (entity) => (isCloudflareRulesetDetail(entity.detail) ? entity.detail.rules : null),
    // A rule is stored exactly as the provider returns it: its `action_parameters` shape is decided by its
    // action and there are dozens of actions, so there is nothing to normalise into.
    normalizeChild: ({ raw }) => raw,
    parents,
    readChild: ({ parentId }) => readCloudflareRulesetRules({ client, operation, params, rulesetId: parentId }),
    stored,
  });
}

/**
 * Read, fan out and fold this run's ACCOUNT-scoped Rulesets attempt into its stored kind file.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param stored the `ruleset` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncRulesetKind({
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
  const scope = flatKindScope({ accountId, kind: "ruleset" });
  const params: CloudflareRulesetScopeParams = { account_id: accountId };
  const inventory = await readCloudflareRulesetInventory({
    client,
    operation: "account-rulesets-list",
    params,
  });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "ruleset", scope, stored }));
  }

  const { attempts, reconciliation } = await fanOutRulesets({
    accountId,
    at,
    client,
    operation: "account-ruleset-get",
    params,
    parents: inventory.value,
    stored: stored.entities,
    zoneId: null,
  });

  return foldFanoutResult({
    at,
    cell: buildFanoutCoverageCell({
      at,
      complete: reconciliation.complete,
      reasons: reconciliation.reasons,
      scope,
      stored,
      successReason: `reconciled ${String(reconciliation.entities.length)} account ruleset(s)`,
    }),
    complete: reconciliation.complete,
    entities: reconciliation.entities,
    gapInputs: basicParentFanoutGapInputs({ accountId, at, attempts, kind: "ruleset" }),
    kind: "ruleset",
    kindScopeRead: "succeeded",
    reasons: reconciliation.reasons,
    scope,
    stored,
  });
}

/**
 * Read, fan out and fold this run's DEEP-ZONE Rulesets attempt into its stored kind file, leaving every
 * other zone's stored rulesets untouched.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `zone-ruleset` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncZoneRulesetKind({
  client,
  accountId,
  zoneId,
  stored,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  stored: CloudflareKindFile;
  at: string;
}): Promise<Result<KindFoldResult>> {
  const scope = deepZoneKindScope({ kind: "zone-ruleset", zoneId });
  const params: CloudflareRulesetScopeParams = { zone_id: zoneId };
  const inventory = await readCloudflareRulesetInventory({
    client,
    operation: "zone-rulesets-list",
    params,
  });
  if (inventory.isErr()) {
    return ok(foldFailedKindRead({ at, error: inventory.error, kind: "zone-ruleset", scope, stored }));
  }

  const { attempts, reconciliation } = await fanOutRulesets({
    accountId,
    at,
    client,
    operation: "zone-ruleset-get",
    params,
    parents: inventory.value,
    stored: entitiesInZone({ stored, zoneId }),
    zoneId,
  });

  return foldFanoutResult({
    at,
    cell: buildFanoutCoverageCell({
      at,
      complete: reconciliation.complete,
      reasons: reconciliation.reasons,
      scope,
      stored,
      successReason: `reconciled ${String(reconciliation.entities.length)} ruleset(s) for the deep zone`,
    }),
    complete: reconciliation.complete,
    entities: withOtherZonesRetained({ entities: reconciliation.entities, stored, zoneId }),
    gapInputs: basicParentFanoutGapInputs({ accountId, at, attempts, kind: "zone-ruleset" }),
    kind: "zone-ruleset",
    kindScopeRead: "succeeded",
    reasons: reconciliation.reasons,
    scope,
    stored,
  });
}
