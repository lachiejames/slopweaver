import { describe, expect, it } from "vitest";

import type { CrowdstrikeHost } from "../../../../atlas/crowdstrike/entities.js";
import {
  divergentSurfaces,
  type ForeignDevice,
  fleetDisagreements,
  reconcileFleets,
} from "../../../../atlas/crowdstrike/reconcile.js";

const AT = "2026-09-04T00:00:00.000Z";

function host({
  providerId,
  serialNumber = null,
  hostname = null,
  macAddress = null,
  lastLoginAccount = null,
}: {
  providerId: string;
  serialNumber?: string | null;
  hostname?: string | null;
  macAddress?: string | null;
  lastLoginAccount?: string | null;
}): CrowdstrikeHost {
  return {
    agentVersion: null,
    firstSeenAt: AT,
    firstSeenAtProvider: null,
    groupIds: [],
    hidden: false,
    hostname,
    id: providerId,
    kernelVersion: null,
    lastLoginAccount,
    lastLoginAt: null,
    lastSeenAt: null,
    macAddress,
    onlineState: null,
    osBuild: null,
    osVersion: null,
    platformName: null,
    preventionPolicyApplied: null,
    preventionPolicyId: null,
    productTypeDesc: null,
    providerId,
    reducedFunctionalityMode: null,
    rtrState: null,
    sensorUpdatePolicyApplied: null,
    sensorUpdatePolicyId: null,
    serialNumber,
    source: {
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unverified",
      endpoint: "/devices",
      observedAt: AT,
      surface: "falcon-api",
    },
    state: "observed",
    status: null,
    systemManufacturer: null,
    systemProductName: null,
  };
}

function device({
  providerId,
  serialNumber = null,
  hostname = null,
  macAddress = null,
  assignedTo = null,
}: Partial<ForeignDevice> & { providerId: string }): ForeignDevice {
  return { assignedTo, hostname, macAddress, providerId, serialNumber };
}

describe("reconcileFleets", () => {
  it("joins on serial number in preference to hostname", () => {
    const result = reconcileFleets({
      devices: [device({ hostname: "OTHER", providerId: "jc-1", serialNumber: "SERIAL-1" })],
      hosts: [host({ hostname: "EXAMPLE-1", providerId: "aid-1", serialNumber: "SERIAL-1" })],
    });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.joinedOn).toBe("serial-number");
  });

  it("falls back to hostname, and says the join was weaker", () => {
    const result = reconcileFleets({
      devices: [device({ hostname: "EXAMPLE-1", providerId: "jc-1" })],
      hosts: [host({ hostname: "EXAMPLE-1", providerId: "aid-1" })],
    });
    expect(result.matched[0]!.joinedOn).toBe("hostname");
  });

  it("normalises separators and case, so one machine is one machine", () => {
    const result = reconcileFleets({
      devices: [device({ macAddress: "00:11:22:33:44:55", providerId: "jc-1" })],
      hosts: [host({ macAddress: "00-11-22-33-44-55", providerId: "aid-1" })],
    });
    expect(result.matched[0]!.joinedOn).toBe("mac-address");
  });

  it("reports a last observed login and an assignment as SEPARATE claims", () => {
    const result = reconcileFleets({
      devices: [device({ assignedTo: "assigned.person", providerId: "jc-1", serialNumber: "SERIAL-1" })],
      hosts: [host({ lastLoginAccount: "observed.person", providerId: "aid-1", serialNumber: "SERIAL-1" })],
    });
    expect(result.matched[0]!.lastObservedLogin).toBe("observed.person");
    expect(result.matched[0]!.assignedTo).toBe("assigned.person");
  });

  it("names a sensored machine the other source does not list", () => {
    const result = reconcileFleets({ devices: [], hosts: [host({ providerId: "aid-1", serialNumber: "SERIAL-1" })] });
    expect(result.onlyInCrowdstrike).toEqual(["aid-1"]);
  });

  it("names a machine the other source lists that carries NO sensor — the coverage gap", () => {
    const result = reconcileFleets({ devices: [device({ providerId: "jc-9", serialNumber: "SERIAL-9" })], hosts: [] });
    expect(result.onlyInForeign).toEqual(["jc-9"]);
  });

  it("names a host that carried no join key at all rather than silently dropping it", () => {
    const result = reconcileFleets({ devices: [], hosts: [host({ providerId: "aid-blank" })] });
    expect(result.unjoinable).toEqual(["aid-blank"]);
    expect(result.onlyInCrowdstrike).toEqual([]);
  });

  it("matches one foreign device at most once", () => {
    const result = reconcileFleets({
      devices: [device({ hostname: "EXAMPLE-1", providerId: "jc-1", serialNumber: "SERIAL-1" })],
      hosts: [
        host({ providerId: "aid-1", serialNumber: "SERIAL-1" }),
        host({ hostname: "EXAMPLE-1", providerId: "aid-2" }),
      ],
    });
    expect(result.matched).toHaveLength(2);
    expect(result.onlyInForeign).toEqual([]);
  });
});

describe("fleetDisagreements", () => {
  it("names a field the two sources describe differently", () => {
    const differing = fleetDisagreements({
      device: device({ hostname: "RENAMED", providerId: "jc-1", serialNumber: "SERIAL-1" }),
      host: host({ hostname: "EXAMPLE-1", providerId: "aid-1", serialNumber: "SERIAL-1" }),
    });
    expect(differing).toEqual(["hostname"]);
  });

  it("does NOT report an absence as a disagreement", () => {
    const differing = fleetDisagreements({
      device: device({ providerId: "jc-1", serialNumber: "SERIAL-1" }),
      host: host({ hostname: "EXAMPLE-1", providerId: "aid-1", serialNumber: "SERIAL-1" }),
    });
    expect(differing).toEqual([]);
  });
});

describe("divergentSurfaces", () => {
  it("names an endpoint the console calls that the closed inventory has no admitted call for", () => {
    const divergent = divergentSurfaces({
      admittedPaths: ["/devices/queries/devices/v1"],
      consoleRequests: [
        { method: "GET", observedOnPages: ["/host-management/hosts"], pathShape: "/api2/devices/queries/fga-hosts/v1" },
        { method: "GET", observedOnPages: ["/a"], pathShape: "/api2/devices/queries/devices/v1" },
      ],
    });
    expect(divergent.map((row) => row.pathShape)).toEqual(["/api2/devices/queries/fga-hosts/v1"]);
  });
});
