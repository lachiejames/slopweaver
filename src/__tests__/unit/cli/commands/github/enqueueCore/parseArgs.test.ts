/* `slopweaver github enqueue`'s argument parser: the flags it takes, and the usage problems it refuses. */
import { describe, expect, it } from "vitest";

import {
  GITHUB_ENQUEUE_FLAG_NAMES,
  GITHUB_ENQUEUE_FLAGS,
  parseGithubEnqueueArgs,
} from "../../../../../../cli/commands/github/enqueueArgs.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

describe("parseGithubEnqueueArgs", () => {
  it("parses the minimal invocation", () => {
    const parsed = unwrap(parseGithubEnqueueArgs({ rest: ["--pr", "9", "--repo", "acme/widget"] }));
    expect(parsed.owner).toBe("acme");
    expect(parsed.repo).toBe("widget");
    expect(parsed.number).toBe(9);
    expect(parsed.dequeue).toBe(false);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.acknowledge).toEqual([]);
  });

  it("splits --acknowledge on commas and trims each subject", () => {
    const parsed = unwrap(
      parseGithubEnqueueArgs({
        rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge", " ci-not-green , not-mergeable "],
      }),
    );
    expect(parsed.acknowledge).toEqual(["ci-not-green", "not-mergeable"]);
  });

  it("refuses --acknowledge-all with no --reason", () => {
    const problems = unwrapErr(
      parseGithubEnqueueArgs({ rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge-all"] }),
    );
    expect(problems).toEqual([
      '--acknowledge-all must be paired with --reason "…" explaining why every finding is accepted',
    ]);
  });

  it("refuses --acknowledge ci-rollup-superseded with no --reason, the run id being what reaches the ledger", () => {
    const problems = unwrapErr(
      parseGithubEnqueueArgs({
        rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge", "ci-rollup-superseded"],
      }),
    );
    expect(problems).toEqual([
      '--acknowledge ci-rollup-superseded must be paired with --reason "…" — the reason is written to the ' +
        "door ledger, so a waived finding stays findable afterwards",
    ]);
  });

  it("refuses --acknowledge private-terms-unchecked with no --reason, since no scan ran to stand behind it", () => {
    const problems = unwrapErr(
      parseGithubEnqueueArgs({
        rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge", "private-terms-unchecked"],
      }),
    );
    expect(problems).toEqual([
      '--acknowledge private-terms-unchecked must be paired with --reason "…" — the reason is written to the ' +
        "door ledger, so a waived finding stays findable afterwards",
    ]);
  });

  it("names BOTH reason-requiring subjects when both were acknowledged bare", () => {
    const problems = unwrapErr(
      parseGithubEnqueueArgs({
        rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge", "codex-loop-incomplete,ci-rollup-superseded"],
      }),
    );
    expect(problems.length).toBe(2);
    expect(problems[0]).toContain("--acknowledge codex-loop-incomplete must be paired with");
    expect(problems[1]).toContain("--acknowledge ci-rollup-superseded must be paired with");
  });

  it("accepts ci-rollup-superseded once --reason names the replacing run", () => {
    const parsed = unwrap(
      parseGithubEnqueueArgs({
        rest: [
          "--pr",
          "9",
          "--repo",
          "acme/widget",
          "--acknowledge",
          "ci-rollup-superseded",
          "--reason",
          "replaced by run 33717812345",
        ],
      }),
    );
    expect(parsed.acknowledge).toEqual(["ci-rollup-superseded"]);
    expect(parsed.reason).toBe("replaced by run 33717812345");
  });

  it("accepts --acknowledge-all once --reason is supplied", () => {
    const parsed = unwrap(
      parseGithubEnqueueArgs({
        rest: ["--pr", "9", "--repo", "acme/widget", "--acknowledge-all", "--reason", "sole codeowner"],
      }),
    );
    expect(parsed.acknowledgeAll).toBe(true);
    expect(parsed.reason).toBe("sole codeowner");
  });

  it("reports every usage problem at once", () => {
    const problems = unwrapErr(parseGithubEnqueueArgs({ rest: ["--pr", "0", "--repo", "not-a-slug"] }));
    expect(problems).toEqual(["--repo owner/name is required", "--pr must be a positive whole number"]);
  });

  it("advertises exactly the flags GITHUB_ENQUEUE_FLAG_NAMES declares", () => {
    expect(GITHUB_ENQUEUE_FLAG_NAMES.toSorted()).toEqual(
      [...GITHUB_ENQUEUE_FLAGS.string!, ...GITHUB_ENQUEUE_FLAGS.boolean!].map((name) => `--${name}`).toSorted(),
    );
  });
});
