/**
 * The `zone-setting` reader: the configured deep zone's complete settings collection, reached through the
 * base client's own untyped `client.get()` — the pinned SDK version never wraps this list endpoint with a
 * typed resource method (see `projection/zoneSetting.ts`'s own header for what was confirmed live before
 * writing this). One call, no pagination — Cloudflare returns every setting in the one response.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { type CloudflareRawZoneSetting, projectCloudflareZoneSetting } from "../projection/zoneSetting.js";

/**
 * Read the configured deep zone's complete settings collection.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns every setting's entity, or the reason the read failed
 */
export async function readCloudflareZoneSettings({
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
    const response = await client.get<{ result: readonly CloudflareRawZoneSetting[] }>(`/zones/${zoneId}/settings`);
    const entities: CloudflareEntity[] = [];
    for (const setting of response.result) {
      if (typeof setting.id !== "string" || setting.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareZoneSetting({ accountId, at, raw: setting, zoneId }));
    }
    return ok(entities);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-settings-list" }));
  }
}
