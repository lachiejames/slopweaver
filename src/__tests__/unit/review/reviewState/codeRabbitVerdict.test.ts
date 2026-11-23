import { describe, expect, it } from "vitest";
import { codeRabbitVerdict } from "../../../../review/codeRabbitVerdict.js";
import { NOW } from "./fixtures.js";

describe("codeRabbitVerdict", () => {
  it("reports none when CodeRabbit has not posted", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "abc",
      reviews: [],
      threadCount: 0,
      threads: [],
      threadsTruncated: false,
    });
    expect(verdict.verdict).toBe("none");
  });

  it("reports changes-requested while one unresolved CodeRabbit thread is open", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [{ commitOid: "abc", login: "coderabbitai", state: "APPROVED", submittedAtIso: NOW }],
      threads: [{ isOutdated: false, isResolved: false, openedByLogin: "coderabbitai" }],
    });
    expect(verdict.verdict).toBe("changes-requested");
  });

  it("ignores an OUTDATED unresolved thread, which the diff has already moved past", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [{ commitOid: "abc", login: "coderabbitai", state: "APPROVED", submittedAtIso: NOW }],
      threads: [{ isOutdated: true, isResolved: false, openedByLogin: "coderabbitai" }],
    });
    expect(verdict.verdict).toBe("green");
  });

  it("ignores an unresolved thread a HUMAN opened, which is a different question", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [{ commitOid: "abc", login: "coderabbitai", state: "APPROVED", submittedAtIso: NOW }],
      threads: [{ isOutdated: false, isResolved: false, openedByLogin: "reviewer-one" }],
    });
    expect(verdict.verdict).toBe("green");
  });

  it("reports stale when CodeRabbit approved a commit the head has moved past", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "def4567",
      reviews: [{ commitOid: "abc1234", login: "coderabbitai", state: "APPROVED", submittedAtIso: NOW }],
      threads: [],
    });
    expect(verdict.verdict).toBe("stale");
    expect(verdict.detail).toBe("CodeRabbit last reviewed abc1234, and the head is now def4567");
  });

  it("stays green when the newest CodeRabbit review is a COMMENT on top of its own approval", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [
        { commitOid: "abc", login: "coderabbitai", state: "APPROVED", submittedAtIso: "2026-08-28T23:07:54Z" },
        { commitOid: "abc", login: "coderabbitai", state: "COMMENTED", submittedAtIso: "2026-08-28T23:08:36Z" },
      ],
      threads: [],
    });
    expect(verdict.verdict).toBe("green");
  });

  it("reports stale when a COMMENT on the new head sits over an approval of an EARLIER one", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "bbbbbbb9",
      reviews: [
        { commitOid: "aaaaaaa1", login: "coderabbitai", state: "APPROVED", submittedAtIso: "2026-08-28T23:07:54Z" },
        { commitOid: "bbbbbbb9", login: "coderabbitai", state: "COMMENTED", submittedAtIso: "2026-08-28T23:08:36Z" },
      ],
      threads: [],
    });
    expect(verdict.verdict).toBe("stale");
    expect(verdict.detail).toBe("CodeRabbit approved aaaaaaa, not the current head bbbbbbb");
  });

  it("reports unknown, never green, when the approval names no commit to tie it to the head", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [{ commitOid: "", login: "coderabbitai", state: "APPROVED", submittedAtIso: NOW }],
      threads: [],
    });
    expect(verdict.verdict).toBe("unknown");
    expect(verdict.detail).toBe("CodeRabbit approved, but this read cannot tie that approval to the current head");
  });

  it("reports pending when CodeRabbit commented and never gave a verdict", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [{ commitOid: "abc", login: "coderabbitai", state: "COMMENTED", submittedAtIso: NOW }],
      threads: [],
    });
    expect(verdict.verdict).toBe("pending");
  });

  it("lets a CHANGES_REQUESTED verdict outrank an earlier approval", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 0,
      threadsTruncated: false,
      headOid: "abc",
      reviews: [
        { commitOid: "abc", login: "coderabbitai", state: "APPROVED", submittedAtIso: "2026-08-28T01:00:00Z" },
        { commitOid: "abc", login: "coderabbitai", state: "CHANGES_REQUESTED", submittedAtIso: "2026-08-28T02:00:00Z" },
      ],
      threads: [],
    });
    expect(verdict.verdict).toBe("changes-requested");
  });

  const requested = [
    { commitOid: "abc", login: "coderabbitai", state: "CHANGES_REQUESTED", submittedAtIso: "2026-08-28T02:00:00Z" },
  ];

  it("names the OUTDATED unresolved threads holding a CHANGES_REQUESTED, which an approval would have ignored", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 3,
      threadsTruncated: false,
      headOid: "abc",
      reviews: requested,
      threads: [
        { isOutdated: true, isResolved: false, openedByLogin: "coderabbitai" },
        { isOutdated: true, isResolved: false, openedByLogin: "coderabbitai" },
        { isOutdated: true, isResolved: true, openedByLogin: "coderabbitai" },
      ],
    });
    expect(verdict).toEqual({
      detail: "CodeRabbit's CHANGES_REQUESTED is held by 2 unresolved outdated CodeRabbit comment(s)",
      verdict: "changes-requested",
    });
  });

  it("reads STUCK when every CodeRabbit thread, outdated included, is resolved and the verdict still stands", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      threadCount: 2,
      threadsTruncated: false,
      headOid: "abc",
      reviews: requested,
      threads: [
        { isOutdated: false, isResolved: true, openedByLogin: "coderabbitai" },
        { isOutdated: true, isResolved: true, openedByLogin: "coderabbitai" },
      ],
    });
    expect(verdict).toEqual({
      detail:
        "every CodeRabbit comment is resolved and its CHANGES_REQUESTED has not flipped — `github landing --press` " +
        "re-requests its review twenty seconds after the read that saw it",
      verdict: "stuck",
    });
  });

  const resolvedThreads = [
    { isOutdated: true, isResolved: true, openedByLogin: "coderabbitai" },
    { isOutdated: false, isResolved: true, openedByLogin: "coderabbitai" },
  ];

  it("reads STUCK when a COMMENTED re-review of the head sits over an older CHANGES_REQUESTED", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "def",
      reviews: [
        ...requested,
        { commitOid: "def", login: "coderabbitai", state: "COMMENTED", submittedAtIso: "2026-08-28T03:00:00Z" },
      ],
      threadCount: 2,
      threads: resolvedThreads,
      threadsTruncated: false,
    });
    expect(verdict.verdict).toBe("stuck");
  });

  it("never reads STUCK when CodeRabbit has not reviewed the head yet — its review of the push is still to come", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "def",
      reviews: requested,
      threadCount: 2,
      threads: resolvedThreads,
      threadsTruncated: false,
    });
    expect(verdict).toEqual({
      detail:
        "every CodeRabbit comment is resolved and CodeRabbit last reviewed abc — its review of the head def is still to come",
      verdict: "changes-requested",
    });
  });

  it("never reads STUCK over a review list that came back short, which could hide the approval", () => {
    const verdict = codeRabbitVerdict({
      headOid: "abc",
      reviews: requested,
      reviewsTruncated: true,
      threadCount: 2,
      threads: resolvedThreads,
      threadsTruncated: false,
    });
    expect(verdict).toEqual({
      detail:
        "every CodeRabbit comment is resolved and its CHANGES_REQUESTED has not flipped, but this read could not " +
        "see every review, so a newer one may already have flipped it",
      verdict: "changes-requested",
    });
  });

  it("never reads STUCK when this read cannot tie CodeRabbit's last review to the head", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "",
      reviews: requested,
      threadCount: 2,
      threads: resolvedThreads,
      threadsTruncated: false,
    });
    expect(verdict).toEqual({
      detail:
        "every CodeRabbit comment is resolved and its CHANGES_REQUESTED has not flipped, but this read cannot tie " +
        "CodeRabbit's last review to the current head",
      verdict: "changes-requested",
    });
  });

  it("never reads STUCK with zero CodeRabbit threads — nothing was resolved, so the body is the likelier holder", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "abc",
      reviews: requested,
      threadCount: 0,
      threads: [],
      threadsTruncated: false,
    });
    expect(verdict).toEqual({
      detail: "CodeRabbit's latest verdict is CHANGES_REQUESTED",
      verdict: "changes-requested",
    });
  });

  it("never reads STUCK over a truncated thread page, which could be hiding an open CodeRabbit thread", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "abc",
      reviews: requested,
      threadCount: 120,
      threads: [{ isOutdated: false, isResolved: true, openedByLogin: "coderabbitai" }],
      threadsTruncated: true,
    });
    expect(verdict.verdict).toBe("unknown");
  });
});

describe("codeRabbitVerdict and a truncated thread read", () => {
  const approved = [{ commitOid: "abc", login: "coderabbitai", state: "APPROVED", submittedAtIso: NOW }];

  it("downgrades a would-be green to unknown when the thread page was capped", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "abc",
      reviews: approved,
      threadCount: 59,
      threads: [],
      threadsTruncated: true,
    });
    expect(verdict).toEqual({
      detail: "59 review threads, more than one page — this read cannot prove nothing is outstanding",
      verdict: "unknown",
    });
  });

  it("keeps a POSITIVE finding a capped page already made, since truncation only ever loses one", () => {
    const verdict = codeRabbitVerdict({
      reviewsTruncated: false,
      headOid: "abc",
      reviews: approved,
      threadCount: 59,
      threads: [{ isOutdated: false, isResolved: false, openedByLogin: "coderabbitai" }],
      threadsTruncated: true,
    });
    expect(verdict.verdict).toBe("changes-requested");
  });
});
