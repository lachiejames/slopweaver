/*
 * The reader for `slack draft context --json`, over a document shaped exactly as the verb printed it for
 * `sd-8386bfdd` (a channel tail in #team-ops), trimmed to what each case needs.
 */

import { describe, expect, it } from "vitest";

import { draftContextStateOf } from "../../components/console/useDraftContext";
import { readDraftContext } from "../../components/live/readDraftContext";
import { messageLines } from "../../components/live/readSlackDraftsMessage";
import { draftContextArgv } from "../../lib/draftContextVerb";
import { draftLinesWords } from "../../lib/draftWords";

/** One message as the verb prints it; `over` replaces any field. */
function message({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    attachments: [],
    author: { userId: "U0SYN000007" },
    blocks: [
      {
        block_id: "ifGR2",
        elements: [
          {
            elements: [
              { type: "user", user_id: "U0SYN000001" },
              { text: " for the latency monitor ", type: "text" },
              {
                text: "github.com/acme/acme-admin/pull/17214",
                type: "link",
                url: "https://github.com/acme/acme-admin/pull/17214",
              },
            ],
            type: "rich_text_section",
          },
        ],
        type: "rich_text",
      },
    ],
    edited: true,
    fileCount: 0,
    permalink: "https://acme.slack.com/archives/C0SYN000007/p1789100342176139",
    replyCount: 2,
    text: "<@U0SYN000001> for the latency monitor <https://github.com/acme/acme-admin/pull/17214|github.com/acme/acme-admin/pull/17214>",
    ts: "1789100342.176139",
    tsIso: "2026-09-11T04:19:02.000Z",
    ...over,
  };
}

/** The whole document; `over` replaces any top-level field. */
function document({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    channel: "C0SYN000007",
    earlierWithheld: true,
    id: "sd-8386bfdd",
    kind: "slopweaver.slack.draft-context",
    link: "https://acme.slack.com/archives/C0SYN000007",
    messages: [message()],
    observedAtIso: "2026-09-29T02:20:40.922Z",
    people: [
      { bot: false, handle: "jonah.yates", name: "Jonah Yates", nativeId: "U0SYN000007" },
      { bot: false, handle: "ada.owner", name: "Ada Owner", nativeId: "U0SYN000001" },
    ],
    schemaVersion: 2,
    scope: "channel",
    sinceDrafted: {
      added: [],
      draftedIso: "2026-09-10T22:00:00.000Z",
      edited: [],
      kind: "measured",
      limits: [],
      removed: [],
    },
    ...over,
  };
}

