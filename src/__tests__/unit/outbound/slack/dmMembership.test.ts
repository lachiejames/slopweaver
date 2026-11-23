import { describe, expect, it } from "vitest";

import { isDirectMessage } from "../../../../corpus/slack/writeApiMembership.js";
import { addressableMembers, dmNonMemberRefusal } from "../../../../outbound/slack/dmMembership.js";

const resolution = { resolved: new Map([["seth", { origin: "member" as const, slackId: "U0SETH" }]]) };

describe("isDirectMessage — a group DM is one, though its surface reads private-channel", () => {
  it("calls a 1:1 DM one", () => {
    expect(isDirectMessage({ info: { is_im: true } })).toBe(true);
  });

  it("calls a group DM one", () => {
    expect(isDirectMessage({ info: { is_im: false, is_mpim: true, is_private: true } })).toBe(true);
  });

  it("calls a channel a channel", () => {
    expect(isDirectMessage({ info: { is_im: false, is_mpim: false, is_private: true } })).toBe(false);
  });

  it("does not guess when Slack named neither flag", () => {
    expect(isDirectMessage({ info: {} })).toBe(undefined);
  });
});

describe("addressableMembers", () => {
  it("hands the ladder the members of a conversation that was read", () => {
    const members = new Set(["U0A"]);

    expect(addressableMembers({ membership: { directMessage: false, kind: "read", members } })).toBe(members);
  });

  it("hands it nothing when the read failed, so a failed read never addresses anyone", () => {
    expect(addressableMembers({ membership: { cause: "ratelimited", kind: "unreadable" } })).toBe(undefined);
  });
});

describe("dmNonMemberRefusal", () => {
  it("holds a DM tag of a non-member", () => {
    const lines = dmNonMemberRefusal({
      channel: "C9",
      membership: { directMessage: true, kind: "read", members: new Set(["U0A", "U0B"]) },
      promptChannel: "D0PROMPT",
      resolution,
    });

    expect(lines[1]).toBe('  "seth" is U0SETH, who is not a member.');
    expect(lines[2]).toBe("  in this DM: U0A, U0B");
  });

  it("passes a DM tag of a member", () => {
    const members = new Set(["U0A", "U0SETH"]);

    expect(
      dmNonMemberRefusal({
        channel: "C9",
        membership: { directMessage: true, kind: "read", members },
        promptChannel: undefined,
        resolution,
      }),
    ).toEqual([]);
  });

  it("passes a read that failed, the residue it states", () => {
    expect(
      dmNonMemberRefusal({
        channel: "C9",
        membership: { cause: "ratelimited", kind: "unreadable" },
        promptChannel: undefined,
        resolution,
      }),
    ).toEqual([]);
  });
});
