/*
 * How a read weighs itself against Slack's own `reply_count`: short of it is reported rather than refused, an
 * agreeing count corroborates the read, and no count at all leaves the read unverified, never "complete".
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { readSlackThread } from "../../../../../live/slack/readThread.js";
import { apiServing, LINK, THREAD } from "./fixtures.js";
import { deps, tempRoot, useTempRoots } from "./harness.js";

useTempRoots();

describe("readSlackThread", () => {
  it("REPORTS a reply_count that disagrees with the fetched thread rather than refusing it", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              // Slack advertises 4 replies; only 1 comes back. Both figures are Slack's.
              { reply_count: 4, text: "parent", ts: THREAD, user: "U1" },
              { text: "reply", thread_ts: THREAD, ts: "1785114500.000100", user: "U2" },
            ],
          }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.completeness.verdict).toBe("short-of-advertised");
    expect(doc.completeness.providerTotalObserved).toBe(5);
    expect(doc.completeness.held).toBe(2);
    expect(doc.completeness.excludedAtLeast).toBe(3);
    expect(doc.warnings.length).toBe(1);
    expect(doc.warnings[0]!).toContain("advertises 5 messages and this read holds 2");
  });

  it("says the count CORROBORATES the read when Slack's own reply_count agrees", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps({
          api: apiServing({
            messages: [
              { reply_count: 1, text: "parent", ts: THREAD, user: "U1" },
              { text: "reply", thread_ts: THREAD, ts: "1785114500.000100", user: "U2" },
            ],
          }),
        }),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.completeness.verdict).toBe("corroborated");
    expect(doc.completeness.providerTotalObserved).toBe(2);
    expect(doc.warnings).toEqual([]);
  });

  it("says UNVERIFIED, not complete, when Slack advertised no reply_count at all", async () => {
    const doc = unwrap(
      await readSlackThread({
        deps: deps(),
        filesRoot: tempRoot(),
        permalink: LINK,
        principal: "user",
        token: "xoxp-test",
      }),
    );

    expect(doc.completeness.verdict).toBe("unverified");
    expect(doc.completeness.providerTotalObserved).toBe(null);
    // Nothing to caveat: cursor exhaustion IS the evidence, and it held.
    expect(doc.warnings).toEqual([]);
  });
});
