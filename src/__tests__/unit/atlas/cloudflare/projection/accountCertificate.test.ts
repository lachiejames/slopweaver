import { describe, expect, it } from "vitest";

import {
  type CloudflareAccountCertificateDetail,
  isCloudflareAccountCertificateDetail,
  normalizeCloudflareAccountCertificateAssociation,
  projectCloudflareAccountCertificate,
} from "../../../../../atlas/cloudflare/projection/accountCertificate.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("normalizeCloudflareAccountCertificateAssociation", () => {
  it("normalizes a real association", () => {
    expect(normalizeCloudflareAccountCertificateAssociation({ raw: { service: "access", status: "active" } })).toEqual({
      service: "access",
      status: "active",
    });
  });

  it("defaults missing fields to null", () => {
    expect(normalizeCloudflareAccountCertificateAssociation({ raw: {} })).toEqual({ service: null, status: null });
  });
});

describe("projectCloudflareAccountCertificate", () => {
  it("projects every field and folds in the resolved associations", () => {
    const entity = projectCloudflareAccountCertificate({
      accountId: ACCOUNT_ID,
      associations: [{ service: "access", status: "active" }],
      at: AT,
      raw: {
        ca: true,
        expires_on: "2027-01-01T00:00:00Z",
        id: "cert-1",
        issuer: "Example CA",
        name: "My Cert",
        serial_number: "123",
        signature: "SHA256",
        type: "custom",
        uploaded_on: "2026-01-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("cert-1");
    expect(entity.detail).toEqual({
      associations: [{ service: "access", status: "active" }],
      ca: true,
      expiresOn: "2027-01-01T00:00:00Z",
      issuer: "Example CA",
      kind: "account-certificate",
      name: "My Cert",
      serialNumber: "123",
      signature: "SHA256",
      type: "custom",
      uploadedOn: "2026-01-01T00:00:00Z",
    });
  });

  it("defaults every missing field to null, and keeps an empty associations list", () => {
    const entity = projectCloudflareAccountCertificate({
      accountId: ACCOUNT_ID,
      associations: [],
      at: AT,
      raw: { id: "cert-1" },
    });
    expect(entity.detail).toEqual({
      associations: [],
      ca: null,
      expiresOn: null,
      issuer: null,
      kind: "account-certificate",
      name: null,
      serialNumber: null,
      signature: null,
      type: null,
      uploadedOn: null,
    });
  });
});

describe("isCloudflareAccountCertificateDetail", () => {
  it("accepts a genuine detail", () => {
    const detail: CloudflareAccountCertificateDetail = {
      associations: [],
      ca: null,
      expiresOn: null,
      issuer: null,
      kind: "account-certificate",
      name: null,
      serialNumber: null,
      signature: null,
      type: null,
      uploadedOn: null,
    };
    expect(isCloudflareAccountCertificateDetail(detail)).toBe(true);
  });

  it("rejects a detail from a different kind", () => {
    expect(isCloudflareAccountCertificateDetail({ kind: "zone" })).toBe(false);
  });

  it("rejects a non-object value", () => {
    expect(isCloudflareAccountCertificateDetail("not an object")).toBe(false);
  });
});
