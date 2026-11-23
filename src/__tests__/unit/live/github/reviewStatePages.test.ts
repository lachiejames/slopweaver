/*
 * The page sizes both pull-request queries spread. The property: every one is a whole number GitHub accepts
 * for a connection's `first:`/`last:` (1 to 100), so no connection is read unsized or refused outright.
 */

import { describe, expect, it } from "vitest";

import { PAGE_LIMITS } from "../../../../live/github/reviewStatePages.js";

describe("PAGE_LIMITS", () => {
  it("sizes every connection within GitHub's 1..100 page bound", () => {
    const sizes = Object.entries(PAGE_LIMITS);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter(([, size]) => !Number.isInteger(size) || size < 1 || size > 100)).toStrictEqual([]);
  });

  it("carries the review-request event page the human wait is dated from", () => {
    expect(PAGE_LIMITS.requestEventLimit).toBe(20);
  });
});
