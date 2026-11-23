/*
 * The one redirect a bare reply link earns: a single foreign-threaded row names the real root and is followed,
 * and every other first answer (the thread itself, an empty page, a row with no root) is taken as it came.
 */
import { describe, expect, it } from "vitest";

import type { SlackThreadTarget } from "../../../../../live/slack/permalink.js";
import { redirectedTarget } from "../../../../../live/slack/threadRedirect.js";

const REQUESTED: SlackThreadTarget = {
  addressedReply: false,
  addressedTs: "1700000100.000200",
  channel: "C0FIXTURE01",
  threadTs: "1700000100.000200",
  workspace: "https://acme.slack.com",
};

describe("redirectedTarget", () => {
  it("follows a lone reply to the root its thread_ts names, still addressing the pasted message", () => {
    const redirect = redirectedTarget({
      rawMessages: [{ thread_ts: "1700000000.000100", ts: "1700000100.000200" }],
      target: REQUESTED,
    });
    expect(redirect).toEqual({
      addressedReply: true,
      addressedTs: "1700000100.000200",
      channel: "C0FIXTURE01",
      threadTs: "1700000000.000100",
      workspace: "https://acme.slack.com",
    });
  });

  it("keeps the requested thread when the lone row is that thread's own root", () => {
    const redirect = redirectedTarget({
      rawMessages: [{ thread_ts: "1700000100.000200", ts: "1700000100.000200" }],
      target: REQUESTED,
    });
    expect(redirect).toBeUndefined();
  });

  it("keeps the requested thread when more than one row came back", () => {
    const redirect = redirectedTarget({
      rawMessages: [
        { thread_ts: "1700000000.000100", ts: "1700000000.000100" },
        { thread_ts: "1700000000.000100", ts: "1700000100.000200" },
      ],
      target: REQUESTED,
    });
    expect(redirect).toBeUndefined();
  });

  it("keeps the requested thread on an empty page, a non-record row, or a row with no root", () => {
    const empty: readonly unknown[] = [];
    expect(redirectedTarget({ rawMessages: empty, target: REQUESTED })).toBeUndefined();
    expect(redirectedTarget({ rawMessages: ["not a row"], target: REQUESTED })).toBeUndefined();
    expect(redirectedTarget({ rawMessages: [{ ts: "1700000100.000200" }], target: REQUESTED })).toBeUndefined();
    expect(
      redirectedTarget({ rawMessages: [{ thread_ts: "", ts: "1700000100.000200" }], target: REQUESTED }),
    ).toBeUndefined();
  });
});
