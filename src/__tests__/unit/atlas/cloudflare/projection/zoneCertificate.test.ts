import { describe, expect, it } from "vitest";

import {
  projectCloudflareCertificatePack,
  projectCloudflareClientCertificate,
  projectCloudflareCustomHostname,
  projectCloudflareKeylessCertificate,
  projectCloudflareOriginCaCertificate,
} from "../../../../../atlas/cloudflare/projection/zoneCertificate.js";
import {
  projectCloudflareAopHostnameCertificate,
  projectCloudflareAopSetting,
  projectCloudflareAopZoneCertificate,
} from "../../../../../atlas/cloudflare/projection/zoneCertificateAop.js";
import { projectCloudflareCustomCertificate } from "../../../../../atlas/cloudflare/projection/zoneCertificateCustom.js";
import { isCloudflareZoneCertificateDetailOf } from "../../../../../atlas/cloudflare/projection/zoneCertificateDetail.js";
import {
  projectCloudflareUniversalSslSetting,
  projectCloudflareUniversalSslVerification,
} from "../../../../../atlas/cloudflare/projection/zoneCertificateUniversal.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareCertificatePack", () => {
  it("projects stable fields and folds the rest into config", () => {
    const entity = projectCloudflareCertificatePack({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        hosts: ["example.test", "www.example.test"],
        id: "pack-1",
        status: "active",
        type: "advanced",
        validity_days: 90,
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("certificate-pack:pack-1");
    expect(entity.detail).toEqual({
      config: {},
      hosts: ["example.test", "www.example.test"],
      kind: "zone-certificate",
      status: "active",
      subtype: "certificate-pack",
      type: "advanced",
      validityDays: 90,
    });
  });

  it("strips certificate/csr bodies and private-key-shaped fields from config", () => {
    const entity = projectCloudflareCertificatePack({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { certificate: "-----BEGIN CERT-----", csr: "-----BEGIN CSR-----", id: "pack-1", private_key: "secret-pem" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: { private_key: null },
      hosts: [],
      kind: "zone-certificate",
      status: null,
      subtype: "certificate-pack",
      type: null,
      validityDays: null,
    });
  });

  it("defaults every missing field to null or empty", () => {
    const entity = projectCloudflareCertificatePack({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "pack-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      hosts: [],
      kind: "zone-certificate",
      status: null,
      subtype: "certificate-pack",
      type: null,
      validityDays: null,
    });
  });
});

describe("projectCloudflareUniversalSslSetting", () => {
  it("projects the singleton, always keyed the same way", () => {
    const entity = projectCloudflareUniversalSslSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      setting: { enabled: true },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("universal-ssl-setting");
    expect(entity.detail).toEqual({ enabled: true, kind: "zone-certificate", subtype: "universal-ssl-setting" });
  });

  it("defaults a missing enabled flag to null", () => {
    const entity = projectCloudflareUniversalSslSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      setting: {},
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({ enabled: null, kind: "zone-certificate", subtype: "universal-ssl-setting" });
  });
});

describe("projectCloudflareUniversalSslVerification", () => {
  it("keys identity by cert_pack_uuid when present", () => {
    const entity = projectCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        cert_pack_uuid: "uuid-1",
        certificate_status: "active",
        verification_status: true,
        verification_type: "cname",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("universal-ssl-verification:uuid-1");
    expect(entity.detail).toEqual({
      certPackUuid: "uuid-1",
      certificateStatus: "active",
      config: {},
      kind: "zone-certificate",
      subtype: "universal-ssl-verification",
      verificationStatus: true,
      verificationType: "cname",
    });
  });

  it("stores null for every absent optional field of an entry carrying only its required fields", () => {
    const entity = projectCloudflareUniversalSslVerification({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { cert_pack_uuid: "uuid-2", certificate_status: "pending_deployment" },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("universal-ssl-verification:uuid-2");
    expect(entity.detail).toEqual({
      certPackUuid: "uuid-2",
      certificateStatus: "pending_deployment",
      config: {},
      kind: "zone-certificate",
      subtype: "universal-ssl-verification",
      verificationStatus: null,
      verificationType: null,
    });
  });
});

describe("projectCloudflareCustomCertificate", () => {
  it("projects every field", () => {
    const entity = projectCloudflareCustomCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        expires_on: "2027-01-01T00:00:00Z",
        hosts: ["example.test"],
        id: "cert-1",
        issuer: "Let's Encrypt",
        priority: 1,
        status: "active",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("custom-certificate:cert-1");
    expect(entity.detail).toEqual({
      config: {},
      expiresOn: "2027-01-01T00:00:00Z",
      hosts: ["example.test"],
      issuer: "Let's Encrypt",
      kind: "zone-certificate",
      priority: 1,
      status: "active",
      subtype: "custom-certificate",
    });
  });

  it("defaults every missing field to null or empty", () => {
    const entity = projectCloudflareCustomCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "cert-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      expiresOn: null,
      hosts: [],
      issuer: null,
      kind: "zone-certificate",
      priority: null,
      status: null,
      subtype: "custom-certificate",
    });
  });
});

describe("projectCloudflareClientCertificate", () => {
  it("projects every field", () => {
    const entity = projectCloudflareClientCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        common_name: "client.example.test",
        expires_on: "2027-01-01T00:00:00Z",
        id: "cc-1",
        issued_on: "2026-01-01T00:00:00Z",
        status: "active",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("client-certificate:cc-1");
    expect(entity.detail).toEqual({
      commonName: "client.example.test",
      config: {},
      expiresOn: "2027-01-01T00:00:00Z",
      issuedOn: "2026-01-01T00:00:00Z",
      kind: "zone-certificate",
      status: "active",
      subtype: "client-certificate",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareClientCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "cc-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      commonName: null,
      config: {},
      expiresOn: null,
      issuedOn: null,
      kind: "zone-certificate",
      status: null,
      subtype: "client-certificate",
    });
  });
});

describe("projectCloudflareKeylessCertificate", () => {
  it("projects every field", () => {
    const entity = projectCloudflareKeylessCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        enabled: true,
        host: "origin.example.test",
        id: "kl-1",
        name: "origin keyless",
        port: 24008,
        status: "active",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("keyless-certificate:kl-1");
    expect(entity.detail).toEqual({
      config: {},
      enabled: true,
      host: "origin.example.test",
      kind: "zone-certificate",
      name: "origin keyless",
      port: 24008,
      status: "active",
      subtype: "keyless-certificate",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareKeylessCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "kl-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      enabled: null,
      host: null,
      kind: "zone-certificate",
      name: null,
      port: null,
      status: null,
      subtype: "keyless-certificate",
    });
  });
});

describe("projectCloudflareOriginCaCertificate", () => {
  it("projects every field", () => {
    const entity = projectCloudflareOriginCaCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        expires_on: "2033-01-01T00:00:00Z",
        hostnames: ["origin.example.test"],
        id: "ca-1",
        request_type: "origin-rsa",
        requested_validity: 5475,
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("origin-ca-certificate:ca-1");
    expect(entity.detail).toEqual({
      config: {},
      expiresOn: "2033-01-01T00:00:00Z",
      hostnames: ["origin.example.test"],
      kind: "zone-certificate",
      requestedValidity: 5475,
      requestType: "origin-rsa",
      subtype: "origin-ca-certificate",
    });
  });

  it("defaults every missing field to null or empty", () => {
    const entity = projectCloudflareOriginCaCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "ca-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      expiresOn: null,
      hostnames: [],
      kind: "zone-certificate",
      requestedValidity: null,
      requestType: null,
      subtype: "origin-ca-certificate",
    });
  });
});

