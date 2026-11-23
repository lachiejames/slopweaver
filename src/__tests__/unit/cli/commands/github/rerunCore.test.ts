import { describe, expect, it } from "vitest";

import {
  attemptAdvanced,
  parseGithubRerunArgs,
  rerunDoorRequest,
  rerunVerdict,
  sendOutcomeUnknown,
  supersedingRun,
} from "../../../../../cli/commands/github/rerunCore.js";
import { toIngestError } from "../../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { WorkflowRunState } from "../../../../../outbound/github/rerun.js";

/** A completed failed run at its first attempt, with `over` replacing any field — an explicit undefined included. */
function run(over: Partial<WorkflowRunState>): WorkflowRunState {
  return {
    conclusion: "failure",
    event: "pull_request",
    headSha: "abc",
    htmlUrl: "https://github.com/o/r/actions/runs/1",
    id: 1,
    name: "ci",
    runAttempt: 1,
    status: "completed",
    workflowId: 100,
    ...over,
  };
}

describe("parseGithubRerunArgs", () => {
  it("reads a named run", () => {
    const args = unwrap(parseGithubRerunArgs({ rest: ["--repo", "o/r", "--run-id", "36945592960"] }));
    expect(args.target).toEqual({ kind: "run", runId: 36945592960 });
    expect(args.owner).toBe("o");
    expect(args.dryRun).toBe(false);
  });

  it("reads a pull request", () => {
    const args = unwrap(parseGithubRerunArgs({ rest: ["--repo", "o/r", "--number", "9876", "--dry-run"] }));
    expect(args.target).toEqual({ kind: "pr", number: 9876 });
    expect(args.dryRun).toBe(true);
  });

  it("refuses neither selector, and names the missing repository too", () => {
    expect(unwrapErr(parseGithubRerunArgs({ rest: [] }))).toEqual([
      "--repo owner/name is required",
      "exactly one of --run-id <id> or --number <n> is required",
    ]);
  });

  it("refuses a run id that is not a positive whole number", () => {
    expect(unwrapErr(parseGithubRerunArgs({ rest: ["--repo", "o/r", "--run-id", "12abc"] }))).toEqual([
      "--run-id must be a positive whole number",
    ]);
    expect(unwrapErr(parseGithubRerunArgs({ rest: ["--repo", "o/r", "--number", "0"] }))).toEqual([
      "--number must be a positive whole number",
    ]);
  });
});

describe("rerunVerdict", () => {
  it("re-runs a finished run that failed, was cancelled or timed out", () => {
    expect(
      ["failure", "cancelled", "timed_out"].map((conclusion) => rerunVerdict({ run: run({ conclusion }) })),
    ).toEqual(["rerun", "rerun", "rerun"]);
  });

  it("leaves a green, skipped or neutral run alone", () => {
    expect(["success", "skipped", "neutral"].map((conclusion) => rerunVerdict({ run: run({ conclusion }) }))).toEqual([
      "nothing-failed",
      "nothing-failed",
      "nothing-failed",
    ]);
  });

  it("calls a run that has not finished not-completed, whatever its conclusion field says", () => {
    expect(rerunVerdict({ run: run({ conclusion: null, status: "in_progress" }) })).toBe("not-completed");
    expect(rerunVerdict({ run: run({ conclusion: "failure", status: null }) })).toBe("not-completed");
  });

  it("calls a finished run that is neither clean nor failed not-rerunnable, never nothing-failed", () => {
    expect(
      ["startup_failure", "action_required", "stale"].map((conclusion) => rerunVerdict({ run: run({ conclusion }) })),
    ).toEqual(["not-rerunnable", "not-rerunnable", "not-rerunnable"]);
    expect(rerunVerdict({ run: run({ conclusion: null }) })).toBe("not-rerunnable");
  });
});

describe("sendOutcomeUnknown", () => {
  it("reads back after a lost connection or a server error, never after GitHub's own 4xx", () => {
    const outcome = ({ error }: { error: Error }): boolean =>
      sendOutcomeUnknown({ error: toIngestError({ error, operation: "rerun", provider: "github" }) });
    expect(outcome({ error: Object.assign(new Error("reset"), { code: "ECONNRESET" }) })).toBe(true);
    expect(outcome({ error: Object.assign(new Error("bad gateway"), { status: 502 }) })).toBe(true);
    expect(outcome({ error: Object.assign(new Error("forbidden"), { status: 403 }) })).toBe(false);
    expect(outcome({ error: Object.assign(new Error("gone"), { status: 404 }) })).toBe(false);
  });
});

describe("supersedingRun", () => {
  it("names the newest later run of the same workflow and event", () => {
    const old = run({ id: 1 });
    const runs = [old, run({ id: 3 }), run({ id: 2 })];
    expect(supersedingRun({ run: old, runs })!.id).toBe(3);
  });

  it("ignores another workflow, another event, and an earlier run", () => {
    const latest = run({ id: 5 });
    const runs = [run({ id: 9, workflowId: 200 }), run({ event: "push", id: 8 }), run({ id: 4 }), latest];
    expect(supersedingRun({ run: latest, runs })).toBe(undefined);
  });
});

describe("attemptAdvanced", () => {
  it("is true only when the read-back attempt is strictly later", () => {
    expect(attemptAdvanced({ after: run({ runAttempt: 2 }), before: run({ runAttempt: 1 }) })).toBe(true);
    expect(attemptAdvanced({ after: run({ runAttempt: 1 }), before: run({ runAttempt: 1 }) })).toBe(false);
  });

  it("confirms nothing when GitHub omitted the attempt on either read", () => {
    expect(attemptAdvanced({ after: run({ runAttempt: undefined }), before: run({ runAttempt: 1 }) })).toBe(false);
    expect(attemptAdvanced({ after: run({ runAttempt: 2 }), before: run({ runAttempt: undefined }) })).toBe(false);
  });
});

describe("rerunDoorRequest", () => {
  it("names the run as the artifact of an external write needing no approval", () => {
    const args = unwrap(parseGithubRerunArgs({ rest: ["--repo", "acme/acme-admin", "--run-id", "36945592960"] }));
    expect(rerunDoorRequest({ args, home: "/h", runId: 36945592960 })).toEqual({
      action: { kind: "verb", noun: "github", verb: "rerun" },
      artifact: { id: "acme/acme-admin/actions/runs/36945592960" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});
