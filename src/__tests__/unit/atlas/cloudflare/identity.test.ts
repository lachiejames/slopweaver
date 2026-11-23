import { describe, expect, it } from "vitest";

import { cloudflareEntityId, cloudflareGapId, cloudflareZoneEntityId } from "../../../../atlas/cloudflare/identity.js";
import { CLOUDFLARE_ZONE_SCOPED_KINDS } from "../../../../atlas/cloudflare/model.js";

describe("cloudflareEntityId", () => {
  it("is deterministic for the same kind and components", () => {
    const first = cloudflareEntityId({ components: { accountId: "a", providerId: "z1" }, kind: "zone" });
    const second = cloudflareEntityId({ components: { accountId: "a", providerId: "z1" }, kind: "zone" });
    expect(first).toBe(second);
  });

  it("is independent of component insertion order", () => {
    const first = cloudflareEntityId({ components: { accountId: "a", providerId: "z1" }, kind: "zone" });
    const second = cloudflareEntityId({ components: { providerId: "z1", accountId: "a" }, kind: "zone" });
    expect(first).toBe(second);
  });

  it("differs across kinds sharing the same provider id", () => {
    const zone = cloudflareEntityId({ components: { providerId: "same-id" }, kind: "zone" });
    const application = cloudflareEntityId({ components: { providerId: "same-id" }, kind: "access-application" });
    expect(zone).not.toBe(application);
  });

  it("distinguishes a null component from an empty string", () => {
    const withNull = cloudflareEntityId({ components: { parentId: null }, kind: "zone" });
    const withEmpty = cloudflareEntityId({ components: { parentId: "" }, kind: "zone" });
    expect(withNull).not.toBe(withEmpty);
  });

  it("returns a 32-character hex digest", () => {
    const id = cloudflareEntityId({ components: { providerId: "z1" }, kind: "zone" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("cloudflareGapId", () => {
  it("is deterministic for the same condition and scope", () => {
    const first = cloudflareGapId({ condition: "transport-error", scope: "account/a/zones" });
    const second = cloudflareGapId({ condition: "transport-error", scope: "account/a/zones" });
    expect(first).toBe(second);
  });

  it("differs when the scope differs", () => {
    const first = cloudflareGapId({ condition: "transport-error", scope: "account/a/zones" });
    const second = cloudflareGapId({ condition: "transport-error", scope: "account/b/zones" });
    expect(first).not.toBe(second);
  });
});

describe("cloudflareZoneEntityId", () => {
  const COMPONENTS = { accountId: "a", providerId: "ssl" } as const;

  it.each(CLOUDFLARE_ZONE_SCOPED_KINDS)(
    "gives %s a different id in two zones that return the same provider id",
    (kind) => {
      const first = cloudflareZoneEntityId({ components: COMPONENTS, kind, zoneId: "zone-one" });
      const second = cloudflareZoneEntityId({ components: COMPONENTS, kind, zoneId: "zone-two" });
      expect(first).not.toBe(second);
    },
  );

  it("is deterministic for the same kind, zone and components", () => {
    const first = cloudflareZoneEntityId({ components: COMPONENTS, kind: "zone-setting", zoneId: "zone-one" });
    const second = cloudflareZoneEntityId({ components: COMPONENTS, kind: "zone-setting", zoneId: "zone-one" });
    expect(first).toBe(second);
  });

  it("cannot transpose the zone with the provider id", () => {
    const first = cloudflareZoneEntityId({ components: { providerId: "x" }, kind: "zone-setting", zoneId: "y" });
    const second = cloudflareZoneEntityId({ components: { providerId: "y" }, kind: "zone-setting", zoneId: "x" });
    expect(first).not.toBe(second);
  });

  it("returns a 32-character hex digest", () => {
    const id = cloudflareZoneEntityId({ components: COMPONENTS, kind: "zone-setting", zoneId: "zone-one" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
