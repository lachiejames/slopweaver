/**
 * `chooseOutlookCalendarGrant` — the one rule for which stored grant a calendar verb reads over: its own grant
 * wins, its own grant short of the calendar is refused rather than passed over, a mail grant is used only when
 * no calendar grant is stored AND it carries the calendar's read, and otherwise the calendar is not connected.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { chooseOutlookCalendarGrant } from "../../../../live/outlook/calendarGrantChoice.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import type { OutlookGrant } from "../../../../secrets/outlookGrant.js";

/** A synthetic grant carrying the given scopes. */
function grantOf({ account, scopes }: { account: string; scopes: readonly string[] }): OutlookGrant {
  return {
    account,
    grantedAtIso: "2026-10-17T00:00:00.000Z",
    homeAccountId: `${account}.uid`,
    msalCache: "{}",
    scopes,
  };
}

const CALENDAR = grantOf({ account: "calendar@example.test", scopes: ["User.Read", "Calendars.Read"] });
const MAIL_WITH_CALENDAR = grantOf({
  account: "mail@example.test",
  scopes: ["User.Read", "Mail.ReadWrite", "Calendars.Read"],
});
const MAIL_ONLY = grantOf({ account: "mail@example.test", scopes: ["User.Read", "Mail.ReadWrite"] });

describe("chooseOutlookCalendarGrant", () => {
  it("chooses the calendar's own grant even beside a mail grant that covers the calendar", () => {
    expect(unwrap(chooseOutlookCalendarGrant({ calendarGrant: CALENDAR, mailGrant: MAIL_WITH_CALENDAR }))).toEqual({
      grant: CALENDAR,
      source: "calendar",
    });
  });

  it("chooses the calendar's own grant when no mail grant is stored", () => {
    expect(unwrap(chooseOutlookCalendarGrant({ calendarGrant: CALENDAR, mailGrant: undefined })).source).toBe(
      "calendar",
    );
  });

  it("refuses its own grant short of the calendar's read instead of falling through to the mail grant", () => {
    const short = grantOf({ account: "calendar@example.test", scopes: ["User.Read"] });

    const refused = unwrapErr(chooseOutlookCalendarGrant({ calendarGrant: short, mailGrant: MAIL_WITH_CALENDAR }));

    expect(refused).toEqual(
      OutlookErrors.scopeMissing({ granted: ["User.Read"], missing: ["Calendars.Read"], product: "calendar" }),
    );
    expect(refused.message).toBe(
      "the stored Outlook Calendar grant is missing Calendars.Read — re-run `slopweaver outlook-calendar connect` and approve it",
    );
  });

  it("falls back to a mail grant carrying Calendars.Read only when no calendar grant is stored", () => {
    expect(unwrap(chooseOutlookCalendarGrant({ calendarGrant: undefined, mailGrant: MAIL_WITH_CALENDAR }))).toEqual({
      grant: MAIL_WITH_CALENDAR,
      source: "mail",
    });
  });

  it("accepts Calendars.ReadWrite on the mail grant as covering the calendar's read", () => {
    const readWrite = grantOf({ account: "mail@example.test", scopes: ["User.Read", "Calendars.ReadWrite"] });

    expect(unwrap(chooseOutlookCalendarGrant({ calendarGrant: undefined, mailGrant: readWrite })).source).toBe("mail");
  });

  it("calls a mail grant without the calendar's read not connected, naming the calendar's own connect", () => {
    const refused = unwrapErr(chooseOutlookCalendarGrant({ calendarGrant: undefined, mailGrant: MAIL_ONLY }));

    expect(refused).toEqual(OutlookErrors.notConnected({ product: "calendar" }));
    expect(refused.message).toBe(
      "no Outlook Calendar grant stored for this home — run `slopweaver outlook-calendar connect`",
    );
  });

  it("calls a home with neither grant not connected", () => {
    expect(unwrapErr(chooseOutlookCalendarGrant({ calendarGrant: undefined, mailGrant: undefined })).code).toBe(
      "NOT_CONNECTED",
    );
  });
});
