import { describe, expect, it } from "vitest";

import {
  CROWDSTRIKE_DENIED_FIELDS,
  CROWDSTRIKE_HOST_FIELDS,
  isDeniedCrowdstrikeField,
  missingJoinKeys,
} from "../../../../atlas/crowdstrike/privacy.js";

describe("missingJoinKeys", () => {
  it("admits every key the CrowdStrike-to-JumpCloud join runs on", () => {
    expect(missingJoinKeys()).toEqual([]);
  });
});

describe("CROWDSTRIKE_HOST_FIELDS", () => {
  it("keeps serial, hostname and MAC, because stripping them defeats the atlas", () => {
    expect(CROWDSTRIKE_HOST_FIELDS).toContain("serial_number");
    expect(CROWDSTRIKE_HOST_FIELDS).toContain("hostname");
    expect(CROWDSTRIKE_HOST_FIELDS).toContain("mac_address");
  });

  it("keeps the posture fields the ISO question asks about", () => {
    expect(CROWDSTRIKE_HOST_FIELDS).toContain("reduced_functionality_mode");
    expect(CROWDSTRIKE_HOST_FIELDS).toContain("agent_version");
    expect(CROWDSTRIKE_HOST_FIELDS).toContain("device_policies");
  });

  it("admits no field that is also denied", () => {
    const contradictory = CROWDSTRIKE_HOST_FIELDS.filter((field) => isDeniedCrowdstrikeField({ field }));
    expect(contradictory).toEqual([]);
  });

  it("does not admit a volatile network locator", () => {
    expect(CROWDSTRIKE_HOST_FIELDS).not.toContain("local_ip");
    expect(CROWDSTRIKE_HOST_FIELDS).not.toContain("external_ip");
  });
});

describe("isDeniedCrowdstrikeField", () => {
  it("refuses a credential", () => {
    expect(isDeniedCrowdstrikeField({ field: "client_secret" })).toBe(true);
    expect(isDeniedCrowdstrikeField({ field: "maintenance_token" })).toBe(true);
  });

  it("refuses a network locator", () => {
    expect(isDeniedCrowdstrikeField({ field: "external_ip" })).toBe(true);
  });

  it("refuses incident content", () => {
    expect(isDeniedCrowdstrikeField({ field: "command_line" })).toBe(true);
  });

  it("normalises case and surrounding space, because providers are inconsistent", () => {
    expect(isDeniedCrowdstrikeField({ field: "  Access_Token " })).toBe(true);
  });

  it("KEEPS posture fields whose names merely look sensitive", () => {
    for (const field of [
      "uninstall_protection",
      "reduced_functionality_mode",
      "rtr_state",
      "safe_mode",
      "sensor_file_status",
      "provisioning_state",
    ]) {
      expect(isDeniedCrowdstrikeField({ field })).toBe(false);
    }
  });

  it("keeps a field whose name merely contains a denied name, matching exactly rather than by substring", () => {
    expect(isDeniedCrowdstrikeField({ field: "cookie_policy_enabled" })).toBe(false);
    expect(isDeniedCrowdstrikeField({ field: "filename_pattern_count" })).toBe(false);
  });

  it("denies nothing by accident — every denial is spelled once", () => {
    expect(CROWDSTRIKE_DENIED_FIELDS.length).toBe(new Set(CROWDSTRIKE_DENIED_FIELDS).size);
  });

  it("stores every denial already lowercased, so the comparison cannot silently miss", () => {
    const unnormalised = CROWDSTRIKE_DENIED_FIELDS.filter((field) => field !== field.toLowerCase());
    expect(unnormalised).toEqual([]);
  });
});
