import { describe, expect, it } from "vitest";

import { botLines, parseStoreBotsArgs } from "../../../cli/commands/store/bots.js";
import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { authorIsBot } from "../../../store/botAuthor.js";
import { type BotCandidate, botPageWrites } from "../../../store/resolveBots.js";

/** Renovate's Linear issue: the GitHub integration acting for a `[bot]` account, the shape bronze holds. */
const RENOVATE_LINEAR_ACTOR = {
  __typename: "ActorBot",
  name: "GitHub",
  subType: "github",
  type: "integration",
  userDisplayName: "acme-renovate[bot]",
};

describe("authorIsBot on Slack", () => {
  it("calls a message carrying a bot_id a bot's, the rule content_slack.is_bot has always used", () => {
    expect(authorIsBot({ authorNativeId: "U01", raw: { bot_id: "B0ALERT" }, source: "slack" })).toBe(true);
  });

  it("calls Slack's own bot_message subtype a bot's", () => {
    expect(authorIsBot({ authorNativeId: null, raw: { subtype: "bot_message" }, source: "slack" })).toBe(true);
  });

  it("leaves a person's message, and a person's thread_broadcast, human", () => {
    expect(authorIsBot({ authorNativeId: "U01", raw: { user: "U01" }, source: "slack" })).toBe(false);
    expect(authorIsBot({ authorNativeId: "U01", raw: { subtype: "thread_broadcast" }, source: "slack" })).toBe(false);
  });

  it("treats an empty bot_id as absent", () => {
    expect(authorIsBot({ authorNativeId: "U01", raw: { bot_id: "" }, source: "slack" })).toBe(false);
  });
});

describe("authorIsBot on GitHub", () => {
  it("calls a [bot] login a bot's, whatever the payload says", () => {
    expect(authorIsBot({ authorNativeId: "acme-renovate[bot]", raw: undefined, source: "github" })).toBe(true);
  });

  it("calls a payload user of type Bot a bot's", () => {
    expect(authorIsBot({ authorNativeId: "dependabot", raw: { user: { type: "Bot" } }, source: "github" })).toBe(true);
  });

  it("leaves a person's login human", () => {
    expect(authorIsBot({ authorNativeId: "octocat", raw: { user: { type: "User" } }, source: "github" })).toBe(false);
  });
});

describe("authorIsBot on Linear", () => {
  it("calls an integration acting for a [bot] account a bot's", () => {
    expect(authorIsBot({ authorNativeId: null, raw: { botActor: RENOVATE_LINEAR_ACTOR }, source: "linear" })).toBe(
      true,
    );
  });

  it("calls Linear's own workflow automation, with no human author beside it, a bot's", () => {
    const raw = { botActor: { name: "Linear", type: "workflow" }, creator: null, user: null };
    expect(authorIsBot({ authorNativeId: null, raw, source: "linear" })).toBe(true);
  });

  it("calls an OAuth client's comment, with no human author beside it, a bot's", () => {
    const raw = { botActor: { name: "CodeRabbit", type: "oauthClient" }, externalUser: null, user: null };
    expect(authorIsBot({ authorNativeId: null, raw, source: "linear" })).toBe(true);
  });

  it("leaves an automation actor human when a person is named beside it", () => {
    const raw = { botActor: { name: "Linear", type: "workflow" }, user: { id: "u-1" } };
    expect(authorIsBot({ authorNativeId: null, raw, source: "linear" })).toBe(false);
  });

  // The review's counterexample: 15,388 bronze records carry this slim shape, and the one it
  // named is a support lead's question synced from a Slack thread. A conduit is not an author.
  it("leaves a Slack-synced comment human even with no author object at all", () => {
    const raw = { botActor: { name: "Slack" }, externalUser: null, user: null };
    expect(authorIsBot({ authorNativeId: "Slack", raw, source: "linear" })).toBe(false);
  });

  it("leaves an integration conduit human whatever the integration", () => {
    const raw = { botActor: { name: "GitHub", subType: "github", type: "integration" }, creator: null };
    expect(authorIsBot({ authorNativeId: null, raw, source: "linear" })).toBe(false);
  });

  // The counterexample bronze holds: a Slack-Asks comment arrives through the Slack integration, but the
  // externalUser beside it is the person who wrote it. Hiding it would hide a person's words.
  it("leaves a Slack-Asks comment human, because the person who wrote it rides beside the botActor", () => {
    const raw = {
      botActor: { name: "Slack", type: "integration" },
      externalUser: { displayName: "John Smith" },
      user: null,
    };
    expect(authorIsBot({ authorNativeId: null, raw, source: "linear" })).toBe(false);
  });

  it("leaves a record with no botActor human", () => {
    expect(authorIsBot({ authorNativeId: "u-1", raw: { user: { id: "u-1" } }, source: "linear" })).toBe(false);
  });
});

