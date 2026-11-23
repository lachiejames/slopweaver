import { errAsync, ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { threadRepeatRefusal } from "../../../../../cli/commands/github/threadRepeatGuard.js";
import type { GithubThreadApi, ReviewThreadComments } from "../../../../../outbound/github/threads.js";

const SELF = "octocat";

/** A plain fake whose only live member is the thread read, recording each thread it is asked for. */
function readOnly({ thread, reads }: { thread: ReviewThreadComments; reads: string[] }): GithubThreadApi {
  const unused = errAsync({ kind: "http" as const, message: "unused", operation: "x" });
  return {
    answer: () => unused,
    comments: ({ threadId }) => {
      reads.push(threadId);
      return ResultAsync.fromSafePromise(Promise.resolve(thread));
    },
    list: () => unused,
    pullRequestId: () => unused,
    reopen: () => unused,
  };
}

describe("threadRepeatRefusal", () => {
  it("lets a reply go when the reviewer spoke after this identity's last reply", async () => {
    const reads: string[] = [];
    const thread: ReviewThreadComments = {
      comments: [
        { author: "quinn", createdAt: "2026-09-28T03:00:00Z", url: "https://github.com/o/r/pull/7#r1" },
        { author: SELF, createdAt: "2026-09-28T05:31:00Z", url: "https://github.com/o/r/pull/7#r2" },
        { author: "quinn", createdAt: "2026-09-28T07:00:00Z", url: "https://github.com/o/r/pull/7#r3" },
      ],
      viewer: SELF,
    };
    const refusal = await threadRepeatRefusal({ api: readOnly({ reads, thread }), hatchIsOpen: false, threadId: "T" });

    expect(refusal).toBeUndefined();
    expect(reads).toEqual(["T"]);
  });

  it("names the earlier reply's URL and time in the four-line refusal", async () => {
    const thread: ReviewThreadComments = {
      comments: [
        { author: "quinn", createdAt: "2026-09-28T03:00:00Z", url: "https://github.com/o/r/pull/7#r1" },
        { author: SELF, createdAt: "2026-09-28T05:31:00Z", url: "https://github.com/o/r/pull/7#r2" },
      ],
      viewer: SELF,
    };
    const refusal = await threadRepeatRefusal({
      api: readOnly({ reads: [], thread }),
      hatchIsOpen: false,
      threadId: "T",
    });

    expect(refusal!.split("\n")).toHaveLength(4);
    expect(refusal).toContain(
      "(@octocat already replied in thread T at 2026-09-28T05:31:00Z, and nobody has commented since: " +
        "https://github.com/o/r/pull/7#r2).",
    );
  });

  it("never reads the thread when the hatch is open", async () => {
    const reads: string[] = [];
    const refusal = await threadRepeatRefusal({
      api: readOnly({ reads, thread: { comments: [], viewer: SELF } }),
      hatchIsOpen: true,
      threadId: "T",
    });

    expect(refusal).toBeUndefined();
    expect(reads).toEqual([]);
  });
});
