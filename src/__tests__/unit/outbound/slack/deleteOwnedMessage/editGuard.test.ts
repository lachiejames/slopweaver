/*
 * The edit guard a caller of `deleteOwnedMessage` can ask for: an edit at or after the caller's own record, or either
 * instant unreadable, is refused and left standing; an edit predating the record, or no record at all, deletes.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { deleteOwnedMessage } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { ACCEPTED, fakeTransport, freshHome, freshLog, OURS, TARGET, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("deleteOwnedMessage — the edit guard a caller can ask for", () => {
  it("refuses a message edited since the caller's own record, leaving it standing", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: { ...OURS, editedTs: "1790056013.000000" } }),
      unchangedSince: "2026-09-22T05:21:30.000Z",
    });

    expect(unwrapErr(outcome).code).toBe("EDITED_SINCE");
    expect(unwrapErr(outcome).message).toContain("1790056013.000000");
    expect(log.deletes).toEqual([]);
    expect(log.calls).not.toContain("deleteMessageOnce");
  });

  it("deletes a message whose only edit PREDATES that record, which is the one the caller judged", async () => {
    const log = freshLog();
    // `1790048000` is 28 minutes before the record's instant below.
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: { ...OURS, editedTs: "1790048000.000000" } }),
      unchangedSince: "2026-09-22T05:21:30.000Z",
    });

    expect(unwrap(outcome)).toEqual({ kind: "deleted", posted: TARGET });
    expect(log.deletes).toEqual([TARGET]);
  });

  it("refuses an edit at the EXACT instant of the record, because the two orderings are indistinguishable", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      // `1790054490.000000` is the same instant as `unchangedSince` below (`slopweaver slack when 1790054490.000000`).
      // The comparison is `>=` rather than `>`, and this pins the boundary so the weaker one cannot survive.
      transport: fakeTransport({ log, message: { ...OURS, editedTs: "1790054490.000000" } }),
      unchangedSince: "2026-09-22T05:21:30.000Z",
    });

    expect(unwrapErr(outcome).code).toBe("EDITED_SINCE");
    expect(log.deletes).toEqual([]);
  });

  it("refuses when the CALLER's own instant is the unreadable one, not just the message's", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: { ...OURS, editedTs: "1790056013.000000" } }),
      // `Date.parse` answers NaN, and every comparison against NaN is false — so without the `isNaN` arm
      // the guard reads an edited message as unedited. Both sides of the comparison need a witness.
      unchangedSince: "not-an-instant",
    });

    expect(unwrapErr(outcome).code).toBe("EDITED_SINCE");
    expect(log.deletes).toEqual([]);
  });

  it("refuses an edit it cannot place in time, which is the direction that leaves a repair standing", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      // What `pickReadMessage` reports for an `edited` block Slack sent in a shape it does not document.
      transport: fakeTransport({ log, message: { ...OURS, editedTs: "unreadable" } }),
      unchangedSince: "2026-09-22T05:21:30.000Z",
    });

    expect(unwrapErr(outcome).code).toBe("EDITED_SINCE");
    expect(log.deletes).toEqual([]);
  });

  it("asks nothing about edits when no caller supplied an instant — `slack delete` picks the message itself", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: { ...OURS, editedTs: "1790056013.000000" } }),
    });

    expect(unwrap(outcome)).toEqual({ kind: "deleted", posted: TARGET });
    expect(log.deletes).toEqual([TARGET]);
  });
});
