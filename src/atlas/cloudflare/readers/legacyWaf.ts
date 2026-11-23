/**
 * The `legacy-waf` readers: the account's WAF package inventory, one package's combined groups+rules read,
 * and the zone's independent WAF overrides collection. A live probe of a deep zone returned
 * `403 WAF is deprecated for this zone, Managed Rulesets should be used instead` for packages and `410 Gone`
 * for overrides — both honest, expected outcomes `legacyWafSync.ts` folds into a typed gap rather than a
 * crash; see that module's header for how a permanently-unavailable product is handled without losing any
 * other kind's data. The SDK has since typed the overrides list as `void` with no pager; `retiredList.ts` reads
 * what a success returns.
 */
import type Cloudflare from "cloudflare";

import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  type CloudflareLegacyWafRawChildItem,
  type CloudflareRawWafGroup,
  type CloudflareRawWafPackage,
  type CloudflareRawWafRule,
  projectCloudflareWafOverride,
} from "../projection/legacyWaf.js";
import { retiredListRecords } from "./retiredList.js";

/**
 * Read the zone's WAF package inventory. The SDK types this endpoint's item as bare `unknown` — see
 * `projection/legacyWaf.ts`'s header — so each item is validated at runtime rather than by the compiler.
 *
 * @param client the constructed Cloudflare client
 * @param zoneId the configured deep zone id
 * @returns every package with a usable string id, or the reason the read failed
 */
export async function readCloudflareWafPackageInventory({
  client,
  zoneId,
}: {
  client: Cloudflare;
  zoneId: string;
}): Promise<Result<readonly CloudflareRawWafPackage[], CloudflareClientError>> {
  const packages: CloudflareRawWafPackage[] = [];
  try {
    for await (const item of client.firewall.waf.packages.list({ zone_id: zoneId })) {
      if (!isRecord(item) || typeof item["id"] !== "string" || item["id"].length === 0) {
        continue;
      }
      packages.push({ ...item, id: item["id"] });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "legacy-waf-packages-list" }));
  }
  return ok(packages);
}

/**
 * Read one WAF package's combined groups and rules, tagged by which collection each item came from.
 *
 * @param client the constructed Cloudflare client
 * @param zoneId the configured deep zone id
 * @param packageId the package to read groups/rules for
 * @returns the package's combined, tagged children, or the reason the read failed
 */
export async function readCloudflareWafPackageChildren({
  client,
  zoneId,
  packageId,
}: {
  client: Cloudflare;
  zoneId: string;
  packageId: string;
}): Promise<Result<readonly CloudflareLegacyWafRawChildItem[], CloudflareClientError>> {
  const children: CloudflareLegacyWafRawChildItem[] = [];
  try {
    for await (const group of client.firewall.waf.packages.groups.list(packageId, { zone_id: zoneId })) {
      if (typeof group.id !== "string" || group.id.length === 0) {
        continue;
      }
      const raw: CloudflareRawWafGroup = { ...group, id: group.id };
      children.push({ group: raw, itemKind: "group" });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "legacy-waf-package-groups-list" }));
  }
  try {
    for await (const rule of client.firewall.waf.packages.rules.list(packageId, { zone_id: zoneId })) {
      if (typeof rule.id !== "string" || rule.id.length === 0) {
        continue;
      }
      const raw: CloudflareRawWafRule = { ...rule, id: rule.id };
      children.push({ itemKind: "rule", rule: raw });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "legacy-waf-package-rules-list" }));
  }
  return ok(children);
}

/**
 * Read every WAF override for the configured deep zone — zone-scoped, never nested under a package.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every override's entity, or the reason the read failed
 */
export async function readCloudflareWafOverrides({
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
  const operation = "legacy-waf-overrides-list";
  let listed: unknown;
  try {
    const pending: Promise<unknown> = client.firewall.waf.overrides.list({ zone_id: zoneId });
    listed = await pending;
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation }));
  }
  return retiredListRecords({ listed, operation }).map((records) =>
    records.map((raw) => projectCloudflareWafOverride({ accountId, at, raw, zoneId })),
  );
}
