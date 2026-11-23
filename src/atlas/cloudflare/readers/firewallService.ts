/**
 * The `firewall-service` readers: six independent, deep-zone-scoped classic firewall collections, each
 * returned as its OWN `Result` rather than combined into one — see `firewallServiceSync.ts`'s header for why
 * this kind needs per-subtype partial success rather than the all-or-nothing combine
 * `readers/notificationDestination.ts` uses for its two collections. A live probe of a deep zone
 * found `filters`/`rules`/`accessRules`/`uaRules`/`lockdowns` all reachable, and `rateLimits` returning
 * `410 Gone` — Cloudflare has retired the legacy rate-limiting API, which its SDK documents. Both are
 * expected, typed outcomes; `mapCloudflareError` already folds a `410` into `provider` with the status and
 * message preserved, and the sync layer turns that into an honest `provider-error` gap rather than crashing.
 * The SDK has since typed that list as `void` with no pager; `retiredList.ts` reads what a success returns.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareFirewallFilter,
  projectCloudflareFirewallRule,
  projectCloudflareIpAccessRule,
  projectCloudflareLockdown,
  projectCloudflareRateLimit,
  projectCloudflareUaRule,
} from "../projection/firewallService.js";
import { retiredListRecords } from "./retiredList.js";

/**
 * Read every classic filter for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every filter's entity, or the reason the read failed
 */
export async function readCloudflareFirewallFilters({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const filter of client.filters.list({ zone_id: zoneId })) {
      if (typeof filter.id !== "string" || filter.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareFirewallFilter({ accountId, at, raw: { ...filter, id: filter.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "firewall-service-filters-list" }));
  }
  return ok(entities);
}

/**
 * Read every classic firewall rule for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every rule's entity, or the reason the read failed
 */
export async function readCloudflareFirewallRules({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const rule of client.firewall.rules.list({ zone_id: zoneId })) {
      if (typeof rule.id !== "string" || rule.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareFirewallRule({ accountId, at, raw: { ...rule, id: rule.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "firewall-service-rules-list" }));
  }
  return ok(entities);
}

/**
 * Read every zone-scoped IP access rule for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every rule's entity, or the reason the read failed
 */
export async function readCloudflareIpAccessRules({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const rule of client.firewall.accessRules.list({ zone_id: zoneId })) {
      if (typeof rule.id !== "string" || rule.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareIpAccessRule({ accountId, at, raw: { ...rule, id: rule.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "firewall-service-access-rules-list" }));
  }
  return ok(entities);
}

/**
 * Read every user-agent blocking rule for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every rule's entity, or the reason the read failed
 */
export async function readCloudflareUaRules({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const rule of client.firewall.uaRules.list({ zone_id: zoneId })) {
      if (typeof rule.id !== "string" || rule.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareUaRule({ accountId, at, raw: { ...rule, id: rule.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "firewall-service-ua-rules-list" }));
  }
  return ok(entities);
}

/**
 * Read every zone lockdown for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every lockdown's entity, or the reason the read failed
 */
export async function readCloudflareLockdowns({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const lockdown of client.firewall.lockdowns.list({ zone_id: zoneId })) {
      if (typeof lockdown.id !== "string" || lockdown.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareLockdown({ accountId, at, raw: { ...lockdown, id: lockdown.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "firewall-service-lockdowns-list" }));
  }
  return ok(entities);
}

/**
 * Read every legacy rate limit for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every rate limit's entity, or the reason the read failed
 */
export async function readCloudflareRateLimits({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const operation = "firewall-service-rate-limits-list";
  let listed: unknown;
  try {
    const pending: Promise<unknown> = client.rateLimits.list({ zone_id: zoneId });
    listed = await pending;
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation }));
  }
  return retiredListRecords({ listed, operation }).map((records) =>
    records.map((raw) => projectCloudflareRateLimit({ accountId, at, raw, zoneId })),
  );
}
