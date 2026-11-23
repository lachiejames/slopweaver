/**
 * The queue-gate read over an injected credential read and queue API: one ordered event log of every token
 * read, client open and GitHub read, so each case pins how far the read got before it answered `undefined`
 * — the answer that leaves the `base-moved` refusal standing — and what it returns when both reads succeed.
 */
import { describe, expect, it } from "vitest";

import { readQueueGateVia } from "../../../../../cli/commands/github/queueGateRun.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { RequiredCheckContexts } from "../../../../../live/github/branchProtection.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { MergeQueueState } from "../../../../../live/github/mergeQueue.js";

const QUEUE: MergeQueueState = { branch: "main", url: "https://github.com/acme/widgets/queue/main" };

/** Edges answering the given token and reads, logging every call in order. */
function harness({
  token = "ghp_fake",
  queue = ok(QUEUE),
  contexts = ok({ branch: "main", contexts: ["ci / test", "ci / lint"], requiresCodeOwnerReviews: true }),
}: {
  /** The installed token; `null` for none (a default parameter would swallow an explicit `undefined`). */
  token?: string | null;
  queue?: Result<MergeQueueState | undefined, GithubLiveError>;
  contexts?: Result<RequiredCheckContexts, GithubLiveError>;
}): {
  events: string[];
  seams: Pick<Parameters<typeof readQueueGateVia>[0], "queueApiFor" | "tokenFor">;
} {
  const events: string[] = [];
  return {
    events,
    seams: {
      queueApiFor: ({ token: opened }) => {
        events.push(`open ${opened}`);
        return {
          queue: async ({ owner, repo, branch }) => {
            events.push(`queue ${owner} ${repo} ${branch}`);
            return queue;
          },
          requiredContexts: async ({ owner, repo, branch }) => {
            events.push(`contexts ${owner} ${repo} ${branch}`);
            return contexts;
          },
        };
      },
      tokenFor: ({ home }) => {
        events.push(`token ${home}`);
        if (token === null) {
          return undefined;
        }
        return token;
      },
    },
  };
}

const NOT_FOUND = GithubLiveErrors.notFound({ identity: "acme/widgets", kind: "repository" });

describe("readQueueGateVia", () => {
  it("returns the queue's URL and the branch's required contexts when both reads succeed", async () => {
    const { events, seams } = harness({});

    const gate = await readQueueGateVia({ branch: "main", home: "/h", repo: "acme/widgets", ...seams });

    expect(gate).toEqual({
      branch: "main",
      contexts: ["ci / test", "ci / lint"],
      url: "https://github.com/acme/widgets/queue/main",
    });
    expect(events).toEqual(["token /h", "open ghp_fake", "queue acme widgets main", "contexts acme widgets main"]);
  });

  it("returns an empty context list as read, for a queue that gates on nothing", async () => {
    const { seams } = harness({ contexts: ok({ branch: "main", contexts: [], requiresCodeOwnerReviews: undefined }) });

    const gate = await readQueueGateVia({ branch: "main", home: "/h", repo: "acme/widgets", ...seams });

    expect(gate).toEqual({ branch: "main", contexts: [], url: "https://github.com/acme/widgets/queue/main" });
  });

  it("answers undefined without opening a client when there is no token", async () => {
    const { events, seams } = harness({ token: null });

    const gate = await readQueueGateVia({ branch: "main", home: "/h", repo: "acme/widgets", ...seams });

    expect(gate).toBe(undefined);
    expect(events).toEqual(["token /h"]);
  });

  it.each(["acme", "/widgets", "acme/", "acme/widgets/extra", ""])(
    "answers undefined without opening a client for the malformed slug %j",
    async (repo) => {
      const { events, seams } = harness({});

      const gate = await readQueueGateVia({ branch: "main", home: "/h", repo, ...seams });

      expect(gate).toBe(undefined);
      expect(events).toEqual(["token /h"]);
    },
  );

  it("answers undefined, reading no contexts, when the queue read fails", async () => {
    const { events, seams } = harness({ queue: err(NOT_FOUND) });

    const gate = await readQueueGateVia({ branch: "main", home: "/h", repo: "acme/widgets", ...seams });

    expect(gate).toBe(undefined);
    expect(events).toEqual(["token /h", "open ghp_fake", "queue acme widgets main"]);
  });

  it("answers undefined, reading no contexts, when the branch has no merge queue", async () => {
    const { events, seams } = harness({ queue: ok(undefined) });

    const gate = await readQueueGateVia({ branch: "main", home: "/h", repo: "acme/widgets", ...seams });

    expect(gate).toBe(undefined);
    expect(events).toEqual(["token /h", "open ghp_fake", "queue acme widgets main"]);
  });

  it("answers undefined when the required-contexts read fails", async () => {
    const { events, seams } = harness({ contexts: err(NOT_FOUND) });

    const gate = await readQueueGateVia({ branch: "main", home: "/h", repo: "acme/widgets", ...seams });

    expect(gate).toBe(undefined);
    expect(events).toEqual(["token /h", "open ghp_fake", "queue acme widgets main", "contexts acme widgets main"]);
  });
});
