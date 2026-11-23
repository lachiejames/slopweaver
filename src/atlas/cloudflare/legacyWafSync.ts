/**
 * Read, fan out and fold the `legacy-waf` kind — its own module for the same file-size reason
 * `pagesSync.ts`/`firewallServiceSync.ts` were. WAF packages (each with combined groups+rules embedded, the
 * same shape `pagesSync.ts` established) and WAF overrides (independent, zone-level, never nested under a
 * package — see `projection/legacyWaf.ts`'s header for why) are two entirely independent read domains folded
 * into one kind file: a live probe of a deep zone found packages returning
 * `403 WAF is deprecated for this zone, Managed Rulesets should be used instead` and overrides returning
 * `410 Gone` — both permanent, product-level unavailability rather than a transient failure, and neither
 * blocks the other from being attempted or from preserving its own previously-stored entities.
 */
import type Cloudflare from "cloudflare";

import type { Result } from "../../lib/result.js";
import type { CloudflareClientError } from "./errors.js";
import type { ParentCollectionAttempt } from "./fanout.js";
import {
  CLOUDFLARE_GAP_CONDITIONS,
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
  recheckEveryCondition,
} from "./gaps.js";
import {
  buildFanoutCoverageCell,
  deepZoneKindScope,
  entitiesInZone,
  foldFanoutResult,
  type KindFoldResult,
  withOtherZonesRetained,
} from "./kindFold.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "./model.js";
import { fanOutAndReconcile, parentFanoutScope } from "./parentFanoutFold.js";
import {
  type CloudflareLegacyWafChildItem,
  type CloudflareLegacyWafRawChildItem,
  type CloudflareRawWafPackage,
  extractCloudflareLegacyWafChildren,
  isCloudflareWafOverrideDetail,
  isCloudflareWafPackageDetail,
  normalizeCloudflareLegacyWafChildItem,
  projectCloudflareWafPackage,
  WAF_PACKAGE_PROVIDER_ID_PREFIX,
} from "./projection/legacyWaf.js";
import {
  readCloudflareWafOverrides,
  readCloudflareWafPackageChildren,
  readCloudflareWafPackageInventory,
} from "./readers/legacyWaf.js";

/**
 * Build the observed gaps and rechecks for this run's WAF package fan-out — one gap per failed package, a
 * recheck for every condition on every succeeded package, matching `pagesProjectGapInputs`'s shape exactly
 * since packages carry no completeness condition beyond "did the combined read succeed." Only a successful
 * inventory read fans out, so every condition at {@link wafPackageInventoryScope} is rechecked too, closing
 * the gap a failed inventory read opened there.
 *
 * @param accountId the selected account id
 * @param attempts this run's per-package fan-out attempts
 * @param at this run's ISO timestamp
 * @param zoneId the configured deep zone id, naming the inventory scope
 * @returns the gaps this run observed, and the rechecks it earned
 */
function wafPackageGapInputs({
  accountId,
  attempts,
  at,
  zoneId,
}: {
  accountId: string;
  attempts: readonly ParentCollectionAttempt<CloudflareLegacyWafChildItem>[];
  at: string;
  zoneId: string;
}): { observed: readonly CloudflareGap[]; rechecks: readonly CloudflareGapRecheck[] } {
  const observed: CloudflareGap[] = [];
  const rechecks: CloudflareGapRecheck[] = [...recheckEveryCondition({ scope: wafPackageInventoryScope({ zoneId }) })];
  for (const attempt of attempts) {
    const scope = parentFanoutScope({ accountId, kind: "legacy-waf", parentId: attempt.parentId });
    if (attempt.result.isErr()) {
      observed.push(
        openCloudflareGap({
          at,
          condition: classifyCloudflareClientErrorGap({ error: attempt.result.error }),
          kind: "legacy-waf",
          reason: attempt.result.error.message,
          scope,
        }),
      );
      continue;
    }
    CLOUDFLARE_GAP_CONDITIONS.forEach((condition) => rechecks.push({ condition, resolved: true, scope }));
  }
  return { observed, rechecks };
}

/** The scope the WAF package INVENTORY read is recorded under, failed or succeeded. */
function wafPackageInventoryScope({ zoneId }: { zoneId: string }): string {
  return `zone/${zoneId}/legacy-waf/packages`;
}

/**
 * This zone's stored packages, each keyed by the raw package id the inventory returns. A package entity's
 * `providerId` carries {@link WAF_PACKAGE_PROVIDER_ID_PREFIX}, while `reconcileParentFanout` finds a failed
 * parent's stored children by the parent's own id, so without this a failed package read found nothing
 * stored and was rebuilt with no groups or rules. Only the lookup sees these: every entity published is
 * built fresh.
 */
function storedPackagesByRawId({ stored, zoneId }: { stored: CloudflareKindFile; zoneId: string }): CloudflareEntity[] {
  return entitiesInZone({ stored, zoneId })
    .filter((entity) => isCloudflareWafPackageDetail(entity.detail))
    .map((entity) => ({ ...entity, providerId: entity.providerId.slice(WAF_PACKAGE_PROVIDER_ID_PREFIX.length) }));
}

/** This run's independent WAF-overrides outcome, folded against what was stored for overrides alone. */
interface WafOverridesFold {
  readonly entities: readonly CloudflareEntity[];
  readonly failed: boolean;
  readonly reason: string | null;
  readonly gapInputs: {
    readonly observed: readonly CloudflareGap[];
    readonly rechecks: readonly CloudflareGapRecheck[];
  };
}

