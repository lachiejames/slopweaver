import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { parseGithubCycleArgs } from "../../../../../cli/commands/github/cycleCore.js";
import { type GithubCycleDeps, runGithubCycle } from "../../../../../cli/commands/github/cycleRun.js";
import { cycleAndConfirm } from "../../../../../cli/commands/github/cycleWrite.js";
import { type IngestError, toIngestError } from "../../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CyclePr, GithubCycleApi } from "../../../../../outbound/github/cycle.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const BASE_TIP = "a8a47c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD_BASE = "0ae199dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD = "f362faffcccccccccccccccccccccccccccccccc";
const MERGE = "22f1fc39dddddddddddddddddddddddddddddddd";
const URL = "https://github.com/o/r/pull/9876";

/** A send whose answer never arrived: a reset connection, which says nothing about whether GitHub acted. */
const LOST = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

/** GitHub's definite refusal of a write. */
const REFUSED = Object.assign(new Error("Validation Failed"), { status: 422 });

/** An open pull request whose merge ref GitHub has computed. */
function openPr(over: Partial<CyclePr> = {}): CyclePr {
  return {
    autoMerge: false,
    baseRef: "staging",
    headRepoFullName: "o/r",
    headSha: HEAD,
    inMergeQueue: false,
    mergeCommitSha: MERGE,
    mergeable: true,
    mergedAtIso: undefined,
    number: 9876,
    stacked: false,
    state: "open",
    url: URL,
    ...over,
  };
}

/** A failed provider result. */
function failed<T>({ error }: { error: Error }): ResultAsync<T, IngestError> {
  return errAsync(toIngestError({ error, operation: "github.pulls.update", provider: "github" }));
}

/**
 * A plain fake over one mutable pull request. `close` and `reopen` move its state as GitHub does, unless an
 * error says GitHub refused; `closeError` reports a failure AFTER the close landed when it is a lost answer.
 * `reopenFailures` refuses that many reopen sends before one lands. `laggingRead` makes the first read after a
 * close still say open, as a GitHub read can. `reads` records the order the judgement's reads were made in.
 * `changedAfterJudging` is somebody else's edit landing just after the judgement's last read.
 */
