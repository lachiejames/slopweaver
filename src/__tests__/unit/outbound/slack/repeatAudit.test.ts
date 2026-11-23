/**
 * The audit's grouping and keep/delete judgement, over messages built the way a real read builds them.
 */
import { describe, expect, it } from "vitest";

import { type AuditMessage, renderRepeatsJson, repeatAudit } from "../../../../outbound/slack/repeatAudit.js";
import { priorsFromRaw } from "../../../../outbound/slack/repeatMatch.js";

const WORKSPACE = "https://acme.slack.com/";
const BUGS = "C0SYN000003";
const SELF_USER = "U0SYN000001";
const FIRST_LINE =
  "P2 in production, not tracked yet: every third-party provider call for the acme booking service has 404'd since 24 sep";

/** One audit message through the real prior path. */
function message({
  text,
  ts,
  channel = BUGS,
  threadTs,
  fileCount = 0,
  othersReplied = false,
}: {
  text: string;
  ts: string;
  channel?: string;
  threadTs?: string;
  fileCount?: number;
  othersReplied?: boolean;
}): AuditMessage {
  const raw =
    threadTs === undefined ? { text, ts, user: SELF_USER } : { text, thread_ts: threadTs, ts, user: SELF_USER };
  const [prior] = priorsFromRaw({ channel, rawMessages: [raw], self: { userId: SELF_USER }, workspaceUrl: WORKSPACE });
  return { ...prior!, actor: "me", fileCount, othersReplied };
}

const audit = ({ messages }: { messages: readonly AuditMessage[] }) =>
  repeatAudit({ days: 7, messages, placesRead: 1, unread: [] });

describe("repeatAudit", () => {
  it("groups the incident pair on its first line, keeping the earlier cut and deleting the later", () => {
    const result = audit({
      messages: [
        message({ fileCount: 3, text: `${FIRST_LINE}\nsecond cut`, ts: "1790611538.684019" }),
        message({ fileCount: 3, text: `${FIRST_LINE}\nfirst cut`, ts: "1790604264.247109" }),
      ],
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.rule).toBe("first-line");
    expect(
      result.groups[0]!.members.map((member) => [member.message.ts, member.verdict, member.deleteCommand]),
    ).toEqual([
      ["1790604264.247109", "keep", undefined],
      ["1790611538.684019", "delete", "slopweaver slack delete --as me --channel C0SYN000003 --ts 1790611538.684019"],
    ]);
  });

  it("keeps the copy with the most files even when it came second", () => {
    const result = audit({
      messages: [
        message({ fileCount: 0, text: "same words", ts: "1790604264.247109" }),
        message({ fileCount: 2, text: "same words", ts: "1790604300.000100" }),
      ],
    });
    expect(result.groups[0]!.members.map((member) => member.verdict)).toEqual(["delete", "keep"]);
  });

  it("marks a copy somebody replied under for review rather than delete", () => {
    const result = audit({
      messages: [
        message({ text: "same words", ts: "1790604264.247109" }),
        message({ othersReplied: true, text: "same words", ts: "1790604300.000100" }),
      ],
    });
    expect(result.groups[0]!.members.map((member) => member.verdict)).toEqual(["keep", "review"]);
  });

  it("does not group the same words in two channels, or top level against a thread", () => {
    const result = audit({
      messages: [
        message({ text: "same words", ts: "1790604264.247109" }),
        message({ channel: "C0OTHER", text: "same words", ts: "1790604300.000100" }),
        message({ text: "same words", threadTs: "1790600000.000100", ts: "1790604400.000100" }),
      ],
    });
    expect(result.groups).toEqual([]);
  });

  it("groups a first line only within a day, but a whole digest across three days", () => {
    const thirtyHours = 30 * 60 * 60;
    const threeDays = 3 * 24 * 60 * 60;
    const result = audit({
      messages: [
        message({ text: `${FIRST_LINE}\na`, ts: "1790604264.247109" }),
        message({ text: `${FIRST_LINE}\nb`, ts: `${String(1790604264 + thirtyHours)}.000100` }),
        message({ text: "whole words", ts: "1790604265.000100" }),
        message({ text: "whole words", ts: `${String(1790604265 + threeDays)}.000100` }),
      ],
    });
    expect(result.groups.map((group) => group.rule)).toEqual(["digest"]);
    expect(result.wouldRefuse.map((refusal) => refusal.rule).toSorted()).toEqual(["digest", "first-line"]);
  });

  it("renders the same document for the same messages in any order", () => {
    const a = message({ text: "same words", ts: "1790604264.247109" });
    const b = message({ text: "same words", ts: "1790604300.000100" });
    expect(renderRepeatsJson({ audit: audit({ messages: [b, a] }) })).toBe(
      renderRepeatsJson({ audit: audit({ messages: [a, b] }) }),
    );
  });
});
