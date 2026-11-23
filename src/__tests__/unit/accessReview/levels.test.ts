import { describe, expect, it } from "vitest";

import {
  ACCESS_LEVEL_TABLE,
  holdsAccount,
  levelValuesOf,
  ROSTER_SPINE,
  readDetailPath,
  verbatimLevel,
} from "../../../accessReview/levels.js";
import { JUMPCLOUD_SURFACES } from "../../../atlas/jumpcloud/generated/surfaces.js";
import { atlasPlatforms } from "../../../atlas/registry.js";

describe("ACCESS_LEVEL_TABLE — the guard that keeps a renamed field from emptying a section", () => {
  it("declares at least one platform", () => {
    expect(ACCESS_LEVEL_TABLE.length).toBeGreaterThan(0);
  });

  it("names only platforms this build registers", () => {
    const known = atlasPlatforms();
    const unknown = [...ACCESS_LEVEL_TABLE, ROSTER_SPINE]
      .map((spec) => spec.platform)
      .filter((platform) => !known.includes(platform));
    expect(unknown).toEqual([]);
  });

  it("names a surface family that is a declared JumpCloud surface row", () => {
    const declared = JUMPCLOUD_SURFACES.map((row) => row.name);
    const families = ACCESS_LEVEL_TABLE.filter((spec) => spec.platform === "jumpcloud").map(
      (spec) => spec.surfaceFamily,
    );
    expect(families).toEqual(["v1-systemusers-get"]);
    expect(declared).toContain("v1-systemusers-get");
  });

  it("gives every hold rule a label the same platform actually declares", () => {
    const orphans = [...ACCESS_LEVEL_TABLE, ROSTER_SPINE].flatMap((spec) =>
      spec.holds
        .filter((rule) => !spec.levels.some((level) => level.label === rule.label))
        .map((rule) => `${spec.platform}:${rule.label}`),
    );
    expect(orphans).toEqual([]);
  });

  it("declares a non-empty hold rule set on every platform", () => {
    const empty = [...ACCESS_LEVEL_TABLE, ROSTER_SPINE]
      .filter((spec) => spec.holds.length === 0)
      .map((spec) => spec.platform);
    expect(empty).toEqual([]);
  });
});

describe("readDetailPath", () => {
  it("walks a nested path", () => {
    expect(readDetailPath({ detail: { employment: { status: "FORMER" } }, path: ["employment", "status"] })).toBe(
      "FORMER",
    );
  });

  it("answers undefined when a step is absent", () => {
    expect(readDetailPath({ detail: { employment: {} }, path: ["employment", "status"] })).toBe(undefined);
  });

  it("answers undefined when a step is not a record", () => {
    expect(readDetailPath({ detail: { admin: "yes" }, path: ["admin", "roleName"] })).toBe(undefined);
  });

  it("answers undefined for a non-record detail", () => {
    expect(readDetailPath({ detail: null, path: ["email"] })).toBe(undefined);
  });

  it("answers the detail itself for an empty path", () => {
    expect(readDetailPath({ detail: "whole", path: [] })).toBe("whole");
  });
});

describe("verbatimLevel", () => {
  it("keeps a string exactly", () => {
    expect(verbatimLevel({ value: "Administrator With Billing" })).toBe("Administrator With Billing");
  });

  it("keeps a stored negative zero distinct from zero", () => {
    expect(verbatimLevel({ value: JSON.parse("-0") })).toBe("-0");
    expect(verbatimLevel({ value: 0 })).toBe("0");
  });

  it("keeps a stored empty string, distinct from absence", () => {
    expect(verbatimLevel({ value: "" })).toBe("");
  });

  it("renders a boolean as the provider's own word", () => {
    expect(verbatimLevel({ value: false })).toBe("false");
  });

  it("renders a number as its digits", () => {
    expect(verbatimLevel({ value: 0 })).toBe("0");
  });

  it("answers null for an absent field", () => {
    expect(verbatimLevel({ value: undefined })).toBe(null);
  });

  it("answers null for an explicit null", () => {
    expect(verbatimLevel({ value: null })).toBe(null);
  });

  it("renders a structured value as its JSON rather than as object prose", () => {
    expect(verbatimLevel({ value: { configured: true } })).toBe('{"configured":true}');
  });
});

describe("levelValuesOf and holdsAccount", () => {
  const jumpcloud = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "jumpcloud")!;
  const cloudflare = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "cloudflare")!;

  it("reads a console role out of the nested admin object", () => {
    const levels = levelValuesOf({
      detail: { admin: { roleName: "Read Only" }, state: "ACTIVATED" },
      spec: jumpcloud,
    });
    expect(levels.find((level) => level.label === "console role")!.value).toBe("Read Only");
  });

  it("reports an absent console role as null rather than as an empty role", () => {
    const levels = levelValuesOf({ detail: { admin: {}, state: "ACTIVATED" }, spec: jumpcloud });
    expect(levels.find((level) => level.label === "console role")!.value).toBe(null);
  });

  it("reports a stored null console role as its JSON, apart from an absent one", () => {
    const levels = levelValuesOf({ detail: { admin: { roleName: null }, state: "ACTIVATED" }, spec: jumpcloud });
    expect(levels.find((level) => level.label === "console role")!.value).toBe("null");
  });

  it("holds an account when the state matches", () => {
    const levels = levelValuesOf({ detail: { state: "ACTIVATED" }, spec: jumpcloud });
    expect(holdsAccount({ levels, spec: jumpcloud })).toBe(true);
  });

  it("does not hold an account when the state is something else", () => {
    const levels = levelValuesOf({ detail: { state: "SUSPENDED" }, spec: jumpcloud });
    expect(holdsAccount({ levels, spec: jumpcloud })).toBe(false);
  });

  it("holds a Cloudflare account on a gateway seat alone", () => {
    const levels = levelValuesOf({ detail: { accessSeat: false, gatewaySeat: true }, spec: cloudflare });
    expect(holdsAccount({ levels, spec: cloudflare })).toBe(true);
  });

  it("does not hold a Cloudflare account with neither seat", () => {
    const levels = levelValuesOf({ detail: { accessSeat: false, gatewaySeat: false }, spec: cloudflare });
    expect(holdsAccount({ levels, spec: cloudflare })).toBe(false);
  });

  it("does not hold an account when the deciding field is absent entirely", () => {
    const levels = levelValuesOf({ detail: {}, spec: jumpcloud });
    expect(holdsAccount({ levels, spec: jumpcloud })).toBe(false);
  });
});
