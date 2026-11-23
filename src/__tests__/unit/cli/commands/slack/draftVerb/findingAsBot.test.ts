/**
 * `slopweaver slack draft record` of a finding shared in a channel, which goes out as the bot.
 *
 * Also covers `slopweaver slack draft context`, which reads the conversation a held draft lands in, live, and
 * `slopweaver slack draft list | show | drop`, over a register seeded with one held draft.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { BOT_FORM_KINDS } from "../../../../../../outbound/artifact/botFormKinds.js";
import { SlackDraftErrors } from "../../../../../../outbound/slack/draftErrors.js";
import { FIRST_MESSAGE_SHOT, oneCard, PROVED_FINDING, PROVED_FINDING_LINES, parkedIn, shown } from "./forms.js";
import { receiptsIn, seededLog } from "./register.js";
import { argv, draftDeps, freshRecording } from "./world.js";

describe("slack draft record — a finding shared in a channel goes out as the bot", () => {
  const FINDING_FORM = JSON.stringify(BOT_FORM_KINDS.find((entry) => entry.kind === "finding")!.fixtures[0]);
  const BOT_TAIL: readonly string[] = [
    "record",
    "--as",
    "bot",
    "--channel",
    "C0TEAM",
    "--form",
    "-",
    "--why",
    "share the staging pool finding",
  ];

  it("parks a --as bot finding card with its three pictures, released by the bot's own command", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...BOT_TAIL, "--media", "0.png,1.png,2.png"] }),
      deps: draftDeps({ image: true, recording: seen, stdin: FINDING_FORM }),
    });
    expect(code).toBe(EXIT_OK);
    const draft = parkedIn({ events: seen.appended });
    expect([draft.actor, draft.kind, draft.channel, draft.shape]).toEqual(["bot", "finding", "C0TEAM", "top-level"]);
    expect("attachments" in draft.payload).toBe(true);
    expect(draft.media!.map((entry) => entry.name)).toEqual(["0.png", "1.png", "2.png"]);
    expect(seen.calls).toContain("botMembership:xoxb-test");
    expect(seen.lines).toContain(
      `to send it as shown: slopweaver slack post --as bot --draft sd-deadbeef --approve ${draft.digest}`,
    );
  });

  it("REFUSES a --as bot finding carrying fewer than three pictures, storing and appending nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...BOT_TAIL, "--media", "0.png"] }),
      deps: draftDeps({ image: true, recording: seen, stdin: FINDING_FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.some((call) => call.startsWith("storeMedia"))).toBe(false);
  });

  it("REFUSES a --as bot draft into a channel the bot is not in, since no release could send it", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...BOT_TAIL, "--media", "0.png,1.png,2.png"] }),
      deps: draftDeps({ botMembership: "not-member", image: true, recording: seen, stdin: FINDING_FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES an as-me finding at the top level of a channel the bot is in, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          "C0TEAM",
          "--form",
          "-",
          "--why",
          "hunt finding for #team-eng",
          "--kind",
          "finding",
          ...PROVED_FINDING,
        ],
      }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: PROVED_FINDING_LINES })) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual(["conversationInfo", "botMembership:xoxb-test"]);
  });

  it("REFUSES an as-me finding in a public channel the bot has not joined, asking nothing about the bot", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          "C0TEAM",
          "--form",
          "-",
          "--why",
          "hunt finding for #team-eng",
          "--kind",
          "finding",
          ...PROVED_FINDING,
        ],
      }),
      deps: draftDeps({
        botMembership: "not-member",
        recording: seen,
        stdin: JSON.stringify(oneCard({ lines: PROVED_FINDING_LINES })),
        surface: "public-channel",
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual(["conversationInfo"]);
  });

  it("parks a --as bot finding in a public channel the bot has not joined, which it posts into anyway", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...BOT_TAIL, "--media", "0.png,1.png,2.png"] }),
      deps: draftDeps({
        botMembership: "not-member",
        image: true,
        recording: seen,
        stdin: FINDING_FORM,
        surface: "public-channel",
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).actor).toBe("bot");
  });

  it("parks a --as bot re-cut that --supersedes a held row, dropping the older cut in the same act", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...BOT_TAIL, "--media", "0.png,1.png,2.png", "--supersedes", "sd-11112222"] }),
      deps: draftDeps({ image: true, log: seededLog(), recording: seen, stdin: FINDING_FORM }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.appended.map((event) => [event.kind, event.id])).toEqual([
      ["parked", "sd-deadbeef"],
      ["dropped", "sd-11112222"],
    ]);
  });

  it("REFUSES a --as bot re-cut superseding a row that is not held, before any Slack read", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...BOT_TAIL, "--media", "0.png,1.png,2.png", "--supersedes", "sd-0000aaaa"] }),
      deps: draftDeps({ image: true, log: seededLog(), recording: seen, stdin: FINDING_FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("parks an as-me finding where the bot is not in the private channel, recording why it may be the owner's", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          "C0TEAM",
          "--form",
          "-",
          "--why",
          "hunt finding for #team-eng",
          "--kind",
          "finding",
          ...PROVED_FINDING,
        ],
      }),
      deps: draftDeps({
        botMembership: "not-member",
        recording: seen,
        stdin: JSON.stringify(oneCard({ lines: PROVED_FINDING_LINES })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).botCannotPost).toBe("not-in-channel");
  });

  it("REFUSES an as-me channel row declaring no --kind, even one whose why misses every finding word", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["record", "--channel", "C0TEAM", "--form", "-", "--why", "share the checkout 500s"] }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["Checkout is failing."] })) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.some((call) => call.startsWith("botMembership"))).toBe(false);
  });

  it("asks nothing about the bot for a row declared --kind message, whatever its why says", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          "C0TEAM",
          "--form",
          "-",
          "--why",
          "reply to the hunt thread",
          "--kind",
          "message",
          ...FIRST_MESSAGE_SHOT,
        ],
      }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(shown({ lines: ["Thanks, looking into it now."] })) }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).kind).toBe("message");
    expect(seen.calls.some((call) => call.startsWith("botMembership"))).toBe(false);
  });
});

describe("slack draft context — the conversation a draft lands in, read live", () => {
  /** A channel tail as `conversations.history` answers it: newest first, one member tagged in the text. */
  const TAIL = ok({
    hasMore: true,
    rows: [
      { text: "second, cc <@U0SYNADAOWN>", ts: "1790000200.000200", user: "U0OTHER" },
      { text: "first", ts: "1790000100.000100", user: "U0SYNADAOWN" },
    ],
    workspaceUrl: "https://acme.slack.com/",
  });

  it("reads a top-level draft's channel tail on the owner's token, oldest first, naming who is in it", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-11112222", "--json"] }),
      deps: draftDeps({ conversation: TAIL, log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.calls).toEqual(["readConversation:C0ISO:undefined:6:xoxp-test", "loadMembers"]);
    const printed: unknown = JSON.parse(seen.lines.join("\n"));
    expect(printed).toMatchObject({
      earlierWithheld: true,
      id: "sd-11112222",
      link: "https://acme.slack.com/archives/C0ISO",
      messages: [{ text: "first" }, { text: "second, cc <@U0SYNADAOWN>" }],
      observedAtIso: "2026-09-23T01:02:03.000Z",
      people: [{ bot: false, handle: "ada", name: "Ada Owner", nativeId: "U0SYNADAOWN" }],
      schemaVersion: 2,
      scope: "channel",
      // Both messages predate the row, which kept no read of its own: nothing new, and it says what it cannot see.
      sinceDrafted: {
        added: [],
        draftedIso: "2026-09-22T10:00:00.000Z",
        edited: [],
        kind: "measured",
        limits: ["This draft was recorded before the read kept what it saw, so a removed message would not show here."],
        removed: [],
      },
    });
    expect(seen.appended).toEqual([]);
  });

  it("reads a reply draft's whole thread under its root", async () => {
    const seen = freshRecording();
    const root = { text: "the root", ts: "1790000000.000100", user: "U0SYNADAOWN" };
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-11112222", "--json"] }),
      deps: draftDeps({
        conversation: ok({ hasMore: false, rows: [root], workspaceUrl: "https://acme.slack.com" }),
        log: seededLog({ over: { shape: "thread", threadTs: "1790000000.000100" } }),
        recording: seen,
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.calls.at(0)).toBe("readConversation:C0ISO:1790000000.000100:6:xoxp-test");
    expect(JSON.parse(seen.lines.join("\n"))).toMatchObject({
      link: "https://acme.slack.com/archives/C0ISO/p1790000000000100",
      scope: "thread",
      threadTs: "1790000000.000100",
    });
  });

  it("reads nobody's roster when the conversation shows no member", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-11112222"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.calls).toEqual(["readConversation:C0ISO:undefined:6:xoxp-test"]);
    expect(JSON.parse(seen.lines.join("\n"))).toMatchObject({ messages: [], people: [] });
  });

  it("refuses a draft addressed to a member id, reading nothing, since only opening the DM names one", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-11112222"] }),
      deps: draftDeps({ log: seededLog({ over: { channel: "U0SYNSOMEONE" } }), recording: seen }),
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(seen.calls).toEqual([]);
    expect(seen.lines).toEqual([]);
  });

  it("answers EXIT_EXPECTED_EMPTY for an id no row carries, reading nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-nosuchid"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(seen.calls).toEqual([]);
  });

  it("prints nothing and exits EXIT_ERROR when the live read fails", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-11112222"] }),
      deps: draftDeps({
        conversation: err(SlackDraftErrors.contextUnreadable({ cause: "not_in_channel", channel: "C0ISO" })),
        log: seededLog(),
        recording: seen,
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(seen.lines).toEqual([]);
  });

  it("refuses a row the projection cannot vouch for rather than drawing it", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["context", "sd-11112222"] }),
      deps: draftDeps({
        conversation: ok({ hasMore: false, rows: [{ text: "no ts" }], workspaceUrl: "https://acme.slack.com" }),
        log: seededLog(),
        recording: seen,
      }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(seen.lines).toEqual([]);
  });
});

