/*
 * The two reads `github pr request-review` makes: a success passes the provider's value through untouched, and a
 * provider failure becomes the command's own typed error, built through the same factory the verb's callers use.
 * The api is a plain fake carrying only the method each read calls.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { parseGithubPrRequestReviewArgs } from "../../../../../cli/commands/github/requestReviewCore.js";
import { readPr, readRequested } from "../../../../../cli/commands/github/requestReviewReads.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HTTP_ERROR = { kind: "http" as const, message: "unreachable", operation: "x" };

const PR: WrittenPr = {
  authorId: 1,
  baseRef: "main",
  baseRepoFullName: "o/r",
  body: "b",
  commits: 1,
  draft: false,
  head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "1111111111111111111111111111111111111111" },
  htmlUrl: "https://example.invalid/pr/7",
  mergedAtIso: undefined,
  nodeId: "PR_7",
  number: 7,
  stack: undefined,
  state: "open",
  title: "t",
  updatedAtIso: "2026-08-10T00:00:00Z",
};

const ARGS = unwrap(
  parseGithubPrRequestReviewArgs({ rest: ["--repo", "o/r", "--number", "7", "--reviewer", "ada", "--dry-run"] }),
);

describe("readPr", () => {
  it("passes the pull request through", async () => {
    const read = await readPr({ api: { getPr: () => okAsync(PR) }, args: ARGS });
    expect(unwrap(read)).toEqual(PR);
  });

  it("names the unread pull request when the provider refuses", async () => {
    const read = await readPr({ api: { getPr: () => errAsync(HTTP_ERROR) }, args: ARGS });
    expect(unwrapErr(read)).toEqual(
      GithubVerbErrors.prUnread({ cause: "unreachable", number: 7, owner: "o", repo: "r" }),
    );
  });
});

describe("readRequested", () => {
  it("passes the requested reviewers through", async () => {
    const read = await readRequested({
      api: { requestedReviewers: () => okAsync({ teams: ["core"], users: ["ada-gh"] }) },
      args: ARGS,
    });
    expect(unwrap(read)).toEqual({ teams: ["core"], users: ["ada-gh"] });
  });

  it("reports the provider's refusal as an upstream refusal of that read", async () => {
    const read = await readRequested({ api: { requestedReviewers: () => errAsync(HTTP_ERROR) }, args: ARGS });
    expect(unwrapErr(read)).toEqual(
      GithubVerbErrors.upstreamRefused({ operation: "requested reviewers", reasons: ["unreachable"] }),
    );
  });
});
