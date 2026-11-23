import { describe, expect, it } from "vitest";

import { continueScrollWalk } from "../../../../../cli/commands/browser/scrollRun.js";

describe("continueScrollWalk", () => {
  it("takes another screen when this one moved one below the cap, and stops when it moved at the cap", () => {
    expect(continueScrollWalk({ moved: true, page: 2, pages: 3 })).toBe(true);
    expect(continueScrollWalk({ moved: true, page: 3, pages: 3 })).toBe(false);
  });

  it("stops below the cap when this screen did not move the page", () => {
    expect(continueScrollWalk({ moved: false, page: 1, pages: 3 })).toBe(false);
  });

  it("stops on a one-screen walk whether or not it moved", () => {
    expect(continueScrollWalk({ moved: true, page: 1, pages: 1 })).toBe(false);
    expect(continueScrollWalk({ moved: false, page: 1, pages: 1 })).toBe(false);
  });
});
