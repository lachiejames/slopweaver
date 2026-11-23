/**
 * `slopweaver github enqueue` under a standing merge hold: a competing pull request is refused, the held one
 * queues itself, `--dequeue` stays ungated, and another repository is untouched.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import { heldPr, pairedCheckout, pr } from "./fixtures.js";
import { api, type Calls, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("runGithubEnqueue", () => {
  it("refuses a competing pull request while a merge hold stands, before it reads anything", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        holds: [heldPr({ pr: 366 })],
        home: scratchHome({ label: "held" }),
        out,
        surface: api({ calls, reads: [pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(out).toEqual([]);
    expect(diagnostic[0]).toBe(
      "refused: a merge hold stands on acme/widget: acme/widget#366 owns the merge queue, and this " +
        "invocation is for #9 — placed by a-session at 2026-09-05T09:30:00.000Z (4m ago).",
    );
    expect(diagnostic[2]).toBe(
      "refused: wait for acme/widget#366 to land, or clear the hold with " +
        "`slopweaver github release --pr 366 --repo acme/widget`.",
    );
  });

  it("lets the HELD pull request queue itself, which is how the holder releases the lane", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        holds: [heldPr({ pr: 9 })],
        home: scratchHome({ label: "holder" }),
        out,
        surface: api({ calls, reads: [pr(), queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued).toEqual([{ expectedHeadOid: "cafe1234", nodeId: "PR_kwabc" }]);
    expect(diagnostic[0]).toBe(
      "merge hold: this IS the held pull request acme/widget#9 — placed by a-session at " +
        "2026-09-05T09:30:00.000Z (4m ago). It does not block you.",
    );
  });

  it("leaves --dequeue ungated, so a refused session can still clear its entry out of the way", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        holds: [heldPr({ pr: 366 })],
        home: scratchHome({ label: "dequeue-held" }),
        out,
        surface: api({
          calls,
          reads: [pr({ entry: { estimatedSecondsToMerge: undefined, position: 3, state: "QUEUED" } }), pr()],
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dequeue"],
    });

    expect(code).toBe(0);
    expect(calls.dequeued).toEqual(["PR_kwabc"]);
    expect(diagnostic).toEqual([]);
  });

  it("holds only the repository they name, so another repository queues untouched", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls: Calls = noCalls();
    const queued = pr({ entry: { estimatedSecondsToMerge: undefined, position: 4, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        codexLoop: pairedCheckout({ repository: "acme/other" }),
        diagnostic,
        holds: [heldPr({ pr: 366 })],
        home: scratchHome({ label: "other-repo" }),
        out,
        surface: api({ calls, reads: [pr(), queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/other"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued.length).toBe(1);
    expect(diagnostic).toEqual([]);
  });
});
