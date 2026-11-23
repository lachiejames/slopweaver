import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type GithubRerunDeps, runGithubRerun } from "../../../../../cli/commands/github/rerunRun.js";
import { toIngestError } from "../../../../../lib/ingestError.js";
import type { GithubRerunApi, WorkflowRunState } from "../../../../../outbound/github/rerun.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { expectedHoldRefusal, withProfileHold } from "../../../../profileHoldFixture.js";

const HEAD = "95de981aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** A send whose answer never arrived: a reset connection, which says nothing about whether GitHub acted. */
const LOST = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

/** A run as GitHub reports it, varying only what a case cares about. Each run is its own workflow by default. */
function run({
  id,
  conclusion,
  status = "completed",
  runAttempt = 1,
  workflowId = id,
}: {
  id: number;
  conclusion: string | null;
  status?: string;
  runAttempt?: number;
  workflowId?: number;
}): WorkflowRunState {
  return {
    conclusion,
    event: "pull_request",
    headSha: HEAD,
    htmlUrl: `https://github.com/o/r/actions/runs/${String(id)}`,
    id,
    name: "ci",
    runAttempt,
    status,
    workflowId,
  };
}

/**
 * A plain fake over a mutable set of runs. A re-run starts the next attempt and queues it, as GitHub does —
 * unless `stuck` says GitHub accepted the call and the read-back still shows the old attempt. `sendError`
 * makes the send report that failure after the attempt has (or has not) moved, as a lost answer to an
 * accepted write does, or a refusal racing somebody else's re-run.
 */
