import { describe, expect, it } from "vitest";

import {
  projectCloudflareAccessApplication,
  projectCloudflareAccessGroup,
  projectCloudflareAccessServiceToken,
  projectCloudflareIdentityProvider,
} from "../../../../../atlas/cloudflare/projection/access.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareAccessApplication", () => {
  it("projects the stable fields and keeps the rest as config", () => {
    const entity = projectCloudflareAccessApplication({
      accountId: ACCOUNT_ID,
      application: { domain: "app.example.test", id: "app-1", name: "My App", type: "self_hosted" },
      at: AT,
    });
    expect(entity.kind).toBe("access-application");
    expect(entity.providerId).toBe("app-1");
    expect(entity.scope).toEqual({ accountId: ACCOUNT_ID, parentId: null, zoneId: null });
    expect(entity.detail).toEqual({
      config: { domain: "app.example.test" },
      kind: "access-application",
      name: "My App",
      type: "self_hosted",
    });
  });

  it("defaults name/type to null when the SDK omits them", () => {
    const entity = projectCloudflareAccessApplication({ accountId: ACCOUNT_ID, application: { id: "app-1" }, at: AT });
    expect(entity.detail).toEqual({ config: {}, kind: "access-application", name: null, type: null });
  });

  it("produces a stable id independent of a config change", () => {
    const first = projectCloudflareAccessApplication({
      accountId: ACCOUNT_ID,
      application: { id: "app-1", name: "A" },
      at: AT,
    });
    const second = projectCloudflareAccessApplication({
      accountId: ACCOUNT_ID,
      application: { id: "app-1", name: "B" },
      at: AT,
    });
    expect(first.id).toBe(second.id);
  });
});

describe("projectCloudflareAccessGroup", () => {
  it("projects the rule arrays as-is, unredacted", () => {
    const entity = projectCloudflareAccessGroup({
      accountId: ACCOUNT_ID,
      at: AT,
      group: { exclude: [{ everyone: {} }], id: "grp-1", include: [{ email: { email: "a@b.test" } }], name: "Group" },
    });
    expect(entity.detail).toEqual({
      exclude: [{ everyone: {} }],
      include: [{ email: { email: "a@b.test" } }],
      isDefault: null,
      kind: "access-group",
      name: "Group",
      require: null,
    });
  });
});

describe("projectCloudflareAccessGroup minimal row", () => {
  it("stores null for every optional field the SDK omits", () => {
    const entity = projectCloudflareAccessGroup({ accountId: ACCOUNT_ID, at: AT, group: { id: "grp-1" } });
    expect(entity.detail).toEqual({
      exclude: null,
      include: null,
      isDefault: null,
      kind: "access-group",
      name: null,
      require: null,
    });
  });
});

describe("projectCloudflareAccessServiceToken minimal row", () => {
  it("stores null for every optional field the SDK omits", () => {
    const entity = projectCloudflareAccessServiceToken({
      accountId: ACCOUNT_ID,
      at: AT,
      serviceToken: { id: "tok-1" },
    });
    expect(entity.detail).toEqual({
      clientId: null,
      duration: null,
      expiresAt: null,
      kind: "access-service-token",
      name: null,
    });
  });
});

describe("projectCloudflareAccessServiceToken", () => {
  it("projects metadata only, no secret value field exists to project", () => {
    const entity = projectCloudflareAccessServiceToken({
      accountId: ACCOUNT_ID,
      at: AT,
      serviceToken: {
        client_id: "client-1",
        duration: "8760h",
        expires_at: "2027-01-01T00:00:00Z",
        id: "tok-1",
        name: "CI token",
      },
    });
    expect(entity.detail).toEqual({
      clientId: "client-1",
      duration: "8760h",
      expiresAt: "2027-01-01T00:00:00Z",
      kind: "access-service-token",
      name: "CI token",
    });
  });
});

describe("projectCloudflareIdentityProvider", () => {
  it("redacts a client_secret nested inside config", () => {
    const entity = projectCloudflareIdentityProvider({
      accountId: ACCOUNT_ID,
      at: AT,
      provider: {
        config: { client_id: "abc", client_secret: "super-secret", redirect_url: "https://example.test" },
        id: "idp-1",
        name: "Okta",
        type: "okta",
      },
    });
    expect(entity.detail).toEqual({
      config: { config: { client_id: "abc", redirect_url: "https://example.test" } },
      kind: "identity-provider",
      name: "Okta",
      type: "okta",
    });
  });

  it("redacts a client_secret at any nesting depth, inside an array", () => {
    const entity = projectCloudflareIdentityProvider({
      accountId: ACCOUNT_ID,
      at: AT,
      provider: { id: "idp-1", scim: [{ client_secret: "nested-secret", enabled: true }] },
    });
    expect(entity.detail).toEqual({
      config: { scim: [{ enabled: true }] },
      kind: "identity-provider",
      name: null,
      type: null,
    });
  });
});
