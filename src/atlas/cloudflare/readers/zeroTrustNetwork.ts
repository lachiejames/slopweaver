/**
 * The five Zero Trust PRIVATE-TOPOLOGY readers — tunnels, their routes, the virtual networks those routes
 * live in, the WARP subnets, and the account-wide connectivity singleton.
 *
 * The tunnel read is `tunnels.cloudflared.list`, not `tunnels.list`: the SDK reserves the latter for the
 * combined connector inventory including WARP connectors, and this atlas holds cloudflared tunnels, which
 * is what `tunnel-route` references by id.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareConnectivitySetting,
  projectCloudflareTunnel,
  projectCloudflareTunnelRoute,
  projectCloudflareVirtualNetwork,
  projectCloudflareZeroTrustSubnet,
} from "../projection/zeroTrustNetwork.js";
import { singletonEntities } from "./singleton.js";

/**
 * Read every cloudflared tunnel under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every tunnel's entity, or the reason the read failed
 */
export async function readCloudflareTunnels({
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
    for await (const tunnel of client.zeroTrust.tunnels.cloudflared.list({ account_id: accountId })) {
      if (typeof tunnel.id !== "string" || tunnel.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a tunnel named "${tunnel.name}" had no id in the response`,
            operation: "tunnels-list",
          }),
        );
      }
      entities.push(projectCloudflareTunnel({ accountId, at, tunnel: { ...tunnel, id: tunnel.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "tunnels-list" }));
  }
  return ok(entities);
}

/**
 * Read every tunnel route under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every route's entity, or the reason the read failed
 */
export async function readCloudflareTunnelRoutes({
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
    for await (const route of client.zeroTrust.networks.routes.list({ account_id: accountId })) {
      if (typeof route.id !== "string" || route.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "a tunnel route had no id in the response",
            operation: "tunnel-routes-list",
          }),
        );
      }
      entities.push(projectCloudflareTunnelRoute({ accountId, at, route: { ...route, id: route.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "tunnel-routes-list" }));
  }
  return ok(entities);
}

/**
 * Read every virtual network under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every virtual network's entity, or the reason the read failed
 */
export async function readCloudflareVirtualNetworks({
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
    for await (const network of client.zeroTrust.networks.virtualNetworks.list({ account_id: accountId })) {
      if (typeof network.id !== "string" || network.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a virtual network named "${network.name}" had no id in the response`,
            operation: "virtual-networks-list",
          }),
        );
      }
      entities.push(projectCloudflareVirtualNetwork({ accountId, at, network: { ...network, id: network.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "virtual-networks-list" }));
  }
  return ok(entities);
}

/**
 * Read every Zero Trust subnet under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every subnet's entity, or the reason the read failed
 */
export async function readCloudflareZeroTrustSubnets({
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
    for await (const subnet of client.zeroTrust.networks.subnets.list({ account_id: accountId })) {
      if (typeof subnet.id !== "string" || subnet.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a Zero Trust subnet named "${subnet.name}" had no id in the response`,
            operation: "zero-trust-subnets-list",
          }),
        );
      }
      entities.push(projectCloudflareZeroTrustSubnet({ accountId, at, subnet: { ...subnet, id: subnet.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zero-trust-subnets-list" }));
  }
  return ok(entities);
}

/**
 * Read the account's Zero Trust connectivity settings singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when the account carries no such settings, or why the read failed
 */
export async function readCloudflareConnectivitySetting({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const setting = await client.zeroTrust.connectivitySettings.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareConnectivitySetting({ accountId, at, setting: value }),
        value: setting,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "connectivity-settings-get" }));
  }
}
