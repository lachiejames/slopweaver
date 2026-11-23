/**
 * The five Zero Trust PRIVATE-TOPOLOGY entity shapes and their projections — what this account reaches
 * privately, and how.
 *
 * Read them as one picture rather than five kinds: a `tunnel` is a cloudflared connector, a `tunnel-route`
 * is a CIDR that connector serves, a `virtual-network` is the namespace those routes live in so two
 * overlapping private ranges can coexist, and a `zero-trust-subnet` is the address space WARP hands out.
 * `connectivity-setting` is the account-wide switch pair (ICMP proxying and WARP-to-WARP offramp) that
 * decides whether any of it carries traffic at all. Measured, every live tunnel, route, virtual
 * network and subnet was absent from the atlas before these readers existed.
 *
 * A tunnel's `credentials_file`/token is a create-only secret Cloudflare's read APIs never return, so no
 * redaction step is needed here; what IS stored is the connector's own connection list, which is the fact a
 * reader asks for when a private route stops answering.
 */
import { absentAsNull, unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The fixed provider id the account-wide connectivity-settings singleton is stored under. */
export const CONNECTIVITY_SETTING_ID = "connectivity-setting";

/** The stable fields one cloudflared tunnel carries. */
export interface CloudflareTunnelDto {
  readonly id: string;
  readonly name?: string | null;
  readonly status?: string | null;
  readonly tun_type?: string | null;
  readonly config_src?: string | null;
  readonly remote_config?: boolean | null;
  readonly connections?: unknown;
  readonly metadata?: unknown;
  readonly created_at?: string | null;
  readonly deleted_at?: string | null;
  readonly conns_active_at?: string | null;
  readonly conns_inactive_at?: string | null;
}

/** The detail this atlas stores for the `tunnel` kind. */
export interface CloudflareTunnelDetail {
  readonly kind: "tunnel";
  readonly name: string | null;
  readonly status: string | null;
  readonly tunnelType: string | null;
  /** Whether the connector's configuration is held by Cloudflare or on the machine running it. */
  readonly configSource: string | null;
  readonly remoteConfig: boolean | null;
  /** One entry per live connector process — colo, client version and origin IP. */
  readonly connections: unknown;
  readonly metadata: unknown;
  readonly createdAt: string | null;
  readonly deletedAt: string | null;
  readonly connectionsActiveAt: string | null;
  readonly connectionsInactiveAt: string | null;
}

/**
 * Project one cloudflared tunnel into a `tunnel` entity.
 *
 * @param tunnel the raw tunnel, already validated to carry a non-empty `id`
 * @param accountId the account this tunnel was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareTunnel({
  tunnel,
  accountId,
  at,
}: {
  tunnel: CloudflareTunnelDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareTunnelDetail = {
    configSource: unsetFieldAsNull({ record: tunnel, key: "config_src" }),
    connections: unsetFieldAsNull({ record: tunnel, key: "connections" }),
    connectionsActiveAt: unsetFieldAsNull({ record: tunnel, key: "conns_active_at" }),
    connectionsInactiveAt: unsetFieldAsNull({ record: tunnel, key: "conns_inactive_at" }),
    createdAt: unsetFieldAsNull({ record: tunnel, key: "created_at" }),
    deletedAt: unsetFieldAsNull({ record: tunnel, key: "deleted_at" }),
    kind: "tunnel",
    metadata: unsetFieldAsNull({ record: tunnel, key: "metadata" }),
    name: unsetFieldAsNull({ record: tunnel, key: "name" }),
    remoteConfig: unsetFieldAsNull({ record: tunnel, key: "remote_config" }),
    status: unsetFieldAsNull({ record: tunnel, key: "status" }),
    tunnelType: unsetFieldAsNull({ record: tunnel, key: "tun_type" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: tunnel.id }, kind: "tunnel" }),
    kind: "tunnel",
    lastSeenAt: at,
    providerId: tunnel.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "tunnels-list" },
    state: "observed",
  };
}

/** The stable fields one tunnel route carries. */
export interface CloudflareTunnelRouteDto {
  readonly id: string;
  readonly network?: string | null;
  readonly tunnel_id?: string | null;
  readonly tunnel_name?: string | null;
  readonly virtual_network_id?: string | null;
  readonly virtual_network_name?: string | null;
  readonly comment?: string | null;
  readonly tun_type?: string | null;
  readonly created_at?: string | null;
  readonly deleted_at?: string | null;
}

/** The detail this atlas stores for the `tunnel-route` kind. */
export interface CloudflareTunnelRouteDetail {
  readonly kind: "tunnel-route";
  /** The private CIDR this route makes reachable. */
  readonly network: string | null;
  readonly tunnelId: string | null;
  readonly tunnelName: string | null;
  readonly virtualNetworkId: string | null;
  readonly virtualNetworkName: string | null;
  readonly comment: string | null;
  readonly tunnelType: string | null;
  readonly createdAt: string | null;
  readonly deletedAt: string | null;
}

/**
 * Project one tunnel route into a `tunnel-route` entity.
 *
 * @param route the raw route, already validated to carry a non-empty `id`
 * @param accountId the account this route was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareTunnelRoute({
  route,
  accountId,
  at,
}: {
  route: CloudflareTunnelRouteDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareTunnelRouteDetail = {
    comment: unsetFieldAsNull({ record: route, key: "comment" }),
    createdAt: unsetFieldAsNull({ record: route, key: "created_at" }),
    deletedAt: unsetFieldAsNull({ record: route, key: "deleted_at" }),
    kind: "tunnel-route",
    network: unsetFieldAsNull({ record: route, key: "network" }),
    tunnelId: unsetFieldAsNull({ record: route, key: "tunnel_id" }),
    tunnelName: unsetFieldAsNull({ record: route, key: "tunnel_name" }),
    tunnelType: unsetFieldAsNull({ record: route, key: "tun_type" }),
    virtualNetworkId: unsetFieldAsNull({ record: route, key: "virtual_network_id" }),
    virtualNetworkName: unsetFieldAsNull({ record: route, key: "virtual_network_name" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: route.id }, kind: "tunnel-route" }),
    kind: "tunnel-route",
    lastSeenAt: at,
    providerId: route.id,
    scope: { accountId, parentId: unsetFieldAsNull({ record: route, key: "tunnel_id" }), zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "tunnel-routes-list" },
    state: "observed",
  };
}

/** The stable fields one virtual network carries. */
export interface CloudflareVirtualNetworkDto {
  readonly id: string;
  readonly name?: string | null;
  readonly comment?: string | null;
  readonly is_default_network?: boolean | null;
  readonly created_at?: string | null;
  readonly deleted_at?: string | null;
}

/** The detail this atlas stores for the `virtual-network` kind. */
export interface CloudflareVirtualNetworkDetail {
  readonly kind: "virtual-network";
  readonly name: string | null;
  readonly comment: string | null;
  readonly isDefaultNetwork: boolean | null;
  readonly createdAt: string | null;
  readonly deletedAt: string | null;
}

/**
 * Project one virtual network into a `virtual-network` entity.
 *
 * @param network the raw virtual network, already validated to carry a non-empty `id`
 * @param accountId the account this network was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareVirtualNetwork({
  network,
  accountId,
  at,
}: {
  network: CloudflareVirtualNetworkDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareVirtualNetworkDetail = {
    comment: absentAsNull({ value: network.comment }),
    createdAt: absentAsNull({ value: network.created_at }),
    deletedAt: unsetFieldAsNull({ record: network, key: "deleted_at" }),
    isDefaultNetwork: absentAsNull({ value: network.is_default_network }),
    kind: "virtual-network",
    name: absentAsNull({ value: network.name }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: network.id }, kind: "virtual-network" }),
    kind: "virtual-network",
    lastSeenAt: at,
    providerId: network.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "virtual-networks-list" },
    state: "observed",
  };
}

/** The stable fields one Zero Trust subnet carries. */
export interface CloudflareZeroTrustSubnetDto {
  readonly id: string;
  readonly name?: string | null;
  readonly comment?: string | null;
  readonly network?: string | null;
  readonly subnet_type?: string | null;
  readonly is_default_network?: boolean | null;
  readonly created_at?: string | null;
  readonly deleted_at?: string | null;
}

/** The detail this atlas stores for the `zero-trust-subnet` kind. */
export interface CloudflareZeroTrustSubnetDetail {
  readonly kind: "zero-trust-subnet";
  readonly name: string | null;
  readonly comment: string | null;
  /** The address space WARP allocates out of. */
  readonly network: string | null;
  readonly subnetType: string | null;
  readonly isDefaultNetwork: boolean | null;
  readonly createdAt: string | null;
  readonly deletedAt: string | null;
}

/**
 * Project one Zero Trust subnet into a `zero-trust-subnet` entity.
 *
 * @param subnet the raw subnet, already validated to carry a non-empty `id`
 * @param accountId the account this subnet was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareZeroTrustSubnet({
  subnet,
  accountId,
  at,
}: {
  subnet: CloudflareZeroTrustSubnetDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareZeroTrustSubnetDetail = {
    comment: unsetFieldAsNull({ record: subnet, key: "comment" }),
    createdAt: unsetFieldAsNull({ record: subnet, key: "created_at" }),
    deletedAt: unsetFieldAsNull({ record: subnet, key: "deleted_at" }),
    isDefaultNetwork: unsetFieldAsNull({ record: subnet, key: "is_default_network" }),
    kind: "zero-trust-subnet",
    name: unsetFieldAsNull({ record: subnet, key: "name" }),
    network: unsetFieldAsNull({ record: subnet, key: "network" }),
    subnetType: unsetFieldAsNull({ record: subnet, key: "subnet_type" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: subnet.id }, kind: "zero-trust-subnet" }),
    kind: "zero-trust-subnet",
    lastSeenAt: at,
    providerId: subnet.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "zero-trust-subnets-list" },
    state: "observed",
  };
}

/** The detail this atlas stores for the `connectivity-setting` singleton. */
export interface CloudflareConnectivitySettingDetail {
  readonly kind: "connectivity-setting";
  readonly icmpProxyEnabled: boolean | null;
  /** Whether WARP-to-WARP traffic leaves through the account's own egress rather than direct. */
  readonly offrampWarpEnabled: boolean | null;
}

/**
 * Project the account's Zero Trust connectivity settings into their singleton entity.
 *
 * @param setting the raw connectivity-settings response
 * @param accountId the account these settings were read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareConnectivitySetting({
  setting,
  accountId,
  at,
}: {
  setting: { readonly icmp_proxy_enabled?: boolean | null; readonly offramp_warp_enabled?: boolean };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareConnectivitySettingDetail = {
    icmpProxyEnabled: unsetFieldAsNull({ record: setting, key: "icmp_proxy_enabled" }),
    kind: "connectivity-setting",
    offrampWarpEnabled: unsetFieldAsNull({ record: setting, key: "offramp_warp_enabled" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({
      components: { accountId, providerId: CONNECTIVITY_SETTING_ID },
      kind: "connectivity-setting",
    }),
    kind: "connectivity-setting",
    lastSeenAt: at,
    providerId: CONNECTIVITY_SETTING_ID,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "connectivity-settings-get" },
    state: "observed",
  };
}
