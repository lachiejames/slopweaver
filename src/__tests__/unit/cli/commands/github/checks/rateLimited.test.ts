/** A rate-limited read: a watch outlasts a reset inside its deadline, and a one-shot read reports it instead. */
import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "#lib/result.js";
import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import type { GithubChecksDeps } from "../../../../../../cli/commands/github/checksSeams.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { type GithubChecksSnapshot, nextChecksPollDelayMs } from "../../../../../../live/github/checks.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { activity, depsFor, PASSED_CHECK, RUNNING_CHECK, snapshot } from "./harness.js";

describe("runGithubChecks — a rate-limited read", () => {
  const SINCE = "2026-09-03T00:00:00Z";
  /** The fake clock starts at the epoch, so a reset two minutes in is 120s away from the first read. */
  const RESET = "1970-01-01T00:02:00.000Z";
  const LIMITED = GithubLiveErrors.rateLimited({
    message: "Request failed due to following response errors: - API rate limit already exceeded for user ID 1.",
    resetAt: RESET,
  });
  const FIRST_DELAY = nextChecksPollDelayMs({ attempt: 0 });
  const RESET_WAIT = 121_000 - FIRST_DELAY;

  /** Serve each read in turn, the last one repeating — a failed read in the middle of an otherwise green run. */
  function inTurn({
    results,
  }: {
    results: readonly Result<GithubChecksSnapshot, GithubLiveError>[];
  }): GithubChecksDeps["fetchChecks"] {
    let call = 0;
    return () => {
      const next = results[Math.min(call, results.length - 1)]!;
      call += 1;
      return Promise.resolve(next);
    };
  }

  /** Wrap a deps' sleep so every requested delay is recorded, in order. */
  function sleepsOf({ deps, sleeps }: { deps: GithubChecksDeps; sleeps: number[] }): GithubChecksDeps {
    return {
      ...deps,
      sleep: ({ ms }) => {
        sleeps.push(ms);
        return deps.sleep({ ms });
      },
    };
  }

  it("--until merge outlasts a rate limit that resets inside its deadline, says so on stdout, and runs on to the merge", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const sleeps: number[] = [];
    const base = depsFor({ activities: [activity(), activity({ state: "MERGED" })], diagnostic, fetches: [], out });
    const deps = sleepsOf({
      deps: {
        ...base,
        fetchChecks: inTurn({
          results: [ok(snapshot({ checks: [PASSED_CHECK] })), err(LIMITED), ok(snapshot({ checks: [PASSED_CHECK] }))],
        }),
      },
      sleeps,
    });

    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--until", "merge", "--since", SINCE] });

    expect(code).toBe(EXIT_OK);
    expect(out.slice(1)).toEqual([
      `RATE-LIMITED until ${RESET}, waiting ${String(Math.ceil(RESET_WAIT / 1000))}s`,
      "MERGED",
      "CI PASS 1/1 on abc123, main requires no status-check contexts",
    ]);
    expect(sleeps).toEqual([FIRST_DELAY, RESET_WAIT]);
    expect(diagnostic).toEqual([]);
  });

  it("re-reads at once after a wait that ends exactly on the deadline, rather than timing out unread", async () => {
    const out: string[] = [];
    const sleeps: number[] = [];
    const unknownReset = GithubLiveErrors.rateLimited({ message: "rate limit exceeded", resetAt: undefined });
    const base = depsFor({ activities: [activity({ state: "MERGED" })], diagnostic: [], fetches: [], out });
    const deps = sleepsOf({
      deps: { ...base, fetchChecks: inTurn({ results: [err(unknownReset), ok(snapshot())] }) },
      sleeps,
    });

    const code = await runGithubChecks({
      deps,
      rest: ["--number", "9", "--until", "merge", "--since", SINCE, "--timeout-seconds", "60"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out.slice(1)).toEqual(["RATE-LIMITED, GitHub named no reset, retrying in 60s", "MERGED"]);
    expect(sleeps).toEqual([60_000]);
  });

  it("--until merge whose deadline falls before the reset ends on a WATCH-FAILED line naming the reset, exiting non-zero", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const base = depsFor({ diagnostic, fetches: [], out });
    const deps = { ...base, fetchChecks: inTurn({ results: [ok(snapshot()), err(LIMITED)] }) };

    const code = await runGithubChecks({
      deps,
      rest: ["--number", "9", "--until", "merge", "--since", SINCE, "--timeout-seconds", "60"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(out.slice(1)).toEqual([`WATCH-FAILED rate-limited until ${RESET}, past the 60s deadline`]);
    expect(diagnostic).toEqual([LIMITED.message]);
  });

  it("any other failed read ends an event watch on a WATCH-FAILED line, never silently on stdout", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const base = depsFor({ diagnostic, fetches: [snapshot()], out });
    const deps = {
      ...base,
      fetchActivity: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "Bad credentials" }))),
    };

    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--until", "merge", "--since", SINCE] });

    expect(code).toBe(EXIT_ERROR);
    expect(out.slice(1)).toEqual(["WATCH-FAILED Bad credentials"]);
    expect(diagnostic).toEqual(["Bad credentials"]);
  });

  it("--wait outlasts it too, saying so on the diagnostic channel so stdout stays status lines", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const base = depsFor({ diagnostic, fetches: [], out });
    const deps = {
      ...base,
      fetchChecks: inTurn({ results: [err(LIMITED), ok(snapshot({ checks: [PASSED_CHECK] }))] }),
    };

    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--wait"] });

    expect(code).toBe(EXIT_OK);
    expect(diagnostic).toEqual([`RATE-LIMITED until ${RESET}, waiting 121s`]);
    expect(out).toEqual(["1/1 checks passed (rollup PENDING), main requires no status-check contexts"]);
  });

  it("a one-shot read does not wait: it was asked for one read, and prints the reset in the failure", async () => {
    const diagnostic: string[] = [];
    const sleeps: number[] = [];
    const base = depsFor({ diagnostic, fetches: [], out: [] });
    const deps = sleepsOf({ deps: { ...base, fetchChecks: inTurn({ results: [err(LIMITED)] }) }, sleeps });

    const code = await runGithubChecks({ deps, rest: ["--number", "9"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostic).toEqual([LIMITED.message]);
    expect(LIMITED.message).toContain(`rate limited until ${RESET}`);
    expect(sleeps).toEqual([]);
  });

  it("re-reads a required-contexts read that was rate-limited, rather than wearing UNREAD for the whole watch", async () => {
    const out: string[] = [];
    const base = depsFor({
      diagnostic: [],
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
      out,
    });
    let requiredReads = 0;
    const deps: GithubChecksDeps = {
      ...base,
      fetchRequiredContexts: ({ branch }) => {
        requiredReads += 1;
        return Promise.resolve(
          requiredReads === 1 ? err(LIMITED) : ok({ branch, contexts: ["lint"], requiresCodeOwnerReviews: undefined }),
        );
      },
    };

    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--wait"] });

    expect(code).toBe(EXIT_OK);
    expect(requiredReads).toBe(2);
    expect(out[1]).toBe("1/1 checks passed (rollup PENDING), 1/1 required present");
  });
});