describe("authorIsBot on a source with no automation marker", () => {
  it("answers false for Notion even under a [bot]-shaped id", () => {
    expect(authorIsBot({ authorNativeId: "integration[bot]", raw: { bot_id: "B1" }, source: "notion" })).toBe(false);
  });
});

/** One backfill candidate, defaulted to a human Slack row already stored as human. */
const candidate = (over: Partial<BotCandidate> = {}): BotCandidate => ({
  authorNativeId: "U01",
  id: "c-1",
  payload: { bot_id: null, subtype: null },
  source: "slack",
  stored: false,
  ...over,
});

describe("botPageWrites", () => {
  it("writes nothing for a page whose stored flags are already right", () => {
    expect(
      botPageWrites({ page: [candidate(), candidate({ id: "c-2", payload: { bot_id: "B1" }, stored: true })] }),
    ).toEqual([]);
  });

  it("flags a bot row stored as human, and clears a human row stored as a bot", () => {
    const page = [
      candidate({ id: "c-1", payload: { bot_id: "B1" }, stored: false }),
      candidate({ id: "c-2" }),
      candidate({ id: "c-3", stored: true }),
    ];
    expect(botPageWrites({ page })).toEqual([
      { flag: true, id: "c-1" },
      { flag: false, id: "c-3" },
    ]);
  });

  it("reads the payload subset a side table holds as null-valued keys as no signal", () => {
    const page = [
      candidate({ payload: { botActor: null, creator: null, externalUser: null, user: null }, source: "linear" }),
    ];
    expect(botPageWrites({ page })).toEqual([]);
  });
});

describe("botLines", () => {
  it("prints the pass's writes and the store's bot rows by source", () => {
    const lines = botLines({
      report: {
        bySource: [
          { rows: 9000, source: "slack" },
          { rows: 120, source: "github" },
        ],
        cleared: 2,
        flagged: 9118,
        rowsScanned: 3_371_051,
      },
    });
    expect(lines).toEqual([
      "scanned 3371051 row(s); flagged 9118 as bot-authored, cleared 2",
      "store now holds 9120 bot-authored row(s):",
      "  slack     9000",
      "  github    120",
    ]);
  });

  it("ends without a colon when the store holds no bot rows", () => {
    const lines = botLines({ report: { bySource: [], cleared: 0, flagged: 0, rowsScanned: 0 } });
    expect(lines.at(-1)).toBe("store now holds 0 bot-authored row(s)");
  });
});

describe("parseStoreBotsArgs", () => {
  it("omits every flag not given", () => {
    expect(unwrap(parseStoreBotsArgs({ rest: [] }))).toEqual({ json: false });
  });

  it("reads a batch and a home", () => {
    expect(unwrap(parseStoreBotsArgs({ rest: ["--batch", "500", "--home", "/h", "--json"] }))).toEqual({
      batch: 500,
      home: "/h",
      json: true,
    });
  });

  it("refuses a batch that is not a positive whole number", () => {
    const lines = storeCommandErrorLines({ error: unwrapErr(parseStoreBotsArgs({ rest: ["--batch", "0"] })) });
    expect(lines[0]).toContain("--batch");
  });
});
