/** The failures that end a run before or at its first read: a usage refusal, no repository, a failed fetch. */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import { runGithubChecks } from "../../../../../../cli/commands/github/checksRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { GithubJobLogErrors } from "../../../../../../live/github/jobLogErrors.js";
import { activity, REPO, snapshot } from "./harness.js";

describe("runGithubChecks", () => {
  it("refuses a missing --number with usage, before repo resolution or a fetch", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    let resolveRepoCalled = false;
    let fetchCalled = false;

    const code = await runGithubChecks({
      deps: {
        fetchActivity: () => Promise.resolve(ok(activity())),
        fetchChecks: () => {
          fetchCalled = true;
          return Promise.resolve(ok(snapshot()));
        },
        fetchRequiredContexts: ({ branch }) =>
          Promise.resolve(ok({ branch, contexts: [], requiresCodeOwnerReviews: undefined })),
        now: () => new Date(0),
        readJobLogs: () => Promise.resolve(err(GithubJobLogErrors.runNotFound({ runId: 0 }))),
        recordChecksRead: () => {},
        recordWatchDone: () => {},
        recordWatching: () => {},
        resolveRepo: () => {
          resolveRepoCalled = true;
          return ok(REPO);
        },
        sleep: () => Promise.resolve(),
        writeDiagnostic: (line) => diagnostic.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: [],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(resolveRepoCalled).toBe(false);
    expect(fetchCalled).toBe(false);
    expect(diagnostic[0]).toBe("--number must be a positive whole number");
  });

  it("surfaces a repo-resolution failure without fetching", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    let fetchCalled = false;

    const code = await runGithubChecks({
      deps: {
        fetchActivity: () => Promise.resolve(ok(activity())),
        fetchChecks: () => {
          fetchCalled = true;
          return Promise.resolve(ok(snapshot()));
        },
        fetchRequiredContexts: ({ branch }) =>
          Promise.resolve(ok({ branch, contexts: [], requiresCodeOwnerReviews: undefined })),
        now: () => new Date(0),
        readJobLogs: () => Promise.resolve(err(GithubJobLogErrors.runNotFound({ runId: 0 }))),
        recordChecksRead: () => {},
        recordWatchDone: () => {},
        recordWatching: () => {},
        resolveRepo: () => err(["no `origin` git remote found — pass --repo owner/repo, or run inside a git checkout"]),
        sleep: () => Promise.resolve(),
        writeDiagnostic: (line) => diagnostic.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(fetchCalled).toBe(false);
    expect(diagnostic).toEqual(["no `origin` git remote found — pass --repo owner/repo, or run inside a git checkout"]);
  });

  it("surfaces a fetch failure as EXIT_ERROR", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubChecks({
      deps: {
        fetchActivity: () => Promise.resolve(ok(activity())),
        fetchChecks: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "github graphql failed" }))),
        fetchRequiredContexts: ({ branch }) =>
          Promise.resolve(ok({ branch, contexts: [], requiresCodeOwnerReviews: undefined })),
        now: () => new Date(0),
        readJobLogs: () => Promise.resolve(err(GithubJobLogErrors.runNotFound({ runId: 0 }))),
        recordChecksRead: () => {},
        recordWatchDone: () => {},
        recordWatching: () => {},
        resolveRepo: () => ok(REPO),
        sleep: () => Promise.resolve(),
        writeDiagnostic: (line) => diagnostic.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["--number", "9"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostic).toEqual(["github graphql failed"]);
    expect(out).toEqual([]);
  });
});
