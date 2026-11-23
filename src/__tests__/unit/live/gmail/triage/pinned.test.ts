/*
 * `pinnedStillInInbox`: which of a card's pinned ids a fresh `gmail triage` reading still holds, in pinned order.
 */
import { describe, expect, it } from "vitest";

import { buildGmailTriage } from "../../../../../live/gmail/triage.js";
import { pinnedStillInInbox } from "../../../../../live/gmail/triageActs.js";
import { EVERY_LANE_POLICY, message, READ_AT } from "./harness.js";

describe("pinnedStillInInbox", () => {
  // The fresh reading holds a pinned id, an id that arrived (or came back from a snooze) AFTER the pin — older than
  // the pin by received time, which is exactly what a time bound would have wrongly caught — and an unkeyed pinned id.
  const document = buildGmailTriage({
    account: "owner@example.test",
    complete: true,
    inviteFileIds: new Set<string>(),
    repliedThreadIds: new Set<string>(),
    inboxEstimate: undefined,
    policy: EVERY_LANE_POLICY,
    messages: [
      message({ atIso: "2026-09-29T10:00:00.000Z", from: "a@example.test", id: "shown" }),
      message({ atIso: "2026-09-01T10:00:00.000Z", from: "a@example.test", id: "unsnoozed" }),
      message({ atIso: "2026-09-29T11:00:00.000Z", from: undefined, id: "no-from" }),
    ],
    readAtIso: READ_AT,
  });

  it("keeps only ids the card pinned, in pinned order, never one the card did not show", () => {
    expect(pinnedStillInInbox({ document, pinned: ["no-from", "shown", "moved-already"] })).toEqual([
      "no-from",
      "shown",
    ]);
  });

  it("is empty when every pinned id has left the inbox", () => {
    expect(pinnedStillInInbox({ document, pinned: ["moved-already"] })).toEqual([]);
  });
});
