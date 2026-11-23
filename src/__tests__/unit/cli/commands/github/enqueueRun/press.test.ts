/**
 * `slopweaver github enqueue` pressing a pull request into the merge queue: the press pinned to the head it
 * measured, the door, `--dry-run`, an acknowledged finding, a base with no queue, an already-queued entry and
 * `--dequeue`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import { unreachableDoorLedger } from "../../../../../doorLedgerFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../../profileHoldFixture.js";
import { pr } from "./fixtures.js";
import { api, type Calls, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("runGithubEnqueue", () => {
  it("presses the enqueue pinned to the head it measured, and confirms by read-back", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({ entry: { estimatedSecondsToMerge: 120, position: 2, state: "AWAITING_CHECKS" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "press" }),
        out,
        surface: api({ calls, reads: [pr(), queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([{ expectedHeadOid: "cafe1234", nodeId: "PR_kwabc" }]);
    expect(out).toContain("queued #9 into main at position 2 (AWAITING_CHECKS)  https://example.invalid/pr/9");
    expect(diagnostic).toEqual([]);
  });

  it("enqueues nothing when the door cannot record the press", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        door: unreachableDoorLedger(),
        home: scratchHome({ label: "door-down" }),
        out,
        surface: api({ calls, reads: [pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
  });

  it("reads the whole state under --dry-run and writes nothing", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "dry" }),
        out,
        surface: api({ calls, reads: [pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([]);
    expect(out.at(-1)).toContain("only REPORTS — drop --dry-run");
  });

  it("refuses an unacknowledged finding without writing", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "refuse" }),
        out,
        surface: api({ calls, reads: [pr({ mergeable: "CONFLICTING" })] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(out.at(-1)).toContain("REFUSED — 1 finding(s) unacknowledged");
  });

  it("writes once the finding is acknowledged by subject", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({
      entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" },
      reviewDecision: "REVIEW_REQUIRED",
    });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "ack" }),
        out,
        surface: api({ calls, reads: [pr({ reviewDecision: "REVIEW_REQUIRED" }), queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge", "review-not-approved"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued.length).toBe(1);
    expect(out).toContain("queued #9 into main at position 1 (QUEUED)  https://example.invalid/pr/9");
  });

  it("refuses a base branch with no merge queue, and never calls the mutation", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "noqueue" }),
        out,
        surface: api({ calls, noQueue: true, reads: [pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(out.at(-1)).toContain("has no merge queue on main");
  });

  it("reports an already-queued pull request as a clean no-op", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "already" }),
        out,
        surface: api({
          calls,
          reads: [pr({ entry: { estimatedSecondsToMerge: undefined, position: 3, state: "QUEUED" } })],
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([]);
    expect(out.at(-1)).toBe("#9 is ALREADY queued at position 3 (QUEUED) — nothing to press.");
  });

  it("dequeues and confirms the entry is gone", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "dequeue" }),
        out,
        surface: api({
          calls,
          reads: [pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } }), pr()],
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dequeue"],
    });

    expect(code).toBe(0);
    expect(calls.dequeued).toEqual(["PR_kwabc"]);
    expect(out).toContain("dequeued #9 — it holds no queue entry now  https://example.invalid/pr/9");
  });

  it("names --dequeue in a held door's refusal, every finding and its way through, and dequeues nothing", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const home = scratchHome({ label: "dequeue-door" });
    const { result: code, decision } = await withProfileHold({
      home,
      run: () =>
        runGithubEnqueue({
          deps: depsFor({
            diagnostic,
            home,
            out,
            surface: api({
              calls,
              reads: [pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } })],
            }),
          }),
          rest: ["--pr", "9", "--repo", "acme/widget", "--dequeue"],
        }),
    });

    expect(code).toBe(1);
    expect(calls.dequeued).toEqual([]);
    expect(decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(diagnostic).toEqual(expectedHoldRefusal({ command: "slopweaver github enqueue --dequeue", decision }));
  });
});
