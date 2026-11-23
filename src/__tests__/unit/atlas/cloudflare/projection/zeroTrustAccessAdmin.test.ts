import { describe, expect, it } from "vitest";

import { cloudflareEntityId } from "../../../../../atlas/cloudflare/identity.js";
import {
  projectCloudflareAccessAuthenticationEvent,
  projectCloudflareAccessBookmark,
  projectCloudflareAccessCertificate,
  projectCloudflareAccessCustomPage,
  projectCloudflareAccessGatewayCa,
  projectCloudflareAccessInfrastructureTarget,
  projectCloudflareAccessKeyConfiguration,
  projectCloudflareAccessScimUpdate,
  projectCloudflareAccessTag,
} from "../../../../../atlas/cloudflare/projection/zeroTrustAccessAdmin.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

type ScimUpdate = Parameters<typeof projectCloudflareAccessScimUpdate>[0]["update"];

/** The entity id the module derives, computed through the same helper it calls. */
function expectedId({
  kind,
  providerId,
}: {
  kind: Parameters<typeof cloudflareEntityId>[0]["kind"];
  providerId: string;
}): string {
  return cloudflareEntityId({ components: { accountId: ACCOUNT_ID, providerId }, kind });
}

describe("projectCloudflareAccessTag", () => {
  it("keys the tag on its own name and maps every field", () => {
    const entity = projectCloudflareAccessTag({
      accountId: ACCOUNT_ID,
      at: AT,
      tag: { app_count: 3, created_at: "2025-01-01T00:00:00Z", name: "finance", updated_at: "2025-02-01T00:00:00Z" },
    });
    expect(entity.providerId).toBe("finance");
    expect(entity.id).toBe(expectedId({ kind: "access-tag", providerId: "finance" }));
    expect(entity.kind).toBe("access-tag");
    expect(entity.source.operation).toBe("access-tags-list");
    expect(entity.detail).toEqual({
      appCount: 3,
      createdAt: "2025-01-01T00:00:00Z",
      kind: "access-tag",
      name: "finance",
      updatedAt: "2025-02-01T00:00:00Z",
    });
  });

  it("stores exactly null for each optional a minimal tag omits", () => {
    const entity = projectCloudflareAccessTag({ accountId: ACCOUNT_ID, at: AT, tag: { name: "bare" } });
    expect(entity.detail).toEqual({
      appCount: null,
      createdAt: null,
      kind: "access-tag",
      name: "bare",
      updatedAt: null,
    });
  });
});

