/** One read or a `--wait` poll: the exit code each snapshot earns, the stepped backoff, the timeout, `--json`. */
import { describe, expect, it } from "vitest";

import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { depsFor, FAILED_CHECK, PASSED_CHECK, RUNNING_CHECK, snapshot } from "./harness.js";

describe("runGithubChecks", () => {
  it("reports the current state once and exits EXIT_OK when nothing failed", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubChecks({
      deps: depsFor({ diagnostic, fetches: [snapshot({ checks: [PASSED_CHECK] })], out }),
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["1/1 checks passed (rollup PENDING), main requires no status-check contexts"]);
    expect(diagnostic).toEqual([]);
  });

  it("exits EXIT_EXPECTED_EMPTY, not an error, when a check has already failed", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubChecks({
      deps: depsFor({ diagnostic, fetches: [snapshot({ checks: [PASSED_CHECK, FAILED_CHECK] })], out }),
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual([
      "1/2 checks passed (rollup PENDING), 1 failed (test), main requires no status-check contexts",
    ]);
  });

  it("without --wait, reports a still-running snapshot as EXIT_EXPECTED_EMPTY after exactly one fetch", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    let calls = 0;

    const deps = depsFor({ diagnostic, fetches: [snapshot({ checks: [RUNNING_CHECK] })], out });
    const code = await runGithubChecks({
      deps: {
        ...deps,
        fetchChecks: (args) => {
          calls += 1;
          return deps.fetchChecks(args);
        },
      },
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(calls).toBe(1);
    expect(out).toEqual(["0/1 checks passed (rollup PENDING), 1 running, main requires no status-check contexts"]);
  });

  it("--wait polls with the stepped backoff until every check turns terminal", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sleeps: number[] = [];
    const deps = depsFor({
      diagnostic,
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
      out,
    });

    const code = await runGithubChecks({
      deps: {
        ...deps,
        sleep: (args) => {
          sleeps.push(args.ms);
          return deps.sleep(args);
        },
      },
      rest: ["--number", "9", "--wait"],
    });

    expect(code).toBe(EXIT_OK);
    expect(sleeps).toEqual([10_000]);
    expect(out).toEqual([
      "0/1 checks passed (rollup PENDING), 1 running, main requires no status-check contexts",
      "1/1 checks passed (rollup PENDING), main requires no status-check contexts",
    ]);
  });

  it("--wait gives up and reports the timeout once the deadline would be exceeded", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const deps = depsFor({ diagnostic, fetches: [snapshot({ checks: [RUNNING_CHECK] })], out });

    const code = await runGithubChecks({
      deps,
      rest: ["--number", "9", "--wait", "--timeout-seconds", "15"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(diagnostic).toEqual(["timed out after 15s waiting for checks to reach a terminal state"]);
  });

  it("emits exactly one JSON document, never an intermediate line, in --json mode", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const deps = depsFor({
      diagnostic,
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
      out,
    });

    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--wait", "--json"] });

    expect(code).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({
      baseRef: "main",
      checks: [PASSED_CHECK],
      gate: { branch: "main", kind: "read", missing: [], required: [], unproven: [] },
      headSha: "abc123",
      mergeable: undefined,
      residue: [],
      rollupState: "PENDING",
      summary: { failed: 0, passed: 1, queued: 0, running: 0, total: 1 },
      supersededChecks: [],
      truncated: false,
      terminal: true,
      timedOut: false,
    });
  });
});