describe("readDraftContext", () => {
  it("reads the envelope, each message's rich text as runs, and the roster naming every member", () => {
    const context = readDraftContext(document())!;
    expect(context.id).toBe("sd-8386bfdd");
    expect(context.scope).toBe("channel");
    expect(context.earlierWithheld).toBe(true);
    expect(context.link).toBe("https://acme.slack.com/archives/C0SYN000007");
    expect(context.people.get("U0SYN000007")!.name).toBe("Jonah Yates");
    const first = context.messages.at(0)!;
    expect(first.userId).toBe("U0SYN000007");
    expect(first.bot).toBe(false);
    expect(first.edited).toBe(true);
    expect(first.replyCount).toBe(2);
    expect(first.lines.at(0)!.runs.map((run) => run.kind)).toEqual(["user", "text", "link"]);
  });

  it("badges APP on a bot member's message, an app with no member behind it, and an app the roster cannot name", () => {
    const claude = { bot: true, handle: "claude", name: "Claude", nativeId: "U0SYN000028" };
    const context = readDraftContext(
      document({
        over: {
          messages: [
            message({ over: { author: { botId: "B0SYN000011", userId: "U0SYN000028" } } }),
            message({ over: { author: { botId: "B0WEBHOOK01", username: "deploy-bot" } } }),
            message({ over: { author: { botId: "B0UNKNOWN01", userId: "U0SYNUNROSTERD" } } }),
            message({ over: { author: { userId: "U0SYNUNROSTERD" } } }),
          ],
          people: [claude],
        },
      }),
    )!;
    expect(context.messages.map((each) => each.bot)).toEqual([true, true, true, false]);
  });

  it("draws a person's own message sent through an app on their token unbadged, as Slack does", () => {
    const viaApp = message({ over: { author: { botId: "B0SYN000012", userId: "U0SYN000001" } } });
    const context = readDraftContext(document({ over: { messages: [viaApp] } }))!;
    expect(context.messages.at(0)!.bot).toBe(false);
  });

  it("refuses a roster whose bot field is not a flag", () => {
    const people = [{ bot: "yes", name: "Claude", nativeId: "U0SYN000028" }];
    expect(readDraftContext(document({ over: { people } }))).toBe(undefined);
  });

  it("reads an empty conversation as one, not as a failure", () => {
    expect(readDraftContext(document({ over: { messages: [] } }))!.messages).toEqual([]);
  });

  it("refuses a document of another kind or version", () => {
    expect(readDraftContext(document({ over: { kind: "slopweaver.slack.thread" } }))).toBe(undefined);
    expect(readDraftContext(document({ over: { schemaVersion: 1 } }))).toBe(undefined);
    expect(readDraftContext(document({ over: { schemaVersion: 3 } }))).toBe(undefined);
    expect(readDraftContext("not json")).toBe(undefined);
  });

  it("reads what moved since the draft was written, exactly as the verb measured it", () => {
    const moved = {
      added: ["1789100342.176139"],
      draftedIso: "2026-09-10T22:00:00.000Z",
      edited: [],
      kind: "measured",
      limits: ["Only the newest messages were read."],
      removed: ["1789000000.000100"],
    };
    expect(readDraftContext(document({ over: { sinceDrafted: moved } }))!.sinceDrafted).toEqual(moved);
    const notMeasured = { kind: "not-measured", why: "its recording instant x is not a date" };
    expect(readDraftContext(document({ over: { sinceDrafted: notMeasured } }))!.sinceDrafted).toEqual(notMeasured);
  });

  it("refuses the whole reading when the since-drafted measurement will not read", () => {
    const measured = (over: Record<string, unknown>): Record<string, unknown> => ({
      added: [],
      draftedIso: "2026-09-10T22:00:00.000Z",
      edited: [],
      kind: "measured",
      limits: [],
      removed: [],
      ...over,
    });
    const refused = [
      undefined,
      { kind: "guessed" },
      { kind: "not-measured", why: " " },
      measured({ draftedIso: "2026-09-10" }),
      measured({ added: [7] }),
      measured({ limits: "partial" }),
      measured({ removed: ["1789000000.000100", "1789000000.000100"] }),
      measured({ added: ["1789100342.176139"], edited: ["1789100342.176139"] }),
      measured({ added: ["1789999999.000000"] }),
    ];
    expect(refused.map((sinceDrafted) => readDraftContext(document({ over: { sinceDrafted } })))).toEqual(
      refused.map(() => undefined),
    );
  });

  it("refuses the whole reading when one message's envelope will not read, rather than drawing it short", () => {
    expect(readDraftContext(document({ over: { messages: [message(), message({ over: { tsIso: 7 } })] } }))).toBe(
      undefined,
    );
    expect(readDraftContext(document({ over: { messages: [message({ over: { replyCount: -1 } })] } }))).toBe(undefined);
  });

  it("refuses a scope it does not draw and a roster naming one member twice", () => {
    expect(readDraftContext(document({ over: { scope: "dm" } }))).toBe(undefined);
    const twice = [
      { name: "Jonah Yates", nativeId: "U0SYN000007" },
      { name: "Someone Else", nativeId: "U0SYN000007" },
    ];
    expect(readDraftContext(document({ over: { people: twice } }))).toBe(undefined);
  });
});

describe("draftContextStateOf", () => {
  it("draws a reading taken for the draft asked about", () => {
    const state = draftContextStateOf({ body: { context: document(), ok: true }, id: "sd-8386bfdd" });
    expect(state.phase).toBe("ready");
  });

  it("refuses a reading of another draft, so a re-cut card never draws the last cut's conversation", () => {
    expect(draftContextStateOf({ body: { context: document(), ok: true }, id: "sd-0c0c0c0c" })).toEqual({
      phase: "not-measured",
      why: "slack draft context answered for sd-8386bfdd, not sd-0c0c0c0c",
    });
  });

  it("carries the route's own reason when the read failed", () => {
    expect(draftContextStateOf({ body: { notMeasured: "timed out", ok: false }, id: "sd-8386bfdd" })).toEqual({
      phase: "not-measured",
      why: "timed out",
    });
  });
});

