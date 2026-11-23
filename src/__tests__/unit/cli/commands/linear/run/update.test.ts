/*
 * `linear issue update` through the real verb: it reports the verb that ran, and refuses an issue slopweaver has
 * no record of creating.
 */
import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { listIssueIds } from "../../../../../../outbound/linear/issueLedger.js";
import { argv, harness, tempHome, useTempHomeCleanup } from "./harness.js";

useTempHomeCleanup();

describe("update", () => {
  it("reports the verb that actually ran, not 'created'", async () => {
    // The first live update printed "created QQQQ-64". A report naming the wrong action is how someone
    // concludes a second ticket was filed when one was edited.
    const home = tempHome();
    const first = harness({ home });
    await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listIssueIds({ home })[0]!;

    const second = harness({ home, storedBody: first.sentBody() });
    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(second.out[0]).toBe("updated AAA-9");
  });

  it("refuses an issue slopweaver has no record of creating", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearIssue({
      argv: argv({
        rest: ["update", "--form", "-", "--issue-id", "752562e2-b5aa-4934-b0aa-03e0165a6196", "--home", home],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join(" ")).toContain("no record of creating issue");
    expect(h.calls.some((c) => c.startsWith("update:"))).toBe(false);
  });
});
