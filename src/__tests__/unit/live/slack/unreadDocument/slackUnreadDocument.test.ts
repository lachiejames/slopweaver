/**
 * The `slack unread` document over projected messages built from raw Slack rows by the real projection: the
 * document's caps, counts and completeness.
 */
import { describe, expect, it } from "vitest";

import { slackUnreadDocument, UNREAD_DM_ROWS, UNREAD_MEANING } from "../../../../../live/slack/unreadDocument.js";
import { dmMarker, dmMessages, ISO_THREAD, MAPS, OWNER, person, READ_AT, ROSA, ROSA_DM } from "./harness.js";

describe("slackUnreadDocument", () => {
  it("lists DMs then activity, caps each, counts what was checked, and calls a row past a cap a short read", () => {
    const manyDms = Array.from({ length: UNREAD_DM_ROWS + 2 }, () => ({
      marker: dmMarker({ count: 2, other: ROSA }),
      messages: ROSA_DM,
    }));
    const document = slackUnreadDocument({
      input: {
        activitySinceIso: "2026-10-03T05:00:00.000Z",
        appTagsNotListed: 0,
        dmSinceIso: "2026-09-29T05:00:00.000Z",
        dms: manyDms,
        dmsChecked: 40,
        incomplete: false,
        maps: MAPS,
        ownerId: OWNER,
        person,
        readAtIso: READ_AT,
        residue: ["a DM is checked only when it has a message since then"],
        threads: [
          {
            channelId: "C0SYNISO12345",
            channelName: "iso",
            direct: false,
            messages: ISO_THREAD,
            taggedFromTs: undefined,
          },
        ],
      },
    });
    expect(document.status).toBe("incomplete");
    expect(document.meaning).toBe(UNREAD_MEANING);
    expect(document.dms.rows.length).toBe(UNREAD_DM_ROWS);
    expect(document.dms.more).toBe(2);
    expect(document.dms.checked).toBe(40);
    expect(document.activity.rows.map((row) => row.where)).toEqual(["#iso"]);
    expect(document.residue).toEqual([
      "a DM is checked only when it has a message since then",
      "2 older unread DM(s) are counted, not listed",
    ]);
  });

  it("counts the app tags it could not list without turning a complete read incomplete", () => {
    const input = {
      activitySinceIso: "2026-10-03T05:00:00.000Z",
      dmSinceIso: "2026-09-29T05:00:00.000Z",
      dms: [],
      dmsChecked: 0,
      incomplete: false,
      maps: MAPS,
      ownerId: OWNER,
      person,
      readAtIso: READ_AT,
      residue: [],
      threads: [],
    };
    const tagged = slackUnreadDocument({ input: { ...input, appTagsNotListed: 2 } });
    expect(tagged.status).toBe("complete");
    expect(tagged.activity.appTagsNotListed).toBe(2);
    const none = slackUnreadDocument({ input: { ...input, appTagsNotListed: 0 } });
    expect(none.status).toBe("complete");
    expect(Object.keys(none.activity)).not.toContain("appTagsNotListed");
  });

  it("is complete when every row it found is listed", () => {
    const document = slackUnreadDocument({
      input: {
        activitySinceIso: "2026-10-03T05:00:00.000Z",
        appTagsNotListed: 0,
        dmSinceIso: "2026-09-29T05:00:00.000Z",
        dms: [{ marker: dmMarker({ count: 2, other: ROSA }), messages: ROSA_DM }],
        dmsChecked: 1,
        incomplete: false,
        maps: MAPS,
        ownerId: OWNER,
        person,
        readAtIso: READ_AT,
        residue: ["a DM is checked only when it has a message since then"],
        threads: [],
      },
    });
    expect(document.status).toBe("complete");
    expect(document.residue).toEqual(["a DM is checked only when it has a message since then"]);
  });

  it("goes incomplete when a DM Slack counts unread had nothing of anyone else's to say", () => {
    const silent = dmMessages({
      channel: "D0SYNDM12345",
      rows: [{ text: "mine", ts: "1791000100.000100", user: OWNER }],
    });
    const document = slackUnreadDocument({
      input: {
        activitySinceIso: "2026-10-03T05:00:00.000Z",
        appTagsNotListed: 0,
        dmSinceIso: "2026-09-29T05:00:00.000Z",
        dms: [{ marker: dmMarker({ count: 1, other: ROSA }), messages: silent }],
        dmsChecked: 1,
        incomplete: false,
        maps: MAPS,
        ownerId: OWNER,
        person,
        readAtIso: READ_AT,
        residue: [],
        threads: [],
      },
    });
    expect(document.status).toBe("incomplete");
    expect(document.residue).toEqual([
      "1 DM(s) Slack counts unread could not have their messages read, so they are not listed",
    ]);
  });
});
