/*
 * An initials tile's letters and hue.
 */
import { describe, expect, it } from "vitest";

import { avatarHue, avatarInitials } from "../../lib/avatarLabel";

describe("avatarInitials", () => {
  it("shows a question mark for an empty or blank name", () => {
    expect(avatarInitials({ name: "" })).toBe("?");
    expect(avatarInitials({ name: "   " })).toBe("?");
  });

  it("shows the first two letters of a one-word name, upper-cased", () => {
    expect(avatarInitials({ name: "coderabbitai" })).toBe("CO");
  });

  it("shows the first letter of each of the first two words", () => {
    expect(avatarInitials({ name: "ada owner extra" })).toBe("AO");
  });

  it("splits on dots, underscores and hyphens as it does on spaces", () => {
    expect(avatarInitials({ name: "ada.owner" })).toBe("AO");
    expect(avatarInitials({ name: "ada_owner" })).toBe("AO");
    expect(avatarInitials({ name: "ada-owner" })).toBe("AO");
  });
});

describe("avatarHue", () => {
  it("hashes each code point into the hue wheel", () => {
    expect(avatarHue({ name: "" })).toBe(0);
    expect(avatarHue({ name: "a" })).toBe(97);
    expect(avatarHue({ name: "ab" })).toBe(225);
  });

  it("gives the same name the same hue every time", () => {
    expect(avatarHue({ name: "octocat" })).toBe(avatarHue({ name: "octocat" }));
  });
});
