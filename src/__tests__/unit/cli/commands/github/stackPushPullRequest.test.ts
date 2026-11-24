/*
 * `resolveStackPushPullRequest`: the one read of the pushed branch's open pull request, as the pull request both
 * of `github stack push`'s description reviews describe. None open is `new`; one open onto the form's base is that
 * pull request; one onto another base, or a read that fails, is refused rather than guessed.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import { parsePrForm } from "../../../../../cli/commands/github/prFormParse.js";
import { type GithubStackPushPlan, githubStackPushPlan } from "../../../../../cli/commands/github/stackPushCore.js";
import { resolveStackPushPullRequest } from "../../../../../cli/commands/github/stackPushPullRequest.js";
import type { GithubWriteApi } from "../../../../../corpus/github/write.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { baseForm, LOCAL_SHA, PINNED_TREE, pr } from "./stackPushRun/fixtures.js";

/** The plan for a push of `top` onto `main` in `o/r`. */
function plan(): GithubStackPushPlan {
  return unwrap(
    githubStackPushPlan({
      facts: {
        amendPin: { kind: "pinned", tree: PINNED_TREE },
        branch: "top",
        defaultBranch: "main",
        headSha: LOCAL_SHA,
        repo: "o/r",
        repoRoot: "/repo",
      },
      form: unwrap(parsePrForm({ raw: baseForm({ base: "main" }) })),
    }),
  );
}

/**
 * A read that records what it was asked and answers `answer`.
 *
 * @returns the reader and every request it received
 */
function reader({ answer }: { answer: ReturnType<GithubWriteApi["findOpenPrByHead"]> }): {
  api: Pick<GithubWriteApi, "findOpenPrByHead">;
  asked: { head: string; owner: string; repo: string }[];
} {
  const asked: { head: string; owner: string; repo: string }[] = [];
  return {
    api: {
      findOpenPrByHead: ({ head, owner, repo }) => {
        asked.push({ head, owner, repo });
        return answer;
      },
    },
    asked,
  };
}

describe("resolveStackPushPullRequest", () => {
  it("answers new, after one read of the form's own head, when the branch has no open pull request", async () => {
    const { api, asked } = reader({ answer: okAsync(undefined) });
    const resolved = await resolveStackPushPullRequest({ api, plan: plan() });
    expect(unwrap(resolved)).toStrictEqual({ kind: "new" });
    expect(asked).toStrictEqual([{ head: "top", owner: "o", repo: "r" }]);
  });

  it("answers the open pull request when it is onto the form's base", async () => {
    const { api } = reader({ answer: okAsync(pr({ number: 42 })) });
    const resolved = await resolveStackPushPullRequest({ api, plan: plan() });
    expect(unwrap(resolved)).toStrictEqual({ kind: "existing", number: 42 });
  });

  it("refuses an open pull request onto another base, naming both", async () => {
    const { api } = reader({ answer: okAsync({ ...pr({ number: 42 }), baseRef: "release" }) });
    const resolved = await resolveStackPushPullRequest({ api, plan: plan() });
    expect(resolved.isErr()).toBe(true);
    expect(unwrapErr(resolved)).toStrictEqual(
      GithubVerbErrors.stackPushOpenPrBaseMismatch({
        actualBase: "release",
        expectedBase: "main",
        head: "top",
        number: 42,
      }),
    );
  });

  it("refuses with its own typed error when the read fails, never answering new", async () => {
    const { api } = reader({ answer: errAsync({ kind: "http", message: "rate limited", operation: "x" }) });
    const resolved = await resolveStackPushPullRequest({ api, plan: plan() });
    const error = unwrapErr(resolved);
    expect(error.code).toBe("STACK_PUSH_OPEN_PR_UNREAD");
    expect(error).toStrictEqual(
      GithubVerbErrors.stackPushOpenPrUnread({ cause: "rate limited", head: "top", repo: "o/r" }),
    );
  });
});
