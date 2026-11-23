import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { SlackThreadTarget } from "../../../../live/slack/permalink.js";
import { projectSlackThread } from "../../../../live/slack/projection.js";

const TARGET: SlackThreadTarget = {
  addressedReply: false,
  addressedTs: "1785114398.557099",
  channel: "C123",
  threadTs: "1785114398.557099",
  workspace: "https://example.slack.com",
};

const PARENT = { text: "the question", ts: TARGET.threadTs, user: "U111" };

describe("projectSlackThread", () => {
  it("projects parent and replies, counting replies excluding the parent", () => {
    const thread = unwrap(
      projectSlackThread({
        rawMessages: [PARENT, { text: "a reply", thread_ts: TARGET.threadTs, ts: "1785114500.000100", user: "U222" }],
        target: TARGET,
      }),
    );

    expect(thread.messages.length).toBe(2);
    expect(thread.replyCount).toBe(1);
    expect(thread.messages[0]!.relation).toBe("parent");
    expect(thread.messages[1]!.relation).toBe("reply");
    expect(thread.messages[1]!.author.userId).toBe("U222");
  });

  it("keeps Block Kit content when top-level text is EMPTY", () => {
    // slopweaver's own cards look exactly like this: empty text, content in attachments[].blocks.
    const card = {
      attachments: [{ blocks: [{ elements: [{ text: "deploy failed", type: "text" }], type: "rich_text" }] }],
      bot_id: "B999",
      text: "",
      thread_ts: TARGET.threadTs,
      ts: "1785114600.000200",
      username: "slopweaver",
    };

    const thread = unwrap(projectSlackThread({ rawMessages: [PARENT, card], target: TARGET }));
    const projected = thread.messages[1]!;

    expect(projected.text).toBe("");
    expect(projected.attachments.length).toBe(1);
    expect(JSON.stringify(projected.attachments)).toContain("deploy failed");
    expect(projected.author.botId).toBe("B999");
    expect(projected.author.username).toBe("slopweaver");
  });

  it("keeps top-level blocks verbatim", () => {
    const withBlocks = {
      blocks: [{ text: { text: "*bold*", type: "mrkdwn" }, type: "section" }],
      text: "bold",
      thread_ts: TARGET.threadTs,
      ts: "1785114700.000300",
      user: "U333",
    };

    const thread = unwrap(projectSlackThread({ rawMessages: [PARENT, withBlocks], target: TARGET }));

    expect(JSON.stringify(thread.messages[1]!.blocks)).toContain("*bold*");
  });

  it("preserves raw mention ids rather than flattening them to @user", () => {
    const mention = {
      text: "cc <@U9ABCDEF> and <#C123|>",
      thread_ts: TARGET.threadTs,
      ts: "1785114800.000400",
      user: "U444",
    };

    const thread = unwrap(projectSlackThread({ rawMessages: [PARENT, mention], target: TARGET }));

    expect(thread.messages[1]!.text).toBe("cc <@U9ABCDEF> and <#C123|>");
  });

  it("projects reactions, files and edit markers", () => {
    const rich = {
      edited: { ts: "1785114999.000000", user: "U555" },
      files: [
        {
          id: "F0BKXLKV0QJ",
          mimetype: "image/png",
          name: "diagram.png",
          size: 12345,
          url_private_download: "https://files.slack.com/files-pri/T1-F1/download/diagram.png",
        },
      ],
      reactions: [{ count: 2, name: "eyes", users: ["U1", "U2"] }],
      text: "see attached",
      thread_ts: TARGET.threadTs,
      ts: "1785114900.000500",
      user: "U555",
    };

    const thread = unwrap(projectSlackThread({ rawMessages: [PARENT, rich], target: TARGET }));
    const projected = thread.messages[1]!;

    expect(projected.editedTs).toBe("1785114999.000000");
    expect(projected.reactions[0]!.name).toBe("eyes");
    expect(projected.reactions[0]!.count).toBe(2);
    expect(projected.reactions[0]!.userIds).toEqual(["U1", "U2"]);
    expect(projected.files[0]!.id).toBe("F0BKXLKV0QJ");
    expect(projected.files[0]!.urlPrivateDownload).toBe("https://files.slack.com/files-pri/T1-F1/download/diagram.png");
    expect(projected.files[0]!.mimetype).toBe("image/png");
    expect(projected.files[0]!.isExternal).toBe(false);
  });

  it("counts a reaction by its reactors when Slack omits `count`, and reads a file from `url_private` alone", () => {
    const sparse = {
      files: [{ id: "F0CANVAS01", url_private: "https://files.slack.com/files-pri/T1-F2/canvas" }],
      reactions: [{ name: "eyes", users: ["U1", "U2", "U3"] }],
      text: "see attached",
      thread_ts: TARGET.threadTs,
      ts: "1785114900.000600",
      user: "U555",
    };

    const projected = unwrap(projectSlackThread({ rawMessages: [PARENT, sparse], target: TARGET })).messages[1]!;

    expect(projected.reactions[0]!.count).toBe(3);
    expect(projected.files[0]!.urlPrivateDownload).toBe("https://files.slack.com/files-pri/T1-F2/canvas");
  });

  it("gives a reply a permalink carrying thread_ts, so it round-trips to the same thread", () => {
    const thread = unwrap(
      projectSlackThread({
        rawMessages: [PARENT, { text: "r", thread_ts: TARGET.threadTs, ts: "1785114500.000100" }],
        target: TARGET,
      }),
    );

    expect(thread.messages[0]!.permalink).toBe("https://example.slack.com/archives/C123/p1785114398557099");
    expect(thread.messages[1]!.permalink).toBe(
      "https://example.slack.com/archives/C123/p1785114500000100?thread_ts=1785114398.557099&cid=C123",
    );
  });

  it("FAILS on an attachment with no id rather than dropping it (R2 regression)", () => {
    // Found by an adversarial review pass. Filtering an unprojectable file out made it vanish from
    // `files`, `skippedFiles` AND `limitations` at once — a message reading as having no attachment when
    // it had one, with nothing in the output hinting at the loss.
    const withIdlessFile = {
      files: [
        {
          mimetype: "image/png",
          name: "diagram.png",
          size: 4,
          url_private_download: "https://files.slack.com/files-pri/T1-F1/download/diagram.png",
        },
      ],
      text: "see attached",
      thread_ts: TARGET.threadTs,
      ts: "1785114500.000100",
    };

    const result = projectSlackThread({ rawMessages: [PARENT, withIdlessFile], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("attachment with no id");
  });

  it("FAILS on a non-array `files` value rather than coercing it away (R2 regression)", () => {
    // Second finding from the same review pass. `arrayOf` mapped any non-array to `[]`, so an attachment
    // that arrived as a bare object — not wrapped in an array — vanished from files, skippedFiles AND
    // limitations at once, and the read still succeeded.
    const badShape = {
      files: { id: "F0BKXLKV0QJ", mimetype: "image/png", size: 4 },
      text: "see attached",
      thread_ts: TARGET.threadTs,
      ts: "1785114500.000100",
    };

    const result = projectSlackThread({ rawMessages: [PARENT, badShape], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("non-array `files` value");
  });

  it("FAILS on a non-array `blocks` value, which would lose an app message's entire body", () => {
    const badBlocks = { blocks: { type: "section" }, text: "", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const result = projectSlackThread({ rawMessages: [PARENT, badBlocks], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("non-array `blocks` value");
  });

  it("FAILS on an explicit null content field, which is not the same as absent (R2 regression)", () => {
    // Third finding from the same property. Absent means "none"; an explicit null is a shape this code
    // does not understand, and guessing "probably empty" is how content goes quietly missing. Measured
    // safe: across well over a hundred thousand real messages these fields are always arrays when present, never null.
    const nulled = { files: null, text: "see attached", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const result = projectSlackThread({ rawMessages: [PARENT, nulled], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("non-array `files` value");
  });

  it("FAILS on a non-string text value rather than blanking the message (R2 regression)", () => {
    const badText = { text: { value: "message body" }, thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const result = projectSlackThread({ rawMessages: [PARENT, badText], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("non-string `text` value");
  });

  it("keeps an ABSENT text as empty — 6% of real messages have no text at all", () => {
    const noText = { blocks: [{ type: "divider" }], thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const thread = unwrap(projectSlackThread({ rawMessages: [PARENT, noText], target: TARGET }));

    expect(thread.messages[1]!.text).toBe("");
    expect(thread.messages[1]!.blocks.length).toBe(1);
  });

  it("still treats an ABSENT content field as empty", () => {
    const plain = { text: "just words", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const thread = unwrap(projectSlackThread({ rawMessages: [PARENT, plain], target: TARGET }));

    expect(thread.messages[1]!.files).toEqual([]);
    expect(thread.messages[1]!.blocks).toEqual([]);
    expect(thread.messages[1]!.attachments).toEqual([]);
  });

  it("FAILS on a non-object entry inside a files array", () => {
    const bad = { files: ["not-a-file"], text: "x", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const result = projectSlackThread({ rawMessages: [PARENT, bad], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("non-object entry in its files array");
  });

  it("FAILS the whole read on a malformed row rather than skipping it", () => {
    const result = projectSlackThread({ rawMessages: [PARENT, "not a message"], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("non-object message row");
  });

  it("FAILS on a row with no ts", () => {
    const result = projectSlackThread({ rawMessages: [PARENT, { text: "orphan" }], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("no ts");
  });

  it("FAILS on a row belonging to another thread", () => {
    const foreign = { text: "elsewhere", thread_ts: "1700000000.000001", ts: "1785114500.000100" };
    const result = projectSlackThread({ rawMessages: [PARENT, foreign], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("belongs to thread");
  });

  it("accepts the PARENT repeated across pages — that is Slack's pagination protocol", () => {
    // VERIFIED against a real 311-message thread: `conversations.replies` returns the thread root as
    // messages[0] of EVERY page (page 1 = parent + 200 replies, page 2 = the SAME parent + 110 more).
    // Treating that as a duplicate made every thread over 200 replies fail outright.
    const r1 = { text: "first", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };
    const r2 = { text: "second", thread_ts: TARGET.threadTs, ts: "1785114600.000200" };
    const pagesFlattened = [PARENT, r1, PARENT, r2];

    const thread = unwrap(projectSlackThread({ rawMessages: pagesFlattened, target: TARGET }));

    expect(thread.messages.length).toBe(3);
    expect(thread.replyCount).toBe(2);
    expect(thread.messages.filter((m) => m.relation === "parent").length).toBe(1);
    expect(thread.messages.map((m) => m.ts)).toEqual([TARGET.threadTs, "1785114500.000100", "1785114600.000200"]);
  });

  it("still FAILS on a duplicate REPLY, which no protocol produces", () => {
    const reply = { text: "r", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };

    const result = projectSlackThread({ rawMessages: [PARENT, reply, reply], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("duplicate message");
  });

  it("FAILS when the parent is absent from the returned rows", () => {
    const replyOnly = { text: "r", thread_ts: TARGET.threadTs, ts: "1785114500.000100" };
    const result = projectSlackThread({ rawMessages: [replyOnly], target: TARGET });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("did not return its parent");
  });
});
