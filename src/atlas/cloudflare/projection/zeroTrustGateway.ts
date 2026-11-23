/**
 * The seven Zero Trust GATEWAY entity shapes and their projections — the egress half of the enforcement
 * path: which policies decide a request's fate, how the proxy is configured, where traffic enters, and what
 * certificate inspects it.
 *
 * `gateway-list` was already covered before this file existed, and the distinction is the whole reason this
 * one does: a Gateway LIST is a named set of domains or addresses, and a Gateway POLICY is the rule that
 * REFERENCES one and decides what happens. Holding the lists without the policies is holding the nouns
 * without the verb — measured, the live DNS/HTTP/Network policies were none of them stored.
 *
 * Three of the seven are SINGLETONS — `gateway-configuration`, `gateway-logging` and
 * `gateway-audit-ssh-setting` — projected in `projection/zeroTrustGatewaySingleton.ts` and re-exported here,
 * so an importer of the Gateway projections names one module.
 *
 * **A certificate's PEM body is deliberately not stored**, exactly as `projection/accountCertificate.ts`
 * decided for account mTLS: the fingerprint, issuer, binding status and expiry are what a reader asks
 * about, and the body is bytes nobody greps. Nothing here is a private key — Cloudflare's read APIs return
 * none — so this is a size call rather than a secrecy one.
 *
 * A field the SDK declares OPTIONAL is read through `unsetFieldAsNull`. The fields its response types
 * declare REQUIRED — a rule's `action`, `enabled`, `filters`, `name`, `precedence` and `traffic`, and a proxy
 * endpoint's `name` (and an IP endpoint's `ips`) — keep their `??` until the reader refuses their absence.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

export {
  GATEWAY_AUDIT_SSH_ID,
  GATEWAY_CONFIGURATION_ID,
  GATEWAY_LOGGING_ID,
  projectCloudflareGatewayAuditSsh,
  projectCloudflareGatewayConfiguration,
  projectCloudflareGatewayLogging,
} from "./zeroTrustGatewaySingleton.js";

/** The stable fields one Gateway rule carries. */
export interface CloudflareGatewayPolicyDto {
  readonly id: string;
  readonly name?: string | null;
  readonly description?: string | null;
  readonly action?: string | null;
  readonly enabled?: boolean | null;
  readonly precedence?: number | null;
  readonly filters?: readonly string[] | null;
  readonly traffic?: string | null;
  readonly identity?: string | null;
  readonly device_posture?: string | null;
  readonly rule_settings?: unknown;
  readonly version?: number | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
  readonly deleted_at?: string | null;
}

/** The detail this atlas stores for the `gateway-policy` kind. */
export interface CloudflareGatewayPolicyDetail {
  readonly kind: "gateway-policy";
  readonly name: string | null;
  readonly description: string | null;
  readonly action: string | null;
  readonly enabled: boolean | null;
  readonly precedence: number | null;
  /** Which of DNS, HTTP, L4 and egress this policy is evaluated on. */
  readonly filters: readonly string[];
  /** The three Wirefilter expressions a policy matches on, kept verbatim — they ARE the policy. */
  readonly traffic: string | null;
  readonly identity: string | null;
  readonly devicePosture: string | null;
  /** Per-action settings (block page, DoH subdomain, egress IP, …) — an open bucket, like a posture rule's. */
  readonly ruleSettings: unknown;
  readonly version: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly deletedAt: string | null;
}

/**
 * Project one Gateway rule into a `gateway-policy` entity.
 *
 * @param policy the raw rule, already validated to carry a non-empty `id`
 * @param accountId the account this rule was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayPolicy({
  policy,
  accountId,
  at,
}: {
  policy: CloudflareGatewayPolicyDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayPolicyDetail = {
    action: policy.action ?? null,
    createdAt: unsetFieldAsNull({ key: "created_at", record: policy }),
    deletedAt: unsetFieldAsNull({ key: "deleted_at", record: policy }),
    description: unsetFieldAsNull({ key: "description", record: policy }),
    devicePosture: unsetFieldAsNull({ key: "device_posture", record: policy }),
    enabled: policy.enabled ?? null,
    filters: [...(policy.filters ?? [])],
    identity: unsetFieldAsNull({ key: "identity", record: policy }),
    kind: "gateway-policy",
    name: policy.name ?? null,
    precedence: policy.precedence ?? null,
    ruleSettings: unsetFieldAsNull({ key: "rule_settings", record: policy }),
    traffic: policy.traffic ?? null,
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: policy }),
    version: unsetFieldAsNull({ key: "version", record: policy }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: policy.id }, kind: "gateway-policy" }),
    kind: "gateway-policy",
    lastSeenAt: at,
    providerId: policy.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-policies-list" },
    state: "observed",
  };
}

/** The stable fields one Gateway location carries. */
export interface CloudflareGatewayLocationDto {
  readonly id: string;
  readonly name?: string | null;
  readonly client_default?: boolean | null;
  readonly ecs_support?: boolean | null;
  readonly doh_subdomain?: string | null;
  readonly ip?: string | null;
  readonly ipv4_destination?: string | null;
  readonly networks?: unknown;
  readonly endpoints?: unknown;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
}

