/**
 * The github verb directory's typed failures: every fragment composes into the one factory, each factory
 * renders the exact line the string list it replaced printed, and the lines helper gives a list-carrying
 * variant back one line per problem.
 */
import { describe, expect, it } from "vitest";
import { githubArgsErrorFactories } from "../../../../../cli/commands/github/argsErrors.js";
import { GithubVerbErrors, githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { githubPrErrorFactories } from "../../../../../cli/commands/github/prErrors.js";
import { githubPushErrorFactories } from "../../../../../cli/commands/github/pushErrors.js";
import { githubRepoErrorFactories } from "../../../../../cli/commands/github/repoErrors.js";
import { githubRepoLifecycleErrorFactories } from "../../../../../cli/commands/github/repoLifecycleErrors.js";
import { githubRepoManifestErrorFactories } from "../../../../../cli/commands/github/repoManifestErrors.js";
import { GithubReviewerErrors } from "../../../../../cli/commands/github/reviewerErrors.js";
import { githubReviewerErrorLines } from "../../../../../cli/commands/github/reviewerRun.js";
import { githubStackErrorFactories } from "../../../../../cli/commands/github/stackErrors.js";

const FRAGMENTS = [
  githubArgsErrorFactories,
  githubPrErrorFactories,
  githubPushErrorFactories,
  githubRepoErrorFactories,
  githubRepoLifecycleErrorFactories,
  githubRepoManifestErrorFactories,
  githubStackErrorFactories,
];

describe("GithubVerbErrors", () => {
  it("is exactly the seven fragments composed, with no name shadowed by another fragment", () => {
    const names = FRAGMENTS.flatMap((fragment) => Object.keys(fragment));
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(GithubVerbErrors).toSorted()).toEqual(names.toSorted());
  });

  it("renders an invocation refusal as the line the verb printed", () => {
    expect(GithubVerbErrors.searchLimitOutOfRange({ got: "0", max: 100 })).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--limit",
      got: "0",
      message: "--limit must be an integer from 1 to 100",
    });
    expect(GithubVerbErrors.usage({ command: "stack", shape: "<audit|adopt>" }).message).toBe(
      "usage: slopweaver github stack <audit|adopt> [...]",
    );
    expect(GithubVerbErrors.flagNotJson({ cause: new Error("Unexpected token"), flag: "--edit" }).message).toBe(
      "--edit is not valid JSON: Unexpected token",
    );
  });

  it("renders a provider or pull-request failure as the line the verb printed", () => {
    expect(GithubVerbErrors.prUnread({ cause: "404", number: 7, owner: "acme", repo: "app" })).toEqual({
      code: "READ_FAILED",
      message: "could not read acme/app#7: 404",
      subject: "acme/app#7",
    });
    expect(GithubVerbErrors.reviewRequestUnconfirmed({ missing: ["alice", "bob"], number: 3 }).message).toBe(
      "GitHub accepted the review request for #3 but the read-back is missing alice, bob",
    );
  });

  it("renders a push or hook failure as the line the verb printed", () => {
    expect(GithubVerbErrors.hookExited({ hook: ".husky/pre-push", status: 1 })).toEqual({
      code: "PRE_PUSH_FAILED",
      hook: ".husky/pre-push",
      message: ".husky/pre-push exited 1",
    });
    expect(GithubVerbErrors.remoteShaInvalid({ ref: "refs/heads/main" }).message).toBe(
      "the remote reported an invalid SHA for refs/heads/main",
    );
  });

  // A hook stopped at its bound is a different correction from one that failed: look for the prompt it sat on.
  it("renders a hook stopped at its bound as a timeout naming the minutes, not as a failure verdict", () => {
    expect(GithubVerbErrors.hookTimedOut({ hook: ".husky/pre-push", timeoutMs: 1_800_000 })).toEqual({
      code: "PRE_PUSH_FAILED",
      hook: ".husky/pre-push",
      message:
        ".husky/pre-push was still running after 30 minutes, so it was stopped before it reached a verdict; " +
        "nothing was sent. Look above for a prompt it was waiting on.",
    });
  });

  it("renders a stack or Git failure as the line the verb printed", () => {
    expect(GithubVerbErrors.revListUnparsed({ cwd: "/repo", text: "nope" })).toEqual({
      code: "GIT_FAILED",
      message: 'git rev-list --count answered "nope" in /repo',
      operation: "rev-list --count",
    });
    expect(GithubVerbErrors.worktreeAmbiguous({ branch: "feat", paths: ["/a", "/b"] }).message).toBe(
      "feat is checked out in more than one worktree: /a, /b",
    );
  });

  it("names everything a stack registration's read-back observed", () => {
    const error = GithubVerbErrors.registrationUnconfirmed({
      observed: {
        childBase: "parent",
        childNumber: 12,
        childStack: "none",
        entryNumbers: [11, 12],
        expectedStackNumber: 4,
        failures: ["child is not in the stack", "parent head moved"],
        parentHead: "parent",
        parentNumber: 11,
        parentStack: "4",
        stackNumber: 4,
      },
    });
    expect(error.message).toBe(
      "child is not in the stack; parent head moved. Observed: expected stack #4; child #12 stack none; " +
        "parent #11 stack 4; fetched stack #4 entries [#11, #12]; child base parent; parent head parent. " +
        "No local enrolment was written.",
    );
    expect(error.subject).toBe("#12");
  });

  it("builds a base-freshness refusal with its remedy and acknowledgement line", () => {
    const refusal = GithubVerbErrors.freshnessRefused({
      detail: "base moved",
      pairing: ' --reason "…"',
      remedy: ["rebase first"],
      subject: "base-moved",
    });
    expect(refusal.reasons).toEqual([
      "refused: base-moved: base moved",
      "rebase first",
      'accept with --acknowledge base-moved --reason "…", or every finding with --acknowledge-all --reason "…"',
    ]);
    expect(GithubVerbErrors.freshnessWarned({ refusal, warning: ["stale fetch"] }).reasons).toEqual([
      ...refusal.reasons,
      "stale fetch",
    ]);
  });
});

