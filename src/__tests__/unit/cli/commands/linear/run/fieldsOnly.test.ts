/*
 * `linear issue update --fields-only` through the real verb: no body is sent, so none is claimed verified.
 */
import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { listIssueIds } from "../../../../../../outbound/linear/issueLedger.js";
import { argv, harness, SAME_BODY_NEW_PRIORITY, tempHome, useTempHomeCleanup } from "./harness.js";

useTempHomeCleanup();

describe("--fields-only", () => {
  it("does not claim a body was verified, because none was sent", async () => {
    const home = tempHome();
    const first = harness({ home });
    await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listIssueIds({ home })[0]!;

    const second = harness({ form: SAME_BODY_NEW_PRIORITY, home, storedBody: first.sentBody() });
    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--fields-only", "--form", "-", "--issue-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(second.out[0]).toBe("updated AAA-9");
    // "body verified" here would be a claim about bytes that were never transmitted.
    expect(second.out.some((line) => line.includes("body verified"))).toBe(false);
    expect(second.out[3]).toBe("so the change is filed but UNVERIFIED. Check the issue if the field values matter.");
  });
});
