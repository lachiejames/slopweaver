/**
 * The four Zero Trust DEVICE entity shapes and their projections — the device half of the enforcement
 * path: what is enrolled, which WARP profile each enrolment falls under, and what the account forces on all
 * of them.
 *
 * `device-posture-rule` was already covered, and holding it alone answers the wrong question: a posture
 * rule is a CHECK that a policy may reference, never a statement that any machine is enrolled. Measured,
 * every live WARP registration was absent from the atlas before these readers existed.
 *
 * ## A registration names a person, and that is the point
 *
 * `device-registration` stores the enrolled user's own identifier, because "whose machine is this" is the
 * question the kind exists to answer and an atlas that dropped it would answer nothing. It is the same
 * treatment `access-user` gets next door. Nothing here is a credential: the enrolment `key` field is the
 * device's WireGuard PUBLIC key, and it is stored for exactly the reason a fingerprint is — it identifies
 * the enrolment without being usable to impersonate it.
 *
 * ## `device-policy` folds two independent reads
 *
 * Cloudflare splits WARP profiles across two endpoints — one default profile that always exists
 * (`devices/policy`) and N custom ones (`devices/policies`) — and neither is complete without the other,
 * because a registration not matched by any custom profile falls to the default. Both fold into this one
 * kind, distinguished by the stored `isDefault` flag, the way `notification-destination` folds webhooks and
 * PagerDuty. The default profile has a real `policy_id`, so no synthetic id is invented for it.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The fixed provider id the account-wide device-settings singleton is stored under. */
export const DEVICE_SETTING_ID = "device-setting";

/** The stable fields one WARP registration carries. */
export interface CloudflareDeviceRegistrationDto {
  readonly id: string;
  readonly key?: string | null;
  readonly key_type?: string | null;
  readonly tunnel_type?: string | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
  readonly last_seen_at?: string | null;
  readonly device?: unknown;
  readonly user?: unknown;
  readonly virtual_ipv4?: string | null;
  readonly virtual_ipv6?: string | null;
}

/** The detail this atlas stores for the `device-registration` kind. */
export interface CloudflareDeviceRegistrationDetail {
  readonly kind: "device-registration";
  /** The device's own record — name, platform, OS version, serial and its own id. An open bucket: the
   * shape varies by platform and by WARP client version. */
  readonly device: unknown;
  /** Who this machine is enrolled to. See this file's header on why it is stored. */
  readonly user: unknown;
  /** The device's WireGuard PUBLIC key, and which key algorithm it is. Never a private key. */
  readonly publicKey: string | null;
  readonly keyType: string | null;
  readonly tunnelType: string | null;
  readonly virtualIpv4: string | null;
  readonly virtualIpv6: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly lastSeenAt: string | null;
}

/**
 * Project one WARP registration into a `device-registration` entity.
 *
 * @param registration the raw registration, already validated to carry a non-empty `id`
 * @param accountId the account this registration was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDeviceRegistration({
  registration,
  accountId,
  at,
}: {
  registration: CloudflareDeviceRegistrationDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDeviceRegistrationDetail = {
    createdAt: unsetFieldAsNull({ record: registration, key: "created_at" }),
    device: unsetFieldAsNull({ record: registration, key: "device" }),
    keyType: unsetFieldAsNull({ record: registration, key: "key_type" }),
    kind: "device-registration",
    lastSeenAt: unsetFieldAsNull({ record: registration, key: "last_seen_at" }),
    publicKey: unsetFieldAsNull({ record: registration, key: "key" }),
    tunnelType: unsetFieldAsNull({ record: registration, key: "tunnel_type" }),
    updatedAt: unsetFieldAsNull({ record: registration, key: "updated_at" }),
    user: unsetFieldAsNull({ record: registration, key: "user" }),
    virtualIpv4: unsetFieldAsNull({ record: registration, key: "virtual_ipv4" }),
    virtualIpv6: unsetFieldAsNull({ record: registration, key: "virtual_ipv6" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: registration.id }, kind: "device-registration" }),
    kind: "device-registration",
    lastSeenAt: at,
    providerId: registration.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "device-registrations-list" },
    state: "observed",
  };
}

/** The stable fields one WARP profile carries, default and custom alike. */
export interface CloudflareDevicePolicyDto {
  readonly policy_id: string;
  readonly name?: string | null;
  readonly description?: string | null;
  readonly default?: boolean | null;
  readonly enabled?: boolean | null;
  readonly precedence?: number | null;
  readonly match?: string | null;
  readonly service_mode_v2?: unknown;
  readonly exclude?: unknown;
  readonly include?: unknown;
  readonly fallback_domains?: unknown;
  readonly switch_locked?: boolean | null;
  readonly allow_mode_switch?: boolean | null;
  readonly allow_updates?: boolean | null;
  readonly allowed_to_leave?: boolean | null;
  readonly auto_connect?: number | null;
  readonly captive_portal?: number | null;
  readonly disable_auto_fallback?: boolean | null;
  readonly tunnel_protocol?: string | null;
}

