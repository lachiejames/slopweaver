/**
 * The wiring proof for `github enqueue`: that it actually consults the Codex pairing floor, and actually
 * stops. `github merge --admin`'s half of the same proof lives beside its own harness, in
 * `../../cli/commands/github/mergeAdminRun.test.ts`.
 *
 * A pure `loopFailures` test cannot stand in for this. The measured failure the standing rule exists to close
 * was never "the policy computed the wrong answer" — it was that nothing on the landing path ASKED. So every
 * case here counts real calls to the enqueue mutation, and a guard that quietly stopped
 * being consulted would turn these red rather than leaving a green suite over an unenforced rule.
 *
 * Zero mocks: every edge is a plain function the harness writes, per `.claude/rules/testing.md`.
 */

import { describe, expect, it } from "vitest";

import type { GithubEnqueueDeps } from "../../../../cli/commands/github/enqueueDeps.js";
import { runGithubEnqueue } from "../../../../cli/commands/github/enqueueRun.js";
import { CODEX_LOOP_SUBJECT } from "../../../../codex/landingGate.js";
import { memoryDoorLedger } from "../../../doorLedgerFixture.js";
import { checkout, doorRecords, enqueueDeps, INCOMPLETE, queuedApi, REPO, scratchHome } from "./harness.js";