describe("messageLines", () => {
  it("falls back to Slack's own mrkdwn text when a block is one the reader does not draw, unescaping it", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [{ image_url: "https://example.com/chart.png", type: "image" }],
      text: "cc <@U0SYN000001> *now* &amp; <https://example.com/a?b=1&amp;c=2|the doc>",
    });
    expect(lines.at(0)!.runs).toEqual([
      { bold: false, code: false, italic: false, kind: "text", text: "cc " },
      { kind: "user", userId: "U0SYN000001" },
      { bold: false, code: false, italic: false, kind: "text", text: " " },
      { bold: true, code: false, italic: false, kind: "text", text: "now" },
      { bold: false, code: false, italic: false, kind: "text", text: " & " },
      { kind: "link", label: "the doc", url: "https://example.com/a?b=1&c=2" },
    ]);
  });

  it("reads a link inside an app's bold text as a link, keeping the bold on the words around it", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [],
      text: "*Excludes <https://github.com/o/r/compare/a...b|8 staging commits> ahead*",
    });
    expect(lines.at(0)!.runs).toEqual([
      { bold: true, code: false, italic: false, kind: "text", text: "Excludes " },
      { kind: "link", label: "8 staging commits", url: "https://github.com/o/r/compare/a...b" },
      { bold: true, code: false, italic: false, kind: "text", text: " ahead" },
    ]);
  });

  it("reads a user-group ping and a broadcast as the chips Slack draws, never as a member", () => {
    const lines = messageLines({ attachments: [], blocks: [], text: "<!subteam^S0SYN000011> <!here>" });
    expect(lines.at(0)!.runs).toEqual([
      { groupId: "S0SYN000011", handle: undefined, kind: "usergroup" },
      { bold: false, code: false, italic: false, kind: "text", text: " " },
      { kind: "broadcast", range: "here" },
    ]);
  });

  it("draws a tagged team in a message above the draft by its handle, else as a group — never its S… id", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [],
      text: "<!subteam^S0SYN000012|@platform> and <!subteam^S0SYN000012> can you review",
    });
    expect(lines.at(0)!.runs).toEqual([
      { groupId: "S0SYN000012", handle: "@platform", kind: "usergroup" },
      { bold: false, code: false, italic: false, kind: "text", text: " and " },
      { groupId: "S0SYN000012", handle: undefined, kind: "usergroup" },
      { bold: false, code: false, italic: false, kind: "text", text: " can you review" },
    ]);
    expect(draftLinesWords({ labels: { mentions: [], people: new Map() }, lines })).toBe(
      "@platform and @a group can you review",
    );
  });

  it("draws a rich-text user group, which carries no handle, as a group rather than its S… id", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [
        {
          elements: [
            {
              elements: [
                { type: "usergroup", usergroup_id: "S0SYN000012" },
                { text: " team, can you review this", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
      text: "<!subteam^S0SYN000012> team, can you review this",
    });
    expect(draftLinesWords({ labels: { mentions: [], people: new Map() }, lines })).toBe(
      "@a group team, can you review this",
    );
  });

  it("keeps an underscore inside a word as a word, so the link after it still reads as a link", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [],
      text: "api_gateway up, see <https://example.com/m?from_ts=1|monitor>",
    });
    expect(lines.at(0)!.runs).toEqual([
      { bold: false, code: false, italic: false, kind: "text", text: "api_gateway up, see " },
      { kind: "link", label: "monitor", url: "https://example.com/m?from_ts=1" },
    ]);
  });

  it("draws a Slack date command as its written fallback, never as a person", () => {
    const lines = messageLines({ attachments: [], blocks: [], text: "window <!date^1700000000^{date_short}|Nov 14>" });
    expect(lines.at(0)!.runs).toEqual([
      { bold: false, code: false, italic: false, kind: "text", text: "window " },
      { bold: false, code: false, italic: false, kind: "text", text: "Nov 14" },
    ]);
  });

  /** Each line as its frame and its runs' words, which is what these cases turn on. */
  const shape = ({ lines }: { lines: ReturnType<typeof messageLines> }): unknown[] =>
    lines.map((line) => [line.frame, line.runs.map((run) => (run.kind === "text" ? run.text : run.kind))]);

  it("draws a forwarded message under the comment it came with, headed by whose words they are", () => {
    const comment = {
      elements: [{ elements: [{ text: "fyi", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    };
    const forwarded = {
      author_name: "Kieran Mendez",
      fallback: "[September 28th] kieran: the deploy is blocked",
      is_share: true,
      text: "the deploy is blocked",
    };
    const lines = messageLines({ attachments: [forwarded], blocks: [comment], text: "fyi" });
    expect(shape({ lines })).toEqual([
      [undefined, ["fyi"]],
      ["quote", ["Kieran Mendez"]],
      ["quote", ["the deploy is blocked"]],
    ]);
  });

  it("keeps an app card's title and says how many fields it does not draw", () => {
    const card = {
      fallback: "Triggered: p99 latency on api",
      fields: [{ title: "env", value: "prod" }],
      text: "over the last 5m",
      title: "Triggered: p99 latency on api",
    };
    expect(shape({ lines: messageLines({ attachments: [card], blocks: [], text: "" }) })).toEqual([
      ["quote", ["Triggered: p99 latency on api"]],
      ["quote", ["over the last 5m"]],
      ["quote", ["1 field not drawn here, open it in Slack"]],
    ]);
  });

  it("draws a bot answer's whole card from its blocks, not just the headline its fallback carries", () => {
    const answer = {
      blocks: [
        {
          elements: [
            { image_url: "https://x/y.png", type: "image" },
            { text: "*acme-bot*", type: "mrkdwn" },
          ],
          type: "context",
        },
        { type: "divider" },
        {
          text: { text: "Staging pool exhausted\n• pool max hit <https://example.com/g|graph>", type: "mrkdwn" },
          type: "section",
        },
        { elements: [{ text: { text: "Open", type: "plain_text" }, type: "button" }], type: "actions" },
      ],
      fallback: "Staging pool exhausted",
    };
    expect(shape({ lines: messageLines({ attachments: [answer], blocks: [], text: "" }) })).toEqual([
      ["quote", ["acme-bot"]],
      ["quote", ["Staging pool exhausted"]],
      ["quote", ["• pool max hit ", "link"]],
    ]);
  });

  it("draws a section-block post from its blocks, and names a block it cannot draw rather than dropping it", () => {
    const header = { text: { text: "Deploy report", type: "plain_text" }, type: "header" };
    const drawn = messageLines({ attachments: [], blocks: [header], text: "deploy report" });
    expect(shape({ lines: drawn })).toEqual([[undefined, ["Deploy report"]]]);
    const chart = { image_url: "https://x/c.png", type: "image" };
    const partial = messageLines({ attachments: [], blocks: [header, chart], text: "deploy report" });
    expect(shape({ lines: partial })).toEqual([
      [undefined, ["deploy report"]],
      [undefined, ["the message's own layout not drawn here, open it in Slack"]],
    ]);
  });

  it("draws a fenced code block literally in a code frame, never as markup", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [],
      text: "Failing query:\n```\nSELECT *, count(*) FROM users\n```",
    });
    expect(shape({ lines })).toEqual([
      [undefined, ["Failing query:"]],
      ["code", ["SELECT *, count(*) FROM users"]],
    ]);
  });

  it("opens and closes a code block partway through a line, as Slack does", () => {
    const lines = messageLines({
      attachments: [],
      blocks: [],
      text: "Query failed: ```SELECT *, count(*) FROM users\nWHERE org_id = 7``` then *retried* ```a * b``` ok",
    });
    expect(shape({ lines })).toEqual([
      [undefined, ["Query failed: "]],
      ["code", ["SELECT *, count(*) FROM users"]],
      ["code", ["WHERE org_id = 7"]],
      [undefined, [" then ", "retried", " "]],
      ["code", ["a * b"]],
      [undefined, [" ok"]],
    ]);
  });

  it("draws a rich-text link whose scheme a card may not link as its words", () => {
    const block = {
      elements: [
        {
          elements: [
            { text: "run it", type: "link", url: "javascript:alert(1)" },
            { text: " or ", type: "text" },
            { text: "the runbook", type: "link", url: "https://example.com/rb" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    };
    expect(messageLines({ attachments: [], blocks: [block], text: "" }).map((line) => line.runs)).toEqual([
      [
        { bold: false, code: false, italic: false, kind: "text", text: "run it" },
        { bold: false, code: false, italic: false, kind: "text", text: " or " },
        { kind: "link", label: "the runbook", url: "https://example.com/rb" },
      ],
    ]);
  });

  it("numbers a list resumed after a nested one from where it resumes, as Slack does", () => {
    const item = ({ words }: { words: string }): Record<string, unknown> => ({
      elements: [{ text: words, type: "text" }],
      type: "rich_text_section",
    });
    const block = {
      elements: [
        { elements: [item({ words: "restart api" })], style: "ordered", type: "rich_text_list" },
        { elements: [item({ words: "check pool" })], indent: 1, style: "bullet", type: "rich_text_list" },
        { elements: [item({ words: "rollback" })], offset: 1, style: "ordered", type: "rich_text_list" },
      ],
      type: "rich_text",
    };
    const lines = messageLines({ attachments: [], blocks: [block], text: "" });
    // The nested bullet takes Slack's second glyph, since it sits one indent in.
    expect(lines.map((line) => line.marker)).toEqual(["1.", "◦", "2."]);
  });

  it("keeps an alert's title link and a url button as links, and a post-back button as nothing", () => {
    const alert = {
      actions: [
        { text: "View incident", type: "button", url: "https://example.pagerduty.com/incidents/Q1" },
        { name: "ack", text: "Acknowledge", type: "button" },
      ],
      text: "over 5m",
      title: "Triggered: p99 on api",
      title_link: "https://app.datadoghq.com/monitors/123",
    };
    const lines = messageLines({ attachments: [alert], blocks: [], text: "" });
    expect(lines.at(0)!.runs).toEqual([
      { kind: "link", label: "Triggered: p99 on api", url: "https://app.datadoghq.com/monitors/123" },
    ]);
    expect(lines.at(2)!.runs).toEqual([
      { kind: "link", label: "View incident", url: "https://example.pagerduty.com/incidents/Q1" },
    ]);
    expect(lines.length).toBe(3);
  });

  it("names a forwarded message's files and a card's picture rather than dropping them", () => {
    const forwarded = {
      author_name: "Kieran Mendez",
      files: [{ id: "F1", name: "p99.png" }],
      image_url: "https://example.com/p99.png",
      text: "see graph",
    };
    expect(shape({ lines: messageLines({ attachments: [forwarded], blocks: [], text: "" }) })).toEqual([
      ["quote", ["Kieran Mendez"]],
      ["quote", ["see graph"]],
      ["quote", ["1 file not drawn here, open it in Slack"]],
      ["quote", ["a picture not drawn here, open it in Slack"]],
    ]);
  });

  it("draws an app's fallback once when the message text already says it", () => {
    const lines = messageLines({ attachments: [{ fallback: "deploy failed" }], blocks: [], text: "deploy failed" });
    expect(shape({ lines })).toEqual([[undefined, ["deploy failed"]]]);
  });

  it("leaves a cron line's asterisks alone, as Slack does", () => {
    const lines = messageLines({ attachments: [], blocks: [], text: "schedule 0 * * * *" });
    expect(shape({ lines })).toEqual([[undefined, ["schedule 0 * * * *"]]]);
  });

  it("splits the text on its newlines, one line each", () => {
    expect(messageLines({ attachments: [], blocks: [], text: "one\ntwo\n" }).length).toBe(2);
  });

  it("draws an app card's fallback when the message itself carries no text", () => {
    const lines = messageLines({ attachments: [{ fallback: "deploy failed" }], blocks: [], text: "" });
    expect(lines.at(0)!.runs).toEqual([
      { bold: false, code: false, italic: false, kind: "text", text: "deploy failed" },
    ]);
  });

  it("gives no lines when Slack gave nothing to draw, which the card says in words", () => {
    expect(messageLines({ attachments: [], blocks: [], text: "  " })).toEqual([]);
  });
});

describe("draftContextArgv", () => {
  it("builds the literal argv for an id shaped as slack draft mints one", () => {
    expect(draftContextArgv({ id: "sd-8386bfdd" })).toEqual({
      argv: ["slack", "draft", "context", "sd-8386bfdd", "--json"],
      kind: "argv",
      title: "slopweaver slack draft context sd-8386bfdd --json",
    });
  });

  it("refuses anything else before it becomes an argv element", () => {
    expect(draftContextArgv({ id: "--home=/tmp" }).kind).toBe("refused");
    expect(draftContextArgv({ id: "sd-8386BFDD" }).kind).toBe("refused");
    expect(draftContextArgv({ id: "sd-8386bfdd\n" }).kind).toBe("refused");
  });
});
