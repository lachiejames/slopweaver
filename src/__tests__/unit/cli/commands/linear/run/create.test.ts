/**
 * The `linear issue` COMMAND. Nothing imported `run.ts` before, which meant a fully green gate was
 * compatible with a verb wired to nothing at all — so these assert the orchestration itself: what is called,
 * in what order, and what is NOT called.
 *
 * Every edge is a plain injected function. No mocks.
 */

import { describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../../cli/commands/linear/run.js";
import type { LinearWriteDeps } from "../../../../../../cli/commands/linear/writeDeps.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { listIssueIds, readIssueRecord } from "../../../../../../outbound/linear/issueLedger.js";
import { argv, harness, tempHome, useTempHomeCleanup } from "./harness.js";

useTempHomeCleanup();

describe("create", () => {
  it("runs token → api → reserve → create → read back → confirm, in that order", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls[0]).toBe("token:same-home");
    expect(h.calls[1]).toBe("makeApi");
    expect(h.calls[2]?.startsWith("create:")).toBe(true);
    expect(h.calls[3]).toBe("read");
    expect(h.out).toEqual([
      "created AAA-9",
      "https://linear.test/AAA-9",
      "body verified: Linear stored all 13 line(s) exactly as sent",
    ]);
  });

  it("reports what Linear changed when the stored body differs from the sent one", async () => {
    const home = tempHome();
    const h = harness({ home, read: "normalised" });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    // The write SUCCEEDED — a normalisation is Linear's storage format, not a failure — but the operator is
    // told, which is the whole point: before this, the read-back fed the ledger digest and was discarded.
    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toBe("created AAA-9");
    expect(h.out[2]).toBe("Linear normalised the body: 1 of 14 line(s) differ from what was sent.");
    expect(h.out[3]).toBe('  line 14: sent (no such line) → stored "+++"');
  });

  it("resolves the token from the SAME home the ledger uses", async () => {
    // A resolver that ignored --home would pair one home's credential with another's ownership records,
    // and the ledger is the only evidence of what slopweaver created.
    const home = tempHome();
    const h = harness({ home });
    await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps });

    expect(h.calls.includes("token:WRONG-HOME")).toBe(false);
    expect(listIssueIds({ home }).length).toBe(1);
  });

  it("confirms the ledger record with the read-back timestamp", async () => {
    const home = tempHome();
    const h = harness({ home });
    await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps });
    const id = listIssueIds({ home })[0]!;
    const record = readIssueRecord({ home, id })!;

    expect(record.identifier).toBe("AAA-9");
    expect(record.confirmedIso).toBe("2026-08-02T10:00:00.000Z");
    expect(record.lastSeenUpdatedAt).toBe("2026-08-02T10:00:00.000Z");
  });

  it("REFUSES a second identical intent instead of filing a duplicate", async () => {
    const home = tempHome();
    await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({ home }).deps,
    });
    const second = harness({ home });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls.some((c) => c.startsWith("create:"))).toBe(false);
    expect(second.out.join(" ")).toContain("already reserved");
  });

  it("reports UNCONFIRMED, not success, when the read-back finds nothing", async () => {
    // The mutation returned but nothing established the issue exists. Reporting failure would invite a
    // retry that files a second ticket; reporting success would claim something unverified.
    const home = tempHome();
    const h = harness({ home, read: "missing" });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join(" ")).toContain("could NOT be read back");
    expect(h.out.join(" ")).toContain("Do not re-run this");
  });

  it("reports a real mutation failure as a fault", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home });
    const code = await runLinearIssue({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out.join(" ")).toContain("the write failed");
  });

  it("refuses when no token can be resolved, and never builds the API", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearWriteDeps = { ...h.deps, resolveToken: () => undefined };
    const code = await runLinearIssue({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls.includes("makeApi")).toBe(false);
    expect(h.err.join(" ")).toContain("no Linear token for this home");
  });
});