describe("github enqueue consults the Codex pairing floor", () => {
  it("presses nothing when the local loop is incomplete", async () => {
    const enqueued: string[] = [];
    const out: string[] = [];
    const code = await runGithubEnqueue({
      deps: enqueueDeps({ codexLoop: INCOMPLETE, enqueued, home: scratchHome({ label: "incomplete" }), out }),
      rest: ["--pr", "9", "--repo", REPO],
    });

    expect(code).toBe(1);
    expect(enqueued).toEqual([]);
    expect(out.some((line) => line.includes(CODEX_LOOP_SUBJECT))).toBe(true);
  });

  /** An association that cannot be made must cost what an incomplete loop costs. */
  it("presses nothing when the checkout cannot speak for this pull request", async () => {
    const enqueued: string[] = [];
    const out: string[] = [];
    const code = await runGithubEnqueue({
      deps: enqueueDeps({
        codexLoop: checkout({ repository: "acme/other" }),
        enqueued,
        home: scratchHome({ label: "mismatch" }),
        out,
      }),
      rest: ["--pr", "9", "--repo", REPO],
    });

    expect(code).toBe(1);
    expect(enqueued).toEqual([]);
    expect(out.some((line) => line.includes("could not be examined"))).toBe(true);
  });

  it("presses once when the loop cleared the floor", async () => {
    const enqueued: string[] = [];
    const code = await runGithubEnqueue({
      deps: enqueueDeps({
        codexLoop: checkout(),
        enqueued,
        home: scratchHome({ label: "clean" }),
        out: [],
      }),
      rest: ["--pr", "9", "--repo", REPO],
    });

    expect(code).toBe(0);
    expect(enqueued).toEqual(["PR_kwabc"]);
  });

  it("refuses the subject named without a reason, before any read", async () => {
    const enqueued: string[] = [];
    const out: string[] = [];
    const code = await runGithubEnqueue({
      deps: enqueueDeps({ codexLoop: INCOMPLETE, enqueued, home: scratchHome({ label: "no-reason" }), out }),
      rest: ["--pr", "9", "--repo", REPO, "--acknowledge", CODEX_LOOP_SUBJECT],
    });

    expect(code).toBe(2);
    expect(enqueued).toEqual([]);
  });

  /** The whole value of the escape: it lands, and the reason is findable in the ledger afterwards. */
  it("presses once when the subject is acknowledged with a reason, and records that reason at the door", async () => {
    const enqueued: string[] = [];
    const home = scratchHome({ label: "acknowledged" });
    const door = memoryDoorLedger();
    const code = await runGithubEnqueue({
      deps: enqueueDeps({ codexLoop: INCOMPLETE, door, enqueued, home, out: [] }),
      rest: ["--pr", "9", "--repo", REPO, "--acknowledge", CODEX_LOOP_SUBJECT, "--reason", "a one-word typo fix"],
    });

    expect(code).toBe(0);
    expect(enqueued).toEqual(["PR_kwabc"]);
    const recorded = doorRecords({ door });

    expect(recorded.at(-1)!.acknowledgements).toEqual([{ reason: "a one-word typo fix", subject: CODEX_LOOP_SUBJECT }]);
  });

  /** A clean loop must not manufacture an audit entry for something nobody waived. */
  it("records no acknowledgement when the flags are supplied over a floor that was already met", async () => {
    const home = scratchHome({ label: "unused-ack" });
    const door = memoryDoorLedger();
    await runGithubEnqueue({
      deps: enqueueDeps({ codexLoop: checkout(), door, enqueued: [], home, out: [] }),
      rest: ["--pr", "9", "--repo", REPO, "--acknowledge", CODEX_LOOP_SUBJECT, "--reason", "not needed"],
    });
    const recorded = doorRecords({ door });

    // The row COUNT is asserted first on purpose: `at(-1)` over an empty list is `undefined`, so asserting
    // only the field would pass just as happily if no door row had been written at all. Caught by a Codex
    // review, which is the shape `.claude/rules/testing.md` bans optional chaining in an assertion to prevent.
    expect(recorded.length).toBe(1);
    expect(recorded.at(-1)!.acknowledgements).toBeUndefined();
  });

  /**
   * The floor is read TWICE — once for the verdict, once immediately before the mutation — because the queue
   * and required-context reads between them are awaited, and a review can finish BROKEN inside that window.
   * Found by a Codex review. This proves the second read happens by letting the first pass and the second fail.
   */
  it("re-reads the floor immediately before pressing, so a review that breaks mid-read still refuses", async () => {
    const enqueued: string[] = [];
    const out: string[] = [];
    let reads = 0;
    const deps: GithubEnqueueDeps = {
      ...enqueueDeps({ codexLoop: checkout(), enqueued, home: scratchHome({ label: "recheck" }), out }),
      readCodexLoop: () => {
        reads += 1;
        return reads === 1 ? checkout() : INCOMPLETE;
      },
    };
    const code = await runGithubEnqueue({ deps, rest: ["--pr", "9", "--repo", REPO] });

    expect(code).toBe(1);
    expect(enqueued).toEqual([]);
    expect(reads).toBe(2);
  });

  /** A waiver recorded from the FIRST read would land the write with no reason in the ledger. */
  it("records the re-read's own waiver when the floor only becomes unmet at the second read", async () => {
    const enqueued: string[] = [];
    const home = scratchHome({ label: "recheck-ack" });
    const door = memoryDoorLedger();
    let reads = 0;
    const deps: GithubEnqueueDeps = {
      ...enqueueDeps({ codexLoop: checkout(), door, enqueued, home, out: [] }),
      readCodexLoop: () => {
        reads += 1;
        return reads === 1 ? checkout() : INCOMPLETE;
      },
    };
    const code = await runGithubEnqueue({
      deps,
      rest: ["--pr", "9", "--repo", REPO, "--acknowledge", CODEX_LOOP_SUBJECT, "--reason", "a one-word typo fix"],
    });

    expect(code).toBe(0);
    expect(enqueued).toEqual(["PR_kwabc"]);
    const recorded = doorRecords({ door });

    expect(recorded.at(-1)!.acknowledgements).toEqual([{ reason: "a one-word typo fix", subject: CODEX_LOOP_SUBJECT }]);
  });

  /** Leaving a queue only narrows what happens next, so it is exempt — and must not even read the ledger. */
  it("never reads the loop for --dequeue, even when there is an entry to remove", async () => {
    const home = scratchHome({ label: "dequeue" });
    // The PR must be QUEUED, or the verb short-circuits on "nothing to dequeue" and never reaches the door —
    // which is exactly the hole the first version of this test left, found by a Codex review.
    const deps: GithubEnqueueDeps = {
      ...enqueueDeps({ codexLoop: INCOMPLETE, enqueued: [], home, out: [] }),
      makeApi: () => queuedApi(),
      readCodexLoop: () => {
        throw new Error("--dequeue must not consult the pairing floor");
      },
    };

    expect(await runGithubEnqueue({ deps, rest: ["--pr", "9", "--repo", REPO, "--dequeue"] })).toBe(0);
  });

  /** Dequeue raises no finding, so the flags must not manufacture a waiver for one. */
  it("records no acknowledgement for a --dequeue that was handed the flags anyway", async () => {
    const home = scratchHome({ label: "dequeue-ack" });
    const door = memoryDoorLedger();
    const deps: GithubEnqueueDeps = {
      ...enqueueDeps({ codexLoop: INCOMPLETE, door, enqueued: [], home, out: [] }),
      makeApi: () => queuedApi(),
    };
    const code = await runGithubEnqueue({
      deps,
      rest: ["--pr", "9", "--repo", REPO, "--dequeue", "--acknowledge", CODEX_LOOP_SUBJECT, "--reason", "cleanup"],
    });

    expect(code).toBe(0);
    const recorded = doorRecords({ door });

    expect(recorded.length).toBe(1);
    expect(recorded.at(-1)!.acknowledgements).toBeUndefined();
  });
});
