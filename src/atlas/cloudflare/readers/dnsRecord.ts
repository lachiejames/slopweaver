/**
 * The `dns-record` reader: every DNS record for the configured deep zone, cursor-exhausted by the SDK's own
 * `V4PagePaginationArray`.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareDnsRecord } from "../projection/dnsRecord.js";

/**
 * Read every DNS record in the configured deep zone, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns every record's entity, or the reason the read failed
 */
export async function readCloudflareDnsRecords({
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
    for await (const record of client.dns.records.list({ zone_id: zoneId })) {
      if (typeof record.id !== "string" || record.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareDnsRecord({ accountId, at, raw: { ...record, id: record.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "dns-records-list" }));
  }
  return ok(entities);
}
