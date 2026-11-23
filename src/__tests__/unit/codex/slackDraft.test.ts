/**
 * `slackDraft.ts` and `draftQuote.ts` — the Codex half of a draft comparison: the conversation the pass is shown, the
 * prompt it is given blind to the original, and its answer parsed into a drip `--form`.
 */
import { describe, expect, it } from "vitest";

import { purposeQuotesDraft } from "../../../codex/draftQuote.js";
import {
  draftConversationLines,
  draftPassReached,
  parseSlackDraftAnswer,
  type SlackDraftBrief,
  slackDraftPrompt,
} from "../../../codex/slackDraft.js";
import type { CodexAttempt, ItemActivity } from "../../../codex/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One answered attempt whose activity is `items`. */
function attempt({ items }: { items: ItemActivity }): CodexAttempt {
  return {
    elapsedMs: 4200,
    finishedAtIso: "2026-10-09T11:07:04.200Z",
    items,
    kind: "initial",
    startedAtIso: "2026-10-09T11:07:00.000Z",
    status: "answered",
    threadId: "thread-1",
    usage: { kind: "not-measured", reason: "aborted" },
  };
}

describe("draftPassReached", () => {
  it("passes a pass that only reasoned and answered, and one with a measured zero", () => {
    const quiet = attempt({ items: { counts: { agent_message: 1, reasoning: 2 }, kind: "measured" } });
    const zero = attempt({ items: { counts: { agent_message: 1, command_execution: 0 }, kind: "measured" } });
    expect(draftPassReached({ attempts: [quiet, zero] })).toBe(undefined);
  });

  it("withholds the draft of a pass that ran a command, on any attempt", () => {
    const quiet = attempt({ items: { counts: { agent_message: 1 }, kind: "measured" } });
    const reading = attempt({ items: { counts: { agent_message: 1, command_execution: 1 }, kind: "measured" } });
    expect(draftPassReached({ attempts: [quiet, reading] })).toBe(
      "Codex used a tool (command_execution) where it must draft from its prompt alone, so it could have read A",
    );
  });

  it("names every tool kind used, an unknown one included", () => {
    const counts = { file_change: 1, mcp_tool_call: 2, unknown: 1, web_search: 1 };
    expect(draftPassReached({ attempts: [attempt({ items: { counts, kind: "measured" } })] })).toBe(
      "Codex used a tool (file_change, mcp_tool_call, unknown, web_search) where it must draft from its prompt alone, " +
        "so it could have read A",
    );
  });

  it("withholds any kind but a message or reasoning, a plan list included", () => {
    const counts = { agent_message: 1, todo_list: 1 };
    expect(draftPassReached({ attempts: [attempt({ items: { counts, kind: "measured" } })] })).toBe(
      "Codex used a tool (todo_list) where it must draft from its prompt alone, so it could have read A",
    );
  });

  it("withholds one whose activity nobody measured", () => {
    expect(draftPassReached({ attempts: [attempt({ items: { kind: "not-measured", reason: "aborted" } })] })).toBe(
      "what Codex did was not measured (aborted), so its draft cannot be shown as blind to A",
    );
  });
});

