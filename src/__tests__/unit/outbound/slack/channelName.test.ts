/**
 * Pure judgement over a proposed Slack channel name. No I/O, no clock, no mocks.
 *
 * The property under test is the one that makes the create verb safe: a name Slack would SILENTLY REWRITE
 * must be refused, and the refusal must name the exact string to re-run with. A test asserting only "it
 * refused" would pass on a refusal that names nothing, which is the failure mode the module exists to avoid.
 */
import { describe, expect, it } from "vitest";

import {
  canonicalChannelName,
  channelNameDifferences,
  channelNameRefusals,
  judgeChannelName,
  SLACK_CHANNEL_NAME_MAX,
} from "../../../../outbound/slack/channelName.js";

describe("canonicalChannelName", () => {
  it("lowercases, and collapses a run of disallowed characters to ONE hyphen", () => {
    expect(canonicalChannelName({ proposed: "Design   Review!!" })).toBe("design-review");
  });

  it("keeps digits, hyphens and underscores exactly as written", () => {
    expect(canonicalChannelName({ proposed: "eng_alerts-2026" })).toBe("eng_alerts-2026");
  });

  it("trims the hyphens a leading or trailing disallowed run would otherwise leave", () => {
    expect(canonicalChannelName({ proposed: " .design. " })).toBe("design");
  });

  it("cuts at Slack's own 80-character cap", () => {
    expect(canonicalChannelName({ proposed: "a".repeat(120) }).length).toBe(SLACK_CHANNEL_NAME_MAX);
  });

  it("removes the hyphen the cut itself lands on, rather than emitting a name ending in one", () => {
    // 79 characters, then a space, then more: the space becomes the 80th character, a hyphen, and the cut
    // lands exactly on it. Trimming AFTER the slice is what makes the answer 79 characters rather than an
    // 80-character name Slack would itself rewrite — which would defeat this whole module.
    const canonical = canonicalChannelName({ proposed: `${"a".repeat(79)} tail` });

    expect(canonical).toBe("a".repeat(79));
    expect(canonical.endsWith("-")).toBe(false);
  });

  it("keeps non-Latin letters, because Slack accepts them and an ASCII-only rule would refuse a real name", () => {
    expect(canonicalChannelName({ proposed: "設計レビュー" })).toBe("設計レビュー");
  });
});

describe("channelNameDifferences", () => {
  it("names the capitals and the disallowed characters SEPARATELY, since the fixes differ", () => {
    expect(channelNameDifferences({ proposed: "Design Review" })).toEqual([
      "Slack stores a channel name in lower case, and this one carries capitals",
      'a channel name holds only letters, digits, hyphens and underscores — Slack would replace " "',
    ]);
  });

  it("names the length with the actual count, so the author knows how much to cut", () => {
    expect(channelNameDifferences({ proposed: "a".repeat(90) })).toEqual([
      "Slack cuts a channel name at 80 characters, and this one is 90",
    ]);
  });

  it("says nothing at all about a name Slack would store unchanged", () => {
    expect(channelNameDifferences({ proposed: "design-review" })).toEqual([]);
  });
});

describe("judgeChannelName", () => {
  it("passes a canonical name through, carrying it forward as the name to create", () => {
    expect(judgeChannelName({ proposed: "design-review" })).toEqual({ kind: "canonical", name: "design-review" });
  });

  it("answers not-canonical with the exact canonical form, never merely a complaint", () => {
    const verdict = judgeChannelName({ proposed: "Design Review" });

    expect(verdict.kind).toBe("not-canonical");
    expect(verdict.kind === "not-canonical" ? verdict.canonical : "").toBe("design-review");
  });

  it("answers UNUSABLE when nothing survives canonicalisation, rather than suggesting an empty name", () => {
    const verdict = judgeChannelName({ proposed: "  ...  " });

    expect(verdict.kind).toBe("unusable");
    expect(verdict.kind === "unusable" ? verdict.why[0] : "").toContain("no letter, digit or underscore");
  });
});

describe("channelNameRefusals", () => {
  it("says nothing for a canonical verdict", () => {
    expect(channelNameRefusals({ verdict: judgeChannelName({ proposed: "eng" }) })).toEqual([]);
  });

  it("ends with the exact command tail to re-run, which is the whole point of refusing", () => {
    const lines = channelNameRefusals({ verdict: judgeChannelName({ proposed: "Design Review" }) });

    expect(lines[lines.length - 1]).toBe("  re-run with --name design-review");
  });

  it("states WHY the refusal is stricter than a send's: a channel cannot be deleted", () => {
    const lines = channelNameRefusals({ verdict: judgeChannelName({ proposed: "Design Review" }) });

    expect(lines[0]).toContain("only archived");
  });

  it("gives an unusable name one line and no re-run suggestion, because there is none to give", () => {
    const lines = channelNameRefusals({ verdict: judgeChannelName({ proposed: "..." }) });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Nothing was created.");
  });
});
