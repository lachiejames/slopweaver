import { describe, expect, it } from "vitest";

import {
  type CloudflareGatewayCertificateDetail,
  type CloudflareGatewayLocationDetail,
  type CloudflareGatewayPolicyDetail,
  type CloudflareGatewayProxyEndpointDetail,
  GATEWAY_AUDIT_SSH_ID,
  GATEWAY_CONFIGURATION_ID,
  GATEWAY_LOGGING_ID,
  projectCloudflareGatewayAuditSsh,
  projectCloudflareGatewayCertificate,
  projectCloudflareGatewayConfiguration,
  projectCloudflareGatewayLocation,
  projectCloudflareGatewayLogging,
  projectCloudflareGatewayPolicy,
  projectCloudflareGatewayProxyEndpoint,
} from "../../../../../atlas/cloudflare/projection/zeroTrustGateway.js";
import type {
  CloudflareGatewayAuditSshDetail,
  CloudflareGatewayConfigurationDetail,
  CloudflareGatewayLoggingDetail,
} from "../../../../../atlas/cloudflare/projection/zeroTrustGatewaySingleton.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

/** Synthetic, and never a real key — the point is only that the projected detail must not echo it back. */
const PRIVATE_KEY_PEM =
  "-----BEGIN OPENSSH PRIVATE KEY----- AAAAsyntheticnotarealkey -----END OPENSSH PRIVATE KEY-----";
const CERTIFICATE_PEM = "-----BEGIN CERTIFICATE----- AAAAsyntheticnotarealcert -----END CERTIFICATE-----";

describe("projectCloudflareGatewayPolicy", () => {
  it("keeps the three match expressions verbatim — they are the policy", () => {
    const entity = projectCloudflareGatewayPolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      policy: {
        action: "block",
        device_posture: 'any(device_posture.checks.passed[*] in {"warp"})',
        enabled: true,
        filters: ["http"],
        id: "rule-1",
        identity: 'identity.email == "person@example.test"',
        name: "block uploads",
        precedence: 10,
        traffic: 'http.request.uri matches ".*"',
      },
    });
    const detail = entity.detail as CloudflareGatewayPolicyDetail;
    expect(detail.traffic).toBe('http.request.uri matches ".*"');
    expect(detail.identity).toBe('identity.email == "person@example.test"');
    expect(detail.devicePosture).toBe('any(device_posture.checks.passed[*] in {"warp"})');
    expect(detail.action).toBe("block");
    expect(detail.filters).toEqual(["http"]);
    expect(entity.kind).toBe("gateway-policy");
    expect(entity.providerId).toBe("rule-1");
    expect(entity.scope).toEqual({ accountId: ACCOUNT_ID, parentId: null, zoneId: null });
    expect(entity.source.operation).toBe("gateway-policies-list");
  });

  it("nulls every absent field rather than dropping it", () => {
    const entity = projectCloudflareGatewayPolicy({ accountId: ACCOUNT_ID, at: AT, policy: { id: "rule-2" } });
    const detail = entity.detail as CloudflareGatewayPolicyDetail;
    expect(detail.name).toBeNull();
    expect(detail.action).toBeNull();
    expect(detail.enabled).toBeNull();
    expect(detail.filters).toEqual([]);
    expect(detail.ruleSettings).toBeNull();
  });

  it("stores the whole detail of a rule carrying only its id as null, with an empty filter list", () => {
    const entity = projectCloudflareGatewayPolicy({ accountId: ACCOUNT_ID, at: AT, policy: { id: "rule-2" } });
    expect(entity.detail).toEqual({
      action: null,
      createdAt: null,
      deletedAt: null,
      description: null,
      devicePosture: null,
      enabled: null,
      filters: [],
      identity: null,
      kind: "gateway-policy",
      name: null,
      precedence: null,
      ruleSettings: null,
      traffic: null,
      updatedAt: null,
      version: null,
    });
  });

  it("stores a rule's deleted_at sent as null as null, and copies its filter list", () => {
    const filters = ["dns"];
    const entity = projectCloudflareGatewayPolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      policy: { deleted_at: null, filters, id: "rule-3", version: 4 },
    });
    const detail = entity.detail as CloudflareGatewayPolicyDetail;
    expect(detail.deletedAt).toBeNull();
    expect(detail.version).toBe(4);
    expect(detail.filters).toEqual(["dns"]);
    expect(detail.filters === filters).toBe(false);
  });

  it("gives two policies with different provider ids two different entity ids", () => {
    const one = projectCloudflareGatewayPolicy({ accountId: ACCOUNT_ID, at: AT, policy: { id: "rule-1" } });
    const two = projectCloudflareGatewayPolicy({ accountId: ACCOUNT_ID, at: AT, policy: { id: "rule-2" } });
    expect(one.id === two.id).toBe(false);
  });
});

