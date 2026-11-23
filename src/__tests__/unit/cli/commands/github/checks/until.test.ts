/** `--until` event watches: which event ends each mode, and the lines a watch prints until it does. */
import { describe, expect, it } from "vitest";

import { err } from "#lib/result.js";
import { untilSatisfied } from "../../../../../../cli/commands/github/checksCore.js";
import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { activity, depsFor, FAILED_CHECK, PASSED_CHECK, REPO, RUNNING_CHECK, snapshot } from "./harness.js";

describe("untilSatisfied", () => {
  it("ends a watch on the event its mode names, preferring CI over a review over a comment", () => {
    const all = { ci: true, commented: true, reviewed: true };
    expect(untilSatisfied({ ...all, until: "any" })).toBe("ci");
    expect(untilSatisfied({ ...all, ci: false, until: "any" })).toBe("review");
    expect(untilSatisfied({ ci: false, commented: true, reviewed: false, until: "any" })).toBe("comment");
    expect(untilSatisfied({ ...all, until: "ci" })).toBe("ci");
    expect(untilSatisfied({ ...all, until: "review" })).toBe("review");
  });

  it("keeps watching when the mode's own event did not arrive, and never ends a merge watch here", () => {
    expect(untilSatisfied({ ci: false, commented: true, reviewed: true, until: "ci" })).toBe(undefined);
    expect(untilSatisfied({ ci: true, commented: true, reviewed: false, until: "review" })).toBe(undefined);
    expect(untilSatisfied({ ci: false, commented: false, reviewed: false, until: "any" })).toBe(undefined);
    expect(untilSatisfied({ ci: true, commented: true, reviewed: true, until: "merge" })).toBe(undefined);
  });
});

describe("runGithubChecks — --until event mode", () => {
  const SINCE = "2026-09-03T00:00:00Z";
  const REVIEW = {
    author: "reviewbot",
    commitSha: "abc123",
    id: "r1",
    state: "APPROVED",
    submittedAt: "2026-09-03T00:05:00Z",
  };
  const COMMENT = { author: "alice", body: "ship it", bot: false, createdAt: "2026-09-03T00:06:00Z", id: "c1" };

  it("reports a CI FAIL verdict, not a PASS, when --until ci meets a missing required context", async () => {
    const out: string[] = [];
    const deps = depsFor({
      activities: [activity(), activity()],
      diagnostic: [],
      fetches: [
        { ...snapshot({ checks: [PASSED_CHECK] }), rollupState: "SUCCESS" },
        { ...snapshot({ checks: [PASSED_CHECK] }), rollupState: "SUCCESS" },
      ],
      out,
      required: ["build"],
    });

    const code = await runGithubChecks({
      deps,
      rest: ["--number", "9", "--until", "ci", "--since", SINCE, "--timeout-seconds", "100"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out.slice(1)).toEqual(["CI FAIL required context never ran: build on abc123", "WATCH-DONE ci-failed"]);
  });

  it("prints the armed line, stays silent on the baseline poll, then ends on the CI verdict", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const deps = depsFor({
      diagnostic,
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
      out,
    });
    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--until", "ci", "--since", SINCE] });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      `WATCH pr=9 repo=${REPO.owner}/${REPO.repo} until=ci since=${SINCE}`,
      "CI PASS 1/1 on abc123, main requires no status-check contexts",
      "WATCH-DONE ci-green",
    ]);
    expect(diagnostic).toEqual([]);
  });

  it("names the failing check and exits EXIT_EXPECTED_EMPTY on a red verdict", async () => {
    const out: string[] = [];
    const deps = depsFor({
      diagnostic: [],
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK, FAILED_CHECK] })],
      out,
    });
    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--until", "ci", "--since", SINCE] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out.slice(1)).toEqual(["CI FAIL test on abc123", "WATCH-DONE ci-failed"]);
  });

  it("--until review ends on the first new review and ignores the CI verdict", async () => {
    const out: string[] = [];
    const deps = depsFor({
      activities: [activity(), activity({ reviews: [REVIEW] })],
      diagnostic: [],
      fetches: [snapshot({ checks: [PASSED_CHECK] })],
      out,
    });
    const code = await runGithubChecks({ deps, rest: ["--number", "9", "--until", "review", "--since", SINCE] });
    expect(code).toBe(EXIT_OK);
    expect(out.slice(1)).toEqual([
      "REVIEW reviewbot APPROVED on abc123 at 2026-09-03T00:05:00Z",
      "CI PASS 1/1 on abc123, main requires no status-check contexts",
      "WATCH-DONE review",
    ]);
  });

  it("--until any ends on a comment, and a --until merge watch runs through it to the merge", async () => {
    const outAny: string[] = [];
    const anyCode = await runGithubChecks({
      deps: depsFor({
        activities: [activity(), activity({ comments: [COMMENT] })],
        diagnostic: [],
        fetches: [snapshot({ checks: [RUNNING_CHECK] })],
        out: outAny,
      }),
      rest: ["--number", "9", "--until", "any", "--since", SINCE],
    });
    expect(anyCode).toBe(EXIT_OK);
    expect(outAny.slice(1)).toEqual(["COMMENT alice at 2026-09-03T00:06:00Z: ship it", "WATCH-DONE comment"]);

    const outMerge: string[] = [];
    const mergeCode = await runGithubChecks({
      deps: depsFor({
        activities: [activity(), activity({ comments: [COMMENT] }), activity({ state: "MERGED" })],
        diagnostic: [],
        fetches: [snapshot({ checks: [PASSED_CHECK] })],
        out: outMerge,
      }),
      rest: ["--number", "9", "--until", "merge", "--since", SINCE],
    });
    expect(mergeCode).toBe(EXIT_OK);
    expect(outMerge.slice(1)).toEqual([
      "COMMENT alice at 2026-09-03T00:06:00Z: ship it",
      "CI PASS 1/1 on abc123, main requires no status-check contexts",
      "MERGED",
    ]);
  });

  it("announces a pushed head once and the new head's verdict once, never a stale one", async () => {
    const out: string[] = [];
    const deps = depsFor({
      activities: [activity(), activity(), activity({ headSha: "def456" }), activity({ headSha: "def456" })],
      diagnostic: [],
      fetches: [
        snapshot({ checks: [PASSED_CHECK] }),
        snapshot({ checks: [PASSED_CHECK] }),
        { ...snapshot({ checks: [RUNNING_CHECK] }), headSha: "def456" },
        { ...snapshot({ checks: [PASSED_CHECK] }), headSha: "def456" },
      ],
      out,
    });
    const code = await runGithubChecks({
      deps,
      rest: ["--number", "9", "--until", "merge", "--since", SINCE, "--timeout-seconds", "100"],
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out.slice(1)).toEqual([
      "CI PASS 1/1 on abc123, main requires no status-check contexts",
      "HEAD def456 pushed (was abc123) — CI and reviews restart",
      "CI PASS 1/1 on def456, main requires no status-check contexts",
      "WATCH-TIMEOUT pr=9 after 100s",
    ]);
  });

  it("surfaces an activity read failure as EXIT_ERROR", async () => {
    const diagnostic: string[] = [];
    const deps = depsFor({ diagnostic, fetches: [snapshot()], out: [] });
    const code = await runGithubChecks({
      deps: {
        ...deps,
        fetchActivity: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "no activity" }))),
      },
      rest: ["--number", "9", "--until", "any"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostic).toEqual(["no activity"]);
  });
});