/** The detail this atlas stores for the `device-policy` kind. */
export interface CloudflareDevicePolicyDetail {
  readonly kind: "device-policy";
  readonly name: string | null;
  readonly description: string | null;
  /** Whether this is the account's fallback profile — see this file's header on the two-endpoint fold. */
  readonly isDefault: boolean;
  readonly enabled: boolean | null;
  readonly precedence: number | null;
  /** The Wirefilter expression deciding which enrolments this profile applies to. `null` on the default. */
  readonly match: string | null;
  readonly serviceMode: unknown;
  readonly tunnelProtocol: string | null;
  /** Split-tunnel routes and DNS fallback — what WARP does and does not carry. Open buckets: each is a
   * variable-length array whose members differ by address/host form. */
  readonly exclude: unknown;
  readonly include: unknown;
  readonly fallbackDomains: unknown;
  /** What the enrolled person is allowed to do to the client. */
  readonly switchLocked: boolean | null;
  readonly allowModeSwitch: boolean | null;
  readonly allowUpdates: boolean | null;
  readonly allowedToLeave: boolean | null;
  readonly autoConnectSeconds: number | null;
  readonly captivePortalSeconds: number | null;
  readonly disableAutoFallback: boolean | null;
}

/**
 * Project one WARP profile — the default one or a custom one — into a `device-policy` entity.
 *
 * @param policy the raw profile, already validated to carry a non-empty `policy_id`
 * @param isDefault whether this came from the default-profile endpoint rather than the custom list
 * @param accountId the account this profile was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDevicePolicy({
  policy,
  isDefault,
  accountId,
  at,
}: {
  policy: CloudflareDevicePolicyDto;
  isDefault: boolean;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDevicePolicyDetail = {
    allowModeSwitch: unsetFieldAsNull({ record: policy, key: "allow_mode_switch" }),
    allowUpdates: unsetFieldAsNull({ record: policy, key: "allow_updates" }),
    allowedToLeave: unsetFieldAsNull({ record: policy, key: "allowed_to_leave" }),
    autoConnectSeconds: unsetFieldAsNull({ record: policy, key: "auto_connect" }),
    captivePortalSeconds: unsetFieldAsNull({ record: policy, key: "captive_portal" }),
    description: unsetFieldAsNull({ record: policy, key: "description" }),
    disableAutoFallback: unsetFieldAsNull({ record: policy, key: "disable_auto_fallback" }),
    enabled: unsetFieldAsNull({ record: policy, key: "enabled" }),
    exclude: unsetFieldAsNull({ record: policy, key: "exclude" }),
    fallbackDomains: unsetFieldAsNull({ record: policy, key: "fallback_domains" }),
    include: unsetFieldAsNull({ record: policy, key: "include" }),
    isDefault,
    kind: "device-policy",
    match: unsetFieldAsNull({ record: policy, key: "match" }),
    name: unsetFieldAsNull({ record: policy, key: "name" }),
    precedence: unsetFieldAsNull({ record: policy, key: "precedence" }),
    serviceMode: unsetFieldAsNull({ record: policy, key: "service_mode_v2" }),
    switchLocked: unsetFieldAsNull({ record: policy, key: "switch_locked" }),
    tunnelProtocol: unsetFieldAsNull({ record: policy, key: "tunnel_protocol" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: policy.policy_id }, kind: "device-policy" }),
    kind: "device-policy",
    lastSeenAt: at,
    providerId: policy.policy_id,
    scope: { accountId, parentId: null, zoneId: null },
    source: {
      channel: "rest-api",
      observedAt: at,
      operation: isDefault ? "device-default-policy-get" : "device-custom-policies-list",
    },
    state: "observed",
  };
}

/** The detail this atlas stores for the `device-setting` singleton. */
export interface CloudflareDeviceSettingDetail {
  readonly kind: "device-setting";
  readonly gatewayProxyEnabled: boolean | null;
  readonly gatewayUdpProxyEnabled: boolean | null;
  readonly rootCertificateInstallationEnabled: boolean | null;
  /** Whether these settings are managed through the API or edited in the dashboard. */
  readonly managed: string | null;
  readonly disableForTimeSeconds: number | null;
  readonly useZeroTrustVirtualIp: boolean | null;
}