function cycleApi({
  pr,
  calls,
  parents = [BASE_TIP, HEAD],
  closeError,
  reopenFailures = 0,
  laggingRead = false,
  reads = [],
  changedAfterJudging,
}: {
  pr: { current: CyclePr };
  calls: string[];
  parents?: readonly string[];
  closeError?: Error;
  reopenFailures?: number;
  laggingRead?: boolean;
  reads?: string[];
  changedAfterJudging?: Partial<CyclePr>;
}): GithubCycleApi {
  let refusalsLeft = reopenFailures;
  let lagging = false;
  return {
    baseTip: () => {
      reads.push("baseTip");
      pr.current = { ...pr.current, ...changedAfterJudging };
      return okAsync(BASE_TIP);
    },
    close: () => {
      calls.push("close");
      if (closeError === REFUSED) {
        return failed({ error: REFUSED });
      }
      pr.current = { ...pr.current, state: "closed" };
      lagging = laggingRead;
      if (closeError !== undefined) {
        return failed({ error: closeError });
      }
      return okAsync(undefined);
    },
    mergeRef: () => {
      reads.push("mergeRef");
      return okAsync<string | undefined>(MERGE);
    },
    parents: () => {
      reads.push("parents");
      return okAsync(parents);
    },
    read: () => {
      reads.push("read");
      if (lagging) {
        lagging = false;
        return okAsync({ ...pr.current, state: "open" });
      }
      return okAsync(pr.current);
    },
    reopen: () => {
      calls.push("reopen");
      if (refusalsLeft > 0) {
        refusalsLeft -= 1;
        return failed({ error: REFUSED });
      }
      pr.current = { ...pr.current, state: "open" };
      return okAsync(pr.current.state);
    },
  };
}

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** Run the verb against a fake and a throwaway home, recording both output channels. */
async function cycle({
  rest,
  api,
  door = memoryDoorLedger().port,
}: {
  rest: readonly string[];
  api: GithubCycleApi;
  door?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-cycle-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const deps: GithubCycleDeps = {
    doorLedger: door,
    home: () => home,
    makeApi: () => api,
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
  return { code: await runGithubCycle({ deps, rest }), diagnostic, out };
}

const ARGS = ["--repo", "o/r", "--number", "9876"];

describe("runGithubCycle", () => {
  it("closes then reopens a pull request whose merge ref is fresh, confirmed by GitHub's answer", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const reads: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, pr, reads }), rest: ARGS });

    expect(result.code).toBe(0);
    expect(calls).toEqual(["close", "reopen"]);
    expect(pr.current.state).toBe("open");
    expect(result.out).toEqual([`cycled #9876  merge 22f1fc39dddd onto staging@a8a47c9aaaaa  ${URL}`]);
    expect(result.diagnostic).toEqual([]);
    // The base tip is judged LAST, so a base that moves while the ref is read cannot be judged fresh; the pull
    // request is read once more right before the close; and no read follows the reopen, because a read can lag
    // the close and GitHub's own answer is the confirmation.
    expect(reads).toEqual(["read", "mergeRef", "parents", "baseTip", "read"]);
  });

  // r3's counterexample: a reviewer's close between the judgement and the write must not be undone.
  it("refuses, sending nothing, when somebody closes or enqueues it after the judgement", async () => {
    const closedCalls: string[] = [];
    const closed = await cycle({
      api: cycleApi({ calls: closedCalls, changedAfterJudging: { state: "closed" }, pr: { current: openPr() } }),
      rest: ARGS,
    });
    const queuedCalls: string[] = [];
    const queued = await cycle({
      api: cycleApi({ calls: queuedCalls, changedAfterJudging: { inMergeQueue: true }, pr: { current: openPr() } }),
      rest: ARGS,
    });

    expect([closed.code, queued.code]).toEqual([1, 1]);
    expect([closedCalls, queuedCalls]).toEqual([[], []]);
    expect([...closed.diagnostic, ...queued.diagnostic]).toEqual([
      "refused: #9876 is closed; this verb cycles an OPEN pull request and never reopens a closed one, as read " +
        "just before the close",
      "refused: #9876 is in the merge queue, and closing it would drop it out; dequeue it first if a cycle is " +
        "still wanted, as read just before the close",
    ]);
  });

  // The counterexample: a head push after the judgement must not be cycled under the judged merge's name.
  it("defers with exit 4, sending nothing, when the merge moves after the judgement, even under --prime", async () => {
    const pushedCalls: string[] = [];
    const pushed = await cycle({
      api: cycleApi({
        calls: pushedCalls,
        changedAfterJudging: {
          headSha: "9999999eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          mergeCommitSha: null,
          mergeable: null,
        },
        pr: { current: openPr() },
      }),
      rest: ARGS,
    });
    const recomputingCalls: string[] = [];
    const recomputing = await cycle({
      api: cycleApi({ calls: recomputingCalls, changedAfterJudging: { mergeable: null }, pr: { current: openPr() } }),
      rest: [...ARGS, "--prime"],
    });

    expect([pushed.code, recomputing.code]).toEqual([4, 4]);
    expect([pushedCalls, recomputingCalls]).toEqual([[], []]);
    expect([pushed.out, recomputing.out]).toEqual([[], []]);
    expect(recomputing.diagnostic).toEqual([
      "not yet: GitHub is computing the test merge again (mergeable is null), as read just before the close. The " +
        "merge this run judged is no longer the one a cycle would re-run, so nothing was written — run the same " +
        "command again shortly",
    ]);
  });

  it("refuses with exit 1 and writes nothing when GitHub has SETTLED the merge onto a base the branch left", async () => {
    const calls: string[] = [];
    const result = await cycle({
      api: cycleApi({ calls, parents: [OLD_BASE, HEAD], pr: { current: openPr() } }),
      rest: ARGS,
    });

    expect(result.code).toBe(1);
    expect(calls).toEqual([]);
    expect(result.out).toEqual([]);
    expect(result.diagnostic).toEqual([
      "refused: 22f1fc39dddd merges onto 0ae199dbbbbb, but staging is now at a8a47c9aaaaa. GitHub has FINISHED " +
        "this test merge, and reading again does not recompute it (a pull request can sit 45 minutes on " +
        "staging's previous tip). A cycle re-runs CI on that old merge. When the recompute follows a " +
        "reopen, `--prime` cycles once to trigger it — that run is on the old merge — then run without " +
        "--prime once the ref is fresh. If this pull request was JUST primed, the recompute may not have " +
        "started yet: run again later rather than priming twice",
    ]);
  });

  it("cycles a settled merge under --prime, saying its CI is on the old merge", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycle({
      api: cycleApi({ calls, parents: [OLD_BASE, HEAD], pr }),
      rest: [...ARGS, "--prime"],
    });

    expect(result.code).toBe(0);
    expect(calls).toEqual(["close", "reopen"]);
    expect(pr.current.state).toBe("open");
    expect(result.out).toEqual([
      "primed #9876  CI runs the OLD merge 22f1fc39dddd; run `github cycle` without --prime later, and a " +
        `settled verdict soon after is not a cue to prime again  ${URL}`,
    ]);
  });

  it("never writes while GitHub is still computing, even under --prime", async () => {
    const calls: string[] = [];
    const result = await cycle({
      api: cycleApi({ calls, pr: { current: openPr({ mergeable: null }) } }),
      rest: [...ARGS, "--prime"],
    });

    expect(result.code).toBe(4);
    expect(calls).toEqual([]);
    expect(result.diagnostic).toEqual([
      "not yet: GitHub has not finished computing the test merge (mergeable is null). GitHub is still computing " +
        "the test merge, and a cycle now would re-run CI on the old one — run the same command again shortly",
    ]);
  });

  it("refuses a merge-queued pull request, which a close would drop out of the queue", async () => {
    const calls: string[] = [];
    const result = await cycle({
      api: cycleApi({ calls, pr: { current: openPr({ inMergeQueue: true }) } }),
      rest: ARGS,
    });

    expect(result.code).toBe(1);
    expect(calls).toEqual([]);
    expect(result.diagnostic).toEqual([
      "refused: #9876 is in the merge queue, and closing it would drop it out; dequeue it first if a cycle is " +
        "still wanted",
    ]);
  });

  it("emits the not-yet verdict as a document under --json", async () => {
    const result = await cycle({
      api: cycleApi({ calls: [], pr: { current: openPr({ mergeable: null }) } }),
      rest: [...ARGS, "--json"],
    });

    expect(result.code).toBe(4);
    expect(JSON.parse(result.out[0]!)).toEqual({
      baseRef: "staging",
      baseTip: BASE_TIP,
      headSha: HEAD,
      mergeSha: null,
      number: 9876,
      outcome: "not yet",
      reason: "GitHub has not finished computing the test merge (mergeable is null)",
      url: URL,
    });
  });

  it("dry-runs a fresh ref with no write", async () => {
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, pr: { current: openPr() } }), rest: [...ARGS, "--dry-run"] });

    expect(result.code).toBe(0);
    expect(calls).toEqual([]);
    expect(result.out).toEqual([`would cycle #9876  merge 22f1fc39dddd onto staging@a8a47c9aaaaa  ${URL}`]);
  });

  it("refuses a closed pull request before reading its merge ref, and never reopens it", async () => {
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, pr: { current: openPr({ state: "closed" }) } }), rest: ARGS });

    expect(result.code).toBe(1);
    expect(calls).toEqual([]);
    expect(result.diagnostic).toEqual([
      "refused: #9876 is closed; this verb cycles an OPEN pull request and never reopens a closed one",
    ]);
  });

  it("leaves the pull request open when GitHub definitely refuses the close", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, closeError: REFUSED, pr }), rest: ARGS });

    expect(result.code).toBe(1);
    expect(calls).toEqual(["close"]);
    expect(pr.current.state).toBe("open");
  });

  it("reopens after a close whose answer was lost but which landed", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, closeError: LOST, pr }), rest: ARGS });

    expect(result.code).toBe(0);
    expect(calls).toEqual(["close", "reopen"]);
    expect(pr.current.state).toBe("open");
  });

  it("still reopens after a lost close whose read-back lags, and says CI may not have re-run", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, closeError: LOST, laggingRead: true, pr }), rest: ARGS });

    expect(result.code).toBe(1);
    expect(calls).toEqual(["close", "reopen"]);
    expect(pr.current.state).toBe("open");
    expect(result.diagnostic).toEqual([
      `GitHub answered the reopen of ${URL} as open, but the close's answer was lost (socket hang up) and no ` +
        "read showed it closed, so whether CI re-ran is unknown — and a close that lands late could still leave " +
        "it closed. Read its state and `github checks` before anything else",
    ]);
  });

  it("sends nothing when the door cannot record the cycle", async () => {
    const calls: string[] = [];
    const result = await cycle({
      api: cycleApi({ calls, pr: { current: openPr() } }),
      door: unreachableDoorLedger(),
      rest: ARGS,
    });

    expect(result.code).toBe(1);
    expect(calls).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain("not performed:");
  });

  it("sends the reopen a second time when the first is refused", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, pr, reopenFailures: 1 }), rest: ARGS });

    expect(result.code).toBe(0);
    expect(calls).toEqual(["close", "reopen", "reopen"]);
    expect(pr.current.state).toBe("open");
  });

  // r2's counterexample: a read lagging the close says open, and must not be taken for a reopen that landed.
  it("says loudly the pull request may be closed when neither reopen is confirmed, whatever a read says", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycle({ api: cycleApi({ calls, laggingRead: true, pr, reopenFailures: 2 }), rest: ARGS });

    expect(result.code).toBe(1);
    expect(calls).toEqual(["close", "reopen", "reopen"]);
    expect(pr.current.state).toBe("closed");
    expect(result.out).toEqual([]);
    expect(result.diagnostic).toEqual([
      `${URL} may be CLOSED NOW: the cycle sent a close and GitHub confirmed neither reopen attempt (Validation ` +
        "Failed). Reopening it is the next act, before anything else; `github cycle` refuses a closed pull " +
        "request, so send this line to the supervisor",
    ]);
  });
});

describe("cycleAndConfirm", () => {
  const args = unwrap(parseGithubCycleArgs({ rest: ARGS }));

  it("closes and reopens when the last read still carries the judged merge", async () => {
    const pr = { current: openPr() };
    const calls: string[] = [];
    const result = await cycleAndConfirm({ api: cycleApi({ calls, pr }), args, judged: openPr() });

    expect(unwrap(result)).toBe(undefined);
    expect(calls).toEqual(["close", "reopen"]);
  });

  it("answers STATE_CHANGED, sending nothing, when the head moved since the judgement", async () => {
    const pr = { current: openPr({ headSha: "9999999eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }) };
    const calls: string[] = [];
    const result = await cycleAndConfirm({ api: cycleApi({ calls, pr }), args, judged: openPr() });

    expect(unwrapErr(result).code).toBe("STATE_CHANGED");
    expect(unwrapErr(result).message).toContain("the head moved from f362faffcccc to 9999999eeeee");
    expect(calls).toEqual([]);
  });
});
