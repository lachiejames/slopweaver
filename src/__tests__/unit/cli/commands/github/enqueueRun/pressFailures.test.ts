/**
 * `slopweaver github enqueue` when the press does not simply land: an unconfirmed read-back, a refusal by
 * GitHub, a send that died at the transport, a failed read, a usage error, and the `--json` object.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import { pr, TRANSPORT_ERROR } from "./fixtures.js";
import { api, type Calls, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("runGithubEnqueue", () => {
  it("reports an enqueue whose read-back shows no entry as UNCONFIRMED", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "unconfirmed" }),
        out,
        surface: api({ calls, reads: [pr(), pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued.length).toBe(1);
    expect(out.at(-1)).toContain("UNCONFIRMED");
  });

  it("reports a REFUSAL by GitHub with its operation, and never sends it a second time", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "writefail" }),
        out,
        surface: api({ calls, reads: [pr()], writeFails: true }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued.length).toBe(1);
    expect(diagnostic).toEqual([
      "http github.enqueuePullRequest: github said no",
      "GitHub answered and refused this enqueue of acme/widget#9; the queue read back confirms nothing was " +
        "applied. Re-sending would earn the same refusal — fix what it named.",
    ]);
  });

  it("recovers a press that died at the TRANSPORT: witness shows nothing applied, one re-send, queued", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({ entry: { estimatedSecondsToMerge: 90, position: 3, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "transport-recovered" }),
        out,
        // reads: the guard's, the witness after the dropped send (still unqueued), the confirming read.
        surface: api({ calls, reads: [pr(), pr(), queued], writeFailures: [TRANSPORT_ERROR] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([
      { expectedHeadOid: "cafe1234", nodeId: "PR_kwabc" },
      { expectedHeadOid: "cafe1234", nodeId: "PR_kwabc" },
    ]);
    expect(diagnostic).toEqual([
      "the enqueue died at the transport and the queue read back shows nothing was applied — sending it once " +
        "more. This is the only re-send; a second failure is reported, not retried.",
    ]);
    expect(out.join("\n")).toContain("queued #9 into main at position 3 (QUEUED)");
  });

  it("reports a press the witness proves LANDED, and does not send it again", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({ entry: { estimatedSecondsToMerge: 60, position: 2, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "transport-landed" }),
        out,
        surface: api({ calls, reads: [pr(), queued], writeFailures: [TRANSPORT_ERROR] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued.length).toBe(1);
    expect(diagnostic).toEqual([
      "the enqueue reported a failure (github github.enqueuePullRequest UND_ERR_SOCKET: other side closed) but " +
        "GitHub had already applied it — the connection dropped after the mutation was accepted. The queue read " +
        "below is the witness.",
    ]);
    expect(out.join("\n")).toContain("queued #9 into main at position 2 (QUEUED)");
  });

  it("stops at exactly TWO sends when the transport drops both, and says nothing was changed", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "transport-twice" }),
        out,
        surface: api({ calls, reads: [pr(), pr(), pr()], writeFailures: [TRANSPORT_ERROR, TRANSPORT_ERROR] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued.length).toBe(2);
    expect(diagnostic.at(-1)).toBe(
      "no HTTP response came back at all, so GitHub never answered this enqueue of acme/widget#9; the queue " +
        "read back shows nothing was applied, and the one permitted re-send failed the same way. Nothing was " +
        "changed on GitHub — run the verb again.",
    );
  });

  it("calls a press UNCERTAIN when the transport dropped and the witness read also failed", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "transport-blind" }),
        out,
        // The guard's read lands; every read after it fails, so the press can never be settled either way.
        surface: api({ calls, readFailsFrom: 2, reads: [pr()], writeFailures: [TRANSPORT_ERROR] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued.length).toBe(1);
    expect(diagnostic.at(-1)).toContain("UNCERTAIN: the enqueue of acme/widget#9 failed and the queue read");
    expect(diagnostic.at(-1)).toContain("Read the pull request's merge queue before pressing again.");
  });

  it("surfaces a failed read without reaching the queue read or the mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "readfail" }),
        out,
        surface: api({ calls, readFails: true, reads: [] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic.length).toBe(1);
    expect(diagnostic[0]).toContain("no pull request at that address");
  });

  it("refuses a usage error before resolving a token", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "usage" }),
        out,
        surface: api({ calls, reads: [pr()] }),
      }),
      rest: ["--repo", "acme/widget"],
    });

    expect(code).toBe(2);
    expect(diagnostic[0]).toBe("--pr must be a positive whole number");
  });

  it("emits one JSON object carrying the entry when --json is set", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({ entry: { estimatedSecondsToMerge: undefined, position: 5, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "json" }),
        out,
        surface: api({ calls, reads: [pr(), queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--json"],
    });

    expect(code).toBe(0);
    expect(out.length).toBe(1);
    const parsed: unknown = JSON.parse(out[0]!);
    expect(parsed).toEqual({
      entry: { position: 5, state: "QUEUED" },
      lines: [
        "queued #9 into main at position 5 (QUEUED)  https://example.invalid/pr/9",
        "next: GitHub merges it once the queue's own required checks pass on the merged result.",
      ],
      outcome: "queued",
      pullRequest: "https://example.invalid/pr/9",
    });
  });
});
