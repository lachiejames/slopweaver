/**
 * The passed-meeting invite rule's subject reading. Every subject is synthetic, in the shapes Google Calendar writes
 * on the owner's mailbox (`slopweaver gmail list --query "filename:invite.ics newer_than:60d" --limit 100`).
 */
import { describe, expect, it } from "vitest";

import { invitedMeetingOverAfterIso, passedMeetingInviteOverIso } from "../../../../live/gmail/triagePassedInvite.js";

describe("invitedMeetingOverAfterIso", () => {
  it("reads a one-day meeting's end as noon UTC the day after, whatever zone the subject names", () => {
    expect(
      invitedMeetingOverAfterIso({ subject: "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner)" }),
    ).toBe("2026-10-20T12:00:00.000Z");
    expect(
      invitedMeetingOverAfterIso({
        subject: "Invitation: Sync @ Fri 9 Oct 2026 10:30am - 11am (AEDT) (o@example.test)",
      }),
    ).toBe("2026-10-10T12:00:00.000Z");
  });

  it("reads every Google Calendar prefix on the same shape", () => {
    const prefixes = [
      "Invitation",
      "Updated invitation",
      "Updated invitation with note",
      "Accepted",
      "Tentatively accepted",
      "Declined",
      "Cancelled event",
      "Cancelled event with note",
    ];
    expect(
      prefixes.map((prefix) =>
        invitedMeetingOverAfterIso({ subject: `${prefix}: Retro @ Thu 17 Sept 2026 3:30pm - 4pm (AEST) (Owner)` }),
      ),
    ).toEqual(prefixes.map(() => "2026-09-18T12:00:00.000Z"));
  });

  it("takes the LAST day of a meeting that runs past midnight or over several days", () => {
    expect(
      invitedMeetingOverAfterIso({
        subject: "Invitation: Cutover @ Mon 19 Oct 2026 11pm - Tue 20 Oct 2026 1am (AEDT) (Owner)",
      }),
    ).toBe("2026-10-21T12:00:00.000Z");
    expect(
      invitedMeetingOverAfterIso({ subject: "Invitation: Offsite @ Mon 19 Oct 2026 - Wed 21 Oct 2026 (Owner)" }),
    ).toBe("2026-10-22T12:00:00.000Z");
    expect(invitedMeetingOverAfterIso({ subject: "Invitation: Leave @ Mon 19 Oct 2026 (Owner)" })).toBe(
      "2026-10-20T12:00:00.000Z",
    );
  });

  it("reads the date after the LAST ' @ ', so a title carrying one is not mistaken for the time", () => {
    expect(
      invitedMeetingOverAfterIso({
        subject: "Invitation: Drinks @ The Lab @ Thu 8 Oct 2026 5:30pm - 8pm (AEDT) (Owner)",
      }),
    ).toBe("2026-10-09T12:00:00.000Z");
  });

  it("never judges a recurring meeting, which has no last day", () => {
    expect(
      [
        "Invitation: Retro @ Weekly from 3:30pm to 4pm on Friday (AEST) (Owner)",
        "Updated invitation: Sync @ Monthly from 2:30pm to 3pm on the fourth Monday (AEDT) (Owner)",
        "Updated invitation: Planning @ Weekly from 5pm to 5:30pm on Thursday from Thu 2 Oct 2026 (AEST) (Owner)",
        "Invitation: Pairing @ Every 2 weeks from 3pm to 3:30pm on Thursday (AEST) (Owner)",
      ].map((subject) => invitedMeetingOverAfterIso({ subject })),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("never judges a subject that is not Google's invite shape whole", () => {
    expect(
      [
        "Re: Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner)",
        "Fwd: Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner)",
        "Invitation to join the ACME FIXTURE account",
        "Invitation: Pairing (Owner)",
        "Invitation: Pairing @ Tue 19 Oct 2026 3pm - 4pm (AEDT) (Owner)",
        "Invitation: Pairing @ Thu 31 Sept 2026 3pm - 4pm (AEST) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - Tue 20 Oct 2026 (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 - 4pm (AEDT) (Owner)",
        "Invitation: Pairing @ Tue 20 Oct 2026 3pm - Mon 19 Oct 2026 4pm (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 15:00 - 16:00 (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 October 2026 3pm - 4pm (AEDT) (Owner)",
        "invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm – 4pm (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) and more",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner) EXTRA)",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner) (more) (again)",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) ((Owner))",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) ()",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT",
        "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm",
        "Invitation: Leave @ Mon 19 Oct 2026",
        "Invitation: Pairing @ Mon 19 Oct 2026 4pm - 3pm (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 12pm - 11:30am (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 19 Oct 2026 4pm - Mon 19 Oct 2026 3pm (AEDT) (Owner)",
        "Invitation: Pairing @ Mon 1 Jan 0000 3pm - 4pm (AEDT) (Owner)",
      ].map((subject) => invitedMeetingOverAfterIso({ subject })),
    ).toEqual(Array.from({ length: 25 }, () => undefined));
  });

  it("reads 12pm as noon and 12am as midnight when ordering a span", () => {
    expect(
      [
        "Invitation: Lunch @ Mon 19 Oct 2026 11:30am - 12:30pm (AEDT) (Owner)",
        "Invitation: Late @ Mon 19 Oct 2026 12am - 1am (AEDT) (Owner)",
      ].map((subject) => invitedMeetingOverAfterIso({ subject })),
    ).toEqual(["2026-10-20T12:00:00.000Z", "2026-10-20T12:00:00.000Z"]);
  });
});

describe("passedMeetingInviteOverIso", () => {
  const subject = "Invitation: Pairing @ Mon 19 Oct 2026 3pm - 4pm (AEDT) (Owner)";
  const OVER = "2026-10-20T12:00:00.000Z";

  it("is passed from the instant the meeting's day has ended in the westernmost zone", () => {
    expect(
      [
        "2026-10-19T05:00:00.000Z",
        "2026-10-20T11:59:59.999Z",
        OVER,
        "2026-10-20T12:00:00.001Z",
        "2026-10-26T02:00:00.000Z",
      ].map((readAtIso) => passedMeetingInviteOverIso({ readAtIso, subject })),
    ).toEqual([undefined, undefined, OVER, OVER, OVER]);
  });

  it("rolls the last day of a year into the next one", () => {
    expect(
      passedMeetingInviteOverIso({
        readAtIso: "2027-01-02T00:00:00.000Z",
        subject: "Invitation: Wrap @ Thu 31 Dec 2026 3pm - 4pm (AEDT) (Owner)",
      }),
    ).toBe("2027-01-01T12:00:00.000Z");
  });

  it("is never passed for a missing subject, an unreadable instant, or a meeting still to come", () => {
    expect(passedMeetingInviteOverIso({ readAtIso: "2026-10-26T02:00:00.000Z", subject: undefined })).toBe(undefined);
    expect(passedMeetingInviteOverIso({ readAtIso: "not an instant", subject })).toBe(undefined);
    expect(
      passedMeetingInviteOverIso({
        readAtIso: "2026-10-26T02:00:00.000Z",
        subject: "Updated invitation with note: Town Hall @ Thu 5 Nov 2026 6pm - 7pm (AEDT) (Owner)",
      }),
    ).toBe(undefined);
  });
});
