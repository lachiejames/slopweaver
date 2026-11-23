/*
 * `github merge --admin` reads its pull request over REST, which carries no base commit, so the base comes from
 * a second, GraphQL read. `withBaseCommit` pairs the two and refuses a pair taken across a push.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { MergeQueuePrState } from "../../../../live/github/mergeQueue.js";
import { type AdminMergePr, withBaseCommit, withStackQueue } from "../../../../outbound/github/adminMerge.js";

/** The REST half: everything but the base commit. */
const REST_PR: Omit<AdminMergePr, "baseSha" | "stack" | "stackQueue"> = {
  baseRef: "main",
  body: "",
  draft: false,
  headRef: "feature",
  headSha: "cafe1234",
  number: 9,
  state: "open",
  title: "a title",
  url: "https://example.invalid/pr/9",
};

/** The GraphQL half, with the head and the base branch it saw. */
function state({ baseRefName = "main", headOid }: { baseRefName?: string; headOid: string }): MergeQueuePrState {
  return {
    approvedBy: [],
    baseRefName,
    baseRefOid: "ba5e0000",
    body: "",
    checks: {
      baseRef: "main",
      checks: [],
      headSha: headOid,
      mergeable: undefined,
      residue: [],
      rollupState: "SUCCESS",
      supersededChecks: [],
      truncated: false,
    },
    codeownerRequests: [],
    codeownerRequestsTruncated: false,
    entry: undefined,
    githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
    headOid,
    headRefName: "feature",
    isDraft: false,
    mergeable: "MERGEABLE",
    nodeId: "PR_kwabc",
    number: 9,
    reviewDecision: "APPROVED",
    stack: undefined,
    state: "OPEN",
    url: "https://example.invalid/pr/9",
  };
}

describe("withStackQueue", () => {
  const PAIRED = { ...REST_PR, baseSha: "ba5e0000" };
  const STACK = { baseRefName: "main", number: 900, position: 2, size: 3 };
  const QUEUE = { branch: "main", url: "https://example.invalid/queue/main" };

  it("reads no queue for a pull request in no stack", async () => {
    const asked: string[] = [];
    const queue = ({ branch }: { branch: string }) => {
      asked.push(branch);
      return Promise.resolve(ok(QUEUE));
    };
    const read = await withStackQueue({ owner: "o", pr: { ...PAIRED, stack: undefined }, queue, repo: "n" });

    expect(unwrap(read)).toStrictEqual({ ...PAIRED, stack: undefined, stackQueue: undefined });
    expect(asked).toEqual([]);
  });

  it("reads the queue on the branch the STACK lands on, not the pull request's own base", async () => {
    const asked: string[] = [];
    const queue = ({ branch }: { branch: string }) => {
      asked.push(branch);
      return Promise.resolve(ok(undefined));
    };
    const pr = { ...PAIRED, baseRef: "stack-member-below", stack: STACK };
    const read = await withStackQueue({ owner: "o", pr, queue, repo: "n" });

    expect(unwrap(read)).toStrictEqual({ ...pr, stackQueue: undefined });
    expect(asked).toEqual(["main"]);
  });

  it("carries a queue the stack's base has", async () => {
    const queue = () => Promise.resolve(ok(QUEUE));
    const read = await withStackQueue({ owner: "o", pr: { ...PAIRED, stack: STACK }, queue, repo: "n" });

    expect(unwrap(read)).toStrictEqual({ ...PAIRED, stack: STACK, stackQueue: QUEUE });
  });

  it("fails the read when the queue cannot be read, rather than treating the base as queueless", async () => {
    const queue = () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "queue read failed: boom" })));
    const read = await withStackQueue({ owner: "o", pr: { ...PAIRED, stack: STACK }, queue, repo: "n" });

    expect(unwrapErr(read)).toStrictEqual({
      kind: "http",
      message: "queue read failed: boom",
      operation: "github.adminMerge.baseCommit",
      provider: "github",
    });
  });
});

describe("withBaseCommit", () => {
  it("carries GitHub's base commit and body onto the pull request when both reads saw the same head", () => {
    const paired = withBaseCommit({
      pr: REST_PR,
      state: { ...state({ headOid: "cafe1234" }), body: "## Codex review leftovers" },
    });

    expect(paired.isOk()).toBe(true);
    expect(unwrap(paired)).toStrictEqual({
      ...REST_PR,
      baseSha: "ba5e0000",
      body: "## Codex review leftovers",
      stack: undefined,
    });
  });

  it("carries the native stack GitHub reported, so the merge can refuse a member it cannot land", () => {
    const stack = { baseRefName: "main", number: 900, position: 2, size: 3 };
    const paired = withBaseCommit({ pr: REST_PR, state: { ...state({ headOid: "cafe1234" }), stack } });

    expect(unwrap(paired)).toStrictEqual({ ...REST_PR, baseSha: "ba5e0000", body: "", stack });
  });

  it("refuses a pair taken across a push, naming both heads", () => {
    const paired = withBaseCommit({ pr: REST_PR, state: state({ headOid: "beef5678" }) });

    expect(paired.isErr()).toBe(true);
    expect(unwrapErr(paired)).toStrictEqual({
      kind: "http",
      message: "the head moved between two reads (cafe1234, then beef5678); run the merge again",
      operation: "github.adminMerge.baseCommit",
      provider: "github",
    });
  });

  it("refuses a pair taken across a retarget, so a bump is never judged against a branch the merge skips", () => {
    const paired = withBaseCommit({ pr: REST_PR, state: state({ baseRefName: "staging", headOid: "cafe1234" }) });

    expect(paired.isErr()).toBe(true);
    expect(unwrapErr(paired)).toStrictEqual({
      kind: "http",
      message: "the base was retargeted between two reads (main, then staging); run the merge again",
      operation: "github.adminMerge.baseCommit",
      provider: "github",
    });
  });
});