describe("the three Gateway singletons", () => {
  it("stores the configuration under a fixed provider id", () => {
    const entity = projectCloudflareGatewayConfiguration({
      accountId: ACCOUNT_ID,
      at: AT,
      configuration: { settings: { antivirus: null }, updated_at: AT },
    });
    const detail = entity.detail as CloudflareGatewayConfigurationDetail;
    expect(JSON.stringify(detail.settings)).toContain("antivirus");
    expect(detail.updatedAt).toBe(AT);
    expect(detail.createdAt).toBeNull();
    expect(entity.providerId).toBe(GATEWAY_CONFIGURATION_ID);
    expect(entity.kind).toBe("gateway-configuration");
  });

  it("stores the logging record's redact_pii switch, false included", () => {
    const entity = projectCloudflareGatewayLogging({ accountId: ACCOUNT_ID, at: AT, logging: { redact_pii: false } });
    const detail = entity.detail as CloudflareGatewayLoggingDetail;
    expect(detail.redactPii).toBe(false);
    expect(entity.providerId).toBe(GATEWAY_LOGGING_ID);
  });

  it("stores only the PUBLIC half of the SSH audit key pair", () => {
    // The fixture carries the private half, so both halves of the redaction claim are asserted below. A
    // setting with no private key in it is absent from the output whether the projector drops it or never
    // ran at all (`.claude/rules/testing.md`'s falsifiable-witness rule). It is a BINDING rather than an
    // inline literal because the declared parameter models only the fields we keep, and a provider that
    // returns more than we model is the case under test.
    const setting = {
      is_public_key_valid: true,
      private_key: PRIVATE_KEY_PEM,
      public_key: "ssh-ed25519 AAAA",
      seed_id: "seed-1",
    };
    const entity = projectCloudflareGatewayAuditSsh({ accountId: ACCOUNT_ID, at: AT, setting });
    const detail = entity.detail as CloudflareGatewayAuditSshDetail;
    expect(detail.publicKey).toBe("ssh-ed25519 AAAA");
    expect(detail.seedId).toBe("seed-1");
    expect(detail.publicKeyValid).toBe(true);
    expect(JSON.stringify(setting)).toContain(PRIVATE_KEY_PEM);
    expect(JSON.stringify(entity.detail)).not.toContain(PRIVATE_KEY_PEM);
    expect(JSON.stringify(entity.detail)).not.toContain("privateKey");
    expect(entity.providerId).toBe(GATEWAY_AUDIT_SSH_ID);
  });

  it("gives the three singletons three distinct entity ids", () => {
    const configuration = projectCloudflareGatewayConfiguration({ accountId: ACCOUNT_ID, at: AT, configuration: {} });
    const logging = projectCloudflareGatewayLogging({ accountId: ACCOUNT_ID, at: AT, logging: {} });
    const audit = projectCloudflareGatewayAuditSsh({ accountId: ACCOUNT_ID, at: AT, setting: {} });
    expect(new Set([configuration.id, logging.id, audit.id]).size).toBe(3);
  });
});

