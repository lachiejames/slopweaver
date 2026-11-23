import { describe, expect, it } from "vitest";

import { isSettling } from "../../lib/settling";

describe("whether a pressed Queue row is drawn settling", () => {
  it("is not, for a row nobody pressed", () => {
    expect(isSettling({ answered: 4, held: undefined })).toBe(false);
  });

  it("is, from the press until the act answers", () => {
    expect(isSettling({ answered: 4, held: { pressedAs: undefined, readsSlug: "hands" } })).toBe(true);
  });

  it("stays settling after a done act until a read that left after the press answers, then lets go", () => {
    const held = { pressedAs: 5, readsSlug: "hands" };
    expect(isSettling({ answered: 4, held })).toBe(true);
    expect(isSettling({ answered: 5, held })).toBe(false);
  });

  it("lets go too when a read after a LATER press answers first", () => {
    expect(isSettling({ answered: 6, held: { pressedAs: 5, readsSlug: "hands" } })).toBe(false);
  });
});
