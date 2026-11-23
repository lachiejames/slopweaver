/** What a run leaves in the ledger: one checks-read per invocation, and a watching/watch-done pair per `--wait`. */
import { describe, expect, it } from "vitest";

import { err } from "#lib/result.js";
import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { depsFor, PASSED_CHECK, RUNNING_CHECK, snapshot, type WatchWitness } from "./harness.js";

describe("runGithubChecks", () => {
  it("records the checks-read ONCE per invocation, from the first snapshot, however many times --wait polls", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const reads: { repo: string; number: number; headSha: string; rollup: string }[] = [];

    // Two polls, two snapshots, ONE row: the obligation `github stack push` left behind is "somebody went and
    // looked", which the first successful read settles. A row per poll would bury the raises the gate reads.
    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic,
        fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
        out,
        reads,
      }),
      rest: ["--number", "16415", "--wait"],
    });

    expect(code).toBe(EXIT_OK);
    expect(reads).toEqual([{ headSha: "abc123", number: 16415, repo: "acme/widget", rollup: "PENDING" }]);
  });

  it("a --wait run records that it is watching on its first read, and that it stopped, against the head it saw", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const watches: WatchWitness[] = [];

    const code = await runGithubChecks({
      deps: depsFor({
        diagnostic,
        fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
        out,
        watches,
      }),
      rest: ["--number", "16415", "--wait", "--timeout-seconds", "90"],
    });

    expect(code).toBe(EXIT_OK);
    expect(watches).toEqual([
      { headSha: "abc123", kind: "watching", mode: "wait", number: 16415, timeoutSeconds: 90 },
      { headSha: "abc123", kind: "watch-done", number: 16415, outcome: "done" },
    ]);
  });

  it("a --wait run that times out records a watch-done saying it stopped, never a silent open watcher", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const watches: WatchWitness[] = [];

    const code = await runGithubChecks({
      deps: depsFor({ diagnostic, fetches: [snapshot({ checks: [RUNNING_CHECK] })], out, watches }),
      rest: ["--number", "9", "--wait", "--timeout-seconds", "15"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(watches.map((row) => row.kind)).toEqual(["watching", "watch-done"]);
    expect(watches[1]).toEqual({ headSha: "abc123", kind: "watch-done", number: 9, outcome: "stopped" });
  });

  it("a one-shot read records no watch row at all: nobody is watching", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const watches: WatchWitness[] = [];

    const code = await runGithubChecks({
      deps: depsFor({ diagnostic, fetches: [snapshot({ checks: [PASSED_CHECK] })], out, watches }),
      rest: ["--number", "16415"],
    });

    expect(code).toBe(EXIT_OK);
    expect(watches).toEqual([]);
  });

  it("records no checks-read at all when the fetch failed, so an unread pull request stays unread", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const reads: { repo: string; number: number; headSha: string; rollup: string }[] = [];

    const code = await runGithubChecks({
      deps: {
        ...depsFor({ diagnostic, fetches: [snapshot()], out, reads }),
        fetchChecks: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "github graphql failed" }))),
      },
      rest: ["--number", "16415"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(reads).toEqual([]);
  });
});