describe("projectCloudflareAopSetting", () => {
  it("projects the singleton", () => {
    const entity = projectCloudflareAopSetting({ accountId: ACCOUNT_ID, at: AT, enabled: false, zoneId: ZONE_ID });
    expect(entity.providerId).toBe("aop-setting");
    expect(entity.detail).toEqual({ enabled: false, kind: "zone-certificate", subtype: "aop-setting" });
  });
});

describe("projectCloudflareAopZoneCertificate", () => {
  it("projects every field, never storing a private_key even if the raw response carried one", () => {
    const entity = projectCloudflareAopZoneCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        enabled: true,
        expires_on: "2027-01-01T00:00:00Z",
        id: "aop-1",
        issuer: "Cloudflare Origin CA",
        private_key: "-----BEGIN PRIVATE KEY-----super-secret",
        status: "active",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("aop-zone-certificate:aop-1");
    expect(entity.detail).toEqual({
      config: { private_key: null },
      enabled: true,
      expiresOn: "2027-01-01T00:00:00Z",
      issuer: "Cloudflare Origin CA",
      kind: "zone-certificate",
      status: "active",
      subtype: "aop-zone-certificate",
    });
  });
});

describe("projectCloudflareAopHostnameCertificate", () => {
  it("projects every field", () => {
    const entity = projectCloudflareAopHostnameCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { expires_on: "2027-01-01T00:00:00Z", id: "aophc-1", issuer: "Cloudflare Origin CA", status: "active" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: {},
      expiresOn: "2027-01-01T00:00:00Z",
      issuer: "Cloudflare Origin CA",
      kind: "zone-certificate",
      status: "active",
      subtype: "aop-hostname-certificate",
    });
  });
});

