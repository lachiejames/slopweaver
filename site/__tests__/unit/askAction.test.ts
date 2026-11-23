/*
 * The command a card prints under one destination. Nothing here sends anything — the property under test
 * is that the printed line is CORRECT for any draft, including one whose own prose collides with the
 * heredoc delimiter, because a truncated heredoc hands the rest of the message to the shell.
 */

import { describe, expect, it } from "vitest";

import type { BoardRowAction, BoardRowDestination } from "../../components/live/readAction";
import { destinationWhere, draftMessages, heredocDelimiter, sendCommand, sendVerb } from "../../lib/askAction";

const CHANNEL: BoardRowDestination = {
  channel: "C01SDLC",
  kind: "channel",
  label: "Post it to #delivery",
  tradeoff: "the whole channel sees we are asking",
  url: undefined,
};

const THREAD: BoardRowDestination = {
  channel: "C01SDLC",
  kind: "thread",
  label: "Reply in the thread",
  permalink: undefined,
  threadTs: "1758500000.000100",
  tradeoff: "only the thread sees it",
};

const DM: BoardRowDestination = {
  conversation: "D01ARI",
  kind: "dm",
  label: "DM Ari",
  recipients: [{ label: "Ari", userId: "U01ARI" }],
  tradeoff: "only the owner sees it",
};

const ACTION: BoardRowAction = {
  actor: "me",
  body: "ready for review",
  destinations: [THREAD],
  followUps: [],
  mentions: [],
};

describe("heredocDelimiter", () => {
  it("uses the idiom when the draft does not contain it", () => {
    expect(heredocDelimiter({ body: "ready for review" })).toBe("EOF");
  });

  it("steps past a delimiter the draft spells on a line of its own", () => {
    expect(heredocDelimiter({ body: "the marker is\nEOF\nand that is the bug" })).toBe("SLOPWEAVER_EOF");
  });

  it("ignores a delimiter that is only part of a line, because a heredoc ends on a whole one", () => {
    expect(heredocDelimiter({ body: "the EOF marker is the bug" })).toBe("EOF");
  });

  it("sees a delimiter through the whitespace a heredoc also ignores", () => {
    expect(heredocDelimiter({ body: "x\n  EOF  \ny" })).toBe("SLOPWEAVER_EOF");
  });

  it("counts past every declared delimiter when the draft collides with all of them", () => {
    const body = ["EOF", "SLOPWEAVER_EOF", "SLOPWEAVER_BODY_END"].join("\n");
    expect(heredocDelimiter({ body })).toBe("SLOPWEAVER_BODY_END_2");
  });

  it("keeps counting when the counted one collides too", () => {
    const body = ["EOF", "SLOPWEAVER_EOF", "SLOPWEAVER_BODY_END", "SLOPWEAVER_BODY_END_2"].join("\n");
    expect(heredocDelimiter({ body })).toBe("SLOPWEAVER_BODY_END_3");
  });
});

describe("sendVerb", () => {
  it("posts a channel message top-level, by id", () => {
    expect(sendVerb({ destination: CHANNEL })).toBe(
      "slopweaver slack post --as me --channel C01SDLC --shape top-level --body -",
    );
  });

  it("binds a thread reply to the root ts rather than opening a new message", () => {
    expect(sendVerb({ destination: THREAD })).toBe(
      "slopweaver slack reply --as me --channel C01SDLC --thread-ts 1758500000.000100 --body -",
    );
  });

  it("posts a DM into the conversation the action named, never opening one", () => {
    expect(sendVerb({ destination: DM })).toBe(
      "slopweaver slack post --as me --channel D01ARI --shape top-level --body -",
    );
  });
});

describe("sendCommand", () => {
  it("feeds the draft over a quoted heredoc, so the shell expands nothing in it", () => {
    expect(sendCommand({ destination: CHANNEL, messages: ["ready for review"] })).toBe(
      "slopweaver slack post --as me --channel C01SDLC --shape top-level --body - <<'EOF'\nready for review\nEOF",
    );
  });

  it("picks a delimiter the draft cannot terminate early", () => {
    const body = "the marker is\nEOF\nand that is the bug";
    const command = sendCommand({ destination: CHANNEL, messages: [body] });
    expect(command).toBe(
      "slopweaver slack post --as me --channel C01SDLC --shape top-level --body - <<'SLOPWEAVER_EOF'\n" +
        `${body}\nSLOPWEAVER_EOF`,
    );
  });

  it("sends each message on its own, in order, and stops at the first send that fails", () => {
    const verb = "slopweaver slack reply --as me --channel C01SDLC --thread-ts 1758500000.000100 --body -";
    expect(sendCommand({ destination: THREAD, messages: ["my angle first", "and a second example"] })).toBe(
      `${verb} <<'EOF' &&\nmy angle first\nEOF\n${verb} <<'EOF'\nand a second example\nEOF`,
    );
  });

  it("picks each message's delimiter from that message alone", () => {
    const verb = "slopweaver slack post --as me --channel D01ARI --shape top-level --body -";
    expect(sendCommand({ destination: DM, messages: ["the marker is\nEOF", "plain"] })).toBe(
      `${verb} <<'SLOPWEAVER_EOF' &&\nthe marker is\nEOF\nSLOPWEAVER_EOF\n${verb} <<'EOF'\nplain\nEOF`,
    );
  });
});

describe("draftMessages", () => {
  it("is the body alone for a one-message draft", () => {
    expect(draftMessages({ action: { ...ACTION, followUps: [] } })).toEqual(["ready for review"]);
  });

  it("is the body then every follow-up, in order", () => {
    expect(draftMessages({ action: { ...ACTION, followUps: ["second", "third"] } })).toEqual([
      "ready for review",
      "second",
      "third",
    ]);
  });
});

describe("destinationWhere", () => {
  it("says a channel post is a new top-level message", () => {
    expect(destinationWhere({ destination: CHANNEL })).toBe("a new top-level message in C01SDLC");
  });

  it("says a thread reply is a reply, and names the root", () => {
    expect(destinationWhere({ destination: THREAD })).toBe("a reply in the thread at C01SDLC · 1758500000.000100");
  });

  it("names the people a DM reaches, never the conversation id", () => {
    expect(destinationWhere({ destination: DM })).toBe("a DM to Ari");
  });

  it("names every person in a group DM", () => {
    const recipients = [
      { label: "Ari", userId: "U01ARI" },
      { label: "Tobias", userId: "U01TOB" },
    ];
    expect(destinationWhere({ destination: { ...DM, recipients } })).toBe("a DM to Ari, Tobias");
  });

  it("says a DM naming nobody is exactly that, rather than printing an id as a person", () => {
    expect(destinationWhere({ destination: { ...DM, recipients: [] } })).toBe(
      "a DM to D01ARI; the conversation names no recipient",
    );
  });
});
