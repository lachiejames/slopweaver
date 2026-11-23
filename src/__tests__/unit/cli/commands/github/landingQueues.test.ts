/*
 * The per-BRANCH queue read. The property: one provider call per distinct base branch however many pull
 * requests share it, and a failure on one branch reads `unread` for that branch alone.
 */

import { describe, expect, it } from "vitest";

import { type QueueFor, queueAvailabilityOf, readQueues } from "../../../../../cli/commands/github/landingQueues.js";
import { err, ok } from "../../../../../lib/result.js";

describe("readQueues", () => {
  it("asks once per base branch and keeps a failed branch's answer to itself", async () => {
    const asked: string[] = [];
    const queueFor: QueueFor = async ({ owner, repo, branch }) => {
      asked.push(`${owner}/${repo}#${branch}`);
      if (repo === "broken") {
        return err(["the read failed"]);
      }
      return ok({ kind: "queue", url: `https://github.com/${owner}/${repo}/queue/${branch}` });
    };
    const answers = await readQueues({
      home: undefined,
      queueFor,
      states: [
        { baseRefName: "main", repoSlug: "o/r" },
        { baseRefName: "main", repoSlug: "o/r" },
        { baseRefName: "main", repoSlug: "o/broken" },
        { baseRefName: "main", repoSlug: "not-a-slug" },
        { baseRefName: "", repoSlug: "o/r" },
      ],
    });
    expect(asked).toStrictEqual(["o/r#main", "o/broken#main"]);
    expect(queueAvailabilityOf({ queues: answers, state: { baseRefName: "main", repoSlug: "o/r" } })).toStrictEqual({
      kind: "queue",
      url: "https://github.com/o/r/queue/main",
    });
    expect(
      queueAvailabilityOf({ queues: answers, state: { baseRefName: "main", repoSlug: "o/broken" } }),
    ).toStrictEqual({
      kind: "unread",
      why: "the read failed",
    });
    expect(
      queueAvailabilityOf({ queues: answers, state: { baseRefName: "main", repoSlug: "not-a-slug" } }),
    ).toStrictEqual({
      kind: "unread",
      why: "not-a-slug is not an owner/name slug",
    });
    expect(answers.size).toBe(3);
  });
});

describe("queueAvailabilityOf", () => {
  it("reads a branch this run never asked about as unread, naming that no read was made", () => {
    expect(queueAvailabilityOf({ queues: new Map(), state: { baseRefName: "", repoSlug: "o/r" } })).toStrictEqual({
      kind: "unread",
      why: "this run made no queue read for that base branch",
    });
  });
});
