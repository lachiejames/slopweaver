/**
 * The `worker-account-setting` reader: a SINGLETON, not a list — one combined read of the account's Workers
 * settings and its `*.workers.dev` subdomain, folded into a one-entity result so it fits the same
 * `FlatKindReader` contract every other flat kind uses.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import { projectCloudflareWorkerAccountSetting } from "../projection/workerAccountSetting.js";

/**
 * Read the account's Workers account settings and subdomain, projecting both into the one
 * `worker-account-setting` entity this kind ever holds.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array holding the projected entity, or the reason either read failed
 */
export async function readCloudflareWorkerAccountSetting({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  let accountSetting: Awaited<ReturnType<typeof client.workers.accountSettings.get>>;
  try {
    accountSetting = await client.workers.accountSettings.get({ account_id: accountId });
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "workers-account-settings-get" }));
  }
  let subdomain: Awaited<ReturnType<typeof client.workers.subdomains.get>>;
  try {
    subdomain = await client.workers.subdomains.get({ account_id: accountId });
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "workers-subdomains-get" }));
  }
  return ok([projectCloudflareWorkerAccountSetting({ accountId, accountSetting, at, subdomain })]);
}
