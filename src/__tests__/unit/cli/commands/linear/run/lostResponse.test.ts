/*
 * `linear issue` when a mutation's response was lost: the read-back settles whether it landed, and an update is
 * never called landed on evidence that existed before it ran.
 */
import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { listIssueIds, readIssueRecord } from "../../../../../../outbound/linear/issueLedger.js";
import { argv, harness, SAME_BODY_NEW_PRIORITY, tempHome, useTempHomeCleanup } from "./harness.js";

/** A DIFFERENT form, so an update built from it genuinely changes the stored body rather than being a no-op. */
const OTHER_FORM = JSON.stringify({
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do something else." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken in a different way." }],
    solution: [{ kind: "para", text: "Unbreak it differently." }],
  },
  fields: { teamId: "00000000-0000-4000-8000-000000000001", title: "A different title" },
});

useTempHomeCleanup();

describe("a mutation whose response was lost", () => {
  it("reports the write as LANDED when the issue is found at the caller-chosen id", async () => {
    // node:fetch was measured re-sending a POST on a 307, so an errored request may well have committed.
    // Reporting a definite failure here is what invites a retry against a ticket that already exists.
    const home = tempHome();
    const h = harness({ create: "fail", home, read: "ok" });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toBe("created AAA-9, despite a transport error — the issue was found at the id we chose.");
    expect(h.out[2]).toBe("the error was: boom");
    expect(h.out[3]).toBe("body verified: Linear stored all 13 line(s) exactly as sent");
    // The ledger records it, so a later update is not refused as an issue slopweaver never created.
    expect(readIssueRecord({ home, id: listIssueIds({ home })[0]! })!.identifier).toBe("AAA-9");
  });

  it("does NOT call an update landed just because the issue exists — it existed before", async () => {
    // The counterexample R6 named. An update targets a pre-existing issue, so finding it proves nothing.
    // Reporting success here would also feed the fidelity comparison the BEFORE image and label "the update
    // never applied" as "Linear normalised it".
    const home = tempHome();
    const first = harness({ home });
    await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listIssueIds({ home })[0]!;

    // The stored body is the ORIGINAL, and the update mutation errors before applying anything.
    const second = harness({ form: OTHER_FORM, home, storedBody: first.sentBody(), update: "fail" });
    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.out[0]).toBe(
      "the mutation errored AND the issue could not be read back, so it is unknown whether it landed.",
    );
    expect(second.out.some((line) => line.startsWith("updated"))).toBe(false);
  });

  it("will not call an update landed on body evidence when a FIELD change cannot be seen", async () => {
    // The body can be unchanged while a field did change. `updateInputFor` sends priority; the read-back
    // returns only id/identifier/url/title/description/updatedAt, so nothing here can see whether the
    // priority took. Declaring success on body equality alone would be a claim about an unread field.
    const home = tempHome();
    const first = harness({ home });
    await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listIssueIds({ home })[0]!;

    const second = harness({
      form: SAME_BODY_NEW_PRIORITY,
      home,
      storedBody: first.sentBody(),
      update: "fail",
    });
    const code = await runLinearIssue({
      argv: argv({ rest: ["update", "--form", "-", "--issue-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.out.some((line) => line.startsWith("updated"))).toBe(false);
  });

  it("reports UNKNOWN, not failure, when the read-back cannot settle it either", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home, read: "error" });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out[0]).toBe(
      "the mutation errored AND the issue could not be read back, so it is unknown whether it landed.",
    );
    expect(h.out[2]).toBe("Do NOT re-run this. Look for the issue in Linear, then reconcile.");
  });

  it("still reports a definite failure once the read-back proves the issue is absent", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out).toEqual(["the write failed: boom"]);
  });
});
