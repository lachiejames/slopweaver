/*
 * Whose name a finding goes out under: the owner's only into a channel the bot cannot post in, like a private DM
 * with someone else; a finding shared at the top level of a channel after the owner approved the queue card posts
 * as the bot instead of as-me.
 */
import { describe, expect, it } from "vitest";

import {
  asMeChannelFinding,
  botCannotPostIn,
  botMembershipOf,
  findingIdentityApplies,
  findingIdentityRefusal,
  readBotMembership,
  undeclaredKindNote,
  undeclaredKindRefusal,
} from "../../../../outbound/slack/findingIdentity.js";

/** An as-me top-level finding in a team channel — the row the rule exists for. */
const CHANNEL_FINDING = {
  actor: undefined,
  botCannotPost: undefined,
  channel: "C0SYN000008",
  kind: "finding",
  threadTs: undefined,
} as const;

/** The same send, as the refusal is asked about it. */
const SEND = {
  actor: "me",
  botMembership: "member",
  channel: "C0SYN000008",
  isFinding: true,
  surface: "public-channel",
  threadTs: undefined,
} as const;

describe("botMembershipOf", () => {
  it("reads is_member as member or not, and an absent answer as unknown", () => {
    expect([true, false, undefined].map((isMember) => botMembershipOf({ isMember }))).toEqual([
      "member",
      "not-member",
      "unknown",
    ]);
  });
});

describe("asMeChannelFinding — the held row no release sends", () => {
  it("names an as-me top-level finding in a channel", () => {
    expect(asMeChannelFinding({ draft: CHANNEL_FINDING })).toBe(true);
  });

  it("holds an undeclared top-level channel row as a finding, whatever its why says", () => {
    expect(asMeChannelFinding({ draft: { ...CHANNEL_FINDING, kind: undefined } })).toBe(true);
  });

  it("opens an undeclared row's refusal on why it is held, and a declared one's on nothing", () => {
    expect(undeclaredKindNote({ draft: { kind: undefined } })).toBe(
      "it declares no --kind, so it is held as a finding (re-record it --kind message if it is not one): ",
    );
    expect([
      undeclaredKindNote({ draft: { kind: "finding" } }),
      undeclaredKindNote({ draft: { kind: "message" } }),
    ]).toEqual(["", ""]);
  });

  it("leaves a bot row, a thread reply, a DM, a recorded not-in-channel and a message alone", () => {
    const rows = [
      { ...CHANNEL_FINDING, actor: "bot" },
      { ...CHANNEL_FINDING, threadTs: "1789407961.767649" },
      { ...CHANNEL_FINDING, channel: "D0SYNSOMEONE" },
      { ...CHANNEL_FINDING, channel: "U0SYNSOMEONE" },
      { ...CHANNEL_FINDING, botCannotPost: "not-in-channel" },
      { ...CHANNEL_FINDING, kind: "message" },
    ] as const;
    expect(rows.map((draft) => asMeChannelFinding({ draft }))).toEqual(rows.map(() => false));
  });
});

describe("findingIdentityApplies", () => {
  it("governs a top-level finding in a channel, and one whose surface could not be read", () => {
    expect([
      findingIdentityApplies({ isFinding: true, surface: "public-channel", threadTs: undefined }),
      findingIdentityApplies({ isFinding: true, surface: undefined, threadTs: undefined }),
    ]).toEqual([true, true]);
  });

  it("does not govern a DM, a thread reply, or a message that is not a finding", () => {
    expect([
      findingIdentityApplies({ isFinding: true, surface: "direct-message", threadTs: undefined }),
      findingIdentityApplies({ isFinding: true, surface: "public-channel", threadTs: "1789407961.767649" }),
      findingIdentityApplies({ isFinding: false, surface: "public-channel", threadTs: undefined }),
    ]).toEqual([false, false, false]);
  });
});

describe("botCannotPostIn", () => {
  it("is true only for a private channel the bot's own read says it is not in", () => {
    expect([
      botCannotPostIn({ botMembership: "not-member", surface: "private-channel" }),
      botCannotPostIn({ botMembership: "not-member", surface: "public-channel" }),
      botCannotPostIn({ botMembership: "not-member", surface: undefined }),
      botCannotPostIn({ botMembership: "member", surface: "private-channel" }),
      botCannotPostIn({ botMembership: "unknown", surface: "private-channel" }),
    ]).toEqual([true, false, false, false, false]);
  });
});

