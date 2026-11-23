/**
 * The two Zero Trust ACTOR readers — the Access seat register and the organisation singleton every seat is
 * judged under.
 *
 * `organizations.list` is a GET of one record despite its name; the SDK spells it that way because
 * Cloudflare's own route is `/accounts/{id}/access/organizations`. It is read as a singleton here, which is
 * what it is.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareAccessUser, projectCloudflareZeroTrustOrganization } from "../projection/zeroTrustActor.js";
import { singletonEntities } from "./singleton.js";

/**
 * Read every Access user under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every user's entity, or the reason the read failed
 */
export async function readCloudflareAccessUsers({
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
    for await (const user of client.zeroTrust.access.users.list({ account_id: accountId })) {
      if (typeof user.id !== "string" || user.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "an Access user had no id in the response",
            operation: "access-users-list",
          }),
        );
      }
      entities.push(projectCloudflareAccessUser({ accountId, at, user: { ...user, id: user.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-users-list" }));
  }
  return ok(entities);
}

/**
 * Read the Zero Trust organisation singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when no organisation is configured, or why the read failed
 */
export async function readCloudflareZeroTrustOrganization({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const organization = await client.zeroTrust.organizations.list({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareZeroTrustOrganization({ accountId, at, organization: value }),
        value: organization,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zero-trust-organization-get" }));
  }
}
