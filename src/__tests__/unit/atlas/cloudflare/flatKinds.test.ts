import { describe, expect, it } from "vitest";

import { flatKindSpecs } from "../../../../atlas/cloudflare/flatKindSpecs.js";
import {
  CLOUDFLARE_ACCOUNT_SCOPED_KINDS,
  CLOUDFLARE_ZERO_TRUST_HELD_KINDS,
  CLOUDFLARE_ZONE_SCOPED_KINDS,
} from "../../../../atlas/cloudflare/model.js";
import { readCloudflareAuditLogs } from "../../../../atlas/cloudflare/readers/auditLog.js";
import { readCloudflareAccessUsers } from "../../../../atlas/cloudflare/readers/zeroTrustActor.js";
import { readCloudflareDexFleetStatus } from "../../../../atlas/cloudflare/readers/zeroTrustPosture.js";
import { readCloudflareZones } from "../../../../atlas/cloudflare/readers/zone.js";

const SPECS = flatKindSpecs({ deepZoneId: "zone-1" });

/** The registry with its reader functions projected away, so a row compares as plain data. */
function dataOf({ deepZoneId }: { deepZoneId: string }): readonly Record<string, unknown>[] {
  return flatKindSpecs({ deepZoneId }).map(({ read: _read, ...rest }) => rest);
}

describe("flatKindSpecs", () => {
  it("registers fifty-three flat kinds in this exact order", () => {
    expect(SPECS.length).toBeGreaterThan(0);
    expect(SPECS.length).toBe(53);
    expect(SPECS.map((spec) => spec.kind)).toEqual([
      "zone",
      "account-setting",
      "access-application",
      "access-group",
      "access-service-token",
      "device-posture-rule",
      "identity-provider",
      "worker-account-setting",
      "worker-domain",
      "notification-policy",
      "notification-destination",
      "notification-silence",
      "notification-history",
      "audit-log",
      "access-user",
      "zero-trust-organization",
      "device-registration",
      "device-policy",
      "device-setting",
      "device-managed-network",
      "gateway-policy",
      "gateway-configuration",
      "gateway-logging",
      "gateway-location",
      "gateway-certificate",
      "gateway-proxy-endpoint",
      "gateway-audit-ssh-setting",
      "connectivity-setting",
      "tunnel",
      "tunnel-route",
      "virtual-network",
      "zero-trust-subnet",
      "dlp-profile",
      "casb-integration",
      "access-tag",
      "access-bookmark",
      "access-custom-page",
      "access-certificate",
      "access-gateway-ca",
      "access-infrastructure-target",
      "access-key-configuration",
      "access-authentication-log",
      "dlp-dataset",
      "casb-finding",
      "risk-score",
      "risk-score-summary",
      "dex-test",
      "dex-fleet-status",
      "dns-record",
      "dnssec",
      "zone-setting",
      "page-rule",
      "worker-route",
    ]);
  });

  it("registers no kind twice", () => {
    expect(new Set(SPECS.map((spec) => spec.kind)).size).toBe(53);
  });

  it("carries every Zero Trust held kind exactly once, in rows fifteen to forty-eight", () => {
    const zeroTrust = SPECS.slice(14, 48).map((spec) => spec.kind);
    expect(zeroTrust.length).toBe(34);
    expect(zeroTrust.toSorted()).toEqual(CLOUDFLARE_ZERO_TRUST_HELD_KINDS.toSorted());
  });

  it("pins the five deep-zone rows to the zone it was given, under a zone/ coverage scope", () => {
    expect(dataOf({ deepZoneId: "zone-1" }).slice(48)).toEqual([
      {
        kind: "dns-record",
        label: "DNS record(s) for the deep zone",
        scope: "zone/zone-1/dns-record",
        zoneId: "zone-1",
      },
      {
        kind: "dnssec",
        label: "DNSSEC status record(s) for the deep zone",
        scope: "zone/zone-1/dnssec",
        zoneId: "zone-1",
      },
      {
        kind: "zone-setting",
        label: "zone setting(s) for the deep zone",
        scope: "zone/zone-1/zone-setting",
        zoneId: "zone-1",
      },
      { kind: "page-rule", label: "Page Rule(s) for the deep zone", scope: "zone/zone-1/page-rule", zoneId: "zone-1" },
      {
        kind: "worker-route",
        label: "Workers route(s) for the deep zone",
        scope: "zone/zone-1/worker-route",
        zoneId: "zone-1",
      },
    ]);
  });

  it("follows a different deep zone into every zone row's id and scope", () => {
    expect(
      dataOf({ deepZoneId: "zone-2" })
        .slice(48)
        .map((row) => [row["zoneId"], row["scope"]]),
    ).toEqual([
      ["zone-2", "zone/zone-2/dns-record"],
      ["zone-2", "zone/zone-2/dnssec"],
      ["zone-2", "zone/zone-2/zone-setting"],
      ["zone-2", "zone/zone-2/page-rule"],
      ["zone-2", "zone/zone-2/worker-route"],
    ]);
  });

  it("gives a zone and scope to exactly the zone-scoped kinds, and to no account-scoped one", () => {
    const zoneKinds = new Set<string>(CLOUDFLARE_ZONE_SCOPED_KINDS);
    const accountKinds = new Set<string>(CLOUDFLARE_ACCOUNT_SCOPED_KINDS);
    const withZone = SPECS.filter((spec) => "zoneId" in spec).map((spec) => spec.kind);
    const withoutZone = SPECS.filter((spec) => !("zoneId" in spec) && !("scope" in spec)).map((spec) => spec.kind);
    expect(withZone).toEqual(["dns-record", "dnssec", "zone-setting", "page-rule", "worker-route"]);
    expect(withZone.filter((kind) => !zoneKinds.has(kind))).toEqual([]);
    expect(withoutZone.length).toBe(48);
    expect(withoutZone.filter((kind) => !accountKinds.has(kind))).toEqual([]);
  });

  it("pins an account row's whole data and hands it the module's own reader unwrapped", () => {
    expect(dataOf({ deepZoneId: "zone-1" }).slice(0, 2)).toEqual([
      { kind: "zone", label: "zone(s) under the selected account" },
      { kind: "account-setting", label: "account setting record(s)" },
    ]);
    expect(SPECS[0]!.read).toBe(readCloudflareZones);
    expect(SPECS[13]!.read).toBe(readCloudflareAuditLogs);
    expect(SPECS[14]!.read).toBe(readCloudflareAccessUsers);
    expect(SPECS[47]!.read).toBe(readCloudflareDexFleetStatus);
  });

  it("wraps each deep-zone reader in its own closure rather than handing over a shared reader", () => {
    const zoneReads = SPECS.slice(48).map((spec) => spec.read);
    expect(new Set(zoneReads).size).toBe(5);
    expect(flatKindSpecs({ deepZoneId: "zone-1" })[48]!.read).not.toBe(SPECS[48]!.read);
  });
});
