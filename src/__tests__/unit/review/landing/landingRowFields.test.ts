import { describe, expect, it } from "vitest";
import type { ThreadDetail } from "../../../../review/prStateDetail.js";
import type { PrReviewState } from "../../../../review/reviewState.js";
import { row, thread } from "./fixtures.js";

describe("landingRow's own-thread count", () => {
  const ours = (over: Partial<ThreadDetail> = {}): ThreadDetail =>
    thread({
      disposition: "ours-open",
      lastCommentLogin: "octocat",
      openedByLogin: "octocat",
      ...over,
    });

  // MEASURED: 7 of the owner's 27 open pull requests carried 23 of these between them, every one with
  // `openThreads: []` — the row said nothing at all about what GitHub was holding the merge on.
  it("counts our own open walkthrough threads, which `openThreads` excludes by design", () => {
    const mixed = row({
      over: { threads: [ours({ id: "PRRT_a" }), ours({ id: "PRRT_b" }), thread({ id: "PRRT_theirs" })] },
    });
    expect(mixed.oursResolvable).toBe(2);
    expect(mixed.openThreads).toEqual([]);
  });

  it("counts zero when every thread on it belongs to a reviewer", () => {
    expect(row({ over: { threads: [thread()] } }).oursResolvable).toBe(0);
  });
});

describe("landingRow's ask trail", () => {
  it("carries every certified ask with its recipients scoped to this pull request, newest first", () => {
    const text = "<@U0SYN000002> pls review <https://github.com/acme/widgets/pull/16378>";
    const ask: PrReviewState["slack"]["asks"][number] = {
      association: "linked",
      atIso: "2026-09-23T04:46:00.000Z",
      authorId: "U0SYN000001",
      authorRole: "owner",
      authoredPrCount: 1,
      authoredText: text,
      channel: "#dev-team",
      conversation: "channel",
      counterpartId: "",
      excerpt: "@Rosa Lindqvist pls review",
      firstLinkAt: 27,
      isDirectMessage: false,
      leg: "live",
      linkSpans: [{ end: 68, start: 28, text: "https://github.com/acme/widgets/pull/16378" }],
      mentions: [{ id: "U0SYN000002", span: { end: 14, start: 0, text: "<@U0SYN000002>" } }],
      messageKey: "C1:1790138766.748499",
      permalink: "https://acme.slack.com/archives/C1/p1790138766748499",
      prKey: "acme/widgets#16378",
      quotedPrKeys: [],
      tagged: ["U0SYN000002"],
      threadKey: "C1:1790138766.748499",
      threadPrKeys: [],
      versionsDisagree: false,
    };
    const slack: PrReviewState["slack"] = {
      asked: "yes",
      asks: [ask],
      bounded: true,
      mentioned: "yes",
      mentions: [ask],
      why: "",
    };
    expect(row({ over: { slack } }).askTrail).toEqual([
      {
        atIso: "2026-09-23T04:46:00.000Z",
        channel: "#dev-team",
        isDirectMessage: false,
        leg: "live",
        messageKey: "C1:1790138766.748499",
        permalink: "https://acme.slack.com/archives/C1/p1790138766748499",
        recipients: ["U0SYN000002"],
      },
    ]);
  });
});
