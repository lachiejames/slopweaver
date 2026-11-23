/**
 * The `slack unread` document over projected messages built from raw Slack rows by the real projection: a DM row
 * off Slack's read marker, an app DM counted by name.
 */
import { describe, expect, it } from "vitest";

import type { ReadMarker } from "../../../../../live/slack/readMarker.js";
import { dmRowOf } from "../../../../../live/slack/unreadRows.js";
import { BOT, dmMarker, dmMessages, JASPER, MAPS, OWNER, person, ROSA, ROSA_DM } from "./harness.js";

describe("dmRowOf", () => {
  it("rows a person's DM with Slack's count, the newest line, whether it asks, and the first unread message's link", () => {
    const built = dmRowOf({
      maps: MAPS,
      ownerId: OWNER,
      person,
      read: { marker: dmMarker({ count: 2, other: ROSA }), messages: ROSA_DM },
    });
    expect(built).toEqual({
      row: {
        asks: true,
        atIso: "2026-10-03T04:03:20.000Z",
        kind: "dm",
        lastFrom: "Rosa Lindqvist",
        line: "do you want option A or option B?",
        unread: 2,
        url: "https://acme.slack.com/archives/D0SYNDM12345/p1791000100000100",
        with: "Rosa Lindqvist",
      },
    });
  });

  it("counts an app's DM by name instead of rowing it", () => {
    const messages = dmMessages({
      channel: "D0SYNDM12345",
      rows: [{ text: "PR landed", ts: "1791000100.000100", user: BOT }],
    });
    const built = dmRowOf({
      maps: MAPS,
      ownerId: OWNER,
      person,
      read: { marker: dmMarker({ count: 1, other: BOT }), messages },
    });
    expect(built).toEqual({ app: { name: "acme-bot", unread: 1 } });
  });

  it("counts a group DM's unread from the messages past the marker, there being no count, and names who spoke", () => {
    const messages = dmMessages({
      channel: "C0SYNGROUP123",
      rows: [
        { text: "lunch?", ts: "1791000100.000100", user: JASPER },
        { text: "sure", ts: "1791000150.000100", user: OWNER },
        { text: "12:30 then", ts: "1791000200.000100", user: ROSA },
      ],
    });
    const marker: ReadMarker = {
      ...dmMarker({ count: undefined, other: undefined }),
      channelId: "C0SYNGROUP123",
      kind: "group",
    };
    const built = dmRowOf({ maps: MAPS, ownerId: OWNER, person, read: { marker, messages } });
    expect(built).toEqual({
      row: {
        asks: true,
        atIso: "2026-10-03T04:03:20.000Z",
        kind: "group",
        lastFrom: "Rosa Lindqvist",
        line: "12:30 then",
        unread: 2,
        url: "https://acme.slack.com/archives/C0SYNGROUP123/p1791000100000100",
        with: "a group DM with Jasper Nolan, Rosa Lindqvist",
      },
    });
  });

  it("gives no row when nothing past the marker is somebody else's", () => {
    const messages = dmMessages({
      channel: "D0SYNDM12345",
      rows: [{ text: "note to self", ts: "1791000100.000100", user: OWNER }],
    });
    expect(
      dmRowOf({ maps: MAPS, ownerId: OWNER, person, read: { marker: dmMarker({ count: 1, other: ROSA }), messages } }),
    ).toBe(undefined);
  });
});
