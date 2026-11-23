/**
 * The `dnssec` reader: a flat singleton, one GET call for the configured deep zone's DNSSEC status.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareDnssec } from "../projection/dnssec.js";

/**
 * Read the configured deep zone's DNSSEC status.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns a one-element list carrying the zone's DNSSEC entity, or the reason the read failed
 */
export async function readCloudflareDnssec({
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
  try {
    const dnssec = await client.dns.dnssec.get({ zone_id: zoneId });
    return ok([projectCloudflareDnssec({ accountId, at, raw: dnssec, zoneId })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "dnssec-get" }));
  }
}
