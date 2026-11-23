/**
 * The `account-setting` reader: a flat singleton, one GET call for the selected account itself.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareAccountSetting } from "../projection/accountSetting.js";

/**
 * Read the selected account's own metadata and settings.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element list carrying the account's entity, or the reason the read failed
 */
export async function readCloudflareAccountSetting({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const account = await client.accounts.get({ account_id: accountId });
    return ok([projectCloudflareAccountSetting({ account: { ...account, id: accountId }, at })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "account-get" }));
  }
}
