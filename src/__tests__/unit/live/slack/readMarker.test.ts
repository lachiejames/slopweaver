/**
 * Slack's own read marker off a raw `conversations.info` body, in the three shapes measured on the owner's workspace:
 * a one-to-one DM (count and `latest`), a group DM (`last_read` only), and a private channel the
 * `is:mpim` search also matched (neither flag set).
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  isDirectConversation,
  mayHaveUnread,
  ReadMarkerErrors,
  readMarkerOf,
  statesNotDirect,
} from "../../../../live/slack/readMarker.js";

const OWNER = "U0SYNOWNER1234";
const OTHER = "U0SYNOTHER123";

/** A one-to-one DM's `conversations.info` body. */
function dmBody({
  count,
  latest,
}: {
  count: number | undefined;
  latest: { ts: string; user: string } | undefined;
}): unknown {
  return {
    channel: {
      id: "D0SYNDM12345",
      is_im: true,
      last_read: "1791000000.000100",
      user: OTHER,
      ...(count === undefined ? {} : { unread_count: count, unread_count_display: count }),
      ...(latest === undefined ? {} : { latest }),
    },
    ok: true,
  };
}

const GROUP_BODY = { channel: { id: "C0SYNGROUP123", is_mpim: true, last_read: "1791000000.000100" }, ok: true };
const PRIVATE_CHANNEL_BODY = {
  channel: { id: "C0SYNPRIV1234", is_im: false, is_mpim: false, last_read: "1791000000.000100" },
  ok: true,
};

describe("readMarkerOf", () => {
  it("reads a one-to-one DM's marker, count, other person and newest message", () => {
    const marker = unwrap(
      readMarkerOf({ body: dmBody({ count: 2, latest: { ts: "1791000100.000200", user: OTHER } }) }),
    );
    expect(marker).toEqual({
      channelId: "D0SYNDM12345",
      kind: "dm",
      lastRead: "1791000000.000100",
      latest: { ts: "1791000100.000200", userId: OTHER },
      otherUserId: OTHER,
      unreadCount: 2,
    });
  });

  it("reads a group DM with no count as a marker whose count is unknown, never zero", () => {
    const marker = unwrap(readMarkerOf({ body: GROUP_BODY }));
    expect(marker.kind).toBe("group");
    expect(marker.unreadCount).toBe(undefined);
    expect(marker.latest).toBe(undefined);
  });

  it("refuses a one-to-one DM with no count rather than reading it as nothing unread", () => {
    const parsed = readMarkerOf({ body: dmBody({ count: undefined, latest: undefined }) });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(ReadMarkerErrors.noUnreadCount({ channelId: "D0SYNDM12345" }));
    expect(unwrapErr(parsed).message).toBe(
      "D0SYNDM12345 answered no `unread_count_display`, so what is unread there is unknown",
    );
  });

  it("refuses a conversation that is not a DM, one with no `last_read`, and a body with no channel", () => {
    expect(unwrapErr(readMarkerOf({ body: PRIVATE_CHANNEL_BODY })).code).toBe("NOT_DIRECT");
    expect(unwrapErr(readMarkerOf({ body: { channel: { id: "C0SYNGROUP123", is_mpim: true } } })).code).toBe(
      "NO_LAST_READ",
    );
    expect(unwrapErr(readMarkerOf({ body: { ok: true } }))).toEqual(ReadMarkerErrors.noChannel());
  });
});

describe("statesNotDirect", () => {
  it("is true only when both DM flags are stated false, never of a body that names neither", () => {
    expect(statesNotDirect({ body: PRIVATE_CHANNEL_BODY })).toBe(true);
    expect(statesNotDirect({ body: { channel: { id: "D0SYNDM12345" }, ok: true } })).toBe(false);
    expect(statesNotDirect({ body: GROUP_BODY })).toBe(false);
  });
});

describe("isDirectConversation", () => {
  it("is true of a DM and a group DM, false of the private channel `is:mpim` also matched", () => {
    expect(isDirectConversation({ body: dmBody({ count: 0, latest: undefined }) })).toBe(true);
    expect(isDirectConversation({ body: GROUP_BODY })).toBe(true);
    expect(isDirectConversation({ body: PRIVATE_CHANNEL_BODY })).toBe(false);
  });
});

describe("mayHaveUnread", () => {
  /** Whether a body's own marker says its messages must be read. */
  const read = ({ body }: { body: unknown }): boolean =>
    mayHaveUnread({ marker: unwrap(readMarkerOf({ body })), ownerId: OWNER });

  it("says no only when the count is zero and the newest message is the owner's or not past the marker", () => {
    expect(read({ body: dmBody({ count: 0, latest: { ts: "1791000100.000200", user: OWNER } }) })).toBe(false);
    expect(read({ body: dmBody({ count: 0, latest: { ts: "1790999000.000000", user: OTHER } }) })).toBe(false);
    expect(read({ body: dmBody({ count: 0, latest: undefined }) })).toBe(false);
  });

  it("says yes on Slack's count, on a newer message of theirs the count has not caught, and on a group DM", () => {
    expect(read({ body: dmBody({ count: 3, latest: { ts: "1791000100.000200", user: OWNER } }) })).toBe(true);
    expect(read({ body: dmBody({ count: 0, latest: { ts: "1791000100.000200", user: OTHER } }) })).toBe(true);
    expect(read({ body: GROUP_BODY })).toBe(true);
  });
});
