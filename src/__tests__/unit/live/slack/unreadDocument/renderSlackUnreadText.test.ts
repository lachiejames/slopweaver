/**
 * The `slack unread` document's render: one line a row plus its link, and an unavailable read that is no all-clear.
 */
import { describe, expect, it } from "vitest";

import {
  renderSlackUnreadText,
  slackUnreadDocument,
  UNREAD_MEANING,
  unavailableUnreadDocument,
} from "../../../../../live/slack/unreadDocument.js";
import { dmMarker, ISO_THREAD, MAPS, OWNER, person, READ_AT, ROSA, ROSA_DM } from "./harness.js";

describe("renderSlackUnreadText", () => {
  it("renders one line a row plus its link, DMs first", () => {
    const document = slackUnreadDocument({
      input: {
        activitySinceIso: "2026-10-03T05:00:00.000Z",
        appTagsNotListed: 0,
        dmSinceIso: "2026-09-29T05:00:00.000Z",
        dms: [{ marker: dmMarker({ count: 2, other: ROSA }), messages: ROSA_DM }],
        dmsChecked: 12,
        incomplete: false,
        maps: MAPS,
        ownerId: OWNER,
        person,
        readAtIso: READ_AT,
        residue: [],
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
    expect(renderSlackUnreadText({ document })).toEqual([
      "slack unread: read live",
      "DMs (1 unread of 12 checked, since 2026-09-29T05:00:00.000Z):",
      "  Rosa Lindqvist · 2 unread · asks · Rosa Lindqvist: do you want option A or option B?",
      "    https://acme.slack.com/archives/D0SYNDM12345/p1791000100000100",
      "Activity (1 threads, since 2026-10-03T05:00:00.000Z):",
      "  #iso · names you · 2 new of 3 · Rosa Lindqvist, Jasper Nolan · ISO 27001 surveillance audit prep",
      "    Jasper Nolan: quarterly is what the auditor liked last year",
      "    https://acme.slack.com/archives/C0SYNISO12345/p1791000000000100",
      `meaning: ${UNREAD_MEANING}`,
      "residue:",
    ]);
  });

  it("says an unavailable read is not an all-clear", () => {
    const document = unavailableUnreadDocument({
      activitySinceIso: "2026-10-03T05:00:00.000Z",
      dmSinceIso: "2026-09-29T05:00:00.000Z",
      readAtIso: READ_AT,
      reason: "no Slack user token in the store",
    });
    expect(renderSlackUnreadText({ document })).toEqual([
      "slack unread: UNAVAILABLE — nothing was read, so this is NOT an all-clear",
      "  - no Slack user token in the store",
    ]);
  });
});
