/**
 * `slopweaver github enqueue` resolving the owner's own walkthrough threads before the press: which notes it resolves,
 * a resolve that fails or races a reply, a moved head, `--dry-run`, and a thread read that fails or is truncated.
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
  /** Measured on acme-admin: the queue refused the ENTRY while these were open. */
  it("resolves the owner's own notes before the enqueue, never a reviewer's, and ledgers the act", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const enqueuedAtResolve: number[] = [];
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({
          beforeResolve: () => enqueuedAtResolve.push(calls.enqueued.length),
          read: MIXED,
          writes,
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(writes.resolved).toEqual(["PRRT_note1", "PRRT_note2"]);
    expect(enqueuedAtResolve).toEqual([0, 0]);
    expect(calls.enqueued.length).toBe(1);
    expect(writes.ledger.map((row) => [row.actionId, row.subject, row.witness])).toEqual([
      [
        "acme-widget-9-resolve-own-threads-cafe123-b48d11",
        "https://example.invalid/pr/9",
        "slopweaver github enqueue -> resolved 2 of 2 own open walkthrough thread(s) on acme/widget#9 at head cafe123",
      ],
    ]);
    expect(diagnostic).toEqual(["resolved our own 2 open walkthrough thread(s) before landing"]);
  });

  it("does not press when one of the owner's notes will not resolve, and still ledgers the one that did", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-fail" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ failIds: ["PRRT_note2"], read: MIXED, writes }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(writes.ledger.map((row) => row.witness)).toEqual([
      "slopweaver github enqueue -> resolved 1 of 2 own open walkthrough thread(s) on acme/widget#9 at head cafe123",
    ]);
    expect(diagnostic.at(-1)).toContain("not landed: resolved 1 of our own 2 open walkthrough thread(s)");
  });

  /** A resolve that never took, remembered as the landing's, reopens the owner's own later resolve. */
  it("forgets a resolve GitHub shows did not take, so the owner's own later resolve over a reply is left alone", async () => {
    const memory: WalkthroughAct[] = [];
    await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "walk-release" }),
        out: [],
        surface: api({ calls: noCalls(), reads: [pr()] }),
        walkthrough: walkthroughDeps({
          failIds: ["PRRT_note2"],
          memory,
          read: MIXED,
          writes: { ledger: [], resolved: [] },
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });
    const calls = noCalls();
    const reopened: string[] = [];
    const tookFirst = walkthroughThread({ id: "PRRT_note1", isResolved: true, resolvedByLogin: "owner" });
    const ownersOwn = walkthroughThread({ ...COLLAPSED, id: "PRRT_note2" });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: [],
        home: scratchHome({ label: "walk-release-later" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({
          memory,
          read: { ...MIXED, threads: [tookFirst, ownersOwn, MIXED.threads[2]!] },
          reopened,
          writes: { ledger: [], resolved: [] },
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(memory).toEqual([
      { kind: "resolving", threadId: "PRRT_note1" },
      { kind: "resolving", threadId: "PRRT_note2" },
      { kind: "released", threadId: "PRRT_note2" },
    ]);
    expect(reopened).toEqual([]);
    expect(code).toBe(0);
    expect(calls.enqueued.length).toBe(1);
  });

  /** GitHub's resolve has no precondition, so a reply racing the read is resolved too. */
  it("does not press when a reply lands on a note as it is resolved, and reopens that thread", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const reopened: string[] = [];
    const home = scratchHome({ label: "walk-reply" });
    const raced = { commentCount: 2, lastCommentBody: "is this retried twice?", lastCommentLogin: "teammate" };
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home,
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({
          afterResolve: (thread) => (thread.id === "PRRT_note2" ? { ...thread, ...raced } : thread),
          read: MIXED,
          reopened,
          writes,
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(writes.resolved).toEqual(["PRRT_note1", "PRRT_note2"]);
    expect(reopened).toEqual(["PRRT_note2"]);
    expect(diagnostic).toEqual([
      "not landed: 1 of the 2 walkthrough thread(s) just resolved carries a reply that arrived as they were " +
        "read; reopened, so the reply reads open again. answer each with the command beneath it, then run it " +
        "again — a resolve with no answer is reopened",
      "  PRRT_note2 on src/a.ts:12, teammate replied:",
      "    > is this retried twice?",
      "    answer: `slopweaver github thread reply --repo acme/widget --number 9 --thread PRRT_note2 " +
        `--home ${home} --body - --resolve\``,
    ]);
  });

  /** A reply left resolved no longer reads as ours-open, so a retry lands over it. */
  it("names the thread command when a replied thread will not reopen", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const walkthrough = walkthroughDeps({
      afterResolve: (thread) => ({ ...thread, commentCount: 2, lastCommentBody: "why?", lastCommentLogin: "teammate" }),
      read: MIXED,
      writes: { ledger: [], resolved: [] },
    });
    const home = scratchHome({ label: "walk-reopen-fail" });
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home,
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: { ...walkthrough, reopenThread: () => Promise.resolve(1) },
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic).toEqual([
      "not landed: 2 of the 2 walkthrough thread(s) just resolved carries a reply that arrived as they were " +
        "read; 2 could not be reopened, and the next landing reopens them first: " +
        `\`slopweaver github thread reopen --repo acme/widget --number 9 --thread PRRT_note1 --home ${home}\`; ` +
        `\`slopweaver github thread reopen --repo acme/widget --number 9 --thread PRRT_note2 --home ${home}\`. ` +
        "answer each with the command beneath it, then run it again — a resolve with no answer is reopened",
      ...["PRRT_note1", "PRRT_note2"].flatMap((id) => [
        `  ${id} on src/a.ts:12, teammate replied:`,
        "    > why?",
        `    answer: \`slopweaver github thread reply --repo acme/widget --number 9 --thread ${id} --home ${home} ` +
          "--body - --resolve`",
      ]),
    ]);
  });

  /** A push between the landing's read and the thread read would resolve the new head's notes. */
  it("resolves nothing and does not press when the thread read is at another head", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-head" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ read: { ...MIXED, headOid: "beef5678" }, writes }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(writes.resolved).toEqual([]);
    expect(diagnostic).toEqual([
      "not landed: the head moved to beef567 since the landing read cafe123; nothing was resolved, run it again",
    ]);
  });

  /** Another client can reopen a thread between the resolve and the press. */
  it("does not press when a note it resolved reads back open, and forgets that resolve", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const memory: WalkthroughAct[] = [];
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-reopen" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({
          afterResolve: (thread) => (thread.id === "PRRT_note1" ? { ...thread, isResolved: false } : thread),
          memory,
          read: MIXED,
          writes: { ledger: [], resolved: [] },
        }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(memory.at(-1)).toEqual({ kind: "released", threadId: "PRRT_note1" });
    expect(diagnostic).toEqual([
      "not landed: 1 of the 2 walkthrough thread(s) just resolved is open again, or missing from the re-read; " +
        "GitHub refuses the landing while a conversation is open",
    ]);
  });

  it("says under --dry-run that it would resolve them, and writes nothing", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-dry" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ read: MIXED, writes }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(writes).toEqual({ ledger: [], resolved: [] });
    expect(diagnostic).toEqual(["would first resolve 2 of our own open walkthrough thread(s)"]);
  });

  it("refuses, under --dry-run and for real, a note GitHub returned with no node id", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const read = { ...MIXED, threads: [walkthroughThread({ id: "" })] };
    const surface = api({ calls, reads: [pr(), pr()] });
    const deps = depsFor({
      diagnostic,
      home: scratchHome({ label: "walk-noid" }),
      out: [],
      surface,
      walkthrough: walkthroughDeps({ read, writes }),
    });

    expect(await runGithubEnqueue({ deps, rest: ["--pr", "9", "--repo", "acme/widget", "--dry-run"] })).toBe(1);
    expect(await runGithubEnqueue({ deps, rest: ["--pr", "9", "--repo", "acme/widget"] })).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(writes.resolved).toEqual([]);
    expect(diagnostic.map((line) => line.split(":")[0])).toEqual(["would not land", "not landed"]);
  });

  it("leaves a teammate's own notes alone and presses", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-theirs" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({ read: { ...MIXED, viewerLogin: "someone-else" }, writes }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(writes.resolved).toEqual([]);
    expect(calls.enqueued.length).toBe(1);
    expect(diagnostic).toEqual([
      "left 2 of @owner's own open walkthrough thread(s) as they are: the pull request is not this account's",
    ]);
  });

  /** An unseen thread may be a reply collapsed under the owner's resolve, which no rule catches. */
  it("does not press when the thread read fails, and names the hatch", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-readfail" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ read: undefined, writes: { ledger: [], resolved: [] } }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(1);
    expect(calls.enqueued).toEqual([]);
    expect(diagnostic.at(0)).toContain("(the review threads could not be read (github said no))");
    expect(diagnostic.at(0)).toContain("SLOPWEAVER_ALLOW_UNSEEN_REVIEW_THREADS=1");
  });

  it("presses over a failed thread read once the hatch is open, saying so", async () => {
    const diagnostic: string[] = [];
    const calls = noCalls();
    const code = await runGithubEnqueue({
      deps: depsFor({
        diagnostic,
        home: scratchHome({ label: "walk-readfail-hatch" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({ read: undefined, unseenAllowed: true, writes: { ledger: [], resolved: [] } }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect(code).toBe(0);
    expect(calls.enqueued.length).toBe(1);
    expect(diagnostic.at(0)).toBe(
      "note: the review threads could not be read (github said no); landing anyway, as the unseen-review-threads " +
        "hatch is open",
    );
  });

  it("does not press over a truncated thread read unless the hatch is open", async () => {
    const shut: string[] = [];
    const open: string[] = [];
    const calls = noCalls();
    const truncated = { ...MIXED, truncated: true };
    const refused = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: shut,
        home: scratchHome({ label: "walk-truncated" }),
        out: [],
        surface: api({ calls, reads: [pr()] }),
        walkthrough: walkthroughDeps({ read: truncated, writes: { ledger: [], resolved: [] } }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });
    const writes: WalkthroughWrites = { ledger: [], resolved: [] };
    const pressed = await runGithubEnqueue({
      deps: depsFor({
        diagnostic: open,
        home: scratchHome({ label: "walk-truncated-hatch" }),
        out: [],
        surface: api({ calls, reads: [pr(), QUEUED] }),
        walkthrough: walkthroughDeps({ read: truncated, unseenAllowed: true, writes }),
      }),
      rest: ["--pr", "9", "--repo", "acme/widget"],
    });

    expect([refused, pressed]).toEqual([1, 0]);
    expect(calls.enqueued.length).toBe(1);
    expect(shut.at(0)).toContain("(GitHub had more review threads than this read carried)");
    expect(writes.resolved).toEqual(["PRRT_note1", "PRRT_note2"]);
  });
});