describe("projectCloudflareCustomHostname", () => {
  it("projects stable fields, never storing ssl.custom_key even if the raw response carried one", () => {
    const entity = projectCloudflareCustomHostname({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: {
        hostname: "shop.customer.test",
        id: "ch-1",
        ownership_verification: { type: "txt" },
        ssl: { custom_key: "-----BEGIN PRIVATE KEY-----super-secret", id: "ssl-1", status: "active" },
        status: "active",
      },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("custom-hostname:ch-1");
    expect(entity.detail).toEqual({
      config: { ssl: { custom_key: null, id: "ssl-1", status: "active" } },
      hostname: "shop.customer.test",
      kind: "zone-certificate",
      ownershipVerificationType: "txt",
      sslId: "ssl-1",
      sslStatus: "active",
      status: "active",
      subtype: "custom-hostname",
    });
  });

  it("stores null for nested ssl and ownership fields when their objects are present but omit them", () => {
    const entity = projectCloudflareCustomHostname({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "ch-1", ownership_verification: {}, ssl: { method: "txt" } },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: { ssl: { method: "txt" } },
      hostname: null,
      kind: "zone-certificate",
      ownershipVerificationType: null,
      sslId: null,
      sslStatus: null,
      status: null,
      subtype: "custom-hostname",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareCustomHostname({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "ch-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      config: { ssl: null },
      hostname: null,
      kind: "zone-certificate",
      ownershipVerificationType: null,
      sslId: null,
      sslStatus: null,
      status: null,
      subtype: "custom-hostname",
    });
  });
});

describe("isCloudflareZoneCertificateDetailOf", () => {
  it("matches a detail of the exact requested subtype", () => {
    const entity = projectCloudflareAopSetting({ accountId: ACCOUNT_ID, at: AT, enabled: true, zoneId: ZONE_ID });
    expect(isCloudflareZoneCertificateDetailOf({ subtype: "aop-setting", value: entity.detail })).toBe(true);
  });

  it("rejects a detail of a different subtype", () => {
    const entity = projectCloudflareAopSetting({ accountId: ACCOUNT_ID, at: AT, enabled: true, zoneId: ZONE_ID });
    expect(isCloudflareZoneCertificateDetailOf({ subtype: "custom-hostname", value: entity.detail })).toBe(false);
  });

  it("rejects a value that is not a record", () => {
    expect(isCloudflareZoneCertificateDetailOf({ subtype: "aop-setting", value: "not-a-record" })).toBe(false);
  });
});
