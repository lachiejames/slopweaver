/*
 * Reading the action off a published board row. The property under test is the THREE-armed answer: a row
 * with no action and a row whose action will not read are different states, because a card that drew
 * "this ask offers no draft" over a malformed one would report a defect as a fact.
 */

import { describe, expect, it } from "vitest";

import { rowAction } from "../../components/live/readAction";
import type { Bag } from "../../lib/bag";

/** One published action, as `handover list --json` writes it. */
const action = (): Bag => ({
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
});

describe("rowAction", () => {
  it("answers none for the ordinary ask, which offers no draft", () => {
    expect(rowAction({ row: { slug: "a-run" } })).toEqual({ kind: "none" });
  });

  it("answers none for an action published as null", () => {
    expect(rowAction({ row: { action: null } })).toEqual({ kind: "none" });
  });

  it("reads a whole action, dropping the fields the card does not draw", () => {
    expect(rowAction({ row: { action: action() } })).toEqual({
      action: {
        actor: "me",
        body: "<@U01ARI> the E2E switch-over is ready for review.",
        destinations: [
          {
            channel: "C01SDLC",
            kind: "channel",
            label: "Post it to #delivery",
            tradeoff: "the whole channel sees we are asking",
            url: undefined,
          },
        ],
        followUps: [],
        mentions: [{ label: "Ari", userId: "U01ARI" }],
      },
      kind: "action",
    });
  });

  it("reads a thread destination with its root ts and permalink", () => {
    const destinations = [
      {
        channel: "C01SDLC",
        kind: "thread",
        label: "Reply in the thread",
        permalink: "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
        threadTs: "1758500000.000100",
        tradeoff: "only the thread sees it",
      },
    ];
    const read = rowAction({ row: { action: { ...action(), destinations } } });
    expect(read).toEqual({
      action: {
        actor: "me",
        body: "<@U01ARI> the E2E switch-over is ready for review.",
        destinations: [
          {
            channel: "C01SDLC",
            kind: "thread",
            label: "Reply in the thread",
            permalink: "https://acme.slack.com/archives/C01SDLC/p1758500000000100",
            threadTs: "1758500000.000100",
            tradeoff: "only the thread sees it",
          },
        ],
        followUps: [],
        mentions: [{ label: "Ari", userId: "U01ARI" }],
      },
      kind: "action",
    });
  });

  it("reads a draft sent in parts, every follow-up in order", () => {
    const read = rowAction({ row: { action: { ...action(), followUps: ["second", "third"] } } });
    expect(JSON.stringify(read)).toContain('"followUps":["second","third"]');
    expect(read.kind).toBe("action");
  });

  it("invalidates the whole draft when one follow-up is blank, never previewing a subset", () => {
    expect(rowAction({ row: { action: { ...action(), followUps: ["second", " "] } } })).toEqual({
      kind: "invalid",
      why: "one of the action's follow-up messages is blank or not text",
    });
  });

  it("invalidates the whole draft when the follow-ups are not a list of text", () => {
    expect(rowAction({ row: { action: { ...action(), followUps: "second" } } })).toEqual({
      kind: "invalid",
      why: "one of the action's follow-up messages is blank or not text",
    });
  });

  it("reads a DM destination with the people it reaches", () => {
    const destinations = [
      {
        conversation: "D01ARI",
        kind: "dm",
        label: "DM Ari",
        recipients: [{ label: "Ari", userId: "U01ARI" }],
        tradeoff: "only the owner sees it",
      },
    ];
    const read = rowAction({ row: { action: { ...action(), destinations } } });
    expect(JSON.stringify(read)).toContain('"conversation":"D01ARI"');
    expect(read.kind).toBe("action");
  });

  it("names the defect when the action is not an object at all", () => {
    expect(rowAction({ row: { action: "post it" } })).toEqual({
      kind: "invalid",
      why: "the action is not an object",
    });
  });

  it("names the defect when there is no message to draw", () => {
    expect(rowAction({ row: { action: { ...action(), body: undefined } } })).toEqual({
      kind: "invalid",
      why: "the action names no actor or carries no message body",
    });
  });

  it("names the defect when the message body is blank, never drawing an empty quote", () => {
    expect(rowAction({ row: { action: { ...action(), body: "  \n" } } })).toEqual({
      kind: "invalid",
      why: "the action names no actor or carries no message body",
    });
  });

  it("reports invalid when the only destination does not name its channel", () => {
    const destinations = [{ kind: "channel", label: "Post it to #delivery", tradeoff: "everyone sees it" }];
    expect(rowAction({ row: { action: { ...action(), destinations } } })).toEqual({
      kind: "invalid",
      why: "one of the action's destinations does not name where it would send",
    });
  });

  // A destination's link is an address the row is placed by, so one present and unreadable is not absence.
  it("reports invalid when a present link does not read as an address", () => {
    const channel = { channel: "C01SDLC", kind: "channel", label: "#delivery", tradeoff: "everyone sees it", url: 7 };
    const thread = {
      channel: "C01SDLC",
      kind: "thread",
      label: "Reply in the thread",
      permalink: "acme.slack.com/archives/C01SDLC/p1",
      threadTs: "1758500000.000100",
      tradeoff: "only the thread sees it",
    };
    const invalid = { kind: "invalid", why: "one of the action's destinations does not name where it would send" };
    expect(rowAction({ row: { action: { ...action(), destinations: [channel] } } })).toEqual(invalid);
    expect(rowAction({ row: { action: { ...action(), destinations: [thread] } } })).toEqual(invalid);
    // A link on another scheme parses but routes to no page, so it is unreadable too.
    const ftp = { ...thread, permalink: "ftp://acme.slack.com/archives/C01SDLC/p1" };
    expect(rowAction({ row: { action: { ...action(), destinations: [ftp] } } })).toEqual(invalid);
  });

  it("reports invalid when the list is there and empty, which is a different defect", () => {
    expect(rowAction({ row: { action: { ...action(), destinations: [] } } })).toEqual({
      kind: "invalid",
      why: "the action offers nowhere to send the message",
    });
  });

  // ONE broken destination invalidates the whole action rather than leaving the survivors: the options a
  // card shows ARE the destinations, so a surviving subset offers the owner two places for a message the row says
  // goes to three, reading exactly as complete. The good destination is in the input so this is falsifiable
  // — a decoder that went back to dropping would return it and redden both halves.
  it("invalidates the whole action when one destination does not read, keeping no survivors", () => {
    const destinations = [
      { channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "everyone sees it" },
      { channel: "C02OPS", kind: "thread", label: "Reply in the thread", tradeoff: "only the thread sees it" },
    ];
    const read = rowAction({ row: { action: { ...action(), destinations } } });

    expect(read).toEqual({
      kind: "invalid",
      why: "one of the action's destinations does not name where it would send",
    });
    expect(JSON.stringify(read)).not.toContain("Post it to #delivery");
  });

  it("drops a mention missing its label rather than drawing a raw id as a name", () => {
    const mentions = [{ userId: "U01ARI" }, { label: "Tobias", userId: "U01TOB" }];
    const read = rowAction({ row: { action: { ...action(), mentions } } });
    expect(JSON.stringify(read)).toContain('"mentions":[{"label":"Tobias","userId":"U01TOB"}]');
  });
});