describe("projectCloudflareGatewayLocation", () => {
  it("stores the location's networks and endpoints as read", () => {
    const entity = projectCloudflareGatewayLocation({
      accountId: ACCOUNT_ID,
      at: AT,
      location: { client_default: true, id: "loc-1", name: "office", networks: [{ network: "203.0.113.0/24" }] },
    });
    const detail = entity.detail as CloudflareGatewayLocationDetail;
    expect(detail.clientDefault).toBe(true);
    expect(detail.name).toBe("office");
    expect(JSON.stringify(detail.networks)).toContain("203.0.113.0/24");
    expect(entity.providerId).toBe("loc-1");
    expect(entity.source.operation).toBe("gateway-locations-list");
  });

  it("stores every field a location omitted or sent as null as null", () => {
    const entity = projectCloudflareGatewayLocation({
      accountId: ACCOUNT_ID,
      at: AT,
      location: { endpoints: null, id: "loc-2", networks: null },
    });
    expect(entity.detail).toEqual({
      clientDefault: null,
      createdAt: null,
      dohSubdomain: null,
      ecsSupport: null,
      endpoints: null,
      ip: null,
      ipv4Destination: null,
      kind: "gateway-location",
      name: null,
      networks: null,
      updatedAt: null,
    });
  });
});

describe("projectCloudflareGatewayCertificate", () => {
  it("keeps the fingerprint and binding status and never the PEM body", () => {
    // The raw certificate carries the PEM body the projector must not store — same call
    // `projection/accountCertificate.ts` made — so the absence below is evidence rather than a fixture that
    // never had one (`.claude/rules/testing.md`'s falsifiable-witness rule). A binding, not an inline
    // literal: `CloudflareGatewayCertificateDto` models only the fields we keep.
    const certificate = {
      binding_status: "active",
      certificate: CERTIFICATE_PEM,
      fingerprint: "ab:cd",
      id: "cert-1",
      in_use: true,
      issuer_org: "Cloudflare",
      type: "custom",
    };
    const entity = projectCloudflareGatewayCertificate({ accountId: ACCOUNT_ID, at: AT, certificate });
    const detail = entity.detail as CloudflareGatewayCertificateDetail;
    expect(detail.fingerprint).toBe("ab:cd");
    expect(detail.bindingStatus).toBe("active");
    expect(detail.inUse).toBe(true);
    expect(JSON.stringify(certificate)).toContain("BEGIN CERTIFICATE");
    expect(JSON.stringify(entity.detail)).not.toContain("BEGIN CERTIFICATE");
  });

  it("stores every field a certificate carrying only its id omitted as null", () => {
    const entity = projectCloudflareGatewayCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      certificate: { id: "cert-2" },
    });
    expect(entity.detail).toEqual({
      bindingStatus: null,
      createdAt: null,
      expiresOn: null,
      fingerprint: null,
      inUse: null,
      issuerOrg: null,
      issuerRaw: null,
      kind: "gateway-certificate",
      type: null,
      updatedAt: null,
      uploadedOn: null,
    });
  });
});

describe("projectCloudflareGatewayProxyEndpoint", () => {
  it("stores the source CIDRs allowed to reach the endpoint", () => {
    const entity = projectCloudflareGatewayProxyEndpoint({
      accountId: ACCOUNT_ID,
      at: AT,
      endpoint: { id: "proxy-1", ips: ["203.0.113.0/24"], name: "office", subdomain: "abc123" },
    });
    const detail = entity.detail as CloudflareGatewayProxyEndpointDetail;
    expect(detail.ips).toEqual(["203.0.113.0/24"]);
    expect(detail.subdomain).toBe("abc123");
  });

  it("stores an endpoint carrying only its id with an empty CIDR list and every other field null", () => {
    const entity = projectCloudflareGatewayProxyEndpoint({
      accountId: ACCOUNT_ID,
      at: AT,
      endpoint: { id: "proxy-2" },
    });
    expect(entity.detail).toEqual({
      createdAt: null,
      ips: [],
      kind: "gateway-proxy-endpoint",
      name: null,
      subdomain: null,
      updatedAt: null,
    });
  });
});