/** The detail this atlas stores for the `gateway-location` kind. */
export interface CloudflareGatewayLocationDetail {
  readonly kind: "gateway-location";
  readonly name: string | null;
  readonly clientDefault: boolean | null;
  readonly ecsSupport: boolean | null;
  readonly dohSubdomain: string | null;
  readonly ip: string | null;
  readonly ipv4Destination: string | null;
  /** The source networks this location claims, and the DoH/DoT/IPv4/IPv6 endpoints it exposes. */
  readonly networks: unknown;
  readonly endpoints: unknown;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project one Gateway location into a `gateway-location` entity.
 *
 * @param location the raw location, already validated to carry a non-empty `id`
 * @param accountId the account this location was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayLocation({
  location,
  accountId,
  at,
}: {
  location: CloudflareGatewayLocationDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayLocationDetail = {
    clientDefault: unsetFieldAsNull({ key: "client_default", record: location }),
    createdAt: unsetFieldAsNull({ key: "created_at", record: location }),
    dohSubdomain: unsetFieldAsNull({ key: "doh_subdomain", record: location }),
    ecsSupport: unsetFieldAsNull({ key: "ecs_support", record: location }),
    endpoints: unsetFieldAsNull({ key: "endpoints", record: location }),
    ip: unsetFieldAsNull({ key: "ip", record: location }),
    ipv4Destination: unsetFieldAsNull({ key: "ipv4_destination", record: location }),
    kind: "gateway-location",
    name: unsetFieldAsNull({ key: "name", record: location }),
    networks: unsetFieldAsNull({ key: "networks", record: location }),
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: location }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: location.id }, kind: "gateway-location" }),
    kind: "gateway-location",
    lastSeenAt: at,
    providerId: location.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-locations-list" },
    state: "observed",
  };
}

/** The stable fields one Gateway (TLS-inspection) certificate carries. */
export interface CloudflareGatewayCertificateDto {
  readonly id: string;
  readonly type?: string | null;
  readonly in_use?: boolean | null;
  readonly binding_status?: string | null;
  readonly fingerprint?: string | null;
  readonly issuer_org?: string | null;
  readonly issuer_raw?: string | null;
  readonly expires_on?: string | null;
  readonly uploaded_on?: string | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
}

/** The detail this atlas stores for the `gateway-certificate` kind. See this file's header on the PEM body. */
export interface CloudflareGatewayCertificateDetail {
  readonly kind: "gateway-certificate";
  readonly type: string | null;
  /** Whether Gateway is currently inspecting traffic with this certificate. */
  readonly inUse: boolean | null;
  readonly bindingStatus: string | null;
  readonly fingerprint: string | null;
  readonly issuerOrg: string | null;
  readonly issuerRaw: string | null;
  readonly expiresOn: string | null;
  readonly uploadedOn: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project one Gateway certificate into a `gateway-certificate` entity.
 *
 * @param certificate the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the account this certificate was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayCertificate({
  certificate,
  accountId,
  at,
}: {
  certificate: CloudflareGatewayCertificateDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayCertificateDetail = {
    bindingStatus: unsetFieldAsNull({ key: "binding_status", record: certificate }),
    createdAt: unsetFieldAsNull({ key: "created_at", record: certificate }),
    expiresOn: unsetFieldAsNull({ key: "expires_on", record: certificate }),
    fingerprint: unsetFieldAsNull({ key: "fingerprint", record: certificate }),
    inUse: unsetFieldAsNull({ key: "in_use", record: certificate }),
    issuerOrg: unsetFieldAsNull({ key: "issuer_org", record: certificate }),
    issuerRaw: unsetFieldAsNull({ key: "issuer_raw", record: certificate }),
    kind: "gateway-certificate",
    type: unsetFieldAsNull({ key: "type", record: certificate }),
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: certificate }),
    uploadedOn: unsetFieldAsNull({ key: "uploaded_on", record: certificate }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: certificate.id }, kind: "gateway-certificate" }),
    kind: "gateway-certificate",
    lastSeenAt: at,
    providerId: certificate.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-certificates-list" },
    state: "observed",
  };
}

/** The stable fields one Gateway proxy endpoint carries. */
export interface CloudflareGatewayProxyEndpointDto {
  readonly id: string;
  readonly name?: string | null;
  readonly ips?: readonly string[] | null;
  readonly subdomain?: string | null;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
}

/** The detail this atlas stores for the `gateway-proxy-endpoint` kind. */
export interface CloudflareGatewayProxyEndpointDetail {
  readonly kind: "gateway-proxy-endpoint";
  readonly name: string | null;
  /** The source CIDRs allowed to reach this dedicated proxy endpoint — an egress allow-list. */
  readonly ips: readonly string[];
  readonly subdomain: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

/**
 * Project one Gateway proxy endpoint into a `gateway-proxy-endpoint` entity.
 *
 * @param endpoint the raw endpoint, already validated to carry a non-empty `id`
 * @param accountId the account this endpoint was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayProxyEndpoint({
  endpoint,
  accountId,
  at,
}: {
  endpoint: CloudflareGatewayProxyEndpointDto;
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareGatewayProxyEndpointDetail = {
    createdAt: unsetFieldAsNull({ key: "created_at", record: endpoint }),
    ips: [...(endpoint.ips ?? [])],
    kind: "gateway-proxy-endpoint",
    name: endpoint.name ?? null,
    subdomain: unsetFieldAsNull({ key: "subdomain", record: endpoint }),
    updatedAt: unsetFieldAsNull({ key: "updated_at", record: endpoint }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: endpoint.id }, kind: "gateway-proxy-endpoint" }),
    kind: "gateway-proxy-endpoint",
    lastSeenAt: at,
    providerId: endpoint.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-proxy-endpoints-list" },
    state: "observed",
  };
}