describe("projectCloudflareAccessBookmark", () => {
  it("keys the bookmark on its id and maps every field", () => {
    const entity = projectCloudflareAccessBookmark({
      accountId: ACCOUNT_ID,
      at: AT,
      bookmark: {
        app_launcher_visible: false,
        created_at: "2025-01-01T00:00:00Z",
        domain: "wiki.example.com",
        id: "bookmark-1",
        name: "Wiki",
        updated_at: "2025-02-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("bookmark-1");
    expect(entity.id).toBe(expectedId({ kind: "access-bookmark", providerId: "bookmark-1" }));
    expect(entity.source.operation).toBe("access-bookmarks-list");
    expect(entity.detail).toEqual({
      appLauncherVisible: false,
      createdAt: "2025-01-01T00:00:00Z",
      domain: "wiki.example.com",
      kind: "access-bookmark",
      name: "Wiki",
      updatedAt: "2025-02-01T00:00:00Z",
    });
  });

  it("stores exactly null for each optional a minimal bookmark omits", () => {
    const entity = projectCloudflareAccessBookmark({ accountId: ACCOUNT_ID, at: AT, bookmark: { id: "bookmark-2" } });
    expect(entity.detail).toEqual({
      appLauncherVisible: null,
      createdAt: null,
      domain: null,
      kind: "access-bookmark",
      name: null,
      updatedAt: null,
    });
  });
});

describe("projectCloudflareAccessCustomPage", () => {
  it("keys the page on its uid and keeps the HTML body", () => {
    const entity = projectCloudflareAccessCustomPage({
      accountId: ACCOUNT_ID,
      at: AT,
      page: {
        app_count: 2,
        created_at: "2025-01-01T00:00:00Z",
        custom_html: "<h1>Denied</h1>",
        name: "Blocked page",
        type: "forbidden",
        uid: "page-uid-1",
        updated_at: "2025-02-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("page-uid-1");
    expect(entity.id).toBe(expectedId({ kind: "access-custom-page", providerId: "page-uid-1" }));
    expect(entity.source.operation).toBe("access-custom-pages-list");
    expect(entity.detail).toEqual({
      appCount: 2,
      createdAt: "2025-01-01T00:00:00Z",
      customHtml: "<h1>Denied</h1>",
      kind: "access-custom-page",
      name: "Blocked page",
      type: "forbidden",
      updatedAt: "2025-02-01T00:00:00Z",
    });
  });

  it("stores exactly null for each optional a minimal page omits", () => {
    const entity = projectCloudflareAccessCustomPage({ accountId: ACCOUNT_ID, at: AT, page: { uid: "page-uid-2" } });
    expect(entity.detail).toEqual({
      appCount: null,
      createdAt: null,
      customHtml: null,
      kind: "access-custom-page",
      name: null,
      type: null,
      updatedAt: null,
    });
  });
});

describe("projectCloudflareAccessCertificate", () => {
  const FULL = {
    associated_hostnames: ["a.example.com", "b.example.com"],
    created_at: "2025-01-01T00:00:00Z",
    expires_on: "2030-01-01T00:00:00Z",
    fingerprint: "AB:CD:EF",
    id: "cert-1",
    name: "Corp CA",
    updated_at: "2025-02-01T00:00:00Z",
  };

  it("maps an mTLS certificate and reads it from the mTLS collection", () => {
    const entity = projectCloudflareAccessCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      certificate: FULL,
      certificateKind: "mtls",
    });
    expect(entity.providerId).toBe("cert-1");
    expect(entity.id).toBe(expectedId({ kind: "access-certificate", providerId: "cert-1" }));
    expect(entity.source.operation).toBe("access-mtls-certificates-list");
    expect(entity.detail).toEqual({
      associatedHostnames: ["a.example.com", "b.example.com"],
      certificateKind: "mtls",
      createdAt: "2025-01-01T00:00:00Z",
      expiresOn: "2030-01-01T00:00:00Z",
      fingerprint: "AB:CD:EF",
      kind: "access-certificate",
      name: "Corp CA",
      updatedAt: "2025-02-01T00:00:00Z",
    });
  });

  it("maps a SAML certificate and reads it from the SAML collection", () => {
    const entity = projectCloudflareAccessCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      certificate: FULL,
      certificateKind: "saml",
    });
    expect(entity.source.operation).toBe("access-saml-certificates-list");
    expect(entity.detail).toEqual({
      associatedHostnames: ["a.example.com", "b.example.com"],
      certificateKind: "saml",
      createdAt: "2025-01-01T00:00:00Z",
      expiresOn: "2030-01-01T00:00:00Z",
      fingerprint: "AB:CD:EF",
      kind: "access-certificate",
      name: "Corp CA",
      updatedAt: "2025-02-01T00:00:00Z",
    });
  });

  it("turns absent hostnames into an empty list and every other optional into null", () => {
    const entity = projectCloudflareAccessCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      certificate: { id: "cert-2" },
      certificateKind: "mtls",
    });
    expect(entity.detail).toEqual({
      associatedHostnames: [],
      certificateKind: "mtls",
      createdAt: null,
      expiresOn: null,
      fingerprint: null,
      kind: "access-certificate",
      name: null,
      updatedAt: null,
    });
  });

  it("copies the hostnames rather than aliasing the raw array", () => {
    const hostnames = ["a.example.com"];
    const entity = projectCloudflareAccessCertificate({
      accountId: ACCOUNT_ID,
      at: AT,
      certificate: { associated_hostnames: hostnames, id: "cert-3" },
      certificateKind: "saml",
    });
    hostnames.push("late.example.com");
    expect((entity.detail as { associatedHostnames: string[] }).associatedHostnames).toEqual(["a.example.com"]);
  });
});

describe("projectCloudflareAccessGatewayCa", () => {
  it("keys the CA on its id and keeps the public key", () => {
    const entity = projectCloudflareAccessGatewayCa({
      accountId: ACCOUNT_ID,
      at: AT,
      ca: { id: "ca-1", public_key: "ecdsa-sha2-nistp256 AAAA" },
    });
    expect(entity.providerId).toBe("ca-1");
    expect(entity.id).toBe(expectedId({ kind: "access-gateway-ca", providerId: "ca-1" }));
    expect(entity.source.operation).toBe("access-gateway-ca-list");
    expect(entity.detail).toEqual({ kind: "access-gateway-ca", publicKey: "ecdsa-sha2-nistp256 AAAA" });
  });

  it("stores a null public key when the read returns none", () => {
    const entity = projectCloudflareAccessGatewayCa({ accountId: ACCOUNT_ID, at: AT, ca: { id: "ca-2" } });
    expect(entity.detail).toEqual({ kind: "access-gateway-ca", publicKey: null });
  });
});

