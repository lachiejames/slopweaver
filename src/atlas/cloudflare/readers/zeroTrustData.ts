/**
 * The two Zero Trust DATA-CONTROL readers — DLP profiles and CASB integrations.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareCasbIntegration, projectCloudflareDlpProfile } from "../projection/zeroTrustData.js";

/**
 * Read every DLP profile under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every profile's entity, or the reason the read failed
 */
export async function readCloudflareDlpProfiles({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const profile of client.zeroTrust.dlp.profiles.list({ account_id: accountId })) {
      if (typeof profile.id !== "string" || profile.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a DLP profile named "${profile.name}" had no id in the response`,
            operation: "dlp-profiles-list",
          }),
        );
      }
      entities.push(projectCloudflareDlpProfile({ accountId, at, profile: { ...profile, id: profile.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "dlp-profiles-list" }));
  }
  return ok(entities);
}

/**
 * Read every CASB integration under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every integration's entity, or the reason the read failed
 */
export async function readCloudflareCasbIntegrations({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const integration of client.zeroTrust.casb.integrations.list({ account_id: accountId })) {
      if (typeof integration.id !== "string" || integration.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a CASB integration named "${integration.name}" had no id in the response`,
            operation: "casb-integrations-list",
          }),
        );
      }
      entities.push(
        projectCloudflareCasbIntegration({ accountId, at, integration: { ...integration, id: integration.id } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "casb-integrations-list" }));
  }
  return ok(entities);
}