function rerunApi({
  runs,
  reruns,
  stuck = false,
  truncated = false,
  sendError,
}: {
  runs: Map<number, WorkflowRunState>;
  reruns: number[];
  stuck?: boolean;
  truncated?: boolean;
  sendError?: Error;
}): GithubRerunApi {
  return {
    prHeadSha: () => ResultAsync.fromSafePromise(Promise.resolve(HEAD)),
    rerunFailed: ({ runId }) => {
      reruns.push(runId);
      const before = runs.get(runId)!;
      if (!stuck) {
        runs.set(runId, { ...before, conclusion: null, runAttempt: before.runAttempt! + 1, status: "queued" });
      }
      if (sendError !== undefined) {
        return errAsync(toIngestError({ error: sendError, operation: "rerun", provider: "github" }));
      }
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    run: ({ runId }) => ResultAsync.fromSafePromise(Promise.resolve(runs.get(runId)!)),
    runsForHead: () => ResultAsync.fromSafePromise(Promise.resolve({ runs: [...runs.values()], truncated })),
  };
}

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** Run the verb against a fake and a throwaway home, recording both output channels. */
async function rerun({
  rest,
  api,
  doorLedger = memoryDoorLedger().port,
}: {
  rest: readonly string[];
  api: GithubRerunApi;
  doorLedger?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-rerun-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const deps: GithubRerunDeps = {
    doorLedger,
    home: () => home,
    makeApi: () => api,
    out: (line) => out.push(line),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
  return { code: await runGithubRerun({ deps, rest }), diagnostic, out };
}

const RUN_ARGS = ["--repo", "o/r", "--run-id", "36945592960"];

describe("runGithubRerun", () => {
  it("re-runs a failed run through the door and confirms the next attempt by read-back", async () => {
    const runs = new Map([[36945592960, run({ conclusion: "failure", id: 36945592960 })]]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: RUN_ARGS });

    expect(result.code).toBe(0);
    expect(reruns).toEqual([36945592960]);
    expect(result.out).toEqual([
      "re-ran  ci (run 36945592960)  attempt 2  https://github.com/o/r/actions/runs/36945592960",
    ]);
    expect(result.diagnostic).toEqual([]);
  });

  it("dry-runs after the read and sends nothing", async () => {
    const runs = new Map([[36945592960, run({ conclusion: "cancelled", id: 36945592960 })]]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: [...RUN_ARGS, "--dry-run"] });

    expect(result.code).toBe(0);
    expect(reruns).toEqual([]);
    expect(result.out).toEqual([
      "would re-run  ci (run 36945592960)  attempt 1  (cancelled)  https://github.com/o/r/actions/runs/36945592960",
    ]);
  });

  it("refuses when GitHub accepts the call but the run reads back at the same attempt", async () => {
    const runs = new Map([[36945592960, run({ conclusion: "failure", id: 36945592960 })]]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs, stuck: true }), rest: RUN_ARGS });

    expect(result.code).toBe(1);
    expect(reruns).toEqual([36945592960]);
    expect(result.out).toEqual([
      "refused  ci (run 36945592960)  attempt 1  (GitHub accepted the re-run of ci (run 36945592960) but it " +
        "still reads back as attempt 1)  https://github.com/o/r/actions/runs/36945592960",
    ]);
  });

  it("refuses a named run that is still going, sending nothing", async () => {
    const runs = new Map([[36945592960, run({ conclusion: null, id: 36945592960, status: "in_progress" })]]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: RUN_ARGS });

    expect(result.code).toBe(1);
    expect(reruns).toEqual([]);
    expect(result.out[0]).toContain("still running  ci (run 36945592960)");
    expect(result.out[0]).toContain("in_progress — GitHub re-runs only a finished run");
  });

  it("reports a green run as nothing failed, sending nothing", async () => {
    const runs = new Map([[36945592960, run({ conclusion: "success", id: 36945592960 })]]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: RUN_ARGS });

    expect(result.code).toBe(0);
    expect(reruns).toEqual([]);
    expect(result.out[0]).toBe(
      "nothing failed  ci (run 36945592960)  attempt 1  (success)  https://github.com/o/r/actions/runs/36945592960",
    );
  });

  it("re-runs only the failed runs on a pull request's head, reporting the rest", async () => {
    const runs = new Map([
      [1, run({ conclusion: "success", id: 1 })],
      [2, run({ conclusion: "timed_out", id: 2 })],
      [3, run({ conclusion: null, id: 3, status: "in_progress" })],
      [4, run({ conclusion: "failure", id: 4 })],
    ]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: ["--repo", "o/r", "--number", "9876"] });

    expect(result.code).toBe(0);
    expect(reruns).toEqual([2, 4]);
    expect(result.out.map((line) => line.split("  ")[0])).toEqual([
      "nothing failed",
      "re-ran",
      "still running",
      "re-ran",
    ]);
  });

  it("leaves a failed run a newer run of the same workflow replaced, and re-runs nothing on its behalf", async () => {
    const runs = new Map([
      [5, run({ conclusion: "cancelled", id: 5, workflowId: 1 })],
      [6, run({ conclusion: null, id: 6, status: "in_progress", workflowId: 1 })],
    ]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: ["--repo", "o/r", "--number", "9876"] });

    expect(result.code).toBe(0);
    expect(reruns).toEqual([]);
    expect(result.out[0]).toBe(
      "superseded  ci (run 5)  attempt 1  (run 6 of the same workflow replaced it)  https://github.com/o/r/actions/runs/5",
    );
  });

  it("reports a run that never started its jobs as one it cannot re-run, and exits non-zero", async () => {
    const runs = new Map([[8, run({ conclusion: "startup_failure", id: 8 })]]);
    const reruns: number[] = [];
    const result = await rerun({ api: rerunApi({ reruns, runs }), rest: ["--repo", "o/r", "--number", "9876"] });

    expect(result.code).toBe(1);
    expect(reruns).toEqual([]);
    expect(result.out[0]).toContain("cannot re-run  ci (run 8)  attempt 1  (startup_failure — it has no failed jobs");
  });

  it("calls a re-run whose answer was lost a re-run when the read-back shows the next attempt", async () => {
    const runs = new Map([[7, run({ conclusion: "failure", id: 7 })]]);
    const reruns: number[] = [];
    const result = await rerun({
      api: rerunApi({ reruns, runs, sendError: LOST }),
      rest: ["--repo", "o/r", "--run-id", "7"],
    });

    expect(result.code).toBe(0);
    expect(reruns).toEqual([7]);
    expect(result.out[0]).toBe("re-ran  ci (run 7)  attempt 2  https://github.com/o/r/actions/runs/7");
  });

  it("reports a lost answer as the send's failure when the read-back shows no new attempt", async () => {
    const runs = new Map([[7, run({ conclusion: "failure", id: 7 })]]);
    const result = await rerun({
      api: rerunApi({ reruns: [], runs, sendError: LOST, stuck: true }),
      rest: ["--repo", "o/r", "--run-id", "7"],
    });

    expect(result.code).toBe(1);
    expect(result.out[0]).toContain("refused  ci (run 7)  attempt 1  (");
    expect(result.out[0]).toContain("socket hang up");
  });

  it("never claims a re-run GitHub refused outright, even when somebody else's moved the attempt", async () => {
    const runs = new Map([[7, run({ conclusion: "failure", id: 7 })]]);
    const forbidden = Object.assign(new Error("already re-running"), { status: 403 });
    const result = await rerun({
      api: rerunApi({ reruns: [], runs, sendError: forbidden }),
      rest: ["--repo", "o/r", "--run-id", "7"],
    });

    expect(result.code).toBe(1);
    expect(result.out[0]).toContain("refused  ci (run 7)  attempt 1  (");
    expect(result.out[0]).toContain("already re-running");
  });

  it("keeps a multi-line upstream refusal inside the run's parenthesis, laid out only for a door refusal", async () => {
    const runs = new Map([[7, run({ conclusion: "failure", id: 7 })]]);
    const forbidden = Object.assign(new Error("first line\nsecond line"), { status: 403 });
    const result = await rerun({
      api: rerunApi({ reruns: [], runs, sendError: forbidden }),
      rest: ["--repo", "o/r", "--run-id", "7"],
    });

    expect(result.code).toBe(1);
    expect(result.out).toHaveLength(1);
    expect(result.out[0]).toMatch(
      /^refused {2}ci \(run 7\) {2}attempt 1 {2}\(.*first line\nsecond line.*\) {2}https:\/\/github\.com\/o\/r\/actions\/runs\/7$/su,
    );
  });

  it("refuses a pull request whose runs did not fit in one read, rather than calling the rest green", async () => {
    const runs = new Map([[4, run({ conclusion: "failure", id: 4 })]]);
    const reruns: number[] = [];
    const result = await rerun({
      api: rerunApi({ reruns, runs, truncated: true }),
      rest: ["--repo", "o/r", "--number", "9876"],
    });

    expect(result.code).toBe(1);
    expect(reruns).toEqual([]);
    expect(result.diagnostic).toEqual([
      `${HEAD} started more workflow runs than one read covers; name the run with --run-id instead`,
    ]);
  });

  it("prints a door refusal whole beneath the run's line, and carries it whole under --json", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-rerun-held-"));
    homes.push(home);
    const reruns: number[] = [];
    const out: string[] = [];
    const deps: GithubRerunDeps = {
      doorLedger: memoryDoorLedger().port,
      home: () => home,
      makeApi: () => rerunApi({ reruns, runs: new Map([[7, run({ conclusion: "failure", id: 7 })]]) }),
      out: (line) => out.push(line),
      token: () => "token",
      writeDiagnostic: () => undefined,
    };
    const rest = ["--repo", "o/r", "--run-id", "7"];
    const text = await withProfileHold({ home, run: () => runGithubRerun({ deps, rest }) });
    const textOut = out.splice(0);
    const json = await withProfileHold({ home, run: () => runGithubRerun({ deps, rest: [...rest, "--json"] }) });
    const refusal = expectedHoldRefusal({ command: "slopweaver github rerun", decision: text.decision });

    expect([text.result, json.result, reruns]).toEqual([1, 1, []]);
    expect(text.decision.findings.map((finding) => finding.code)).toEqual(["PROFILE_NOT_LOADED"]);
    expect(textOut).toEqual([
      ["refused  ci (run 7)  attempt 1  https://github.com/o/r/actions/runs/7", ...refusal].join("\n"),
    ]);
    const jsonRun = JSON.parse(out.join("\n")).runs[0];
    expect([jsonRun.detail, jsonRun.doorRefusal]).toEqual([null, refusal]);
  });

  it("sends nothing and reports refused, with the reason in detail, when the door ledger's store is down", async () => {
    const runs = new Map([[7, run({ conclusion: "failure", id: 7 })]]);
    const reruns: number[] = [];
    const result = await rerun({
      api: rerunApi({ reruns, runs }),
      doorLedger: unreachableDoorLedger(),
      rest: ["--repo", "o/r", "--run-id", "7", "--json"],
    });

    const jsonRun = JSON.parse(result.out.join("\n")).runs[0];
    expect(result.code).toBe(1);
    expect(reruns).toEqual([]);
    expect(jsonRun.outcome).toBe("refused");
    expect(jsonRun.detail).toContain("slopweaver github rerun not performed:");
    expect(jsonRun.doorRefusal).toBe(undefined);
  });

  it("emits one JSON document under --json", async () => {
    const runs = new Map([[7, run({ conclusion: "failure", id: 7 })]]);
    const result = await rerun({
      api: rerunApi({ reruns: [], runs }),
      rest: ["--repo", "o/r", "--run-id", "7", "--json"],
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out.join("\n"))).toEqual({
      repo: "o/r",
      runs: [
        {
          attempt: 2,
          detail: null,
          id: 7,
          name: "ci",
          outcome: "re-ran",
          url: "https://github.com/o/r/actions/runs/7",
        },
      ],
    });
  });

  it("refuses both selectors at once as a usage error, before any read", async () => {
    const reruns: number[] = [];
    const result = await rerun({
      api: rerunApi({ reruns, runs: new Map() }),
      rest: ["--repo", "o/r", "--run-id", "7", "--number", "9"],
    });

    expect(result.code).toBe(2);
    expect(result.diagnostic[0]).toBe("exactly one of --run-id <id> or --number <n> is required");
  });
});
