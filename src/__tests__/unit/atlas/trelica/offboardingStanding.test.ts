/**
 * Who counts as a leaver, off each person's own current record: every standing, and which make a current leaver.
 */
import { describe, expect, it } from "vitest";

import {
  isCurrentTrelicaLeaver,
  type TrelicaLeaverStanding,
  trelicaLeaverStanding,
} from "../../../../atlas/trelica/offboardingStanding.js";

import { person } from "./offboardingFixtures.js";

const AS_OF = "2026-10-15T00:00:00.000Z";

describe("trelicaLeaverStanding", () => {
  const cases: readonly { label: string; subject: Parameters<typeof person>[0] | null; want: TrelicaLeaverStanding }[] =
    [
      { label: "a Terminated person with no date", subject: { id: "p", name: "A" }, want: "terminated" },
      {
        label: "an active leaver whose removal is due, the removal read before the leaving date",
        subject: {
          id: "p",
          leaver: true,
          leavingDate: "2026-12-01T00:00:00",
          name: "A",
          removedDate: "2026-10-15T09:00:00",
          status: "Active",
        },
        want: "leaving-date-due",
      },
      {
        label: "an active leaver whose leaving date is later",
        subject: { id: "p", leaver: true, leavingDate: "2026-10-16T00:00:00", name: "A", status: "Active" },
        want: "leaving-date-not-due",
      },
      {
        label: "an active leaver with no date",
        subject: { id: "p", leaver: true, name: "A", status: "Active" },
        want: "leaver-without-date",
      },
      {
        label: "an active person not flagged",
        subject: { id: "p", name: "A", status: "Active" },
        want: "not-a-leaver",
      },
      { label: "a person the held people do not include", subject: null, want: "no-current-record" },
    ];

  it.each(cases)("reads $label as $want", ({ subject, want }) => {
    const held = subject === null ? undefined : person(subject);

    expect(trelicaLeaverStanding({ asOf: AS_OF, person: held })).toBe(want);
  });

  it("makes only Terminated and a due leaving date a current leaver", () => {
    const standings: readonly TrelicaLeaverStanding[] = cases.map((c) => c.want);

    expect(standings.length).toBeGreaterThan(0);
    expect(standings.filter((standing) => isCurrentTrelicaLeaver({ standing }))).toEqual([
      "terminated",
      "leaving-date-due",
    ]);
  });
});