describe("githubVerbErrorLines", () => {
  it("gives a list-carrying variant back one line per problem", () => {
    const reasons = ["unknown flag --x", "unknown flag --y"];
    expect(githubVerbErrorLines({ error: GithubVerbErrors.flagsRefused({ reasons }) })).toEqual(reasons);
    expect(githubVerbErrorLines({ error: GithubVerbErrors.argumentsRefused({ reasons }) })).toEqual(reasons);
    expect(githubVerbErrorLines({ error: GithubVerbErrors.formInvalid({ form: "--form", reasons }) })).toEqual(reasons);
    expect(githubVerbErrorLines({ error: GithubVerbErrors.upstreamRefused({ operation: "git", reasons }) })).toEqual(
      reasons,
    );
    expect(
      githubVerbErrorLines({ error: GithubVerbErrors.freshnessUnpaired({ detail: "d", subject: "base-moved" }) }),
    ).toEqual([
      "refused: base-moved: d",
      '--acknowledge base-moved must be paired with --reason "…" naming which deliberate re-land this is',
    ]);
  });

  it("joins a list variant's reasons into its single-line message", () => {
    expect(GithubVerbErrors.flagsRefused({ reasons: ["a", "b"] }).message).toBe("a; b");
  });

  it("gives any other variant back as its one message line", () => {
    expect(githubVerbErrorLines({ error: GithubVerbErrors.prRequired() })).toEqual(["--pr is required"]);
  });

  it("withholds a form refusal that would quote a credential shape, in its lines and its message", () => {
    // A synthetic token built at runtime, so no credential shape sits in this file's source.
    const token = `ghp_${"a".repeat(30)}`;
    const withheld =
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
      "the secret scan names, and the refusal prints in full";
    const invalid = GithubVerbErrors.formInvalid({ form: "--form", reasons: ["title: fine", `explainer: ${token}`] });
    expect(githubVerbErrorLines({ error: invalid })).toEqual(["title: fine", withheld]);
    expect(invalid.message.includes(token)).toBe(false);
    const notJson = GithubVerbErrors.formNotJson({ cause: new Error(`Unexpected token in "${token}"`) });
    expect(notJson.message).toBe(`the form is not valid JSON: ${withheld}`);
    const flagNotJson = GithubVerbErrors.flagNotJson({
      cause: new Error(`Unexpected token in "${token}"`),
      flag: "--edit",
    });
    expect(flagNotJson.message).toBe(`--edit is not valid JSON: ${withheld}`);
  });
});

describe("githubReviewerErrorLines", () => {
  it("gives a usage refusal back one line per problem", () => {
    const error = GithubReviewerErrors.usage({ reasons: ["--repo is required", "--number is required"] });
    expect(error.message).toBe("--repo is required; --number is required");
    expect(githubReviewerErrorLines({ error })).toEqual(["--repo is required", "--number is required"]);
  });

  it("gives any other refusal back as its one message line", () => {
    expect(githubReviewerErrorLines({ error: GithubReviewerErrors.notInReading({ target: "#9" }) })).toEqual([
      "#9 is not an open pull request in the last github landing reading",
    ]);
  });
});
