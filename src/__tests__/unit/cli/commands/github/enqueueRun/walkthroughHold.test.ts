/**
 * `slopweaver github enqueue` holding the press over a colleague's reply under a resolve: the reopen, the next
 * run, the owner's own deliberate resolve, the thread register, a truncated confirming re-read, and `--dequeue`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { runGithubEnqueue } from "../../../../../../cli/commands/github/enqueueRun.js";
import type { WalkthroughAct } from "../../../../../../outbound/github/walkthroughLedger.js";
import { type WalkthroughWrites, walkthroughDeps, walkthroughThread } from "../../../../../walkthroughFake.js";
import { COLLAPSED, MIXED, pr, QUEUED } from "./fixtures.js";
import { api, depsFor, noCalls, removeHomes, scratchHome } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("runGithubEnqueue — the owner's own walkthrough threads", () => {
  /** Where a raced reply ends up, re-derived on every run so a retry sees it. */
  it("reopens a note the landing resolved over a colleague's last word, records it, and does not press", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const reopened: string[] = [];
    const memory: WalkthroughAct[] = [{ kind: "resolving", threadId: "PRRT_collapsed" }];
    const home = scratchHome({ label: "walk-collapsed" });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home,
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({
          memory,
          read: { ...MIXED, threads: [...MIXED.threads, COLLAPSED] },
          reopened,
          writes,
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(writes.resolved).toEqual([]);
    expect(reopened).toEqual(["PRRT_collapsed"]);
    expect(memory.at(-1)).toEqual({
      kind: "surfaced",
      replyAtIso: COLLAPSED.lastCommentAtIso,
      replyCount: 2,
      threadId: "PRRT_collapsed",
    });
    expect(diagnostic).toEqual([
      "not landed: 1 walkthrough thread(s) the landing resolved hold somebody else's reply under that resolve; " +
        "reopened, so the reply reads open again. answer each with the command beneath it, then run it again — " +
        "a resolve with no answer is reopened",
      "  PRRT_collapsed on src/a.ts:12, teammate replied:",
      "    (this read carried no text for it)",
      "    answer: `slopweaver github thread reply --repo acme/widget --number 9 --thread PRRT_collapsed " +
        `--home ${home} --body - --resolve\``,
    ]);
  });

  /** A reopen that went through must still hold the NEXT landing, whichever door. */
  it("does not press on the next run while the reopened reply sits unanswered", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const reopenedReply = walkthroughThread({
      commentCount: 2,
      id: "PRRT_collapsed",
      lastCommentBody: "why not reuse the old cache?",
      lastCommentLogin: "teammate",
      line: 12,
      path: "src/a.ts",
    });
    const home = scratchHome({ label: "walk-unanswered" });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home,
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({
          memory: [
            { kind: "resolving", threadId: "PRRT_collapsed" },
            { kind: "surfaced", replyAtIso: COLLAPSED.lastCommentAtIso, replyCount: 2, threadId: "PRRT_collapsed" },
          ],
          read: { ...MIXED, threads: [...MIXED.threads, reopenedReply] },
          writes: { ledger: [], resolved: [] },
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic).toEqual([
      "not landed: 1 of our walkthrough thread(s) hold a colleague's reply nobody has answered (PRRT_collapsed); " +
        "answer each with the command beneath it, then run it again — a resolve with no answer is reopened",
      "  PRRT_collapsed on src/a.ts:12, teammate replied:",
      "    > why not reuse the old cache?",
      "    answer: `slopweaver github thread reply --repo acme/widget --number 9 --thread PRRT_collapsed " +
        `--home ${home} --body - --resolve\``,
    ]);
  });

  /** The owner's own resolve after reading a reply must never wedge the landing. */
  it("leaves a reply the owner resolved themselves alone, whether or not the landing ever resolved it", async () => {
    const calls = noCalls();
    const reopened: string[] = [];
    const deliberate = walkthroughThread({ ...COLLAPSED, id: "PRRT_his_own" });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "walk-deliberate" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({
          memory: [
            { kind: "resolving", threadId: "PRRT_collapsed" },
            { kind: "surfaced", replyAtIso: COLLAPSED.lastCommentAtIso, replyCount: 2, threadId: "PRRT_collapsed" },
          ],
          read: { ...MIXED, threads: [...MIXED.threads, COLLAPSED, deliberate] },
          reopened,
          writes: { ledger: [], resolved: [] },
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(reopened).toEqual([]);
    expect(calls.enqueued.length).toBe(1);
  });

  it("records every thread in the register before resolving it, and resolves nothing when it cannot", async () => {
    const memory: WalkthroughAct[] = [];
    const order: number[] = [];
    const recorded = walkthroughDeps({
      beforeResolve: () => order.push(memory.length),
      memory,
      read: MIXED,
      writes: { ledger: [], resolved: [] },
    });
    await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "walk-register" }),
        out: [],
        surface: api({ calls: noCalls(), reads: [pr(), QUEUED] }),
        walkthrough: recorded,
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-register-fails" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ read: MIXED, registerFails: "disk full", writes }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(order).toEqual([2, 2]);
    expect(memory).toEqual([
      { kind: "resolving", threadId: "PRRT_note1" },
      { kind: "resolving", threadId: "PRRT_note2" },
    ]);
    expect(code).toBe(1);
    expect(writes.resolved).toEqual([]);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic).toEqual([
      "not landed: the walkthrough-thread register could not record the 2 thread(s) about to be resolved " +
        "(disk full), and a resolve it does not remember cannot be told from the owner's own; nothing was resolved",
    ]);
  });

  /** A thread added before the confirming read may be the one it no longer carries. */
  it("does not press when the confirming re-read is truncated, unless the hatch is open", async () => {
    const shut: string[] = [];
    const calls = noCalls();
    const refused = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: shut,
        home: scratchHome({ label: "walk-reread-truncated" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ read: MIXED, rereadTruncated: true, writes: { ledger: [], resolved: [] } }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });
    const open: string[] = [];
    const pressed = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: open,
        home: scratchHome({ label: "walk-reread-truncated-hatch" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({
          read: MIXED,
          rereadTruncated: true,
          unseenAllowed: true,
          writes: { ledger: [], resolved: [] },
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect([refused, pressed]).toEqual([1, 0]);
    expect(calls.enqueued.length).toBe(1);
    expect(shut.at(0)).toContain(
      "(resolved our own 2 open walkthrough thread(s), but the re-read confirming them carried only GitHub's " +
        "first page of threads)",
    );
    expect(open.at(0)).toBe(
      "note: resolved our own 2 open walkthrough thread(s), but the re-read confirming them carried only GitHub's " +
        "first page of threads; only those were checked, as the unseen-review-threads hatch is open",
    );
  });

  it("never reads threads to leave a queue", async () => {
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    let reads = 0;
    const walkthrough = walkthroughDeps({ read: MIXED, writes });
    await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "walk-dequeue" }),
        out: [],
        surface: api({ calls, reads: [QUEUED, pr()] }),
        walkthrough: {
          ...walkthrough,
          walkthroughs: (args) => {
            reads += 1;
            return walkthrough.walkthroughs(args);
          },
        },
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dequeue"],
    });

    expect(reads).toBe(0);
    expect(writes.resolved).toEqual([]);
  });
});
