/**
 * `github stack push`'s write-access preflight: the one gate that needs the API, read through the injected
 * `GithubWriteApi.canPush`.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { stackPushWriteBlocked } from "../../../../../cli/commands/github/stackPushGates.js";
import type { GithubWriteApi } from "../../../../../corpus/github/write.js";
import { toIngestError } from "../../../../../lib/ingestError.js";
import type { PrTarget } from "../../../../../outbound/github/types.js";

const TARGET: PrTarget = { base: "main", head: "feat-x", owner: "acme", repo: "widget" };

/** A write API exposing only `canPush`, recording the repository each call asked about. */
function apiAnswering({ answer }: { answer: GithubWriteApi["canPush"] }): {
  api: GithubWriteApi;
  asked: { owner: string; repo: string }[];
} {
  const asked: { owner: string; repo: string }[] = [];
  const canPush: GithubWriteApi["canPush"] = (input) => {
    asked.push({ owner: input.owner, repo: input.repo });
    return answer(input);
  };
  return { api: { canPush } as unknown as GithubWriteApi, asked };
}

describe("stackPushWriteBlocked", () => {
  it("lets a pushable repository through, asking about exactly the target repository", async () => {
    const { api, asked } = apiAnswering({ answer: () => okAsync(true) });
    expect(await stackPushWriteBlocked({ api, target: TARGET })).toBeUndefined();
    expect(asked).toEqual([{ owner: "acme", repo: "widget" }]);
  });

  it("refuses a read-only repository with the complete viewer-role refusal naming owner/repo", async () => {
    const { api } = apiAnswering({ answer: () => okAsync(false) });
    expect(await stackPushWriteBlocked({ api, target: TARGET })).toBe(
      "acme/widget is readable but this token cannot push to it, so a pull request would fail at the API " +
        "after you believed it was settled. Note this reports the VIEWER's repository role, which is the " +
        "strongest signal a read-only probe can give — it is not a token-grant attestation.",
    );
  });

  it("reports 'could not check write access' with the provider's message when canPush fails", async () => {
    const failure = toIngestError({ error: new Error("Bad credentials"), operation: "canPush", provider: "github" });
    const { api } = apiAnswering({ answer: () => errAsync(failure) });
    const line = await stackPushWriteBlocked({ api, target: TARGET });
    expect(line).toBe("could not check write access to acme/widget: Bad credentials");
    expect(line).toBe(`could not check write access to acme/widget: ${failure.message}`);
  });
});
