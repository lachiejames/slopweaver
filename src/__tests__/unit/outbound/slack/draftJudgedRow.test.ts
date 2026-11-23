/**
 * `draftJudgedRow.ts` — a judgement folds onto a held row, and a `not-owner-yes` hold records the yes it set down.
 */
import { describe, expect, it } from "vitest";

import { judgedRow } from "../../../../outbound/slack/draftJudgedRow.js";
import { draftItem, KNOCK } from "../../supervisor/draftItemFixture.js";

const ID = "sd-11112222";
const AT = "2026-10-08T00:30:00.000Z";

describe("judgedRow", () => {
  it("records the approval a not-owner-yes hold sets down, and drops it from the words", () => {
    const standing = draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" });

    const row = judgedRow({
      event: { id: ID, kind: "held", reason: "not-owner-yes", tsIso: AT, why: "the owner meant the other draft" },
      standing,
    });

    expect(row.draft.approval).toBe(undefined);
    expect(row.judgedIso).toBe(AT);
    expect(row.hold).toEqual({
      atIso: AT,
      reason: "not-owner-yes",
      setDown: { approval: KNOCK, atIso: AT, why: "the owner meant the other draft" },
      why: "the owner meant the other draft",
    });
  });

  it("keeps the approval on a blocking hold and sets no yes down", () => {
    const standing = draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" });

    const row = judgedRow({
      event: { id: ID, kind: "held", reason: "no-fleet-slot", tsIso: AT, why: "every seat is busy" },
      standing,
    });

    expect(row.draft.approval).toEqual(KNOCK);
    expect(row.hold).toEqual({ atIso: AT, reason: "no-fleet-slot", why: "every seat is busy" });
  });

  it("carries a set-down yes through a later blocking hold, which keeps no approval of its own", () => {
    const setDown = { approval: KNOCK, atIso: AT, why: "the owner meant the other draft" };
    const standing = draftItem({
      hold: { atIso: AT, reason: "not-owner-yes", setDown, why: "the owner meant the other draft" },
      id: ID,
      tsIso: "2026-10-08T00:10:00.000Z",
    });
    const later = "2026-10-08T00:35:00.000Z";

    const row = judgedRow({
      event: { id: ID, kind: "held", reason: "no-fleet-slot", tsIso: later, why: "every seat is busy" },
      standing,
    });

    expect(row.draft.approval).toBe(undefined);
    expect(row.hold).toEqual({ atIso: later, reason: "no-fleet-slot", setDown, why: "every seat is busy" });
  });

  it("records a change of meaning waiting on the owner's word that a not-owner-yes hold sets down", () => {
    const parked = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const standing = { ...parked, draft: { ...parked.draft, meaningChanged: "the customer withdrew it" } };

    const row = judgedRow({
      event: { id: ID, kind: "held", reason: "not-owner-yes", tsIso: AT, why: "no longer needed" },
      standing,
    });

    expect(row.draft.meaningChanged).toBe(undefined);
    expect(row.hold?.setDown).toEqual({ atIso: AT, change: "the customer withdrew it", why: "no longer needed" });
  });

  it("keeps the owner's channel steer through a yes and a hold on the words", () => {
    const steer = {
      anchor: "talk:a0000054-0000-4000-8000-000000000057",
      channels: [{ id: "C0SYN000006", name: "dev-alerts" }],
      from: { id: "C0SYN000001", name: "proj-launch-room" },
      heard: "Let's send this to Dev alerts instead",
      tsIso: "2026-10-08T00:20:00.000Z",
    };
    const standing = { ...draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" }), steer };

    const approved = judgedRow({ event: { approval: KNOCK, id: ID, kind: "approved", tsIso: AT }, standing });
    const held = judgedRow({
      event: { id: ID, kind: "held", reason: "not-owner-yes", tsIso: AT, why: "the owner meant the other draft" },
      standing,
    });

    expect([approved.steer, held.steer]).toEqual([steer, steer]);
  });

  it("counts the landings a judgement read, and an uncounted hold keeps that count and instant", () => {
    const standing = draftItem({ id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const later = "2026-10-08T00:35:00.000Z";

    const counted = judgedRow({
      event: {
        id: ID,
        kind: "held",
        landingsRead: 3,
        reason: "not-owner-yes",
        tsIso: AT,
        why: "the owner meant the other",
      },
      standing,
    });
    const uncounted = judgedRow({
      event: { id: ID, kind: "held", reason: "slack-refused", tsIso: later, why: "invalid_auth" },
      standing: counted,
    });
    const approved = judgedRow({
      event: { approval: KNOCK, id: ID, kind: "approved", landingsRead: 5, tsIso: later },
      standing: uncounted,
    });

    expect(counted.judgedLandings).toBe(3);
    expect(uncounted.judgedLandings).toBe(3);
    expect(uncounted.judgedIso).toBe(AT);
    expect(uncounted.hold).toEqual({ atIso: later, reason: "slack-refused", why: "invalid_auth" });
    expect(approved.judgedLandings).toBe(5);
    expect(
      judgedRow({ event: { approval: KNOCK, id: ID, kind: "approved", tsIso: AT }, standing }).judgedLandings,
    ).toBe(undefined);
  });

  it("records the ledger boundary a set-down and a change of meaning were judged at, until an approve", () => {
    const standing = draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" });
    const later = "2026-10-08T00:35:00.000Z";

    const setDown = judgedRow({
      event: {
        id: ID,
        kind: "held",
        landingsRead: 4,
        reason: "not-owner-yes",
        tsIso: AT,
        why: "the owner meant another",
      },
      standing,
    });
    const changed = judgedRow({
      event: { id: ID, kind: "held", landingsRead: 6, reason: "meaning-changed", tsIso: AT, why: "it was withdrawn" },
      standing,
    });
    const blocked = judgedRow({
      event: { id: ID, kind: "held", landingsRead: 7, reason: "no-fleet-slot", tsIso: later, why: "every seat busy" },
      standing: changed,
    });
    const approved = judgedRow({
      event: { approval: KNOCK, id: ID, kind: "approved", landingsRead: 8, tsIso: later },
      standing: blocked,
    });

    expect(setDown.hold!.setDown).toEqual({
      approval: KNOCK,
      atIso: AT,
      landingsRead: 4,
      why: "the owner meant another",
    });
    expect([changed.changedLandings, blocked.changedLandings, blocked.judgedLandings]).toEqual([6, 6, 7]);
    expect(approved.changedLandings).toBe(undefined);
  });

  it("leaves a row that is no longer held exactly as it stood", () => {
    const standing = {
      ...draftItem({ approval: KNOCK, id: ID, tsIso: "2026-10-08T00:10:00.000Z" }),
      state: "dropped" as const,
    };

    expect(judgedRow({ event: { approval: KNOCK, id: ID, kind: "approved", tsIso: AT }, standing })).toBe(standing);
  });
});
