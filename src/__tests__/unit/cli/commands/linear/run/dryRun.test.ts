/*
 * `linear issue create --dry-run` through the real verb: it prints the body and performs no effect at all.
 */
import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { listIssueIds } from "../../../../../../outbound/linear/issueLedger.js";
import { argv, harness, tempHome, useTempHomeCleanup } from "./harness.js";

useTempHomeCleanup();

describe("dry run touches nothing", () => {
  it("prints the body and performs NO effect at all", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    // The whole point: no token resolved, no API built, no call made, no ledger entry.
    expect(h.calls).toEqual([]);
    expect(listIssueIds({ home })).toEqual([]);
    expect(h.out.join("\n")).toContain("## Problem");
  });
});
