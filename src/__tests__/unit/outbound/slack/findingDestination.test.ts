import { describe, expect, it } from "vitest";

import { findingDestinationRefusal } from "../../../../outbound/slack/findingDestination.js";

const SHARE = {
  approvedDraft: true,
  channel: "C0TEAM",
  formKind: "finding",
} as const;

describe("findingDestinationRefusal", () => {
  // No placement input at all: the thread is the card's pick, judged by the owner.
  it("admits an approved share into a team channel", () => {
    expect(findingDestinationRefusal(SHARE)).toEqual([]);
  });

  it("asks nothing of any other form kind, wherever it goes", () => {
    expect(
      findingDestinationRefusal({
        ...SHARE,
        approvedDraft: false,
        channel: "D0SYNOWNERDM",
        formKind: "update",
      }),
    ).toEqual([]);
  });

  it("refuses an approved share into a direct message, by DM id or by user id", () => {
    expect(findingDestinationRefusal({ ...SHARE, channel: "D0SYNSOMEONE" })[0]).toContain(
      "D0SYNSOMEONE is a direct message",
    );
    expect(findingDestinationRefusal({ ...SHARE, channel: "U0SYNSOMEONE" })[0]).toContain(
      "U0SYNSOMEONE is a direct message",
    );
    expect(findingDestinationRefusal({ ...SHARE, channel: "W0SYNSOMEONE" })[0]).toContain(
      "W0SYNSOMEONE is a direct message",
    );
  });

  it("names only the DM when an approved share is aimed at the owner's DM", () => {
    const lines = findingDestinationRefusal({ ...SHARE, channel: "D0SYNOWNERDM" });
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(
      "this finding cannot go out as asked: D0SYNOWNERDM is a direct message, and a finding goes to the owning team's " +
        "channel, never a DM. Every finding is a queue card naming the channel and thread, who " +
        "to tag and why, and goes out as the bot on the owner's yes, never a DM.",
    );
  });

  it("names only the missing approval when an unapproved finding is aimed at a team channel", () => {
    const lines = findingDestinationRefusal({ ...SHARE, approvedDraft: false });
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(
      "this finding cannot go out as asked: it is not a parked draft the owner approved, and a finding reaches a team only " +
        "on the owner's yes. Every finding is a queue card naming the channel and thread, who to tag and " +
        "why, and goes out as the bot on the owner's yes, never a DM.",
    );
  });

  it("asks nothing of a non-finding kind even when it is unapproved", () => {
    expect(findingDestinationRefusal({ ...SHARE, approvedDraft: false, formKind: "digest" })).toEqual([]);
  });

  it("admits an approved share into a private team channel's G id, which is not a direct message", () => {
    expect(findingDestinationRefusal({ ...SHARE, channel: "G0SYNPRIVATE" })).toEqual([]);
  });

  it("names every problem at once, in order, then the park command and the absent hatch", () => {
    const lines = findingDestinationRefusal({ ...SHARE, approvedDraft: false, channel: "D0SYNOWNERDM" });
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(
      "this finding cannot go out as asked: D0SYNOWNERDM is a direct message, and a finding goes to the owning team's " +
        "channel, never a DM. Also, it is not a parked draft the owner approved, and a finding reaches a team only on the " +
        "owner's yes. Every finding is a queue card naming the channel and thread, who to tag and why, " +
        "and goes out as the bot on the owner's yes, never a DM.",
    );
    expect(lines[1]).toBe(
      "Park it with `slopweaver slack draft record --as bot --channel <team channel> [--thread-ts <root ts>] --form - " +
        '--why "<…>" --media a,b,c`; it is released by `slack post` (or `slack reply` for a thread) `--as bot --draft ' +
        "<id> --approve <digest>` on the owner's yes.",
    );
    expect(lines[2]).toBe("There is deliberately NO escape hatch here: the correction is always available.");
  });
});
