/** A recent headline claiming a page published names the address the owner goes to see it. */
import { describe, expect, it } from "vitest";

import { publishClaimRefusal } from "../../../../../briefing/publishClaim.js";
import { FORM, text } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a publish claim names where the owner goes to see it", () => {
  it("refuses a recent headline saying a page republished with no address", () => {
    const recent = [{ headline: text({ value: "The asks page republished." }) }];

    expect(refusals({ form: { ...FORM, recent } })).toEqual([
      `recent.0.headline: ${publishClaimRefusal({ claim: "republished" })}`,
    ]);
  });

  it("passes the same headline once it carries the console URL", () => {
    const recent = [{ headline: text({ value: "The asks page republished: http://localhost:3000/queue" }) }];

    expect(refusals({ form: { ...FORM, recent } })).toEqual([]);
  });
});