describe("purposeQuotesDraft", () => {
  const words = "Four groups, one question. Which is the right state?";

  it("catches six of the original's words in a row, ignoring case and punctuation", () => {
    expect(purposeQuotesDraft({ purpose: "ask: one question, which is the RIGHT state", words })).toBe(true);
  });

  it("catches the whole of an original shorter than six words", () => {
    expect(
      purposeQuotesDraft({ purpose: "reply 'sounds good, ship it' to Seth", words: "Sounds good, ship it." }),
    ).toBe(true);
  });

  it("reads a labelled link as its label, so a run quoted across it is caught", () => {
    const linked = "Please read this important <https://example.com/guide|deployment guide> now";
    expect(purposeQuotesDraft({ purpose: "Please read this important deployment guide now", words: linked })).toBe(
      true,
    );
  });

  it("lets a bare mention match the name the purpose writes, so an original of mentions alone is always quoted", () => {
    expect(purposeQuotesDraft({ purpose: "Please ask Seth today", words: "Please ask <@U0SETH> today" })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "Seth Pat", words: "<@U0SETH> <@U0PAT>" })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "Seth", words: "<@U0SETH> <@U0PAT>" })).toBe(false);
  });

  it("lets a mention match a name of several words", () => {
    const named = "Hello <@UALICE> please ship this";
    expect(purposeQuotesDraft({ purpose: "Hello Alice Smith please ship this", words: named })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "Hello Alice Mary Jane Smith please ship this", words: named })).toBe(true);
  });

  it("counts the six words in what Slack shows, a mention's whole name included", () => {
    const longer = "Hello <@UALICE> please ship this today";
    expect(purposeQuotesDraft({ purpose: "Hello Alice Mary Jane Smith please", words: longer })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "Hello Alice Smith please", words: longer })).toBe(false);
  });

  it("reads an escaped ampersand as Slack shows it, so it never splits a quoted run", () => {
    const escaped = "one two &amp; three four five six";
    expect(purposeQuotesDraft({ purpose: "one two three four five six", words: escaped })).toBe(true);
  });

  it("reads a token's own text as well as its fallback, so a date's format words count", () => {
    const dated = "<!date^1791586800^alpha beta gamma delta epsilon zeta {date_short}|fallback>";
    expect(purposeQuotesDraft({ purpose: "alpha beta gamma delta epsilon zeta", words: dated })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "fallback", words: dated })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "alpha beta gamma", words: `${dated} and more words here` })).toBe(false);
  });

  it("reads a short date token's format as the whole of A", () => {
    const short = "<!date^1791586800^alpha beta|fallback>";
    expect(purposeQuotesDraft({ purpose: "alpha beta", words: short })).toBe(true);
    const placed = "<!date^1791586800^alpha {date_short} beta^https://example.com|fallback>";
    expect(purposeQuotesDraft({ purpose: "alpha beta", words: placed })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "alpha", words: short })).toBe(false);
  });

  it("reads each token its own way, so a run may cross a link's label into a date's format (twenty-seventh)", () => {
    const mixed = "<https://example.com|alpha beta gamma> <!date^1791586800^delta epsilon zeta|fallback>";
    expect(purposeQuotesDraft({ purpose: "alpha beta gamma delta epsilon zeta", words: mixed })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "https example com fallback", words: mixed })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "alpha beta gamma delta epsilon", words: `${mixed} tail` })).toBe(false);
    // A run that begins partway into a label, and one that ends partway into a long one.
    const label = "<https://example.com|one two three four> five six seven";
    expect(purposeQuotesDraft({ purpose: "three four five six seven eight", words: `start ${label}` })).toBe(false);
    expect(purposeQuotesDraft({ purpose: "two three four five six seven", words: `start ${label}` })).toBe(true);
    const long = "intro <https://example.com|a b c d e f g h> outro";
    expect(purposeQuotesDraft({ purpose: "intro a b c d e", words: long })).toBe(true);
  });

  it("reads a token drawn literally in a code span, its head running into its label (thirty-second pass)", () => {
    const literal = "`<https://one.two.three.four.five|alpha beta gamma delta epsilon>`";
    expect(purposeQuotesDraft({ purpose: "three four five alpha beta gamma", words: literal })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "three four five alpha beta gamma", words: "unrelated words" })).toBe(false);
  });

  it("reads a case change that adds a mark as the same word", () => {
    expect(purposeQuotesDraft({ purpose: "istanbul release", words: "İstanbul release" })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "STRASSE release", words: "straße release" })).toBe(true);
    expect(purposeQuotesDraft({ purpose: "istanbul launch", words: "İstanbul release" })).toBe(false);
  });

  it("sees through invisible characters and compatibility forms inside a quoted word", () => {
    const hidden = "p​lease a​pprove th­e p⁠roduction r﻿elease ｔｏｄａｙ";
    expect(purposeQuotesDraft({ purpose: hidden, words: "please approve the production release today" })).toBe(true);
  });

  it("passes a purpose sharing only five words in a row, or none", () => {
    expect(purposeQuotesDraft({ purpose: "one question which is the", words })).toBe(false);
    expect(purposeQuotesDraft({ purpose: "the ISO group question", words })).toBe(false);
  });

  it("passes an original with no words at all", () => {
    expect(purposeQuotesDraft({ purpose: "the ISO group question", words: " — " })).toBe(false);
  });
});

const BRIEF: SlackDraftBrief = {
  act: "reply",
  channel: "C0123456789",
  channelName: "team-eng",
  conversation: [
    { author: "U0SETH", text: "who owns the ISO group?", ts: "1760000000.000100" },
    { author: "U0HIM", text: "checking", ts: "1760000001.000100" },
  ],
  priorAsk: undefined,
  selfUserId: "U0HIM",
  threadTs: "1760000000.000100",
  voiceBrief: ["No em dashes."],
  why: "owed: who owns ISO",
};

