/**
 * `slopweaver atlas <platform> page`'s flag parsing, and the one property that makes its caps safe: every
 * flag bounds SIZE, and none of them can change what the page claims.
 */
import { describe, expect, it } from "vitest";

import {
  ATLAS_RENDER_DEFAULT_MAX_PAGE_MIB,
  ATLAS_RENDER_DEFAULT_MAX_ROWS,
  ATLAS_RENDER_DEFAULT_NEVER_HIT_CAP,
  ATLAS_RENDER_DEFAULT_SCREENSHOT_BUDGET_MIB,
  ATLAS_RENDER_FLAG_NAMES,
  ATLAS_RENDER_USAGE,
  parseAtlasRenderArgs,
} from "../../../../../cli/commands/atlas/renderCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseAtlasRenderArgs", () => {
  it("defaults every cap when the tail is empty", () => {
    const result = parseAtlasRenderArgs({ rest: [] });
    expect(result.isOk()).toBe(true);
    const options = unwrap(result);
    expect(options.maxRows).toBe(ATLAS_RENDER_DEFAULT_MAX_ROWS);
    expect(options.neverHitCap).toBe(ATLAS_RENDER_DEFAULT_NEVER_HIT_CAP);
    expect(options.screenshotBudgetBytes).toBe(ATLAS_RENDER_DEFAULT_SCREENSHOT_BUDGET_MIB * 1024 * 1024);
    expect(options.maxPageBytes).toBe(ATLAS_RENDER_DEFAULT_MAX_PAGE_MIB * 1024 * 1024);
    expect(options.fragment).toBe(false);
    expect(options.json).toBe(false);
    expect(options.out).toBe(undefined);
  });

  it("reads every flag it advertises", () => {
    const result = parseAtlasRenderArgs({
      rest: [
        "--out",
        "/tmp/page.html",
        "--fragment",
        "--max-rows",
        "10",
        "--never-hit-cap",
        "5",
        "--screenshot-budget-mib",
        "2",
        "--max-page-mib",
        "4",
        "--home",
        "/tmp/home",
      ],
    });
    const options = unwrap(result);
    expect(options.out).toBe("/tmp/page.html");
    expect(options.fragment).toBe(true);
    expect(options.maxRows).toBe(10);
    expect(options.neverHitCap).toBe(5);
    expect(options.screenshotBudgetBytes).toBe(2 * 1024 * 1024);
    expect(options.maxPageBytes).toBe(4 * 1024 * 1024);
    expect(options.home).toBe("/tmp/home");
  });

  it("spends nothing on screenshots when they are turned off, whatever the budget says", () => {
    const options = unwrap(parseAtlasRenderArgs({ rest: ["--no-screenshots", "--screenshot-budget-mib", "9"] }));
    expect(options.screenshotBudgetBytes).toBe(0);
  });

  it("refuses a cap that is not a whole number, naming the flag the reader typed", () => {
    const result = parseAtlasRenderArgs({ rest: ["--max-rows", "lots"] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("--max-rows takes a whole number");
  });

  it("refuses a negative cap", () => {
    const result = parseAtlasRenderArgs({ rest: ["--never-hit-cap", "-1"] });
    expect(unwrapErr(result)).toEqual([`--never-hit-cap takes a whole number of 0 or more, not "-1"`]);
  });

  it("reports every bad cap at once rather than the first", () => {
    const result = parseAtlasRenderArgs({ rest: ["--max-rows", "x", "--never-hit-cap", "y"] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toHaveLength(2);
  });

  it("advertises in its usage exactly the flags it accepts", () => {
    for (const flag of ATLAS_RENDER_FLAG_NAMES) {
      expect(ATLAS_RENDER_USAGE).toContain(flag);
    }
    expect(ATLAS_RENDER_FLAG_NAMES).toHaveLength(9);
  });
});
