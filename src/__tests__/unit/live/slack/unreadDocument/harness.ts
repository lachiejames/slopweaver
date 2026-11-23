/*
 * What the `slack unread` document test files share: the synthetic people and maps, projected DM messages and a
 * whole thread built from raw Slack rows by the real projection, a DM marker, and the two fixtures most cases read.
 */
import { unwrap } from "../../../../../lib/result.js";
import { projectSlackThread, projectTopLevelMessages } from "../../../../../live/slack/projection.js";
import type { ReadMarker } from "../../../../../live/slack/readMarker.js";
import type { VisibleSlackMessage } from "../../../../../live/slack/types.js";
import type { PersonOf } from "../../../../../live/slack/unreadRows.js";

const WORKSPACE = "https://acme.slack.com";
/** The owner's synthetic Slack user id. */
export const OWNER = "U0SYNOWNER1234";
/** A synthetic colleague's Slack user id. */
export const ROSA = "U0SYNROSA123";
/** A second synthetic colleague's Slack user id. */
export const JASPER = "U0SYNJASPER123";
/** A synthetic app user's Slack id. */
export const BOT = "U0SYNBOTUSER1";
/** The instant the unread read was taken. */
export const READ_AT = "2026-10-06T05:00:00.000Z";

const PEOPLE: Readonly<Record<string, { name: string; isHuman: boolean }>> = {
  [BOT]: { isHuman: false, name: "acme-bot" },
  [JASPER]: { isHuman: true, name: "Jasper Nolan" },
  [OWNER]: { isHuman: true, name: "Ada Owner" },
  [ROSA]: { isHuman: true, name: "Rosa Lindqvist" },
};
/**
 * Who an author id is, over the synthetic roster.
 *
 * @returns the roster entry's name and whether it is a human
 */
export const person: PersonOf = ({ authorId }) => PEOPLE[authorId]!;
/** The name maps the rows render with. */
export const MAPS = {
  channelNames: {},
  userNames: { [JASPER]: "Jasper Nolan", [OWNER]: "Ada Owner", [ROSA]: "Rosa Lindqvist" },
};

/**
 * Top-level DM messages, oldest first, through the real projection.
 *
 * @returns the projected messages
 */
export function dmMessages({
  channel,
  rows,
}: {
  channel: string;
  rows: readonly Record<string, unknown>[];
}): readonly VisibleSlackMessage[] {
  return projectTopLevelMessages({ channel, rawMessages: rows.toReversed(), workspace: WORKSPACE }).messages;
}

/**
 * A whole thread, root first, through the real projection.
 *
 * @returns the projected thread messages
 */
export function thread({
  channel,
  rows,
}: {
  channel: string;
  rows: readonly Record<string, unknown>[];
}): readonly VisibleSlackMessage[] {
  const threadTs = String(rows[0]!["ts"]);
  const target = { addressedReply: false, addressedTs: threadTs, channel, threadTs, workspace: WORKSPACE };
  return unwrap(projectSlackThread({ rawMessages: rows, target })).messages;
}

/**
 * A one-to-one DM's marker.
 *
 * @returns the read marker with that other user and count
 */
export function dmMarker({ other, count }: { other: string | undefined; count: number | undefined }): ReadMarker {
  return {
    channelId: "D0SYNDM12345",
    kind: "dm",
    lastRead: "1791000000.000000",
    latest: undefined,
    otherUserId: other,
    unreadCount: count,
  };
}

/** Two of Rosa's DM messages, the second asking a question. */
export const ROSA_DM = dmMessages({
  channel: "D0SYNDM12345",
  rows: [
    { text: "hey, the ISO evidence for A.5.15 is due", ts: "1791000100.000100", user: ROSA },
    { text: "do you want option A or option B?", ts: "1791000200.000200", user: ROSA },
  ],
});

/** A channel thread Rosa opened, the owner spoke in, and two people spoke after. */
export const ISO_THREAD = thread({
  channel: "C0SYNISO12345",
  rows: [
    {
      reply_count: 3,
      text: "ISO 27001 surveillance audit prep",
      thread_ts: "1791000000.000100",
      ts: "1791000000.000100",
      user: ROSA,
    },
    { text: "I'll take the access reviews", thread_ts: "1791000000.000100", ts: "1791000100.000100", user: OWNER },
    {
      text: `<@${OWNER}> A: annual or B: quarterly?`,
      thread_ts: "1791000000.000100",
      ts: "1791000200.000100",
      user: ROSA,
    },
    {
      text: "quarterly is what the auditor liked last year",
      thread_ts: "1791000000.000100",
      ts: "1791000300.000100",
      user: JASPER,
    },
  ],
});