describe("undeclaredKindRefusal — a forgotten --kind cannot pass a finding off by its why", () => {
  it("holds a top-level recording outside a DM that declares no kind, naming both kinds", () => {
    const refusal = undeclaredKindRefusal({ channel: "C0TEAM", kind: undefined, threadTs: undefined });
    expect(refusal[0]).toContain("pass `--kind finding` or `--kind message`");
    expect(refusal).toHaveLength(2);
    expect(undeclaredKindRefusal({ channel: "G0GROUP", kind: undefined, threadTs: undefined })).toEqual(refusal);
  });

  it("lets a declared kind, a thread reply and a DM through", () => {
    expect([
      undeclaredKindRefusal({ channel: "C0TEAM", kind: "message", threadTs: undefined }),
      undeclaredKindRefusal({ channel: "G0GROUP", kind: "finding", threadTs: undefined }),
      undeclaredKindRefusal({ channel: "C0TEAM", kind: undefined, threadTs: "1789407961.767649" }),
      undeclaredKindRefusal({ channel: "D0DM", kind: undefined, threadTs: undefined }),
      undeclaredKindRefusal({ channel: "U0PERSON", kind: undefined, threadTs: undefined }),
    ]).toEqual([[], [], [], [], []]);
  });
});

describe("readBotMembership", () => {
  /** A membership read answering `not-member`, recording each ask. */
  function reader(): { asked: string[]; read: (a: { channel: string; token: string }) => Promise<"not-member"> } {
    const asked: string[] = [];
    return {
      asked,
      read: async ({ channel, token }) => {
        asked.push(`${channel} ${token}`);
        return "not-member";
      },
    };
  }

  it("asks under the bot token for a private channel", async () => {
    const { asked, read } = reader();
    const membership = await readBotMembership({
      botToken: "xoxb-bot",
      channel: "G0SYNPRIVATE",
      read,
      surface: "private-channel",
    });
    expect(membership).toBe("not-member");
    expect(asked).toEqual(["G0SYNPRIVATE xoxb-bot"]);
  });

  it("answers unknown with no read for a public or unread surface, or with no bot token", async () => {
    const { asked, read } = reader();
    const answers = await Promise.all([
      readBotMembership({ botToken: "xoxb-bot", channel: "C1", read, surface: "public-channel" }),
      readBotMembership({ botToken: "xoxb-bot", channel: "C1", read, surface: undefined }),
      readBotMembership({ botToken: undefined, channel: "G1", read, surface: "private-channel" }),
    ]);
    expect(answers).toEqual(["unknown", "unknown", "unknown"]);
    expect(asked).toEqual([]);
  });
});

describe("findingIdentityRefusal", () => {
  it("refuses as-me in a public channel, naming the ruling and the bot's record command", () => {
    const lines = findingIdentityRefusal(SEND);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "this finding cannot go out as the owner: it is a top-level post in a channel and C0SYN000008 is public, so " +
        "the bot can carry the finding itself, joined or not (chat:write.public). A finding " +
        "shared at the top level of a channel after the owner approves the card posts as the bot — the owner did not " +
        "find it and has not verified it. As the owner only where the bot cannot post: a DM with a person, or a " +
        "private channel the bot is not in.",
    );
    expect(lines[1]).toContain("slopweaver slack draft record --as bot");
    expect(lines[2]).toContain("NO escape hatch");
  });

  it("refuses as-me in a public channel the bot has not joined, since it posts there anyway", () => {
    expect(findingIdentityRefusal({ ...SEND, botMembership: "not-member" })[0]).toContain(
      "C0SYN000008 is public, so the bot can carry the finding itself, joined or not",
    );
  });

  it("refuses as-me in a private channel the bot is in, or where no read could say", () => {
    const privately = { ...SEND, surface: "private-channel" } as const;
    expect([
      findingIdentityRefusal(privately)[0],
      findingIdentityRefusal({ ...privately, botMembership: "unknown" })[0],
      findingIdentityRefusal({ ...SEND, botMembership: "not-member", surface: undefined })[0],
    ]).toEqual([
      expect.stringContaining("the bot is in C0SYN000008, so it can carry the finding itself"),
      expect.stringContaining("no read could establish that the bot cannot post in C0SYN000008"),
      expect.stringContaining("no read could establish that the bot cannot post in C0SYN000008"),
    ]);
  });

  it("admits as-me in a private channel the bot is not in, and any bot send", () => {
    expect([
      findingIdentityRefusal({ ...SEND, botMembership: "not-member", surface: "private-channel" }),
      findingIdentityRefusal({ ...SEND, actor: "bot" }),
    ]).toEqual([[], []]);
  });

  it("admits as-me in a DM with a person and in a thread the owner is already in", () => {
    expect([
      findingIdentityRefusal({ ...SEND, surface: "direct-message" }),
      findingIdentityRefusal({ ...SEND, threadTs: "1789407961.767649" }),
    ]).toEqual([[], []]);
  });
});
