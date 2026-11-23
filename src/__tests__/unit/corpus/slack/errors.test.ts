import { describe, expect, it } from "vitest";

import { SlackFetchErrors } from "../../../../corpus/slack/errors.js";

describe("SlackFetchErrors", () => {
  it("builds fetchFailed carrying the composed message and the original thrown value by reference", () => {
    const cause = new Error("socket hang up");
    const error = SlackFetchErrors.fetchFailed({ cause, message: "channel discovery failed: socket hang up" });
    expect(error).toEqual({ cause, code: "FETCH_FAILED", message: "channel discovery failed: socket hang up" });
    expect(error.cause).toBe(cause);
  });

  it("keeps a non-Error thrown value verbatim as the cause", () => {
    expect(SlackFetchErrors.fetchFailed({ cause: "rate_limited", message: "listing failed" })).toEqual({
      cause: "rate_limited",
      code: "FETCH_FAILED",
      message: "listing failed",
    });
  });

  it("omits the cause key entirely when no cause is given", () => {
    const error = SlackFetchErrors.fetchFailed({ message: "workspace pre-fetch failed" });
    expect(error).toStrictEqual({ code: "FETCH_FAILED", message: "workspace pre-fetch failed" });
    expect(Object.keys(error)).toEqual(["code", "message"]);
  });

  it("omits the cause key when the cause passed is undefined", () => {
    const error = SlackFetchErrors.fetchFailed({ cause: undefined, message: "workspace pre-fetch failed" });
    expect(Object.keys(error)).toEqual(["code", "message"]);
  });

  it("builds workspaceUrlUnresolved pointing at the token scopes", () => {
    expect(SlackFetchErrors.workspaceUrlUnresolved()).toEqual({
      code: "WORKSPACE_URL_UNRESOLVED",
      message: "could not resolve the workspace URL (auth.test) — check the token scopes",
    });
  });
});