describe("slack draft list | show | drop", () => {
  it("lists the held row, naming the channel and what it is for", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-list-held-"));
    try {
      const seen = freshRecording();
      // A top-level row in a channel is listed once it carries its receipts; one without is sent back unseen.
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: ["list", "--home", home] }),
        deps: draftDeps({ log: seededLog({ over: receiptsIn({ home }) }), recording: seen }),
      });
      expect(code).toBe(EXIT_OK);
      expect(seen.lines.length).toBe(1);
      expect(seen.lines[0]).toContain("sd-11112222");
      expect(seen.lines[0]).toContain("#iso-27001");
      expect(seen.lines[0]).toContain("the ISO group question");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("shows the row with the digest the owner's approval binds and the body as it would post", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["show", "sd-11112222"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    const printed = seen.lines.join("\n");
    expect(printed).toContain("digest   0123456789abcdef0123456789abcdef");
    expect(printed).toContain("as       you (U0SYNADAOWN)");
    expect(printed).toContain("Four groups.");
  });

  it("names the author in --json, off member bronze, beside the rows", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["list", "--json"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    const printed: unknown = JSON.parse(seen.lines.join("\n"));
    expect(printed).toMatchObject({
      people: [{ bot: false, handle: "ada", name: "Ada Owner", nativeId: "U0SYNADAOWN" }],
    });
  });

  it("reads no roster for an empty register", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["list", "--json"] }),
      deps: draftDeps({ recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(seen.lines.join("\n"))).toEqual({
      items: [],
      people: [],
      picks: { byModel: {}, codex: 0, original: 0 },
    });
    expect(seen.calls).toEqual([]);
  });

  it("answers EXIT_EXPECTED_EMPTY for an id no row carries, rather than an empty success", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["show", "sd-nosuchid"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(seen.lines).toEqual([]);
  });

  it("drops a held row, recording the note", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["drop", "sd-11112222", "--note", "they answered in the thread"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.appended).toEqual([
      {
        id: "sd-11112222",
        kind: "dropped",
        landingsRead: 0,
        note: "they answered in the thread",
        tsIso: "2026-09-23T01:02:03.000Z",
      },
    ]);
  });

  it("REFUSES a drop with no --note, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["drop", "sd-11112222"] }),
      deps: draftDeps({ log: seededLog(), recording: seen }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("lists every draft it can read past a line it cannot, and never drops a row that line names", async () => {
    const log = `${seededLog()}{not json\n{"kind":"parked","id":"sd-e7511638","shape":"thread"}\n`;
    const listed = freshRecording();
    const listCode = await runSlackDraftWithDeps({
      argv: argv({ tail: ["list"] }),
      deps: draftDeps({ log, recording: listed }),
    });
    expect(listCode).toBe(EXIT_OK);
    expect(listed.lines.length).toBe(1);
    expect(listed.lines[0]).toContain("sd-11112222");

    const dropped = freshRecording();
    const dropCode = await runSlackDraftWithDeps({
      argv: argv({ tail: ["drop", "sd-e7511638", "--note", "a thread reply"] }),
      deps: draftDeps({ log, recording: dropped }),
    });
    expect(dropCode).toBe(EXIT_EXPECTED_EMPTY);
    expect(dropped.appended).toEqual([]);
  });
});
