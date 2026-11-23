/**
 * `slopweaver github enqueue` on a native-stack member: the asynchronous merge request instead of the GraphQL
 * mutation, the stack's own base, and what it says when the request is not witnessed.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import { BOTTOM, MID, pr } from "./fixtures.js";
import { api, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("runGithubEnqueue on a native-stack member", () => {
  it("sends GitHub's asynchronous merge request, never the GraphQL mutation the endpoint refuses", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls = noCalls();
    const member = pr({ baseRefName: "staging", stack: BOTTOM });
    const queued = pr({
      baseRefName: "staging",
      entry: { estimatedSecondsToMerge: 300, position: 4, state: "QUEUED" },
      stack: BOTTOM,
    });

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "stack-press" }),
        out,
        surface: api({ calls, reads: [member, queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    // The whole defect: the GraphQL mutation must not be reached for a member, whatever its base reads.
    expect(calls.enqueued).toEqual([]);
    expect(calls.stackEnqueued).toEqual([{ expectedHeadOid: "cafe1234", number: 9, owner: "acme", repo: "widget" }]);
    expect(out).toContain("queued #9 into staging at position 4 (QUEUED)  https://example.invalid/pr/9");
    expect(out).toContain(
      "scope: #9 and every unmerged pull request BELOW it in stack #16958 were requested together; the " +
        "position above is the SELECTED pull request's own read-back, not a read of every entry.",
    );
  });

  it("reads the queue and the required contexts on the STACK's base, not on the member below it", async () => {
    const out: string[] = [];
    const calls = noCalls();
    const member = pr({ baseRefName: "mx-2386-onboarding-consent-invariant", stack: MID });
    const queued = pr({
      baseRefName: "mx-2386-onboarding-consent-invariant",
      entry: { estimatedSecondsToMerge: undefined, position: 5, state: "QUEUED" },
      stack: MID,
    });

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "stack-base" }),
        out,
        surface: api({ calls, reads: [member, queued] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    // MEASURED on acme-admin: a mid-stack member's own base has no queue at all, so reading it would refuse a member
    // that is perfectly queueable. Both reads must address `staging`.
    expect(calls.branchesRead).toEqual(["staging", "staging"]);
    expect(out).toContain(
      "PR base:      mx-2386-onboarding-consent-invariant — the member below it, which is NOT where the " +
        "stack lands",
    );
  });

  it("says before the write that the press reaches more than the pull request named", async () => {
    const out: string[] = [];
    const calls = noCalls();

    await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "stack-dry" }),
        out,
        surface: api({ calls, reads: [pr({ baseRefName: "staging", stack: BOTTOM })] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dry-run"],
    });

    expect(out).toContain("stack:        #16958  position 1 of 3  landing on staging");
    expect(out).toContain(
      "scope:        #9 and every unmerged pull request BELOW it in stack #16958 are requested together, " +
        "bottom-up.",
    );
    // A dry run touches neither transport, and neither the poll nor the wait.
    expect(calls.stackEnqueued).toEqual([]);
    expect(calls.enqueued).toEqual([]);
  });

  it("reports UNCONFIRMED and exits non-zero when the accepted request never becomes an entry", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls = noCalls();
    const member = pr({ baseRefName: "staging", stack: BOTTOM });

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "stack-unconfirmed" }),
        out,
        // Every read answers the unqueued member, so the whole confirmation budget is spent.
        surface: api({ calls, reads: [member] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(diagnostic.some((line) => line.startsWith("UNCONFIRMED: GitHub accepted the asynchronous enqueue"))).toBe(
      true,
    );
  });

  it("reports an unreadable asynchronous request on the diagnostic channel, never as a JSON success", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const calls = noCalls();

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "stack-json" }),
        out,
        surface: api({ calls, reads: [pr({ baseRefName: "staging", stack: BOTTOM })] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--json"],
    });

    expect(code).toBe(1);
    // No object at all rather than one saying `queued`: the request was accepted and never witnessed, which
    // is the same shape a failed write already reports, and a success object here would be a false claim.
    expect(out.some((line) => line.includes('"outcome"'))).toBe(false);
    expect(diagnostic.some((line) => line.startsWith("UNCONFIRMED:"))).toBe(true);
  });

  it("warns that the request MAY have reached GitHub when its own answer could not be read", async () => {
    // A 202 whose body this build cannot parse is an accepted merge job with a lost uuid. Reporting only
    // the provider message reads like a no-op and invites the retry that starts a second job on the stack.
    // A Codex review's counterexample.
    const diagnostic: string[] = [];
    const calls = noCalls();

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "stack-uncertain" }),
        out: [],
        surface: api({ calls, reads: [pr({ baseRefName: "staging", stack: BOTTOM })], writeFails: true }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(diagnostic).toContain(
      "UNCERTAIN: an asynchronous merge request for acme/widget#9 may already have reached GitHub — this " +
        "failed while sending it or while reading its answer. Re-read the pull request before retrying; " +
        "enqueueing again would start a second merge job on the stack.",
    );
  });

  it("takes --dequeue down the GraphQL path even for a member, and reaches neither enqueue", async () => {
    const calls = noCalls();
    const queuedMember = pr({
      baseRefName: "staging",
      entry: { estimatedSecondsToMerge: undefined, position: 1, state: "QUEUED" },
      stack: BOTTOM,
    });

    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "stack-dequeue" }),
        out: [],
        surface: api({ calls, reads: [queuedMember, pr({ baseRefName: "staging", stack: BOTTOM })] }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dequeue"],
    });

    expect(code).toBe(0);
    expect(calls.dequeued).toEqual(["PR_kwabc"]);
    expect(calls.stackEnqueued).toEqual([]);
    expect(calls.enqueued).toEqual([]);
  });
});
