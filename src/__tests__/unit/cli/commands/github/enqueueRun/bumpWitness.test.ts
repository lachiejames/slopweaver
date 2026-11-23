/**
 * `slopweaver github enqueue` and the ratchet-bump witness: what the witness is asked about, the refusal no
 * acknowledgement reaches, and `--dequeue` never reading it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import type { BaselineBumpVerdict } from "../../../../../../codex/baselineBumpWitnessRun.js";
import type { PullRequestHead } from "../../../../../../codex/landingGate.js";
import { MID, pr } from "./fixtures.js";
import { api, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

/** A witness read that found one bump manifest with no Codex witness. */
const UNWITNESSED: BaselineBumpVerdict = {
  details: [
    "ledgers/baseline-bumps/widen.json has no Codex witness (no review); take it with: slopweaver codex review",
  ],
  kind: "refused",
};

/** The prefix every refusal line of the hold carries. */
const BUMP_REFUSAL = "refused: baseline-bump-unwitnessed: ";

describe("runGithubEnqueue and the ratchet-bump witness", () => {
  it("asks the witness about the pull request's own head AND base commit", async () => {
    const bumpHeads: PullRequestHead[] = [];
    const bumpBranches: (string | undefined)[] = [];
    const queued = pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } });
    const code = await runGithubEnqueue({
      deps: depsFor({
        bumpBranches,
        bumpHeads,
        diagnostic: [],
        home: scratchHome({ label: "bump-clear" }),
        out: [],
        surface: api({ calls: noCalls(), reads: [pr(), queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(bumpHeads).toEqual([
      { baseSha: "ba5e0000", branch: "feature", headSha: "cafe1234", repository: "acme/widget" },
    ]);
    expect(bumpBranches).toEqual([undefined]);
  });

  it("judges a stack member above the bottom against the branch the WHOLE stack lands on, not the member below", async () => {
    const bumpHeads: PullRequestHead[] = [];
    const bumpBranches: (string | undefined)[] = [];
    const member = pr({ baseRefName: "mx-2386-onboarding-consent-invariant", stack: MID });
    const queued = pr({
      baseRefName: "mx-2386-onboarding-consent-invariant",
      entry: { estimatedSecondsToMerge: undefined, position: 5, state: "QUEUED" },
      stack: MID,
    });
    await runGithubEnqueue({
      deps: depsFor({
        bumpBranches,
        bumpHeads,
        diagnostic: [],
        home: scratchHome({ label: "bump-stack" }),
        out: [],
        surface: api({ calls: noCalls(), reads: [member, queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(bumpHeads).toEqual([
      { baseSha: "ba5e0000", branch: "feature", headSha: "cafe1234", repository: "acme/widget" },
    ]);
    expect(bumpBranches).toEqual(["staging"]);
  });

  it.each([
    { label: "by subject", flags: ["--acknowledge", "baseline-bump-unwitnessed"] },
    { label: "wholesale", flags: ["--acknowledge-all", "--reason", "the owner said so"] },
  ])("refuses an unwitnessed bump however it is acknowledged ($label), and presses nothing", async ({ flags }) => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        bump: UNWITNESSED,
        diagnostic,
        home: scratchHome({ label: "bump-ack" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", ...flags],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(calls.stackEnqueued).toEqual([]);
    expect(diagnostic).toEqual([
      `${BUMP_REFUSAL}ledgers/baseline-bumps/widen.json has no Codex witness (no review); take it with: slopweaver codex review`,
      "refused: baseline-bump-unwitnessed has no acknowledgement and no escape hatch: --acknowledge and " +
        "--acknowledge-all do not reach it. Take the Codex witness review each line names on the pull " +
        "request's head, then land again.",
    ]);
  });

  it("makes a dry run say the press would be refused", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        bump: UNWITNESSED,
        diagnostic,
        home: scratchHome({ label: "bump-dry" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dry-run"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic[0]).toBe(
      `${BUMP_REFUSAL}ledgers/baseline-bumps/widen.json has no Codex witness (no review); take it with: slopweaver codex review`,
    );
  });

  it("never reads the witness to leave a queue", async () => {
    const bumpHeads: PullRequestHead[] = [];
    const calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        bump: UNWITNESSED,
        bumpHeads,
        diagnostic: [],
        home: scratchHome({ label: "bump-dequeue" }),
        out: [],
        surface: api({
          calls,
          reads: [pr({ entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" } }), pr()],
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dequeue"],
    });

    expect(code).toBe(0);
    expect(calls.dequeued).toEqual(["PR_kwabc"]);
    expect(bumpHeads).toEqual([]);
  });
});
