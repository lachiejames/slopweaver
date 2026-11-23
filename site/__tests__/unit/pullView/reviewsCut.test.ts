/*
 * Whether the pull-request view's read cut its reviews short.
 */

import { describe, expect, it } from "vitest";

import { reviewsCut } from "../../../lib/pullView";
import { VIEW } from "./harness";

describe("reviewsCut", () => {
  it("says the reviews were cut only when the read names another page of them", () => {
    const cut = { ...VIEW, residue: ["data.reviews has another provider page"] };
    expect(reviewsCut({ view: cut })).toBe(true);
    expect(reviewsCut({ view: VIEW })).toBe(false);
  });
});
