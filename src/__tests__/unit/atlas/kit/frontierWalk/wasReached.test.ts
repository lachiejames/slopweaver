/*
 * Which walked-page outcomes count as reached: a page that rendered, photographed or not, and nothing else.
 */
import { describe, expect, it } from "vitest";

import { FRONTIER_PAGE_OUTCOMES } from "../../../../../atlas/kit/frontierContract.js";
import { wasReached } from "../../../../../atlas/kit/frontierPageDetail.js";

describe("wasReached", () => {
  it("counts a page that rendered, photographed or not, and no other outcome", () => {
    expect(FRONTIER_PAGE_OUTCOMES.length).toBeGreaterThan(0);
    expect(FRONTIER_PAGE_OUTCOMES.filter((outcome) => wasReached({ outcome }))).toEqual(["landed", "unphotographed"]);
  });
});