/**
 * Project the account-wide Zero Trust device settings into their singleton entity.
 *
 * @param setting the raw settings response
 * @param accountId the account these settings were read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDeviceSetting({
  setting,
  accountId,
  at,
}: {
  setting: {
    readonly gateway_proxy_enabled?: boolean | null;
    readonly gateway_udp_proxy_enabled?: boolean | null;
    readonly root_certificate_installation_enabled?: boolean | null;
    readonly managed?: string | null;
    readonly disable_for_time?: number | null;
    readonly use_zt_virtual_ip?: boolean | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDeviceSettingDetail = {
    disableForTimeSeconds: unsetFieldAsNull({ record: setting, key: "disable_for_time" }),
    gatewayProxyEnabled: unsetFieldAsNull({ record: setting, key: "gateway_proxy_enabled" }),
    gatewayUdpProxyEnabled: unsetFieldAsNull({ record: setting, key: "gateway_udp_proxy_enabled" }),
    kind: "device-setting",
    managed: unsetFieldAsNull({ record: setting, key: "managed" }),
    rootCertificateInstallationEnabled: unsetFieldAsNull({
      record: setting,
      key: "root_certificate_installation_enabled",
    }),
    useZeroTrustVirtualIp: unsetFieldAsNull({ record: setting, key: "use_zt_virtual_ip" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: DEVICE_SETTING_ID }, kind: "device-setting" }),
    kind: "device-setting",
    lastSeenAt: at,
    providerId: DEVICE_SETTING_ID,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "device-settings-get" },
    state: "observed",
  };
}

/** The stable fields one managed network carries. */
export interface CloudflareDeviceManagedNetworkDto {
  readonly network_id: string;
  readonly name?: string | null;
  readonly type?: string | null;
  readonly config?: unknown;
}

/** The detail this atlas stores for the `device-managed-network` kind. */
export interface CloudflareDeviceManagedNetworkDetail {
  readonly kind: "device-managed-network";
  readonly name: string | null;
  readonly type: string | null;
  /** The TLS endpoint and certificate SHA this network is recognised by. */
  readonly config: unknown;
}

/**
 * Project one managed network into a `device-managed-network` entity.
 *
 * @param network the raw managed network, already validated to carry a non-empty `network_id`
 * @param accountId the account this network was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDeviceManagedNetwork({
  network,
  accountId,
  at,
}: {
  network: CloudflareDeviceManagedNetworkDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDeviceManagedNetworkDetail = {
    config: unsetFieldAsNull({ record: network, key: "config" }),
    kind: "device-managed-network",
    name: unsetFieldAsNull({ record: network, key: "name" }),
    type: unsetFieldAsNull({ record: network, key: "type" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({
      components: { accountId, providerId: network.network_id },
      kind: "device-managed-network",
    }),
    kind: "device-managed-network",
    lastSeenAt: at,
    providerId: network.network_id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "device-managed-networks-list" },
    state: "observed",
  };
}
