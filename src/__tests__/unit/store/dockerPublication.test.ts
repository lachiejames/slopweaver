/**
 * The one loopback policy the store's readers share: which publications reach this machine only, and how a
 * refusal names the rest without carrying an address.
 */
import { describe, expect, it } from "vitest";

import { exposureLabel, exposuresOf, isLoopbackHostIp } from "../../../store/dockerPublication.js";

describe("isLoopbackHostIp", () => {
  it("accepts every IPv4 loopback address and ::1", () => {
    expect(["127.0.0.1", "127.1.2.3", "::1"].map((hostIp) => isLoopbackHostIp({ hostIp }))).toEqual([true, true, true]);
  });

  it("refuses every interface and a LAN address", () => {
    expect(["0.0.0.0", "::", "", "192.0.2.10"].map((hostIp) => isLoopbackHostIp({ hostIp }))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("exposureLabel", () => {
  it("names every interface for an empty address, 0.0.0.0 and ::", () => {
    expect(["", "0.0.0.0", "::"].map((hostIp) => exposureLabel({ hostIp }))).toEqual([
      "every interface",
      "every interface",
      "every interface",
    ]);
  });

  it("names any other address only by its kind", () => {
    expect(exposureLabel({ hostIp: "192.0.2.10" })).toBe("a non-loopback address");
  });
});

describe("exposuresOf", () => {
  it("is empty when every publication is loopback", () => {
    expect(
      exposuresOf({
        ports: [
          { hostIp: "127.0.0.1", port: 55322 },
          { hostIp: "::1", port: 55322 },
        ],
      }),
    ).toEqual([]);
  });

  it("deduplicates in first-seen order and ignores the loopback ones", () => {
    expect(
      exposuresOf({
        ports: [
          { hostIp: "127.0.0.1", port: 55322 },
          { hostIp: "192.0.2.10", port: 55322 },
          { hostIp: "0.0.0.0", port: 55322 },
          { hostIp: "::", port: 55322 },
        ],
      }),
    ).toEqual(["a non-loopback address", "every interface"]);
  });
});
