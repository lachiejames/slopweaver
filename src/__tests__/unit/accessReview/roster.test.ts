import { describe, expect, it } from "vitest";

import { ROSTER_SPINE } from "../../../accessReview/levels.js";
import { endDateMsOf, FORMER_STATUS, formerStaffOf, hasDeparted, rosterOf } from "../../../accessReview/roster.js";

import { entity, personDetail } from "./fixtures.js";

/** One spine entity for one employment spell. */
function spell({
  email,
  status,
  endDate,
  display = "A Person",
  id,
}: {
  email: string;
  status: string;
  endDate: string | null;
  display?: string;
  id: string;
}): ReturnType<typeof entity> {
  return entity({ detail: personDetail({ display, email, endDate, status }), providerId: id });
}

describe("rosterOf — one address can carry several employment spells", () => {
  it("treats an address whose only spell is FORMER as departed", () => {
    const roster = rosterOf({
      entities: [spell({ email: "gone@x.test", endDate: "2026-01-01T00:00:00.000Z", id: "a", status: FORMER_STATUS })],
      spec: ROSTER_SPINE,
    });
    expect(roster.people.length).toBe(1);
    expect(hasDeparted({ person: roster.people[0]! })).toBe(true);
    expect(roster.rehired).toEqual([]);
  });

  it("treats an address with a FORMER spell AND a CURRENT spell as a rehire, not a departure", () => {
    const roster = rosterOf({
      entities: [
        spell({ email: "back@x.test", endDate: "2026-04-28T02:31:46.733Z", id: "a", status: FORMER_STATUS }),
        spell({ email: "back@x.test", endDate: null, id: "b", status: "CURRENT" }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(roster.people.length).toBe(1);
    expect(hasDeparted({ person: roster.people[0]! })).toBe(false);
    expect(roster.rehired).toEqual(["back@x.test"]);
    expect(formerStaffOf({ roster })).toEqual([]);
  });

  it("reaches the same verdict whichever order the two spells are read in", () => {
    const forwards = rosterOf({
      entities: [
        spell({ email: "back@x.test", endDate: "2026-04-28T00:00:00.000Z", id: "a", status: FORMER_STATUS }),
        spell({ email: "back@x.test", endDate: null, id: "b", status: "CURRENT" }),
      ],
      spec: ROSTER_SPINE,
    });
    const backwards = rosterOf({
      entities: [
        spell({ email: "back@x.test", endDate: null, id: "b", status: "CURRENT" }),
        spell({ email: "back@x.test", endDate: "2026-04-28T00:00:00.000Z", id: "a", status: FORMER_STATUS }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(forwards.people[0]!.stillEmployed).toBe(true);
    expect(backwards.people[0]!.stillEmployed).toBe(true);
    expect(backwards.people[0]!.endDateIso).toBe("2026-04-28T00:00:00.000Z");
  });

  it("carries the LATEST end date across several FORMER spells", () => {
    const roster = rosterOf({
      entities: [
        spell({ email: "twice@x.test", endDate: "2025-06-01T00:00:00.000Z", id: "a", status: FORMER_STATUS }),
        spell({ email: "twice@x.test", endDate: "2026-06-01T00:00:00.000Z", id: "b", status: FORMER_STATUS }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(roster.people[0]!.endDateIso).toBe("2026-06-01T00:00:00.000Z");
    expect(roster.people[0]!.spells).toBe(2);
  });

  it("never lets a dated FORMER spell mask an undated one, in either order", () => {
    for (const order of [
      ["2026-01-01T00:00:00.000Z", null],
      [null, "2026-01-01T00:00:00.000Z"],
    ] as const) {
      const roster = rosterOf({
        entities: order.map((endDate, index) =>
          spell({ email: "twice@x.test", endDate, id: String(index), status: FORMER_STATUS }),
        ),
        spec: ROSTER_SPINE,
      });
      expect(roster.people[0]!.endDateIso).toBe(null);
      expect(roster.formerWithoutEndDate).toEqual(["twice@x.test"]);
    }
  });

  it("keeps an unparseable FORMER end date rather than judging by an earlier spell", () => {
    const roster = rosterOf({
      entities: [
        spell({ email: "twice@x.test", endDate: "2026-01-01T00:00:00.000Z", id: "a", status: FORMER_STATUS }),
        spell({ email: "twice@x.test", endDate: "last tuesday", id: "b", status: FORMER_STATUS }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(roster.people[0]!.endDateIso).toBe("last tuesday");
  });

  it("names a departed person carrying no end date rather than bucketing them", () => {
    const roster = rosterOf({
      entities: [spell({ email: "nodate@x.test", endDate: null, id: "a", status: FORMER_STATUS })],
      spec: ROSTER_SPINE,
    });
    expect(roster.formerWithoutEndDate).toEqual(["nodate@x.test"]);
    expect(formerStaffOf({ roster })).toEqual([]);
  });

  it("counts a status that is neither CURRENT nor FORMER as its own residue", () => {
    const roster = rosterOf({
      entities: [
        spell({ email: "away@x.test", endDate: null, id: "a", status: "ON_LEAVE" }),
        spell({ email: "off@x.test", endDate: null, id: "b", status: "INACTIVE" }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(roster.nonDepartureStatuses).toEqual([
      { addresses: 1, status: "INACTIVE" },
      { addresses: 1, status: "ON_LEAVE" },
    ]);
    expect(formerStaffOf({ roster })).toEqual([]);
  });

  it("counts a record with no readable address rather than dropping it silently", () => {
    const roster = rosterOf({
      entities: [entity({ detail: { employment: { status: FORMER_STATUS } }, providerId: "a" })],
      spec: ROSTER_SPINE,
    });
    expect(roster.addressless).toBe(1);
    expect(roster.people).toEqual([]);
  });

  it("counts a blank address as unreadable", () => {
    const roster = rosterOf({
      entities: [spell({ email: "   ", endDate: null, id: "a", status: "CURRENT" })],
      spec: ROSTER_SPINE,
    });
    expect(roster.addressless).toBe(1);
  });

  it("lowercases the join key while keeping the display name", () => {
    const roster = rosterOf({
      entities: [spell({ display: "Loud Person", email: "LOUD@X.test", endDate: null, id: "a", status: "CURRENT" })],
      spec: ROSTER_SPINE,
    });
    expect(roster.people[0]!.email).toBe("loud@x.test");
    expect(roster.people[0]!.display).toBe("Loud Person");
  });

  it("answers an empty roster for no entities", () => {
    const roster = rosterOf({ entities: [], spec: ROSTER_SPINE });
    expect(roster.people).toEqual([]);
    expect(roster.addressless).toBe(0);
    expect(formerStaffOf({ roster })).toEqual([]);
  });
});

describe("formerStaffOf and endDateMsOf", () => {
  it("orders departures oldest first", () => {
    const roster = rosterOf({
      entities: [
        spell({ email: "newer@x.test", endDate: "2026-06-01T00:00:00.000Z", id: "a", status: FORMER_STATUS }),
        spell({ email: "older@x.test", endDate: "2025-06-01T00:00:00.000Z", id: "b", status: FORMER_STATUS }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(formerStaffOf({ roster }).map((person) => person.email)).toEqual(["older@x.test", "newer@x.test"]);
  });

  it("answers null for an end date that does not parse, and still keeps the person, after every dated one", () => {
    const roster = rosterOf({
      entities: [
        spell({ email: "bad@x.test", endDate: "2026-09-11", id: "a", status: FORMER_STATUS }),
        spell({ email: "worse@x.test", endDate: "not-a-date", id: "b", status: FORMER_STATUS }),
        spell({ email: "zed@x.test", endDate: "2026-01-01T00:00:00.000Z", id: "c", status: FORMER_STATUS }),
      ],
      spec: ROSTER_SPINE,
    });
    expect(endDateMsOf({ person: roster.people[0]! })).toBe(null);
    expect(formerStaffOf({ roster }).map((person) => person.email)).toEqual([
      "zed@x.test",
      "bad@x.test",
      "worse@x.test",
    ]);
    expect(roster.formerWithoutEndDate).toEqual([]);
  });

  it("puts an unparseable end date after a dated one whichever is read first", () => {
    for (const order of [
      ["2026-09-11", "2026-01-01T00:00:00.000Z"],
      ["2026-01-01T00:00:00.000Z", "2026-09-11"],
    ] as const) {
      const roster = rosterOf({
        entities: order.map((endDate, index) =>
          spell({ email: `${endDate}@x.test`, endDate, id: String(index), status: FORMER_STATUS }),
        ),
        spec: ROSTER_SPINE,
      });
      expect(formerStaffOf({ roster }).map((person) => person.endDateIso)).toEqual([
        "2026-01-01T00:00:00.000Z",
        "2026-09-11",
      ]);
    }
  });

  it("answers the instant for a usable end date", () => {
    const roster = rosterOf({
      entities: [spell({ email: "ok@x.test", endDate: "2026-01-01T00:00:00.000Z", id: "a", status: FORMER_STATUS })],
      spec: ROSTER_SPINE,
    });
    expect(endDateMsOf({ person: roster.people[0]! })).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});

describe("FORMER_STATUS", () => {
  it("is the status Vanta writes, which is what every departure check compares to", () => {
    expect(FORMER_STATUS).toBe("FORMER");
  });
});