describe("projectCloudflareAccessInfrastructureTarget", () => {
  it("maps every field and keeps the whole ip object", () => {
    const ip = {
      ipv4: { ip_addr: "10.0.0.5", virtual_network_id: "vnet-1" },
      ipv6: { ip_addr: "fd00::5", virtual_network_id: "vnet-1" },
    };
    const entity = projectCloudflareAccessInfrastructureTarget({
      accountId: ACCOUNT_ID,
      at: AT,
      target: {
        created_at: "2025-01-01T00:00:00Z",
        hostname: "db-1",
        id: "target-1",
        ip,
        modified_at: "2025-02-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("target-1");
    expect(entity.id).toBe(expectedId({ kind: "access-infrastructure-target", providerId: "target-1" }));
    expect(entity.source.operation).toBe("access-infrastructure-targets-list");
    expect(entity.detail).toEqual({
      createdAt: "2025-01-01T00:00:00Z",
      hostname: "db-1",
      ip,
      kind: "access-infrastructure-target",
      modifiedAt: "2025-02-01T00:00:00Z",
    });
  });

  it("stores exactly null for each optional a minimal target omits", () => {
    const entity = projectCloudflareAccessInfrastructureTarget({
      accountId: ACCOUNT_ID,
      at: AT,
      target: { id: "target-2" },
    });
    expect(entity.detail).toEqual({
      createdAt: null,
      hostname: null,
      ip: null,
      kind: "access-infrastructure-target",
      modifiedAt: null,
    });
  });
});

describe("projectCloudflareAccessKeyConfiguration", () => {
  it("camel-cases the three rotation fields under the fixed singleton id", () => {
    const entity = projectCloudflareAccessKeyConfiguration({
      accountId: ACCOUNT_ID,
      at: AT,
      configuration: {
        days_until_next_rotation: 12,
        key_rotation_interval_days: 30,
        last_key_rotation_at: "2025-12-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("access-key-configuration");
    expect(entity.id).toBe(expectedId({ kind: "access-key-configuration", providerId: "access-key-configuration" }));
    expect(entity.source.operation).toBe("access-keys-get");
    expect(entity.detail).toEqual({
      daysUntilNextRotation: 12,
      keyRotationIntervalDays: 30,
      kind: "access-key-configuration",
      lastKeyRotationAt: "2025-12-01T00:00:00Z",
    });
  });

  it("stores null for each rotation field the read omits, and keeps a zero", () => {
    const empty = projectCloudflareAccessKeyConfiguration({ accountId: ACCOUNT_ID, at: AT, configuration: {} });
    expect(empty.detail).toEqual({
      daysUntilNextRotation: null,
      keyRotationIntervalDays: null,
      kind: "access-key-configuration",
      lastKeyRotationAt: null,
    });
    const zero = projectCloudflareAccessKeyConfiguration({
      accountId: ACCOUNT_ID,
      at: AT,
      configuration: { days_until_next_rotation: 0 },
    });
    expect((zero.detail as { daysUntilNextRotation: number | null }).daysUntilNextRotation).toBe(0);
  });
});

describe("projectCloudflareAccessAuthenticationEvent", () => {
  it("keys the event on its instant and ray id and maps every field", () => {
    const entity = projectCloudflareAccessAuthenticationEvent({
      accountId: ACCOUNT_ID,
      at: AT,
      event: {
        action: "login",
        allowed: true,
        app_domain: "wiki.example.com",
        app_name: "Wiki",
        app_type: "self_hosted",
        app_uid: "app-1",
        connection: "google",
        country: "AU",
        created_at: "2026-01-01T00:00:05Z",
        ip_address: "203.0.113.9",
        ray_id: "ray-abc",
        user_email: "person@example.com",
        user_id: "user-1",
      },
    });
    expect(entity.providerId).toBe("auth:2026-01-01T00:00:05Z:ray-abc");
    expect(entity.id).toBe(
      expectedId({ kind: "access-authentication-log", providerId: "auth:2026-01-01T00:00:05Z:ray-abc" }),
    );
    expect(entity.kind).toBe("access-authentication-log");
    expect(entity.source.operation).toBe("access-authentication-events-list");
    expect(entity.detail).toEqual({
      action: "login",
      allowed: true,
      appDomain: "wiki.example.com",
      appName: "Wiki",
      appType: "self_hosted",
      appUid: "app-1",
      connection: "google",
      country: "AU",
      entryKind: "authentication",
      ipAddress: "203.0.113.9",
      kind: "access-authentication-log",
      loggedAt: "2026-01-01T00:00:05Z",
      rayId: "ray-abc",
      userEmail: "person@example.com",
      userId: "user-1",
    });
  });

  it("keeps a denied sign-in as allowed false rather than null", () => {
    const entity = projectCloudflareAccessAuthenticationEvent({
      accountId: ACCOUNT_ID,
      at: AT,
      event: { allowed: false, created_at: "2026-01-01T00:00:06Z", ray_id: "ray-def" },
    });
    expect((entity.detail as { allowed: boolean | null }).allowed).toBe(false);
  });

  it("gives two events in the same instant different ids when their ray ids differ", () => {
    const first = projectCloudflareAccessAuthenticationEvent({
      accountId: ACCOUNT_ID,
      at: AT,
      event: { created_at: "2026-01-01T00:00:05Z", ray_id: "ray-1" },
    });
    const second = projectCloudflareAccessAuthenticationEvent({
      accountId: ACCOUNT_ID,
      at: AT,
      event: { created_at: "2026-01-01T00:00:05Z", ray_id: "ray-2" },
    });
    expect(first.providerId).toBe("auth:2026-01-01T00:00:05Z:ray-1");
    expect(second.providerId).toBe("auth:2026-01-01T00:00:05Z:ray-2");
    expect(first.id === second.id).toBe(false);
  });
});

describe("projectCloudflareAccessScimUpdate", () => {
  const BASE: ScimUpdate = {
    cf_resource_id: "cf-res-1",
    http_method: "PATCH",
    idp_id: "idp-1",
    logged_at: "2026-01-01T00:00:07Z",
    request_body: "body-a",
    resource_group_name: "Engineering",
    resource_type: "Group",
    status: "success",
  };
  const WITHOUT_BODY: ScimUpdate = {
    cf_resource_id: "cf-res-1",
    http_method: "PATCH",
    idp_id: "idp-1",
    logged_at: "2026-01-01T00:00:07Z",
  };
  const PREFIX = "scim:2026-01-01T00:00:07Z:idp-1:cf-res-1:PATCH";

  function project({ update }: { update: ScimUpdate }): ReturnType<typeof projectCloudflareAccessScimUpdate> {
    return projectCloudflareAccessScimUpdate({ accountId: ACCOUNT_ID, at: AT, update });
  }

  it("maps every field and builds the exact composite id with the body hash last", () => {
    const entity = project({ update: BASE });
    expect(entity.providerId).toBe(`${PREFIX}:8edbb46d547b79d7`);
    expect(entity.id).toBe(expectedId({ kind: "access-authentication-log", providerId: `${PREFIX}:8edbb46d547b79d7` }));
    expect(entity.kind).toBe("access-authentication-log");
    expect(entity.source.operation).toBe("access-scim-updates-list");
    expect(entity.detail).toEqual({
      cfResourceId: "cf-res-1",
      entryKind: "scim-update",
      httpMethod: "PATCH",
      idpId: "idp-1",
      kind: "access-authentication-log",
      loggedAt: "2026-01-01T00:00:07Z",
      requestBody: "body-a",
      resourceGroupName: "Engineering",
      resourceType: "Group",
      status: "success",
    });
  });

  it("gives two updates that differ only in body different provider ids", () => {
    const a = project({ update: { ...BASE, request_body: "body-a" } });
    const b = project({ update: { ...BASE, request_body: "body-b" } });
    expect(a.providerId).toBe(`${PREFIX}:8edbb46d547b79d7`);
    expect(b.providerId).toBe(`${PREFIX}:1d3300fc1b38db64`);
    expect(a.id === b.id).toBe(false);
  });

  it("tells an absent body from an empty one", () => {
    const absent = project({ update: WITHOUT_BODY });
    const nulled = project({ update: { ...BASE, request_body: null } });
    const empty = project({ update: { ...BASE, request_body: "" } });
    expect(absent.providerId).toBe(`${PREFIX}:2be88ca4242c76e8`);
    expect(nulled.providerId).toBe(`${PREFIX}:2be88ca4242c76e8`);
    expect(empty.providerId).toBe(`${PREFIX}:dd29ecf524b030a6`);
    expect(absent.id === empty.id).toBe(false);
  });

  it("gives two byte-identical updates the same provider id and entity id", () => {
    const first = project({ update: { ...BASE } });
    const second = project({ update: { ...BASE } });
    expect(first.providerId).toBe(second.providerId);
    expect(first.id).toBe(second.id);
  });

  it("stores null for each detail field a minimal update omits", () => {
    const entity = project({ update: WITHOUT_BODY });
    expect(entity.detail).toEqual({
      cfResourceId: "cf-res-1",
      entryKind: "scim-update",
      httpMethod: "PATCH",
      idpId: "idp-1",
      kind: "access-authentication-log",
      loggedAt: "2026-01-01T00:00:07Z",
      requestBody: null,
      resourceGroupName: null,
      resourceType: null,
      status: null,
    });
  });
});
