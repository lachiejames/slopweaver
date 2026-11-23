/**
 * The four Zero Trust DEVICE readers.
 *
 * `device-policy` is the one that is not a straight list: it reads the default WARP profile and the custom
 * profile list as two INDEPENDENT calls and returns both, because a registration matched by no custom
 * profile falls to the default and a kind holding one without the other describes an enforcement path that
 * does not exist. Both reads must succeed — a partial answer here is a wrong answer, not a smaller one —
 * so the first failure is returned rather than folded away, exactly as `worker-account-setting`'s two-call
 * singleton does.
 *
 * **The two endpoints OVERLAP, and that is measured rather than assumed.** `devices/policies` returns the
 * default profile alongside the custom ones — MEASURED live: a row in the custom list carried
 * the same `policy_id` the default endpoint had just returned. Emitting both projects one thing twice, and `merge.ts`'s duplicate-id guard refuses the
 * WHOLE generation for it: `this run produced the same entity id twice … refusing to merge`. That refusal
 * is what found this, on the first live sync, after every unit test passed — the fixtures had modelled two
 * disjoint endpoints because the SDK's shape suggests two. So the default endpoint is read FIRST and its
 * `policy_id` is skipped in the custom list: the default profile's own record is the authoritative one for
 * itself, and it is the only one of the two that is guaranteed to carry `isDefault`.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareDeviceManagedNetwork,
  projectCloudflareDevicePolicy,
  projectCloudflareDeviceRegistration,
  projectCloudflareDeviceSetting,
} from "../projection/zeroTrustDevice.js";
import { singletonEntities } from "./singleton.js";

/**
 * Read every WARP device registration under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every registration's entity, or the reason the read failed
 */
export async function readCloudflareDeviceRegistrations({
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
    for await (const registration of client.zeroTrust.devices.registrations.list({ account_id: accountId })) {
      if (typeof registration.id !== "string" || registration.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "a WARP device registration had no id in the response",
            operation: "device-registrations-list",
          }),
        );
      }
      entities.push(
        projectCloudflareDeviceRegistration({ accountId, at, registration: { ...registration, id: registration.id } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "device-registrations-list" }));
  }
  return ok(entities);
}

/**
 * Read the account's default WARP profile and every custom one, as the single `device-policy` kind.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns the default profile followed by every custom one, or the reason either read failed
 */
export async function readCloudflareDevicePolicies({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  const seen = new Set<string>();
  try {
    const fallback = await client.zeroTrust.devices.policies.default.get({ account_id: accountId });
    if (fallback != null && typeof fallback.policy_id === "string" && fallback.policy_id.length > 0) {
      seen.add(fallback.policy_id);
      entities.push(
        projectCloudflareDevicePolicy({
          accountId,
          at,
          isDefault: true,
          policy: { ...fallback, policy_id: fallback.policy_id },
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "device-default-policy-get" }));
  }
  try {
    for await (const policy of client.zeroTrust.devices.policies.custom.list({ account_id: accountId })) {
      if (typeof policy.policy_id !== "string" || policy.policy_id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a custom WARP profile named "${policy.name}" had no policy_id in the response`,
            operation: "device-custom-policies-list",
          }),
        );
      }
      // The custom list carries the default profile too — see this file's header for the live measurement
      // and the generation-wide refusal that found it.
      if (seen.has(policy.policy_id)) {
        continue;
      }
      seen.add(policy.policy_id);
      entities.push(
        projectCloudflareDevicePolicy({
          accountId,
          at,
          isDefault: false,
          policy: { ...policy, policy_id: policy.policy_id },
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "device-custom-policies-list" }));
  }
  return ok(entities);
}

/**
 * Read the account-wide Zero Trust device settings singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when the account carries no such settings, or why the read failed
 */
export async function readCloudflareDeviceSetting({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const setting = await client.zeroTrust.devices.settings.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareDeviceSetting({ accountId, at, setting: value }),
        value: setting,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "device-settings-get" }));
  }
}

/**
 * Read every managed network under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every managed network's entity, or the reason the read failed
 */
export async function readCloudflareDeviceManagedNetworks({
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
    for await (const network of client.zeroTrust.devices.networks.list({ account_id: accountId })) {
      if (typeof network.network_id !== "string" || network.network_id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a managed network named "${network.name}" had no network_id in the response`,
            operation: "device-managed-networks-list",
          }),
        );
      }
      entities.push(
        projectCloudflareDeviceManagedNetwork({
          accountId,
          at,
          network: { ...network, network_id: network.network_id },
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "device-managed-networks-list" }));
  }
  return ok(entities);
}
