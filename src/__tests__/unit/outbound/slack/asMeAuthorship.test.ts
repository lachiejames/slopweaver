/**
 * `asMeAuthorship` — a message under the owner's name is Slopweaver's to correct only when the as-me draft register
 * shows it released there, as the owner, under the same user the token signs in as.
 */
import { describe, expect, it } from "vitest";

import { asMeAuthorship, asMeAuthorshipRefusal } from "../../../../outbound/slack/asMeAuthorship.js";
import { parseSlackDraftLog } from "../../../../outbound/slack/draftLog.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  slackDraftEventLine,
} from "../../../../outbound/slack/draftRegister.js";
import type { ReadSlackMessage } from "../../../../outbound/slack/lifecycleGuards.js";

const POSTED = { channel: "C0SYN000008", ts: "1792561174.501869" };
const ME = "U0ME";

/** The owner's message as Slack stores it: posted by the owner's user, no bot id, no card metadata. */
const HIS_MESSAGE: ReadSlackMessage = {
  fileIds: [],
  stored: { text: "V23 is 10 controls." },
  ts: POSTED.ts,
  userId: ME,
};

/** One parked row and, unless `released` is false, its release to `released`. */
function logOf({
  actor,
  authorId = ME,
  released = POSTED,
  extraLines = [],
}: {
  actor?: "bot";
  /** The recording's user, or `null` for a row parked before the register named one. */
  authorId?: string | null;
  released?: { channel: string; ts: string } | false;
  extraLines?: readonly string[];
}): ReturnType<typeof parseSlackDraftLog> {
  const content = {
    ...(authorId === null ? {} : { authorId }),
    channel: POSTED.channel,
    mentions: [],
    payload: { form: "plain" as const, text: "V23 is 10 controls.", unfurl_links: false, unfurl_media: false },
  };
  const row: ParkedSlackDraft = {
    ...content,
    ...(actor === undefined ? {} : { actor }),
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id: "sd-v23",
    shape: "top-level",
    tsIso: "2026-10-21T05:00:00.000Z",
    why: "the V23 card",
  };
  const lines = [slackDraftEventLine({ event: { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso } })];
  if (released !== false) {
    lines.push(
      slackDraftEventLine({
        event: {
          channel: released.channel,
          id: row.id,
          kind: "released",
          ts: released.ts,
          tsIso: "2026-10-21T05:01:00.000Z",
        },
      }),
    );
  }
  return parseSlackDraftLog({ lines: [...lines, ...extraLines] });
}

