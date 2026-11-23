import { describe, expect, it } from "vitest";

import { describedByWith, describedByWithout } from "../../lib/describedBy";

describe("describedByWith", () => {
  it("adds an id to no attribute, to an existing list at its end, and never twice", () => {
    expect([
      describedByWith({ id: "mark-a", value: null }),
      describedByWith({ id: "mark-b", value: "row-hint mark-a" }),
      describedByWith({ id: "mark-a", value: "row-hint  mark-a" }),
      describedByWith({ id: "mark-a", value: "   " }),
    ]).toEqual(["mark-a", "row-hint mark-a mark-b", "row-hint mark-a", "mark-a"]);
  });
});

describe("describedByWithout", () => {
  it("removes only its own id, keeping every other in order, and answers null when none is left", () => {
    expect([
      describedByWithout({ id: "mark-a", value: "row-hint mark-a mark-b" }),
      describedByWithout({ id: "mark-a", value: "mark-a" }),
      describedByWithout({ id: "mark-a", value: null }),
      describedByWithout({ id: "mark-c", value: "mark-a mark-b" }),
    ]).toEqual(["row-hint mark-b", null, null, "mark-a mark-b"]);
  });
});
