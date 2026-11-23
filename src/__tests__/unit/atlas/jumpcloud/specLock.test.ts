import { describe, expect, it } from "vitest";

import {
  JUMPCLOUD_ORIGINS,
  JUMPCLOUD_SPEC_PINS,
  JUMPCLOUD_UNPROJECTABLE_PATHS,
} from "../../../../atlas/jumpcloud/generated/specLock.js";

describe("JUMPCLOUD_SPEC_PINS", () => {
  it("pins the measured v1 specification", () => {
    expect(JUMPCLOUD_SPEC_PINS.v1.sha256).toBe("2d6f66e5f6ce56623458168a31246bb698b3659be3987f2fa1f003e75acfe274");
    expect(JUMPCLOUD_SPEC_PINS.v1.byteLength).toBe(368080);
    expect(JUMPCLOUD_SPEC_PINS.v1.pathCount).toBe(81);
    expect(JUMPCLOUD_SPEC_PINS.v1.getCount).toBe(21);
  });

  it("pins the measured v2 specification", () => {
    expect(JUMPCLOUD_SPEC_PINS.v2.sha256).toBe("bf2427024231a244996063904117f2c4775ee67e8344562ce65739575fd8a9c3");
    expect(JUMPCLOUD_SPEC_PINS.v2.byteLength).toBe(2940657);
    expect(JUMPCLOUD_SPEC_PINS.v2.pathCount).toBe(715);
    expect(JUMPCLOUD_SPEC_PINS.v2.getCount).toBe(464);
  });

  it("pins the measured Directory Insights specification", () => {
    expect(JUMPCLOUD_SPEC_PINS.insights.sha256).toBe(
      "fa21b67f8beda2b98e33bba0b588a80b244c2bba898c6095544df3ef8b889a7d",
    );
    expect(JUMPCLOUD_SPEC_PINS.insights.byteLength).toBe(272944);
    expect(JUMPCLOUD_SPEC_PINS.insights.pathCount).toBe(7);
    expect(JUMPCLOUD_SPEC_PINS.insights.getCount).toBe(2);
  });

  it("carries a 64-character hex digest for every pin, so a truncated paste fails here", () => {
    const digests = Object.values(JUMPCLOUD_SPEC_PINS).map((pin) => pin.sha256);
    expect(digests.filter((d) => /^[0-9a-f]{64}$/.test(d)).length).toBe(3);
  });

  it("reaches every pin over https at docs.jumpcloud.com", () => {
    const urls = Object.values(JUMPCLOUD_SPEC_PINS).map((pin) => pin.url);
    expect(urls.filter((u) => u.startsWith("https://docs.jumpcloud.com/api/")).length).toBe(3);
  });
});

describe("JUMPCLOUD_ORIGINS", () => {
  it("admits exactly the Directory and Insights hosts", () => {
    expect(Object.values(JUMPCLOUD_ORIGINS)).toStrictEqual([
      "https://console.jumpcloud.com",
      "https://api.jumpcloud.com",
    ]);
  });

  it("names no regional or CDN host, which is how an admin key reaches an unreviewed origin", () => {
    const suspicious = Object.values(JUMPCLOUD_ORIGINS).filter((o) => /eu|in\.|cdn|storage/i.test(o));
    expect(suspicious).toStrictEqual([]);
  });
});

describe("JUMPCLOUD_UNPROJECTABLE_PATHS", () => {
  it("names the eight operations whose success schema the specifications do not describe", () => {
    expect(JUMPCLOUD_UNPROJECTABLE_PATHS.length).toBe(8);
  });

  it("includes the open Directory Insights events array", () => {
    expect(JUMPCLOUD_UNPROJECTABLE_PATHS).toContain("/insights/directory/v1/events");
  });

  it("holds every entry sorted, so a review diff shows an addition in place", () => {
    expect(JUMPCLOUD_UNPROJECTABLE_PATHS.toSorted()).toStrictEqual([...JUMPCLOUD_UNPROJECTABLE_PATHS]);
  });

  it("lists each path once", () => {
    expect(new Set(JUMPCLOUD_UNPROJECTABLE_PATHS).size).toBe(JUMPCLOUD_UNPROJECTABLE_PATHS.length);
  });
});