describe("draftConversationLines", () => {
  it("keeps ts, author and text, oldest first, passing over a row with no text", () => {
    const lines = draftConversationLines({
      rows: [
        { text: "second", ts: "1760000002.000100", user: "U0SETH" },
        { bot_id: "B0BOT", text: "first", ts: "1760000001.000100" },
        { attachments: [], text: "", ts: "1760000003.000100" },
        "not a row",
      ],
    });
    expect(lines).toEqual([
      { author: "B0BOT", text: "first", ts: "1760000001.000100" },
      { author: "U0SETH", text: "second", ts: "1760000002.000100" },
    ]);
  });

  it("marks a file beside text, and reads an app card's attachment", () => {
    const lines = draftConversationLines({
      rows: [
        { files: [{ id: "F0" }], text: "see the graph", ts: "1760000001.000100", user: "U0SETH" },
        { attachments: [{ fallback: "deploy failed" }], bot_id: "B0CI", text: "", ts: "1760000002.000100" },
      ],
    });
    expect(lines).toEqual([
      {
        author: "U0SETH",
        text: "see the graph [an attachment or file is here, not shown to you]",
        ts: "1760000001.000100",
      },
      { author: "B0CI", text: "deploy failed", ts: "1760000002.000100" },
    ]);
  });

  it("reads a Block Kit card's words, never doubles a message's own rich text, and marks a card with none", () => {
    const ownWords = {
      blocks: [
        {
          elements: [{ elements: [{ text: "who owns this?", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      text: "who owns this?",
      ts: "1760000001.000100",
      user: "U0SETH",
    };
    const card = {
      blocks: [{ text: { text: "Deploy failed on prod", type: "mrkdwn" }, type: "section" }],
      bot_id: "B0CI",
      text: "",
      ts: "1760000002.000100",
    };
    const picture = {
      blocks: [{ alt_text: "", image_url: "https://example.com/g.png", type: "image" }],
      bot_id: "B0CI",
    };
    const lines = draftConversationLines({ rows: [ownWords, card, { ...picture, text: "", ts: "1760000003.000100" }] });
    expect(lines.map((line) => line.text)).toEqual([
      "who owns this?",
      "Deploy failed on prod",
      "[an attachment or file is here, not shown to you]",
    ]);
  });

  it("keeps the newest forty, each cut to 2,000 characters", () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({
      text: "x".repeat(2500),
      ts: `17600000${String(index).padStart(2, "0")}.000100`,
      user: "U0SETH",
    }));
    const lines = draftConversationLines({ rows });
    expect(lines.length).toBe(40);
    expect(lines[0]!.ts).toBe("1760000005.000100");
    expect(lines[0]!.text.length).toBe(2000);
  });

  it("marks a picture beside text, and keeps the mark on a line cut to length", () => {
    const marker = "[an attachment or file is here, not shown to you]";
    const graph = {
      blocks: [{ alt_text: "", image_url: "https://example.com/g.png", type: "image" }],
      text: "see the graph",
      ts: "1760000001.000100",
      user: "U0SETH",
    };
    const long = { files: [{ id: "F0" }], text: "y".repeat(2500), ts: "1760000002.000100", user: "U0SETH" };
    const [beside, cut] = draftConversationLines({ rows: [graph, long] });
    expect(beside!.text).toBe(`see the graph ${marker}`);
    expect(cut!.text).toBe(`${"y".repeat(2000 - marker.length - 1)} ${marker}`);
  });

  it("marks a picture nested beside a card's prose: a section's image accessory, an attachment's thumbnail", () => {
    const marker = "[an attachment or file is here, not shown to you]";
    const accessory = {
      blocks: [
        {
          accessory: { alt_text: "", image_url: "https://example.com/chart.png", type: "image" },
          text: { text: "Latency changed after deploy", type: "mrkdwn" },
          type: "section",
        },
      ],
      bot_id: "B0CI",
      text: "",
      ts: "1760000001.000100",
    };
    const thumb = {
      attachments: [{ fallback: "deploy failed", thumb_url: "https://example.com/t.png" }],
      bot_id: "B0CI",
      text: "",
      ts: "1760000002.000100",
    };
    expect(draftConversationLines({ rows: [accessory, thumb] }).map((line) => line.text)).toEqual([
      `Latency changed after deploy ${marker}`,
      `deploy failed ${marker}`,
    ]);
  });
});

describe("slackDraftPrompt", () => {
  it("names the destination, marks the owner's own lines and carries the voice brief", () => {
    const prompt = slackDraftPrompt({ brief: BRIEF });
    expect(prompt).toContain("A reply in the thread under 1760000000.000100 in #team-eng (C0123456789).");
    expect(prompt).toContain("[1760000001.000100] <U0HIM> (the owner): checking");
    expect(prompt).toContain("[1760000000.000100] <U0SETH>: who owns the ISO group?");
    expect(prompt).toContain("No em dashes.");
    expect(prompt).toContain("What it is for, in the words of the session that asked for it: owed: who owns ISO");
  });

  it("says a top-level post and an unread conversation plainly", () => {
    const prompt = slackDraftPrompt({
      brief: { ...BRIEF, channelName: undefined, conversation: [], threadTs: undefined },
    });
    expect(prompt).toContain("A top-level message in C0123456789.");
    expect(prompt).toContain("(No conversation was read: the message opens a direct message with a person.)");
  });

  it("requires an opening of a top-level channel post, and null of a reply or a DM", () => {
    const channelTop = slackDraftPrompt({ brief: { ...BRIEF, threadTs: undefined } });
    expect(channelTop).toContain("- `opening` is required: this is a top-level channel post");
    expect(slackDraftPrompt({ brief: BRIEF })).toContain("- `opening` is `null`: this message is not a top-level");
    expect(slackDraftPrompt({ brief: { ...BRIEF, channel: "D0SYN123456789", threadTs: undefined } })).toContain(
      "- `opening` is `null`",
    );
  });
});

describe("parseSlackDraftAnswer", () => {
  it("turns the answer into one drip message, dropping a text run's false flags", () => {
    const response = JSON.stringify({
      problem: { kind: "none" },
      runs: [
        { bold: false, code: false, italic: false, text: "It is ", type: "text" },
        { bold: true, code: false, italic: false, text: "Seth's", type: "text" },
        { person: "U0SETH", type: "mention" },
      ],
    });
    expect(JSON.parse(unwrap(parseSlackDraftAnswer({ response })).form)).toEqual({
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "It is ", type: "text" },
            { bold: true, text: "Seth's", type: "text" },
            { person: "U0SETH", type: "mention" },
          ],
        },
      ],
      problem: { kind: "none" },
    });
  });

  it("refuses an answer with no JSON object", () => {
    expect(unwrapErr(parseSlackDraftAnswer({ response: "no json here" }))).toEqual([
      "the response contained no JSON object",
    ]);
  });

  it("names every shape fault at once", () => {
    const response = JSON.stringify({ problem: { kind: "maybe" }, runs: [{ type: "broadcast" }] });
    expect(unwrapErr(parseSlackDraftAnswer({ response }))).toEqual([
      'every entry of "runs" must be a text, link, mention or group run',
      'field "problem" must declare kind "none" or "possible"',
    ]);
  });

  it("refuses an empty message", () => {
    const response = JSON.stringify({ problem: { kind: "none" }, runs: [] });
    expect(unwrapErr(parseSlackDraftAnswer({ response }))).toEqual(['field "runs" must be a non-empty array']);
  });

  it("carries a declared opening into the form, and drops a null one", () => {
    const runs = [
      { bold: false, code: false, italic: false, text: "A pilot of the bot, nothing needed", type: "text" },
    ];
    const opening = { asks: { kind: "nothing", text: "nothing needed" }, what: "a pilot of the bot" };
    const declared = JSON.parse(
      unwrap(parseSlackDraftAnswer({ response: JSON.stringify({ opening, problem: { kind: "none" }, runs }) })).form,
    );
    expect(declared.opening).toEqual(opening);
    const none = JSON.parse(
      unwrap(parseSlackDraftAnswer({ response: JSON.stringify({ opening: null, problem: { kind: "none" }, runs }) }))
        .form,
    );
    expect(Object.keys(none)).toEqual(["kind", "messages", "problem"]);
  });

  it("refuses an opening that is neither null nor an object", () => {
    const response = JSON.stringify({
      opening: "a pilot",
      problem: { kind: "none" },
      runs: [{ text: "x", type: "text" }],
    });
    expect(unwrapErr(parseSlackDraftAnswer({ response }))).toEqual(['field "opening" must be null or an object']);
  });
});
