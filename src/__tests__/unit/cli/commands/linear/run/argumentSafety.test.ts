/*
 * `linear issue`'s argument parsing through the real verb: an unknown flag, the `--flag=value` form, a value flag
 * with no value, an `--issue-id` that could escape the ledger, and the usage exit code.
 */
import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { argv, harness, tempHome, useTempHomeCleanup } from "./harness.js";

useTempHomeCleanup();

describe("argument safety", () => {
  it("REFUSES an unknown flag rather than ignoring it", async () => {
    // `--dryrun` is a plausible typo. Ignored, it turns a preview into a real write.
    const h = harness({ home: tempHome() });
    const code = await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--dryrun"] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("unknown flag: --dryrun");
    expect(h.calls).toEqual([]);
  });

  it("accepts the --flag=value form, which the hand-rolled parser rejected as unknown", async () => {
    // Rolling my own `indexOf('--x')` scan matched whole tokens, so `--form={...}` read as an unknown flag.
    // `parseFlags` exists precisely so a verb never hand-rolls this; the header of that file says so.
    const h = harness({ home: tempHome() });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form=-", "--dry-run"] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("## Problem");
  });

  it("distinguishes a value flag given with NO value from one that is absent", async () => {
    // The hand-rolled version reported "--form is required", which is a different and misleading claim.
    const h = harness({ home: tempHome() });
    const code = await runLinearIssue({ argv: argv({ rest: ["create", "--dry-run", "--form"] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("--form requires a value");
  });

  it("REFUSES an --issue-id that could escape the ledger directory", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", "../../escape"] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("must be a UUID v4");
  });

  it("uses the usage exit code for a bad invocation, not the fault code", async () => {
    const h = harness({ home: tempHome() });
    expect(await runLinearIssue({ argv: argv({ rest: ["create"] }), deps: h.deps })).toBe(EXIT_USAGE);
  });
});
