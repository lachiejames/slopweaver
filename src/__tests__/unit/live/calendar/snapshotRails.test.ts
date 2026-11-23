/**
 * Unit: the two writes a calendar snapshot alone rules out — an event that declines invitations on the owner's
 * behalf, read from whichever event-type block it carries, and a recurring series master — and every snapshot
 * that rules nothing out, a booking's absent one included.
 */
import { describe, expect, it } from "vitest";
import { snapshotRefusal } from "../../../../live/calendar/snapshotRails.js";

describe("snapshotRefusal", () => {
  it("rules nothing out for a booking, which has no snapshot, nor for a plain event", () => {
    expect([snapshotRefusal({ event: undefined }), snapshotRefusal({ event: { id: "evt-1" } })]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("refuses an out-of-office block that declines, naming its mode", () => {
    const refusal = snapshotRefusal({
      event: { outOfOfficeProperties: { autoDeclineMode: "declineAllConflictingInvitations" } },
    })!;
    expect(refusal.code).toBe("INVALID_WRITE");
    expect(refusal.message).toContain("autoDeclineMode declineAllConflictingInvitations");
  });

  it("refuses a focus-time block that declines, naming its mode", () => {
    const refusal = snapshotRefusal({
      event: { focusTimeProperties: { autoDeclineMode: "declineOnlyNewConflictingInvitations" } },
    })!;
    expect(refusal.code).toBe("INVALID_WRITE");
    expect(refusal.message).toContain("autoDeclineMode declineOnlyNewConflictingInvitations");
  });

  it("rules nothing out for a block that declines nothing: declineNone, an empty mode, a null one or none", () => {
    expect([
      snapshotRefusal({ event: { outOfOfficeProperties: { autoDeclineMode: "declineNone" } } }),
      snapshotRefusal({ event: { outOfOfficeProperties: { autoDeclineMode: "" } } }),
      snapshotRefusal({ event: { focusTimeProperties: { autoDeclineMode: null } } }),
      snapshotRefusal({ event: { focusTimeProperties: {} } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("reads the out-of-office block through every branch: absent, no mode, a null one, declineNone, empty, declining", () => {
    expect([
      snapshotRefusal({ event: { eventType: "outOfOffice" } }),
      snapshotRefusal({ event: { outOfOfficeProperties: {} } }),
      snapshotRefusal({ event: { outOfOfficeProperties: { autoDeclineMode: null } } }),
      snapshotRefusal({ event: { outOfOfficeProperties: { autoDeclineMode: "declineNone" } } }),
      snapshotRefusal({ event: { outOfOfficeProperties: { autoDeclineMode: "" } } }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const declining = snapshotRefusal({
      event: { outOfOfficeProperties: { autoDeclineMode: "declineOnlyNewConflictingInvitations" } },
    })!;
    expect(declining.message).toContain("autoDeclineMode declineOnlyNewConflictingInvitations");
  });

  it("reads the focus-time block through every branch: absent, no mode, a null one, declineNone, empty, declining", () => {
    expect([
      snapshotRefusal({ event: { eventType: "focusTime" } }),
      snapshotRefusal({ event: { focusTimeProperties: {} } }),
      snapshotRefusal({ event: { focusTimeProperties: { autoDeclineMode: null } } }),
      snapshotRefusal({ event: { focusTimeProperties: { autoDeclineMode: "declineNone" } } }),
      snapshotRefusal({ event: { focusTimeProperties: { autoDeclineMode: "" } } }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const declining = snapshotRefusal({
      event: { focusTimeProperties: { autoDeclineMode: "declineAllConflictingInvitations" } },
    })!;
    expect(declining.message).toContain("autoDeclineMode declineAllConflictingInvitations");
  });

  it("reads each block on its own, so an out-of-office block declining nothing never hides a focus-time mode", () => {
    // Google sends one block per event type, never both; a snapshot that did is read fail-closed.
    const refusal = snapshotRefusal({
      event: {
        focusTimeProperties: { autoDeclineMode: "declineAllConflictingInvitations" },
        outOfOfficeProperties: { autoDeclineMode: "declineNone" },
      },
    })!;
    expect(refusal.message).toContain("autoDeclineMode declineAllConflictingInvitations");
  });

  it("refuses a recurring series master, and lets one occurrence and a stub's null rule through", () => {
    const refusal = snapshotRefusal({ event: { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"] } })!;
    expect(refusal.code).toBe("INVALID_WRITE");
    expect(refusal.message).toContain("recurring SERIES");
    expect([
      snapshotRefusal({ event: { recurringEventId: "master-1" } }),
      snapshotRefusal({ event: { recurrence: null } }),
      snapshotRefusal({ event: { recurrence: [] } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
