/**
 * The flag reads `profile standing` and `profile steers` share.
 */
import { describe, expect, it } from "vitest";

import { foreignFlagsOf, stringFlag } from "../../../../../cli/commands/profile/modeFlags.js";

describe("stringFlag", () => {
  it("answers a typed string, and undefined for an untyped or non-string flag", () => {
    const values = { json: true, reason: "done", since: undefined };
    expect(["reason", "json", "since", "absent"].map((name) => stringFlag({ name, values }))).toEqual([
      "done",
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("foreignFlagsOf", () => {
  it("names every typed flag the mode does not own, in the order typed, and never --home or --now", () => {
    const values = { covers: "findings", home: "/h", json: true, now: "2026-10-10T00:00:00.000Z", reason: "x" };
    expect(foreignFlagsOf({ allowed: ["reason"], values })).toEqual(["covers", "json"]);
  });

  it("ignores a flag parsed but not typed, and answers empty when the mode owns them all", () => {
    expect(foreignFlagsOf({ allowed: ["reason"], values: { covers: undefined, reason: "x" } })).toEqual([]);
  });
});
