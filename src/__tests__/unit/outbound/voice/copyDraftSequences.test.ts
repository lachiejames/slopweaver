import { describe, expect, it } from "vitest";

import { copyDraftSequences } from "../../../../outbound/voice/copyDraftSequences.js";

describe("copyDraftSequences", () => {
  it("splits paragraphs on a blank line and reads a single newline inside one as a space", () => {
    expect(copyDraftSequences({ text: "first line\nsame paragraph\n\n  \nsecond" })).toEqual([
      [
        { text: "first line", type: "text" },
        { text: " ", type: "text" },
        { text: "same paragraph", type: "text" },
      ],
      [{ text: "second", type: "text" }],
    ]);
  });

  it("leaves out every bullet line, and the lines after a list are their own paragraph", () => {
    expect(copyDraftSequences({ text: "a few for you\n• one\n- two\n* three\nno rush" })).toEqual([
      [{ text: "a few for you", type: "text" }],
      [{ text: "no rush", type: "text" }],
    ]);
  });

  it("reads *bold* at the start of a line as prose, never a bullet, and drops the markers", () => {
    expect(copyDraftSequences({ text: "*heads up* it is down" })).toEqual([
      [{ text: "heads up it is down", type: "text" }],
    ]);
  });

  // `keen to *hear*` kept its asterisks, so the filler matcher never saw the phrase.
  it("reads bold, italic and strike as the words they show, and leaves snake_case and a cron line as typed", () => {
    expect(copyDraftSequences({ text: "keen to *hear* _what_ ~you~ reckon, max_retries at 0 * * * *" })).toEqual([
      [{ text: "keen to hear what you reckon, max_retries at 0 * * * *", type: "text" }],
    ]);
  });

  it("reads a person, a group, the room and a channel blast as the runs they render as", () => {
    expect(copyDraftSequences({ text: "<@U0SYN000032> and <!subteam^S01|dev>, <!here> <!channel>" })).toEqual([
      [
        { person: "U0SYN000032", type: "mention" },
        { text: " and ", type: "text" },
        { handle: "S01", type: "group" },
        { text: ", ", type: "text" },
        { range: "here", type: "broadcast" },
        { text: " ", type: "text" },
        { range: "channel", type: "broadcast" },
      ],
    ]);
  });

  it("reads a labelled link by its label and a bare one by its address", () => {
    expect(
      copyDraftSequences({
        text: "see <https://linear.app/acme/issue/BBB-389|BBB-389> and <https://example.com/a>",
      }),
    ).toEqual([
      [
        { text: "see ", type: "text" },
        { label: "BBB-389", type: "link", url: "https://linear.app/acme/issue/BBB-389" },
        { text: " and ", type: "text" },
        { label: "https://example.com/a", type: "link", url: "https://example.com/a" },
      ],
    ]);
  });

  it("reads inline code and a fenced block as code, a blank or bullet-looking line inside the fence included", () => {
    expect(
      copyDraftSequences({ text: "run `yarn lint` first\n```\n- not a bullet\n\nstill code\n```\nafter" }),
    ).toEqual([
      [
        { text: "run ", type: "text" },
        { code: true, text: "yarn lint", type: "text" },
        { text: " first", type: "text" },
        { text: " ", type: "text" },
        { code: true, text: "- not a bullet", type: "text" },
        { text: " ", type: "text" },
        { code: true, text: "still code", type: "text" },
        { text: " ", type: "text" },
        { text: "after", type: "text" },
      ],
    ]);
  });

  // Prose on the same line as a ```span``` was read as code, so its ask went unjudged.
  it("reads a fence opened and closed inside one line as code there, and the prose beside it as prose", () => {
    expect(copyDraftSequences({ text: "Can you review this? I added context. ```x``` after" })).toEqual([
      [
        { text: "Can you review this? I added context. ", type: "text" },
        { code: true, text: "x", type: "text" },
        { text: " after", type: "text" },
      ],
    ]);
  });

  // Prose in angle brackets was read as a link and hidden from the shape check.
  it("reads a <…> that is no link, mention or channel as the literal text it shows as", () => {
    expect(copyDraftSequences({ text: "<Can you review this? I added context.> and <#C01|dev>" })).toEqual([
      [
        { text: "<Can you review this? I added context.>", type: "text" },
        { text: " and ", type: "text" },
        { label: "dev", type: "link", url: "#C01" },
      ],
    ]);
  });

  // An unknown <!…> command showed as prose and was read as an opaque link.
  it("reads any other <!…> command as the fallback it shows, else its body", () => {
    expect(copyDraftSequences({ text: "<!can you review this? I added context.> <!date^1|Nov 14>" })).toEqual([
      [
        { text: "can you review this? I added context.", type: "text" },
        { text: " ", type: "text" },
        { text: "Nov 14", type: "text" },
      ],
    ]);
  });

  // A group with no id is no entity, so its fallback shows as prose.
  it("reads a mention, group or channel with no id as the literal text it shows as", () => {
    expect(copyDraftSequences({ text: "<!subteam^|Can you review this? I added context.> <@|x>" })).toEqual([
      [
        { text: "Can you review this? I added context.", type: "text" },
        { text: " ", type: "text" },
        { text: "<@|x>", type: "text" },
      ],
    ]);
  });

  // An empty label hid the entity's words from the 100-word count.
  it("reads a channel or link with an empty label by its id or address, as the tray draws it", () => {
    expect(copyDraftSequences({ text: "<#C01|> <https://example.com/a|>" })).toEqual([
      [
        { label: "#C01", type: "link", url: "#C01" },
        { text: " ", type: "text" },
        { label: "https://example.com/a", type: "link", url: "https://example.com/a" },
      ],
    ]);
  });

  // `<@` + prose + `>` was read as one opaque mention, hiding its words from the count.
  it("reads a mention, channel or group whose id is no Slack id as the literal text it shows as", () => {
    expect(copyDraftSequences({ text: "<@word word> <#not a channel|x> <!subteam^my group|y>" })).toEqual([
      [
        { text: "<@word word>", type: "text" },
        { text: " ", type: "text" },
        { text: "<#not a channel|x>", type: "text" },
        { text: " ", type: "text" },
        { text: "y", type: "text" },
      ],
    ]);
  });

  // A bullet holding a ```span``` was read as fenced prose and judged.
  it("leaves out a bullet with a fence span in it, and a fence a bullet leaves open still opens", () => {
    expect(copyDraftSequences({ text: "- keen to ```x``` hear what you reckon\nafter" })).toEqual([
      [{ text: "after", type: "text" }],
    ]);
    expect(copyDraftSequences({ text: "- see ```\nstill code\n```\nafter" })).toEqual([
      [
        { code: true, text: "still code", type: "text" },
        { text: " ", type: "text" },
        { text: "after", type: "text" },
      ],
    ]);
  });

  it("reads a quoted line as somebody else's words", () => {
    expect(copyDraftSequences({ text: "> are you there?\nyes" })).toEqual([
      [
        { quoted: true, text: "are you there?", type: "text" },
        { text: " ", type: "text" },
        { text: "yes", type: "text" },
      ],
    ]);
  });

  it("reads a >>> line and every line after it as quoted, a bullet and a fence among them, as Slack draws it", () => {
    expect(
      copyDraftSequences({ text: "mine first\n\n>>> their words\nmore of theirs\n\n• a bullet\n```code```" }),
    ).toEqual([
      [{ text: "mine first", type: "text" }],
      [
        { quoted: true, text: "their words", type: "text" },
        { text: " ", type: "text" },
        { quoted: true, text: "more of theirs", type: "text" },
      ],
      [
        { quoted: true, text: "• a bullet", type: "text" },
        { text: " ", type: "text" },
        { quoted: true, text: "```code```", type: "text" },
      ],
    ]);
  });

  it("reads an escaped &gt;&gt;&gt; as the same quote, and a >>> inside a fence as code", () => {
    expect(copyDraftSequences({ text: "&gt;&gt;&gt; theirs\nstill theirs" })).toEqual([
      [
        { quoted: true, text: "theirs", type: "text" },
        { text: " ", type: "text" },
        { quoted: true, text: "still theirs", type: "text" },
      ],
    ]);
    expect(copyDraftSequences({ text: "```\n>>> code\n```\nmine" })).toEqual([
      [
        { code: true, text: ">>> code", type: "text" },
        { text: " ", type: "text" },
        { text: "mine", type: "text" },
      ],
    ]);
  });

  it("reads nothing out of an empty message", () => {
    expect(copyDraftSequences({ text: "\n\n" })).toEqual([]);
  });
});
