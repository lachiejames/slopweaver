/**
 * `slopweaver memory passes`'s argv parse.
 *
 * The verb's whole body past this point is I/O — resolve the home, read the ledger, take the clock — and the
 * fold it hands to is unit-tested next door in `unit/memory/hygienePasses.test.ts`. What is left to pin here
 * is the contract a caller actually types.
 */
import { describe, expect, it } from "vitest";

import { MEMORY_PASSES_FLAG_NAMES, parseMemoryPassesArgs } from "../../../../../cli/commands/memory/passesRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseMemoryPassesArgs", () => {
  it("leaves the home ABSENT when none was asked for, so the runner resolves the ambient one", () => {
    const parsed = parseMemoryPassesArgs({ rest: [] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBe(undefined);
    expect(unwrap(parsed).json).toBe(false);
  });

  it("carries an explicit --home through", () => {
    const parsed = parseMemoryPassesArgs({ rest: ["--home", "/tmp/elsewhere", "--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBe("/tmp/elsewhere");
    expect(unwrap(parsed).json).toBe(true);
  });

  it("refuses a flag it does not accept, naming it", () => {
    const parsed = parseMemoryPassesArgs({ rest: ["--since", "7d"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--since");
  });

  it("declares every flag it accepts, so helpTruth compares behaviour rather than prose", () => {
    expect(MEMORY_PASSES_FLAG_NAMES).toEqual(["--home", "--json"]);
  });
});