describe("asMeAuthorship", () => {
  it("owns a message a released as-me row names, under the user the token is", () => {
    expect(asMeAuthorship({ log: logOf({}), message: HIS_MESSAGE, posted: POSTED, selfUserId: ME })).toEqual({
      draftId: "sd-v23",
      kind: "owned",
    });
  });

  it("refuses a row recorded before authorId existed: absence is not identity", () => {
    const verdict = asMeAuthorship({
      log: logOf({ authorId: null }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ authorId: undefined, draftId: "sd-v23", kind: "other-author" });
  });

  it("refuses when auth.test named no user, even on a message that names none either", () => {
    const verdict = asMeAuthorship({
      log: logOf({}),
      message: { ...HIS_MESSAGE, userId: undefined },
      posted: POSTED,
      selfUserId: undefined,
    });
    expect(verdict).toEqual({ botId: undefined, kind: "not-owner-message", messageUserId: undefined });
  });

  it("refuses when two rows each say they released the one message", () => {
    const second = slackDraftEventLine({
      event: {
        channel: POSTED.channel,
        id: "sd-twin",
        kind: "released",
        ts: POSTED.ts,
        tsIso: "2026-10-21T05:02:00.000Z",
      },
    });
    const verdict = asMeAuthorship({
      log: logOf({ extraLines: [second] }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ draftIds: ["sd-v23", "sd-twin"], kind: "ambiguous-release" });
  });

  it("still owns the message when the only unreadable line names another row", () => {
    const other = JSON.stringify({ id: "sd-other", kind: "parked", schemaVersion: 1 });
    const log = logOf({ extraLines: [other] });
    expect(log.skipped.map((line) => line.id)).toEqual(["sd-other"]);
    expect(asMeAuthorship({ log, message: HIS_MESSAGE, posted: POSTED, selfUserId: ME }).kind).toBe("owned");
  });

  it("refuses a message the owner typed directly: no released row names it", () => {
    const verdict = asMeAuthorship({
      log: logOf({ released: false }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ kind: "no-released-row" });
  });

  it("refuses when the released row went to another message in the same channel", () => {
    const elsewhere = { channel: POSTED.channel, ts: "1792561174.000001" };
    const verdict = asMeAuthorship({
      log: logOf({ released: elsewhere }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ kind: "no-released-row" });
  });

  it("refuses a row released as the bot", () => {
    const verdict = asMeAuthorship({
      log: logOf({ actor: "bot" }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ draftId: "sd-v23", kind: "bot-row" });
  });

  it("refuses a row recorded under another user", () => {
    const verdict = asMeAuthorship({
      log: logOf({ authorId: "U0SYNSOMEONE" }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ authorId: "U0SYNSOMEONE", draftId: "sd-v23", kind: "other-author" });
  });

  it("owns the owner's message posted through the app, which carries the app's bot id beside the owner's user", () => {
    // A message read back live carried the app's bot_id and the owner's user both.
    const verdict = asMeAuthorship({
      log: logOf({}),
      message: { ...HIS_MESSAGE, botId: "B0SYN000001" },
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ draftId: "sd-v23", kind: "owned" });
  });

  it("refuses a message another user, or the bot's own user, posted, whatever the register says", () => {
    const theirs = asMeAuthorship({
      log: logOf({}),
      message: { ...HIS_MESSAGE, userId: "U0SYNSOMEONE" },
      posted: POSTED,
      selfUserId: ME,
    });
    const bots = asMeAuthorship({
      log: logOf({}),
      message: { ...HIS_MESSAGE, botId: "B1", userId: "U0SYNBOTUSER" },
      posted: POSTED,
      selfUserId: ME,
    });
    expect([theirs, bots]).toEqual([
      { botId: undefined, kind: "not-owner-message", messageUserId: "U0SYNSOMEONE" },
      { botId: "B1", kind: "not-owner-message", messageUserId: "U0SYNBOTUSER" },
    ]);
  });

  it("judges the park that stood at the release, not one re-parked after it", () => {
    const sentAsSomeoneElse = logOf({ authorId: "U0SYNSOMEONE" });
    const reparkedAsMe = logOf({ released: false }).events;
    const verdict = asMeAuthorship({
      log: { ...sentAsSomeoneElse, events: [...sentAsSomeoneElse.events, ...reparkedAsMe] },
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ authorId: "U0SYNSOMEONE", draftId: "sd-v23", kind: "other-author" });
  });

  it("refuses a release no park of its row comes before", () => {
    const log = logOf({});
    const verdict = asMeAuthorship({
      log: { ...log, events: log.events.filter((event) => event.kind === "released") },
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ draftId: "sd-v23", kind: "row-unreadable" });
  });

  it("refuses when a line the register cannot read may touch the row", () => {
    const verdict = asMeAuthorship({
      log: logOf({ extraLines: ["{not json"] }),
      message: HIS_MESSAGE,
      posted: POSTED,
      selfUserId: ME,
    });
    expect(verdict).toEqual({ draftId: "sd-v23", kind: "row-unreadable" });
  });
});

describe("asMeAuthorshipRefusal", () => {
  it("names the message and says a message the owner typed is the owner's to correct", () => {
    expect(asMeAuthorshipRefusal({ posted: POSTED, verdict: { kind: "no-released-row" } })).toBe(
      "slack correct --as me refused C0SYN000008/1792561174.501869: no released row in the as-me draft register " +
        "names this message, so nothing proves Slopweaver sent it rather than the owner typing it. A message the owner typed is " +
        "the owner's to correct. Nothing was changed.",
    );
  });

  it("routes a bot row back to the bot lane", () => {
    expect(asMeAuthorshipRefusal({ posted: POSTED, verdict: { draftId: "sd-v23", kind: "bot-row" } })).toContain(
      "Correct it without --as me",
    );
  });
});
