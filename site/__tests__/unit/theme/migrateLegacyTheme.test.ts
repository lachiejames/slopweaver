/*
 * The four earlier theme ids carried to the family and mode that look like them.
 */

import { describe, expect, it } from "vitest";

import { migrateLegacyTheme } from "../../../lib/theme";

describe("migrateLegacyTheme", () => {
  it("carries each of the four earlier themes to the family and mode that look like it", () => {
    expect(migrateLegacyTheme({ legacy: "midnight-teal" })).toEqual({ family: "teal", mode: "dark" });
    expect(migrateLegacyTheme({ legacy: "warm-dark" })).toEqual({ family: "amber", mode: "dark" });
    expect(migrateLegacyTheme({ legacy: "paper-light" })).toEqual({ family: "teal", mode: "light" });
    expect(migrateLegacyTheme({ legacy: "low-contrast-grey" })).toEqual({ family: "graphite", mode: "dark" });
  });

  it("carries nothing else, an inherited object key included", () => {
    expect(migrateLegacyTheme({ legacy: "neon" })).toBeUndefined();
    expect(migrateLegacyTheme({ legacy: "constructor" })).toBeUndefined();
    expect(migrateLegacyTheme({ legacy: null })).toBeUndefined();
  });
});
