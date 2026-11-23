/**
 * The listener's conversation scope — the flags it parses, what falls inside it, and the command line and
 * arm record that carry it across a re-arm.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { Mention } from "../../../../live/listen/mention.js";
import {
  mentionInScope,
  parseListenScope,
  scopeArgs,
  scopeFromRecord,
  scopeLine,
  UNSCOPED,
} from "../../../../live/listen/scope.js";

/** A parsed address on one surface, in one conversation. */
function mention({ channel, surface }: { channel: string; surface: Mention["surface"] }): Mention {
  return {
    channel,
    messageTs: "1788743178.348089",
    surface,
    text: "<@U0BOT> status?",
    threadTs: "1788743178.348089",
    userId: "U0HUMAN",
  };
}

describe("parseListenScope", () => {
  it("is the unscoped listener when neither flag is given", () => {
    expect(unwrap(parseListenScope({ channelsFlag: undefined, dmOnly: false }))).toEqual({ kind: "all" });
  });

  it("is DMs only under --dm-only", () => {
    expect(unwrap(parseListenScope({ channelsFlag: undefined, dmOnly: true }))).toEqual({ kind: "dm-only" });
  });

  it("trims, drops empty parts and dedupes a --channels list", () => {
    expect(
      unwrap(parseListenScope({ channelsFlag: " C0SYN000002, D0SYN000001,,C0SYN000002 ", dmOnly: false })),
    ).toEqual({
      channels: ["C0SYN000002", "D0SYN000001"],
      kind: "channels",
    });
  });

  it("refuses both flags together rather than picking one", () => {
    const result = parseListenScope({ channelsFlag: "C0SYN000002", dmOnly: true });

    expect(unwrapErr(result)).toEqual([
      "--channels and --dm-only are mutually exclusive: name a DM's D… id in --channels to scope to one DM and some channels",
    ]);
  });

  it("refuses a --channels list that names nothing", () => {
    expect(unwrapErr(parseListenScope({ channelsFlag: " , ", dmOnly: false }))).toEqual([
      "--channels requires a comma-separated list of conversation ids",
    ]);
  });

  it("refuses a channel name where an id belongs, naming it", () => {
    expect(unwrapErr(parseListenScope({ channelsFlag: "C0SYN000002,#general", dmOnly: false }))).toEqual([
      "--channels takes Slack conversation ids (C…, G… or D…), not #general",
    ]);
  });

  it("refuses a valueless --channels", () => {
    expect(unwrapErr(parseListenScope({ channelsFlag: true, dmOnly: false }))).toEqual([
      "--channels requires a comma-separated list of conversation ids",
    ]);
  });
});

describe("mentionInScope", () => {
  const channelTag = mention({ channel: "C0SYN000002", surface: "channel" });
  const dmTag = mention({ channel: "D0SYN000001", surface: "dm" });

  it("admits every conversation when unscoped", () => {
    expect([
      mentionInScope({ mention: channelTag, scope: UNSCOPED }),
      mentionInScope({ mention: dmTag, scope: UNSCOPED }),
    ]).toEqual([true, true]);
  });

  it("admits only the DM surface under --dm-only", () => {
    const scope = { kind: "dm-only" } as const;

    expect([mentionInScope({ mention: channelTag, scope }), mentionInScope({ mention: dmTag, scope })]).toEqual([
      false,
      true,
    ]);
  });

  it("decides --dm-only on the typed surface, not on the id's leading letter", () => {
    expect(
      mentionInScope({
        mention: mention({ channel: "D0SYNLOOKSLIKEADM", surface: "channel" }),
        scope: { kind: "dm-only" },
      }),
    ).toBe(false);
  });

  it("admits only a listed conversation under --channels", () => {
    const scope = { channels: ["D0SYN000001"], kind: "channels" } as const;

    expect([mentionInScope({ mention: channelTag, scope }), mentionInScope({ mention: dmTag, scope })]).toEqual([
      false,
      true,
    ]);
  });
});

describe("scopeArgs", () => {
  it("adds nothing for the unscoped listener, so its command line is unchanged", () => {
    expect(scopeArgs({ scope: UNSCOPED })).toEqual([]);
  });

  it("reproduces each scope as the flags that parse back to it", () => {
    const channels = { channels: ["C0SYN000002", "D0SYN000001"], kind: "channels" } as const;

    expect(scopeArgs({ scope: channels })).toEqual(["--channels", "C0SYN000002,D0SYN000001"]);
    expect(scopeArgs({ scope: { kind: "dm-only" } })).toEqual(["--dm-only"]);
    expect(unwrap(parseListenScope({ channelsFlag: scopeArgs({ scope: channels })[1], dmOnly: false }))).toEqual(
      channels,
    );
  });
});

describe("scopeLine", () => {
  it("names each scope in words", () => {
    expect([
      scopeLine({ scope: UNSCOPED }),
      scopeLine({ scope: { kind: "dm-only" } }),
      scopeLine({ scope: { channels: ["C0SYN000002"], kind: "channels" } }),
    ]).toEqual([
      "every conversation the bot is in",
      "1:1 direct messages only (--dm-only)",
      "only C0SYN000002 (--channels)",
    ]);
  });
});

describe("scopeFromRecord", () => {
  it("reads an arm record written before scoping existed as unscoped", () => {
    expect(scopeFromRecord({ raw: undefined })).toEqual({ kind: "all" });
  });

  it("round-trips every scope through JSON", () => {
    const scopes = [UNSCOPED, { kind: "dm-only" }, { channels: ["C0SYN000002"], kind: "channels" }] as const;

    expect(scopes.map((scope) => scopeFromRecord({ raw: JSON.parse(JSON.stringify(scope)) }))).toEqual(scopes);
  });

  it("rejects a present value that is not a scope, rather than reading it as unscoped", () => {
    expect([
      scopeFromRecord({ raw: null }),
      scopeFromRecord({ raw: { kind: "everywhere" } }),
      scopeFromRecord({ raw: { channels: [], kind: "channels" } }),
      scopeFromRecord({ raw: { channels: ["C0SYN000002", 7], kind: "channels" } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
