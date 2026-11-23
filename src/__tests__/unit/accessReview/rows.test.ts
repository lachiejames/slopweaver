import { describe, expect, it } from "vitest";

import { ACCESS_LEVEL_TABLE, type AccessPlatformSpec } from "../../../accessReview/levels.js";
import { accessRowsOf } from "../../../accessReview/rows.js";

import { entity } from "./fixtures.js";

const JUMPCLOUD = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "jumpcloud")!;

/** A spec with no surface family, so every record of the kind is a person. */
const FAMILYLESS: AccessPlatformSpec = {
  display: "Test",
  displayPath: ["name"],
  emailPath: ["email"],
  holds: [{ label: "state", whenValue: ["ACTIVE"] }],
  kind: "user",
  levels: [{ label: "state", path: ["state"] }],
  platform: "test",
  surfaceFamily: null,
};

describe("accessRowsOf — the surface family filter", () => {
  it("counts a record of another declared family rather than projecting it", () => {
    const rows = accessRowsOf({
      entities: [
        entity({ detail: { email: "a@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" }),
        entity({ detail: { email: "b@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-list:2" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.rows.map((row) => row.email)).toEqual(["a@x.test"]);
    expect(rows.otherFamily).toBe(1);
  });

  it("projects every record when the spec declares no family", () => {
    const rows = accessRowsOf({
      entities: [
        entity({ detail: { email: "a@x.test", state: "ACTIVE" }, providerId: "anything:1" }),
        entity({ detail: { email: "b@x.test", state: "ACTIVE" }, providerId: "other:2" }),
      ],
      spec: FAMILYLESS,
    });
    expect(rows.rows.length).toBe(2);
    expect(rows.otherFamily).toBe(0);
  });
});

describe("accessRowsOf — a record a complete read no longer returned", () => {
  it("counts a stale record and projects no row for it, whatever state its stored detail reads", () => {
    const rows = accessRowsOf({
      entities: [
        entity({
          detail: { email: "gone@x.test", state: "ACTIVATED" },
          providerId: "v1-systemusers-get:1",
          state: "stale",
        }),
        entity({ detail: { email: "here@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:2" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.rows.map((row) => row.email)).toEqual(["here@x.test"]);
    expect(rows.stale).toBe(1);
  });

  it("lets a current suspended record stand when a stale live one shares its address", () => {
    const rows = accessRowsOf({
      entities: [
        entity({
          detail: { email: "a@x.test", state: "ACTIVATED" },
          providerId: "v1-systemusers-get:old",
          state: "stale",
        }),
        entity({ detail: { email: "a@x.test", state: "SUSPENDED" }, providerId: "v1-systemusers-get:new" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.rows.map((row) => [row.providerId, row.holds])).toEqual([["v1-systemusers-get:new", false]]);
    expect(rows.collidingAddresses).toEqual([]);
  });
});

describe("accessRowsOf — what it cannot use, it counts", () => {
  it("counts a record of the right family carrying no address", () => {
    const rows = accessRowsOf({
      entities: [entity({ detail: { state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" })],
      spec: JUMPCLOUD,
    });
    expect(rows.addressless).toBe(1);
    expect(rows.rows).toEqual([]);
  });

  it("counts a blank address as unusable", () => {
    const rows = accessRowsOf({
      entities: [entity({ detail: { email: "  ", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" })],
      spec: JUMPCLOUD,
    });
    expect(rows.addressless).toBe(1);
  });

  it("reports an address two records both claim, keeping the live one", () => {
    const rows = accessRowsOf({
      entities: [
        entity({ detail: { email: "dup@x.test", state: "SUSPENDED" }, providerId: "v1-systemusers-get:1" }),
        entity({ detail: { email: "DUP@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:2" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.collidingAddresses).toEqual(["dup@x.test"]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]!.providerId).toBe("v1-systemusers-get:2");
  });

  it("never lets a later dead record hide a live one sharing its address", () => {
    const rows = accessRowsOf({
      entities: [
        entity({ detail: { email: "dup@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" }),
        entity({ detail: { email: "dup@x.test", state: "SUSPENDED" }, providerId: "v1-systemusers-get:2" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.collidingAddresses).toEqual(["dup@x.test"]);
    expect(rows.rows.map((row) => [row.providerId, row.holds])).toEqual([["v1-systemusers-get:1", true]]);
  });
});

describe("accessRowsOf — the row itself", () => {
  it("keeps the address verbatim beside the lowercased join key", () => {
    const rows = accessRowsOf({
      entities: [
        entity({
          detail: { displayname: "A Person", email: "Mixed.Case@X.test", state: "ACTIVATED" },
          providerId: "v1-systemusers-get:1",
        }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.rows[0]!.email).toBe("mixed.case@x.test");
    expect(rows.rows[0]!.emailVerbatim).toBe("Mixed.Case@X.test");
    expect(rows.rows[0]!.display).toBe("A Person");
  });

  it("holds the account when the hold rule's value matches, and not otherwise", () => {
    const rows = accessRowsOf({
      entities: [
        entity({ detail: { email: "live@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" }),
        entity({ detail: { email: "gone@x.test", state: "SUSPENDED" }, providerId: "v1-systemusers-get:2" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.rows.find((row) => row.email === "live@x.test")!.holds).toBe(true);
    expect(rows.rows.find((row) => row.email === "gone@x.test")!.holds).toBe(false);
  });

  it("carries every declared level in the spec's order, absent ones included", () => {
    const rows = accessRowsOf({
      entities: [entity({ detail: { email: "a@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" })],
      spec: JUMPCLOUD,
    });
    expect(rows.rows[0]!.levels.map((level) => level.label)).toEqual(JUMPCLOUD.levels.map((level) => level.label));
    expect(rows.rows[0]!.levels.find((level) => level.label === "console role")!.value).toBe(null);
  });

  it("orders rows by address", () => {
    const rows = accessRowsOf({
      entities: [
        entity({ detail: { email: "zoe@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:1" }),
        entity({ detail: { email: "amy@x.test", state: "ACTIVATED" }, providerId: "v1-systemusers-get:2" }),
      ],
      spec: JUMPCLOUD,
    });
    expect(rows.rows.map((row) => row.email)).toEqual(["amy@x.test", "zoe@x.test"]);
  });

  it("answers an empty projection carrying its subject for no entities", () => {
    const rows = accessRowsOf({ entities: [], spec: JUMPCLOUD });
    expect(rows.platform).toBe("jumpcloud");
    expect(rows.kind).toBe("systemusers");
    expect(rows.rows).toEqual([]);
    expect(rows.addressless).toBe(0);
    expect(rows.otherFamily).toBe(0);
    expect(rows.collidingAddresses).toEqual([]);
  });
});
