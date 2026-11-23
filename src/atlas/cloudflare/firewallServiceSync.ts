/**
 * Read, fan out and fold the `firewall-service` kind — its own module, registered by `nonFlatKinds.ts` as
 * `syncFirewallServiceKind` for the same file-size reason `pagesSync.ts` was.
 *
 * Unlike every other combined-collection kind in this atlas, `firewall-service` does NOT use the
 * all-or-nothing combine `readers/notificationDestination.ts` established for two sources — a live probe
 * of a deep zone found five of its six classic surfaces reachable and the sixth
 * (legacy rate limits) permanently `410 Gone`, so short-circuiting on the first failure would have thrown
 * away five real, successfully-read collections over one Cloudflare has simply retired. Instead each of the
 * six subtypes is read independently and folded independently: a failed subtype preserves only ITS OWN
 * previously-stored entities (matching every other kind's "a failed read preserves what came before"
 * philosophy, just applied at subtype granularity instead of per-parent), while every succeeded subtype
 * replaces its own entities outright. Kind-level `complete` requires all six to have succeeded this run.
 */
import type Cloudflare from "cloudflare";

import type { Result } from "../../lib/result.js";
import type { CloudflareClientError } from "./errors.js";
import {
  CLOUDFLARE_GAP_CONDITIONS,
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
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
import {
  CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES,
  type CloudflareFirewallServiceSubtype,
  isCloudflareFirewallServiceDetailOf,
} from "./projection/firewallService.js";
import {
  readCloudflareFirewallFilters,
  readCloudflareFirewallRules,
  readCloudflareIpAccessRules,
  readCloudflareLockdowns,
  readCloudflareRateLimits,
  readCloudflareUaRules,
} from "./readers/firewallService.js";

/** The coverage/gap scope one `firewall-service` subtype is recorded under.
 *
 * @param zoneId the configured deep zone id
 * @param subtype the subtype this scope is for
 * @returns the scope string
 */
function firewallServiceSubtypeScope({
  zoneId,
  subtype,
}: {
  zoneId: string;
  subtype: CloudflareFirewallServiceSubtype;
}): string {
  return `zone/${zoneId}/firewall-service/${subtype}`;
}

/** One subtype's independent read attempt, folded against what was stored for that subtype alone. */
interface FirewallServiceSubtypeFold {
  readonly entities: readonly CloudflareEntity[];
  readonly failed: boolean;
  readonly reason: string | null;
  readonly gapInputs: {
    readonly observed: readonly CloudflareGap[];
    readonly rechecks: readonly CloudflareGapRecheck[];
  };
}

/**
 * Fold one subtype's independent read attempt: on success, its entities replace whatever was stored for that
 * subtype; on failure, its previously-stored entities FOR THIS ZONE are preserved untouched and a gap opens at its own
 * scope.
 *
 * @param stored the `firewall-service` kind file as it stood before this run
 * @param subtype the subtype this attempt is for
 * @param result this subtype's own read attempt
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns this subtype's entities and gap inputs, isolated from every other subtype's outcome
 */
function foldFirewallServiceSubtype({
  stored,
  subtype,
  result,
  zoneId,
  at,
}: {
  stored: CloudflareKindFile;
  subtype: CloudflareFirewallServiceSubtype;
  result: Result<readonly CloudflareEntity[], CloudflareClientError>;
  zoneId: string;
  at: string;
}): FirewallServiceSubtypeFold {
  const scope = firewallServiceSubtypeScope({ subtype, zoneId });
  if (result.isErr()) {
    const preserved = entitiesInZone({ stored, zoneId }).filter((entity) =>
      isCloudflareFirewallServiceDetailOf({ subtype, value: entity.detail }),
    );
    return {
      entities: preserved,
      failed: true,
      gapInputs: {
        observed: [
          openCloudflareGap({
            at,
            condition: classifyCloudflareClientErrorGap({ error: result.error }),
            kind: "firewall-service",
            reason: result.error.message,
            scope,
          }),
        ],
        rechecks: [],
      },
      reason: `${subtype}: ${result.error.message}`,
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

/**
 * Read each of the six classic surfaces independently and concurrently, each tagged by its own subtype.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every subtype's own read attempt, tagged
 */
async function readFirewallServiceSubtypes({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<readonly [CloudflareFirewallServiceSubtype, Result<readonly CloudflareEntity[], CloudflareClientError>][]> {
  return Promise.all([
    readCloudflareFirewallFilters({ accountId, at, client, zoneId }).then(
      (result): [CloudflareFirewallServiceSubtype, typeof result] => ["filter", result],
    ),
    readCloudflareFirewallRules({ accountId, at, client, zoneId }).then(
      (result): [CloudflareFirewallServiceSubtype, typeof result] => ["firewall-rule", result],
    ),
    readCloudflareIpAccessRules({ accountId, at, client, zoneId }).then(
      (result): [CloudflareFirewallServiceSubtype, typeof result] => ["ip-access-rule", result],
    ),
    readCloudflareUaRules({ accountId, at, client, zoneId }).then(
      (result): [CloudflareFirewallServiceSubtype, typeof result] => ["ua-rule", result],
    ),
    readCloudflareLockdowns({ accountId, at, client, zoneId }).then(
      (result): [CloudflareFirewallServiceSubtype, typeof result] => ["lockdown", result],
    ),
    readCloudflareRateLimits({ accountId, at, client, zoneId }).then(
      (result): [CloudflareFirewallServiceSubtype, typeof result] => ["rate-limit", result],
    ),
  ]);
}

/**
 * Read, fan out and fold this run's `firewall-service` attempt into its stored kind file — see this module's
 * header for why each of the six classic surfaces is read and folded independently.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `firewall-service` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncFirewallServiceKind({
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
  const attempts = await readFirewallServiceSubtypes({ accountId, at, client, zoneId });

  const folds = attempts.map(([subtype, result]) =>
    foldFirewallServiceSubtype({ at, result, stored, subtype, zoneId }),
  );
  const zoneEntities = folds.flatMap((fold) => fold.entities);
  const reasons = folds.map((fold) => fold.reason).filter((reason): reason is string => reason !== null);
  const complete = reasons.length === 0;
  const scope = deepZoneKindScope({ kind: "firewall-service", zoneId });
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(zoneEntities.length)} classic firewall entit${zoneEntities.length === 1 ? "y" : "ies"} across all ${String(CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.length)} subtypes`,
  });

  const gapInputs = {
    observed: folds.flatMap((fold) => fold.gapInputs.observed),
    rechecks: folds.flatMap((fold) => fold.gapInputs.rechecks),
  };
  return foldFanoutResult({
    at,
    cell,
    complete,
    entities: withOtherZonesRetained({ entities: zoneEntities, stored, zoneId }),
    gapInputs,
    kind: "firewall-service",
    kindScopeRead: "not-made",
    reasons,
    scope,
    stored,
  });
}
