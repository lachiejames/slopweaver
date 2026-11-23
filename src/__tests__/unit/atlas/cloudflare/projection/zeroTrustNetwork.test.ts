import { describe, expect, it } from "vitest";

import {
  type CloudflareConnectivitySettingDetail,
  type CloudflareTunnelDetail,
  type CloudflareTunnelRouteDetail,
  type CloudflareVirtualNetworkDetail,
  type CloudflareZeroTrustSubnetDetail,
  CONNECTIVITY_SETTING_ID,
  projectCloudflareConnectivitySetting,
  projectCloudflareTunnel,
  projectCloudflareTunnelRoute,
  projectCloudflareVirtualNetwork,
  projectCloudflareZeroTrustSubnet,
} from "../../../../../atlas/cloudflare/projection/zeroTrustNetwork.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareTunnel", () => {
  it("keeps the connector's live connections, which is what a broken private route is diagnosed from", () => {
    const entity = projectCloudflareTunnel({
      accountId: ACCOUNT_ID,
      at: AT,
      tunnel: {
        config_src: "cloudflare",
        connections: [{ colo_name: "SYD", is_pending_reconnect: false }],
        id: "tunnel-1",
        name: "office",
        status: "healthy",
      },
    });
    const detail = entity.detail as CloudflareTunnelDetail;
    expect(detail.status).toBe("healthy");
    expect(detail.configSource).toBe("cloudflare");
    expect(JSON.stringify(detail.connections)).toContain("SYD");
    expect(entity.source.operation).toBe("tunnels-list");
  });

  it("stores every optional field as null when only the id is present", () => {
    const entity = projectCloudflareTunnel({ accountId: ACCOUNT_ID, at: AT, tunnel: { id: "tunnel-2" } });
    expect(entity.detail).toEqual({
      configSource: null,
      connections: null,
      connectionsActiveAt: null,
      connectionsInactiveAt: null,
      createdAt: null,
      deletedAt: null,
      kind: "tunnel",
      metadata: null,
      name: null,
      remoteConfig: null,
      status: null,
      tunnelType: null,
    });
  });

  it("stores explicitly null optional fields as null", () => {
    const entity = projectCloudflareTunnel({
      accountId: ACCOUNT_ID,
      at: AT,
      tunnel: { connections: null, id: "tunnel-3", name: null, remote_config: null },
    });
    const detail = entity.detail as CloudflareTunnelDetail;
    expect(detail.connections).toBeNull();
    expect(detail.name).toBeNull();
    expect(detail.remoteConfig).toBeNull();
  });
});

describe("projectCloudflareTunnelRoute", () => {
  it("records the tunnel it belongs to as its parent scope", () => {
    const entity = projectCloudflareTunnelRoute({
      accountId: ACCOUNT_ID,
      at: AT,
      route: { id: "route-1", network: "10.1.0.0/16", tunnel_id: "tunnel-1", virtual_network_id: "vnet-1" },
    });
    const detail = entity.detail as CloudflareTunnelRouteDetail;
    expect(detail.network).toBe("10.1.0.0/16");
    expect(detail.virtualNetworkId).toBe("vnet-1");
    expect(entity.scope).toEqual({ accountId: ACCOUNT_ID, parentId: "tunnel-1", zoneId: null });
  });

  it("leaves the parent null for a route with no tunnel in the response", () => {
    const entity = projectCloudflareTunnelRoute({ accountId: ACCOUNT_ID, at: AT, route: { id: "route-2" } });
    expect(entity.scope.parentId).toBeNull();
  });

  it("stores every optional field as null when only the id is present", () => {
    const entity = projectCloudflareTunnelRoute({ accountId: ACCOUNT_ID, at: AT, route: { id: "route-3" } });
    expect(entity.detail).toEqual({
      comment: null,
      createdAt: null,
      deletedAt: null,
      kind: "tunnel-route",
      network: null,
      tunnelId: null,
      tunnelName: null,
      tunnelType: null,
      virtualNetworkId: null,
      virtualNetworkName: null,
    });
  });

  it("leaves the parent null when the tunnel id is explicitly null", () => {
    const entity = projectCloudflareTunnelRoute({
      accountId: ACCOUNT_ID,
      at: AT,
      route: { id: "route-4", tunnel_id: null },
    });
    expect(entity.scope.parentId).toBeNull();
  });
});

describe("projectCloudflareVirtualNetwork", () => {
  it("keeps the default-network flag, false included", () => {
    const detail = projectCloudflareVirtualNetwork({
      accountId: ACCOUNT_ID,
      at: AT,
      network: { id: "vnet-1", is_default_network: false, name: "second" },
    }).detail as CloudflareVirtualNetworkDetail;
    expect(detail.isDefaultNetwork).toBe(false);
    expect(detail.name).toBe("second");
  });

  it("stores the deletion time as null when a live network omits it", () => {
    const entity = projectCloudflareVirtualNetwork({
      accountId: ACCOUNT_ID,
      at: AT,
      network: {
        comment: "",
        created_at: "2026-01-02T00:00:00Z",
        id: "vnet-2",
        is_default_network: true,
        name: "default",
      },
    });
    expect(entity.detail).toEqual({
      comment: "",
      createdAt: "2026-01-02T00:00:00Z",
      deletedAt: null,
      isDefaultNetwork: true,
      kind: "virtual-network",
      name: "default",
    });
  });
});

describe("projectCloudflareZeroTrustSubnet", () => {
  it("keeps the address space and its subnet type", () => {
    const detail = projectCloudflareZeroTrustSubnet({
      accountId: ACCOUNT_ID,
      at: AT,
      subnet: { id: "subnet-1", name: "warp", network: "100.96.0.0/12", subnet_type: "warp" },
    }).detail as CloudflareZeroTrustSubnetDetail;
    expect(detail.network).toBe("100.96.0.0/12");
    expect(detail.subnetType).toBe("warp");
  });

  it("stores every optional field as null when only the id is present", () => {
    const entity = projectCloudflareZeroTrustSubnet({ accountId: ACCOUNT_ID, at: AT, subnet: { id: "subnet-2" } });
    expect(entity.detail).toEqual({
      comment: null,
      createdAt: null,
      deletedAt: null,
      isDefaultNetwork: null,
      kind: "zero-trust-subnet",
      name: null,
      network: null,
      subnetType: null,
    });
  });
});

describe("projectCloudflareConnectivitySetting", () => {
  it("stores both switches under a fixed provider id", () => {
    const entity = projectCloudflareConnectivitySetting({
      accountId: ACCOUNT_ID,
      at: AT,
      setting: { icmp_proxy_enabled: true, offramp_warp_enabled: false },
    });
    const detail = entity.detail as CloudflareConnectivitySettingDetail;
    expect(detail.icmpProxyEnabled).toBe(true);
    expect(detail.offrampWarpEnabled).toBe(false);
    expect(entity.providerId).toBe(CONNECTIVITY_SETTING_ID);
  });

  it("stores both switches as null when the response omits them", () => {
    const entity = projectCloudflareConnectivitySetting({ accountId: ACCOUNT_ID, at: AT, setting: {} });
    expect(entity.detail).toEqual({ icmpProxyEnabled: null, kind: "connectivity-setting", offrampWarpEnabled: null });
  });
});
