/**
 * `slopweaver store share`'s argv parse.
 *
 * Only the parse is unit-testable here, and deliberately so: `collectHomeShare` walks the home AND opens a
 * postgres connection to count the store side, which is the shared service `.claude/rules/testing.md` bans a
 * unit test from reaching. The half that can be a pure fold already is one — `src/store/homeShare.ts`, tested
 * next door in `unit/store/homeShare.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { parseStoreShareArgs, STORE_SHARE_FLAG_NAMES } from "../../../../../cli/commands/store/shareRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseStoreShareArgs", () => {
  it("leaves the home ABSENT when none was asked for, so the runner resolves the ambient one", () => {
    const parsed = parseStoreShareArgs({ rest: [] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBe(undefined);
    expect(unwrap(parsed).json).toBe(false);
  });

  it("carries an explicit --home through", () => {
    const parsed = parseStoreShareArgs({ rest: ["--home", "/tmp/elsewhere", "--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBe("/tmp/elsewhere");
    expect(unwrap(parsed).json).toBe(true);
  });

  it("refuses a flag it does not accept, naming it", () => {
    const parsed = parseStoreShareArgs({ rest: ["--table", "run"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--table");
  });

  it("declares every flag it accepts, so helpTruth compares behaviour rather than prose", () => {
    expect(STORE_SHARE_FLAG_NAMES).toEqual(["--home", "--json"]);
  });
});
