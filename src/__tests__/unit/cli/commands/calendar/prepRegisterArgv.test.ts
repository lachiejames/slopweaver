/** `prepRegisterArgv`: the row a meeting owed a brief becomes, and whose work its calendar's account says it is. */
import { describe, expect, it } from "vitest";

import { prepRegisterArgv } from "../../../../../cli/commands/calendar/prepRegisterArgv.js";
import { parseCalendarEvent } from "../../../../../live/calendar/parse.js";
import { type PrepDueMeeting, prepAsk } from "../../../../../live/calendar/prepDue.js";
import type { Organisation } from "../../../../../organisation/core.js";
import { ACME_ORGANISATION, GLOBEX_ORGANISATION } from "../../../../organisationFixture.js";

const event = parseCalendarEvent({
  calendarId: "primary",
  event: { id: "evt1", start: { dateTime: "2026-10-12T09:00:00+11:00" }, summary: "Pipeline sync" },
})!;

const meeting: PrepDueMeeting = {
  event,
  externalDomains: [],
  others: [
    {
      displayName: undefined,
      email: "someone@acme.com",
      optional: false,
      resource: false,
      responseStatus: "accepted",
      self: false,
    },
  ],
  reason: "one-on-one",
  startIso: "2026-10-11T22:00:00.000Z",
  startWall: "2026-10-12 09:00",
};

const argvFor = ({
  account,
  organisation = ACME_ORGANISATION,
}: {
  account: string;
  organisation?: Organisation;
}): readonly string[] =>
  prepRegisterArgv({ account, askedIso: "2026-10-11T20:00:00.000Z", home: "/h", meeting, organisation, repo: "/r" });

describe("prepRegisterArgv", () => {
  it("states team for a calendar on the organisation's domain, naming the account", () => {
    expect(argvFor({ account: "Owner@acme.com" })).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      prepAsk({ meeting }),
      "--dispatch",
      "--slug",
      "meeting-brief-evt1",
      "--asked-iso",
      "2026-10-11T20:00:00.000Z",
      "--workspace",
      "team",
      "--workspace-because",
      "the meeting this brief is for is in owner@acme.com, an account on acme.com",
      "--repo",
      "/r",
      "--home",
      "/h",
    ]);
  });

  it("states no workspace for a calendar on any other account", () => {
    const argv = argvFor({ account: "someone@gmail.com" });
    expect(argv.includes("--workspace")).toBe(false);
    expect(argv.slice(-4)).toEqual(["--repo", "/r", "--home", "/h"]);
  });

  it("states no workspace for an organisation written with no Google domain, even on the account Acme would place", () => {
    expect(argvFor({ account: "owner@acme.com", organisation: GLOBEX_ORGANISATION }).includes("--workspace")).toBe(
      false,
    );
  });
});
