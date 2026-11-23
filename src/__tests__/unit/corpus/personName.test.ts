/**
 * Unit: the one rule for what `author` holds when a provider names a person by address — a name, never the
 * address itself.
 */
import { describe, expect, it } from "vitest";

import { personName } from "../../../corpus/personName.js";

describe("personName", () => {
  it("prefers the display name, trimmed", () => {
    expect(personName({ address: "pat@example.test", displayName: "  Pat Boss " })).toBe("Pat Boss");
  });

  it("falls back to the address's local part when the display name is absent or blank", () => {
    expect(personName({ address: "pat.boss@example.test", displayName: undefined })).toBe("pat.boss");
    expect(personName({ address: "pat.boss@example.test", displayName: "   " })).toBe("pat.boss");
  });

  it("never returns an @, distrusting a display name that is itself an address the email pass may miss", () => {
    expect(personName({ address: "pat@example.test", displayName: '"boss"@example.test' })).toBe("pat");
    expect(personName({ address: undefined, displayName: '"boss"@example.test' })).toBe("boss");
    expect(personName({ address: '"pat.boss"@example.test', displayName: undefined })).toBe("pat.boss");
  });

  it("names nobody when neither half carries a name", () => {
    expect(personName({ address: undefined, displayName: undefined })).toBe(undefined);
    expect(personName({ address: "@example.test", displayName: "" })).toBe(undefined);
  });
});
