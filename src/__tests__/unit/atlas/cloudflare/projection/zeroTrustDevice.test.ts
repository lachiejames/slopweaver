import { describe, expect, it } from "vitest";

import {
  type CloudflareDeviceManagedNetworkDetail,
  type CloudflareDevicePolicyDetail,
  type CloudflareDeviceRegistrationDetail,
  type CloudflareDeviceSettingDetail,
  DEVICE_SETTING_ID,
  projectCloudflareDeviceManagedNetwork,
  projectCloudflareDevicePolicy,
  projectCloudflareDeviceRegistration,
  projectCloudflareDeviceSetting,
} from "../../../../../atlas/cloudflare/projection/zeroTrustDevice.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareDeviceRegistration", () => {
  it("keeps the device and its enrolled user, which is the question the kind answers", () => {
    const entity = projectCloudflareDeviceRegistration({
      accountId: ACCOUNT_ID,
      at: AT,
      registration: {
        device: { name: "laptop-1", os_version: "15.0" },
        id: "reg-1",
        key: "wireguard-public",
        key_type: "secp256r1",
        last_seen_at: AT,
        tunnel_type: "wireguard",
        user: { email: "person@example.test" },
      },
    });
    const detail = entity.detail as CloudflareDeviceRegistrationDetail;
    expect(JSON.stringify(detail.device)).toContain("laptop-1");
    expect(JSON.stringify(detail.user)).toContain("person@example.test");
    expect(detail.publicKey).toBe("wireguard-public");
    expect(detail.keyType).toBe("secp256r1");
    expect(entity.kind).toBe("device-registration");
    expect(entity.source.operation).toBe("device-registrations-list");
  });

  it("nulls a registration that carries nothing but an id", () => {
    const detail = projectCloudflareDeviceRegistration({ accountId: ACCOUNT_ID, at: AT, registration: { id: "reg-2" } })
      .detail as CloudflareDeviceRegistrationDetail;
    expect(detail.device).toBeNull();
    expect(detail.user).toBeNull();
    expect(detail.publicKey).toBeNull();
    expect(detail.lastSeenAt).toBeNull();
  });

  it("stores null for every field when the registration row carries nothing but an id", () => {
    const detail = projectCloudflareDeviceRegistration({
      accountId: ACCOUNT_ID,
      at: AT,
      registration: { id: "reg-3" },
    }).detail;
    expect(detail).toEqual({
      createdAt: null,
      device: null,
      keyType: null,
      kind: "device-registration",
      lastSeenAt: null,
      publicKey: null,
      tunnelType: null,
      updatedAt: null,
      user: null,
      virtualIpv4: null,
      virtualIpv6: null,
    });
  });
});

describe("projectCloudflareDevicePolicy", () => {
  it("marks the default profile and records which endpoint it came from", () => {
    const entity = projectCloudflareDevicePolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      isDefault: true,
      policy: { auto_connect: 300, default: true, enabled: true, policy_id: "warp-default", switch_locked: false },
    });
    const detail = entity.detail as CloudflareDevicePolicyDetail;
    expect(detail.isDefault).toBe(true);
    expect(detail.match).toBeNull();
    expect(detail.autoConnectSeconds).toBe(300);
    expect(detail.switchLocked).toBe(false);
    expect(entity.source.operation).toBe("device-default-policy-get");
  });

  it("marks a custom profile, keeps its match expression, and names the other endpoint", () => {
    const entity = projectCloudflareDevicePolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      isDefault: false,
      policy: { match: 'identity.email == "person@example.test"', name: "contractors", policy_id: "warp-custom-1" },
    });
    const detail = entity.detail as CloudflareDevicePolicyDetail;
    expect(detail.isDefault).toBe(false);
    expect(detail.match).toBe('identity.email == "person@example.test"');
    expect(detail.name).toBe("contractors");
    expect(entity.source.operation).toBe("device-custom-policies-list");
  });

  it("keys identity on the provider's policy_id, so the same profile read twice is one entity", () => {
    const first = projectCloudflareDevicePolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      isDefault: true,
      policy: { policy_id: "warp-default" },
    });
    const second = projectCloudflareDevicePolicy({
      accountId: ACCOUNT_ID,
      at: "2026-02-02T00:00:00.000Z",
      isDefault: true,
      policy: { name: "renamed", policy_id: "warp-default" },
    });
    expect(second.id).toBe(first.id);
  });

  it("stores null for every field but the supplied default flag when the profile row carries nothing but an id", () => {
    const detail = projectCloudflareDevicePolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      isDefault: false,
      policy: { policy_id: "warp-bare" },
    }).detail;
    expect(detail).toEqual({
      allowModeSwitch: null,
      allowUpdates: null,
      allowedToLeave: null,
      autoConnectSeconds: null,
      captivePortalSeconds: null,
      description: null,
      disableAutoFallback: null,
      enabled: null,
      exclude: null,
      fallbackDomains: null,
      include: null,
      isDefault: false,
      kind: "device-policy",
      match: null,
      name: null,
      precedence: null,
      serviceMode: null,
      switchLocked: null,
      tunnelProtocol: null,
    });
  });
});

describe("projectCloudflareDeviceSetting", () => {
  it("stores the account-wide switches under a fixed provider id", () => {
    const entity = projectCloudflareDeviceSetting({
      accountId: ACCOUNT_ID,
      at: AT,
      setting: { disable_for_time: 3600, gateway_proxy_enabled: true, managed: "not_api_managed" },
    });
    const detail = entity.detail as CloudflareDeviceSettingDetail;
    expect(detail.gatewayProxyEnabled).toBe(true);
    expect(detail.managed).toBe("not_api_managed");
    expect(detail.disableForTimeSeconds).toBe(3600);
    expect(entity.providerId).toBe(DEVICE_SETTING_ID);
  });

  it("stores null for every switch when the settings row is empty", () => {
    const detail = projectCloudflareDeviceSetting({ accountId: ACCOUNT_ID, at: AT, setting: {} }).detail;
    expect(detail).toEqual({
      disableForTimeSeconds: null,
      gatewayProxyEnabled: null,
      gatewayUdpProxyEnabled: null,
      kind: "device-setting",
      managed: null,
      rootCertificateInstallationEnabled: null,
      useZeroTrustVirtualIp: null,
    });
  });
});

describe("projectCloudflareDeviceManagedNetwork", () => {
  it("keys on the provider's network_id rather than its renameable name", () => {
    const entity = projectCloudflareDeviceManagedNetwork({
      accountId: ACCOUNT_ID,
      at: AT,
      network: { config: { tls_sockaddr: "10.0.0.1:443" }, name: "office", network_id: "net-1", type: "tls" },
    });
    const detail = entity.detail as CloudflareDeviceManagedNetworkDetail;
    expect(detail.name).toBe("office");
    expect(detail.type).toBe("tls");
    expect(JSON.stringify(detail.config)).toContain("10.0.0.1:443");
    expect(entity.providerId).toBe("net-1");
    const renamed = projectCloudflareDeviceManagedNetwork({
      accountId: ACCOUNT_ID,
      at: AT,
      network: { name: "office-renamed", network_id: "net-1" },
    });
    expect(renamed.id).toBe(entity.id);
  });

  it("stores null for every field when the network row carries nothing but an id", () => {
    const detail = projectCloudflareDeviceManagedNetwork({
      accountId: ACCOUNT_ID,
      at: AT,
      network: { network_id: "net-2" },
    }).detail;
    expect(detail).toEqual({ config: null, kind: "device-managed-network", name: null, type: null });
  });
});