/**
 * Fold this run's independent WAF-overrides read: on success its entities replace whatever overrides were
 * stored; on failure the previously-stored overrides FOR THIS ZONE are preserved untouched and a gap opens at the
 * overrides' own scope, exactly mirroring `firewallServiceSync.ts`'s per-subtype fold at a scope of one.
 *
 * @param stored the `legacy-waf` kind file as it stood before this run
 * @param result this run's WAF-overrides read attempt
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the overrides entities and gap inputs, isolated from the package fan-out's own outcome
 */
function foldWafOverrides({
  stored,
  result,
  zoneId,
  at,
}: {
  stored: CloudflareKindFile;
  result: Result<readonly CloudflareEntity[], CloudflareClientError>;
  zoneId: string;
  at: string;
}): WafOverridesFold {
  const scope = `zone/${zoneId}/legacy-waf/overrides`;
  if (result.isErr()) {
    return {
      entities: entitiesInZone({ stored, zoneId }).filter((entity) => isCloudflareWafOverrideDetail(entity.detail)),
      failed: true,
      gapInputs: {
        observed: [
          openCloudflareGap({
            at,
            condition: classifyCloudflareClientErrorGap({ error: result.error }),
            kind: "legacy-waf",
            reason: result.error.message,
            scope,
          }),
        ],
        rechecks: [],
      },
      reason: `overrides: ${result.error.message}`,
    };
  }
  return {
    entities: result.value,
    failed: false,
    gapInputs: {
      observed: [],
      rechecks: CLOUDFLARE_GAP_CONDITIONS.map((condition) => ({ condition, resolved: true, scope })),
    },
    reason: null,
  };
}

/** This run's WAF-package fan-out outcome — inventory failure and per-package fan-out folded into one
 * shape, so the caller never branches on which happened. */
interface WafPackagesFold {
  readonly entities: readonly CloudflareEntity[];
  readonly complete: boolean;
  readonly reasons: readonly string[];
  readonly gapInputs: {
    readonly observed: readonly CloudflareGap[];
    readonly rechecks: readonly CloudflareGapRecheck[];
  };
}

/**
 * Read the WAF package inventory and fan out each package's combined groups/rules, folding an inventory
 * failure the same way `syncGatewayListKind` folds one: preserve every previously-stored package untouched
 * and open one gap for the inventory read itself, never a per-package attempt that never happened.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `legacy-waf` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns this run's package entities, completeness and gap inputs
 */
async function resolveWafPackages({
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
}): Promise<WafPackagesFold> {
  const inventory = await readCloudflareWafPackageInventory({ client, zoneId });
  if (inventory.isErr()) {
    return {
      complete: false,
      entities: entitiesInZone({ stored, zoneId }).filter((entity) => isCloudflareWafPackageDetail(entity.detail)),
      gapInputs: {
        observed: [
          openCloudflareGap({
            at,
            condition: classifyCloudflareClientErrorGap({ error: inventory.error }),
            kind: "legacy-waf",
            reason: inventory.error.message,
            scope: wafPackageInventoryScope({ zoneId }),
          }),
        ],
        rechecks: [],
      },
      reasons: [`packages: ${inventory.error.message}`],
    };
  }
  const { attempts, reconciliation } = await fanOutAndReconcile<
    CloudflareRawWafPackage,
    CloudflareLegacyWafRawChildItem,
    CloudflareLegacyWafChildItem
  >({
    accountId,
    at,
    buildEntity: ({ accountId: entityAccountId, at: entityAt, children, parent }) =>
      projectCloudflareWafPackage({ accountId: entityAccountId, at: entityAt, children, raw: parent, zoneId }),
    extractStoredChildren: (entity) =>
      isCloudflareWafPackageDetail(entity.detail)
        ? extractCloudflareLegacyWafChildren({ detail: entity.detail })
        : null,
    normalizeChild: ({ raw }) => normalizeCloudflareLegacyWafChildItem({ raw }),
    parents: inventory.value,
    readChild: ({ parentId }) => readCloudflareWafPackageChildren({ client, packageId: parentId, zoneId }),
    // This zone only — a WAF package id is Cloudflare-wide, so `reconcileParentFanout`'s lookup by
    // `providerId` over an unfiltered store would hand this zone another zone's stored children.
    stored: storedPackagesByRawId({ stored, zoneId }),
  });
  return {
    complete: reconciliation.complete,
    entities: reconciliation.entities,
    gapInputs: wafPackageGapInputs({ accountId, at, attempts, zoneId }),
    reasons: reconciliation.reasons,
  };
}

/**
 * Read, fan out and fold this run's `legacy-waf` attempt into its stored kind file — see this module's header
 * for why packages and overrides are two independent read domains combined into one kind.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `legacy-waf` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncLegacyWafKind({
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
  const scope = deepZoneKindScope({ kind: "legacy-waf", zoneId });
  const packages = await resolveWafPackages({ accountId, at, client, stored, zoneId });

  const overridesResult = await readCloudflareWafOverrides({ accountId, at, client, zoneId });
  const overridesFold = foldWafOverrides({ at, result: overridesResult, stored, zoneId });

  const zoneEntities = [...packages.entities, ...overridesFold.entities];
  const reasons = [...packages.reasons, ...(overridesFold.reason !== null ? [overridesFold.reason] : [])];
  const complete = packages.complete && !overridesFold.failed;
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(packages.entities.length)} WAF package(s) and ${String(overridesFold.entities.length)} override(s)`,
  });

  const gapInputs = {
    observed: [...packages.gapInputs.observed, ...overridesFold.gapInputs.observed],
    rechecks: [...packages.gapInputs.rechecks, ...overridesFold.gapInputs.rechecks],
  };
  return foldFanoutResult({
    at,
    cell,
    complete,
    entities: withOtherZonesRetained({ entities: zoneEntities, stored, zoneId }),
    gapInputs,
    kind: "legacy-waf",
    kindScopeRead: "not-made",
    reasons,
    scope,
    stored,
  });
}
