import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import { makeFetchGithubAsyncMerge } from "../../../../live/github/mergeAsync.js";
import type { GithubReadRest } from "../../../../live/github/read.js";

/** What one fake REST seam was asked for. */
interface Asked {
  route: string;
  params: Readonly<Record<string, unknown>>;
}

/** A REST seam that records the call and answers one canned Octokit-shaped response. */
function recordingRest({ asked, data }: { asked: Asked[]; data: unknown }): GithubReadRest {
  return async ({ route, params }) => {
    asked.push({ params, route });
    return ok({ data, status: 200 });
  };
}

describe("makeFetchGithubAsyncMerge", () => {
  it("addresses GitHub's documented poll route with the pull request and the request's own uuid", async () => {
    const asked: Asked[] = [];
    const fetch = makeFetchGithubAsyncMerge({
      rest: recordingRest({ asked, data: { details: { message: "still going", uuid: "req-9" }, status: "pending" } }),
    });

    const state = unwrap(await fetch({ number: 16_378, owner: "acme", repo: "acme-admin", uuid: "req-9" }));

    expect(asked).toStrictEqual([
      {
        params: { owner: "acme", pull_number: 16_378, repo: "acme-admin", uuid: "req-9" },
        route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}",
      },
    ]);
    expect(state).toStrictEqual({ message: "still going", status: "pending", uuid: "req-9" });
  });

  it("unwraps the response envelope rather than parsing the whole Octokit response", async () => {
    const fetch = makeFetchGithubAsyncMerge({
      rest: recordingRest({ asked: [], data: { details: { message: "in the queue" }, status: "enqueued" } }),
    });

    const state = unwrap(await fetch({ number: 1, owner: "o", repo: "r", uuid: "u" }));

    expect(state).toStrictEqual({ message: "in the queue", status: "enqueued", uuid: undefined });
  });

  it("passes a transport failure through as the live error the read lane already produced", async () => {
    const fetch = makeFetchGithubAsyncMerge({
      rest: async () => err(GithubLiveErrors.readFailed({ message: "github said 502" })),
    });

    const error = unwrapErr(await fetch({ number: 1, owner: "o", repo: "r", uuid: "u" }));

    expect(error.message).toBe("github said 502");
  });

  it("names the pull request and the request when the body cannot be read", async () => {
    const fetch = makeFetchGithubAsyncMerge({
      rest: recordingRest({ asked: [], data: { status: "pending" } }),
    });

    const error = unwrapErr(await fetch({ number: 16_378, owner: "acme", repo: "acme-admin", uuid: "req-9" }));

    expect(error.message).toBe(
      "GitHub's asynchronous merge result for acme/acme-admin#16378 (request req-9) could not be read: " +
        "GitHub's asynchronous merge response (pending) carried no details object",
    );
  });
});
