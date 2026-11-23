/**
 * The `slack unread` document over projected messages built from raw Slack rows by the real projection: a thread
 * row from a person's word since the owner's. The tagged-thread and DM cases are `./threadRowOfTagged.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { threadRowOf } from "../../../../../live/slack/unreadRows.js";
import { ISO_THREAD, MAPS, OWNER, person } from "./harness.js";

describe("threadRowOf", () => {
  it("rows a thread the owner spoke in by what people said after the owner, and says it names the owner", () => {
    const row = threadRowOf({
      maps: MAPS,
      ownerId: OWNER,
      person,
      read: {
        channelId: "C0SYNISO12345",
        channelName: "iso",
        direct: false,
        messages: ISO_THREAD,
        taggedFromTs: undefined,
      },
    });
    expect(row).toEqual({
      atIso: "2026-10-03T04:05:00.000Z",
      forYou: "names you",
      kind: "reply",
      lastFrom: "Jasper Nolan",
      line: "quarterly is what the auditor liked last year",
      newReplies: 2,
      people: ["Rosa Lindqvist", "Jasper Nolan"],
      replies: 3,
      topic: "ISO 27001 surveillance audit prep",
      url: "https://acme.slack.com/archives/C0SYNISO12345/p1791000000000100",
      where: "#iso",
    });
  });

  it("gives no row when the owner's is the last word", () => {
    const quiet = ISO_THREAD.slice(0, 2);
    expect(
      threadRowOf({
        maps: MAPS,
        ownerId: OWNER,
        person,
        read: {
          channelId: "C0SYNISO12345",
          channelName: "iso",
          direct: false,
          messages: quiet,
          taggedFromTs: undefined,
        },
      }),
    ).toBe(undefined);
  });
});
