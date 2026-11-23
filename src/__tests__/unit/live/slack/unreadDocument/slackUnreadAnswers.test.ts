/**
 * Whether a `slack unread` document answers the voice, or fails so a short read never reads as an all-clear.
 */
import { describe, expect, it } from "vitest";

import {
  type SlackUnreadDocument,
  slackUnreadAnswers,
  slackUnreadDocument,
  slackUnreadFailureLines,
  unavailableUnreadDocument,
} from "../../../../../live/slack/unreadDocument.js";
import { dmMarker, MAPS, OWNER, person, READ_AT, ROSA, ROSA_DM } from "./harness.js";

describe("slackUnreadAnswers", () => {
  /** A document over one Rosa DM or none, its read short or not. */
  const documentOf = ({ withRow, incomplete }: { withRow: boolean; incomplete: boolean }): SlackUnreadDocument =>
    slackUnreadDocument({
      input: {
        activitySinceIso: "2026-10-03T05:00:00.000Z",
        appTagsNotListed: 0,
        dmSinceIso: "2026-09-29T05:00:00.000Z",
        dms: withRow ? [{ marker: dmMarker({ count: 2, other: ROSA }), messages: ROSA_DM }] : [],
        dmsChecked: 1,
        incomplete,
        maps: MAPS,
        ownerId: OWNER,
        person,
        readAtIso: READ_AT,
        residue: incomplete ? ["3 DM(s) were not checked in time"] : [],
        threads: [],
      },
    });

  it("answers a complete read, empty or not, and a short read that still lists a row", () => {
    expect(slackUnreadAnswers({ document: documentOf({ incomplete: false, withRow: false }) })).toBe(true);
    expect(slackUnreadAnswers({ document: documentOf({ incomplete: false, withRow: true }) })).toBe(true);
    const short = documentOf({ incomplete: true, withRow: true });
    expect(short.status).toBe("incomplete");
    expect(slackUnreadAnswers({ document: short })).toBe(true);
  });

  it("fails a short read that lists nothing, and an unavailable one, so neither reads as an all-clear", () => {
    const short = documentOf({ incomplete: true, withRow: false });
    expect(short.status).toBe("incomplete");
    expect(slackUnreadAnswers({ document: short })).toBe(false);
    const unavailable = unavailableUnreadDocument({
      activitySinceIso: "2026-10-03T05:00:00.000Z",
      dmSinceIso: "2026-09-29T05:00:00.000Z",
      readAtIso: READ_AT,
      reason: "no Slack user token in the store",
    });
    expect(slackUnreadAnswers({ document: unavailable })).toBe(false);
  });

  it("says why on stderr when it does not answer, since the voice keeps only stderr from a failed verb", () => {
    expect(slackUnreadFailureLines({ document: documentOf({ incomplete: true, withRow: true }) })).toEqual([]);
    expect(slackUnreadFailureLines({ document: documentOf({ incomplete: true, withRow: false }) })).toEqual([
      "slack unread: INCOMPLETE — nothing could be listed, so this is not an all-clear",
      "  - 3 DM(s) were not checked in time",
    ]);
  });
});
