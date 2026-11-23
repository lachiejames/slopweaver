/*
 * `prNumberOf` — taking a squash subject's trailing pull-request number, and only that one. It moved here when
 * `fleet landed`'s pure-join tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { prNumberOf } from "../../../../fleet/landed.js";

describe("prNumberOf", () => {
  it("takes only the trailing number, so a title's own parenthetical stays in the title", () => {
    expect(prNumberOf({ subject: "Never floats as a new one (INC-33) (#1837)" })).toEqual({
      number: 1837,
      title: "Never floats as a new one (INC-33)",
    });
  });

  it("names no pull request for a subject that does not end in one", () => {
    expect(prNumberOf({ subject: "Merge (#12) into main" })).toBe(undefined);
  });
});
