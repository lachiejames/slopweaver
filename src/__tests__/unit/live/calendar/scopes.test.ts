/** Unit: the per-verb Calendar scope mapping, including the one implication rule Google's model has. */
import { describe, expect, it } from "vitest";
import { CALENDAR_SCOPE_TABLE, CALENDAR_SCOPES, VERB_CAPABILITIES } from "../../../../live/calendar/scopes.js";
import { missingScopes, satisfiesCapability, scopesToRequest } from "../../../../live/google/scopes.js";

describe("satisfiesCapability", () => {
  it("accepts the wider calendar.readonly for an events requirement", () => {
    expect(
      satisfiesCapability({ table: CALENDAR_SCOPE_TABLE, capability: "events", granted: [CALENDAR_SCOPES.calendars] }),
    ).toBe(true);
  });

  it("does NOT accept the narrower events scope for a calendar-list requirement", () => {
    expect(
      satisfiesCapability({ table: CALENDAR_SCOPE_TABLE, capability: "calendars", granted: [CALENDAR_SCOPES.events] }),
    ).toBe(false);
  });

  it("does not accept the calendar scopes for the settings requirement", () => {
    expect(
      satisfiesCapability({
        table: CALENDAR_SCOPE_TABLE,
        capability: "settings",
        granted: [CALENDAR_SCOPES.calendars],
      }),
    ).toBe(false);
  });

  it("lets calendar.readonly and Google's availability-only scope both answer free/busy, and events.readonly not", () => {
    expect(
      satisfiesCapability({
        table: CALENDAR_SCOPE_TABLE,
        capability: "freebusy",
        granted: [CALENDAR_SCOPES.calendars],
      }),
    ).toBe(true);
    expect(
      satisfiesCapability({
        table: CALENDAR_SCOPE_TABLE,
        capability: "freebusy",
        granted: ["https://www.googleapis.com/auth/calendar.events.freebusy"],
      }),
    ).toBe(true);
    expect(
      satisfiesCapability({ table: CALENDAR_SCOPE_TABLE, capability: "freebusy", granted: [CALENDAR_SCOPES.events] }),
    ).toBe(false);
  });

  it("never lets a read scope satisfy the write capability", () => {
    expect(
      satisfiesCapability({
        table: CALENDAR_SCOPE_TABLE,
        capability: "ownedEvents",
        granted: [CALENDAR_SCOPES.calendars, CALENDAR_SCOPES.events, CALENDAR_SCOPES.settings],
      }),
    ).toBe(false);
    expect(CALENDAR_SCOPES.ownedEvents).toBe("https://www.googleapis.com/auth/calendar.events.owned");
  });

  it("accepts a capability's own scope", () => {
    expect(
      satisfiesCapability({ table: CALENDAR_SCOPE_TABLE, capability: "events", granted: [CALENDAR_SCOPES.events] }),
    ).toBe(true);
  });
});

describe("missingScopes", () => {
  it("names the capability's own primary scope, not the one that would have implied it", () => {
    expect(
      missingScopes({
        table: CALENDAR_SCOPE_TABLE,
        capabilities: ["events", "calendars"],
        granted: [CALENDAR_SCOPES.events],
      }),
    ).toStrictEqual([CALENDAR_SCOPES.calendars]);
  });

  it("is empty when every capability is covered", () => {
    expect(
      missingScopes({ table: CALENDAR_SCOPE_TABLE, capabilities: ["events"], granted: [CALENDAR_SCOPES.calendars] }),
    ).toStrictEqual([]);
  });

  it("names every unsatisfied capability on an empty grant, in declaration order", () => {
    expect(
      missingScopes({ table: CALENDAR_SCOPE_TABLE, capabilities: ["calendars", "settings"], granted: [] }),
    ).toStrictEqual([CALENDAR_SCOPES.calendars, CALENDAR_SCOPES.settings]);
  });
});

describe("scopesToRequest", () => {
  it("always leads with identity, so connect can record which account it bound to", () => {
    expect(scopesToRequest({ table: CALENDAR_SCOPE_TABLE, capabilities: ["events"] })).toStrictEqual([
      CALENDAR_SCOPES.identity,
      CALENDAR_SCOPES.events,
    ]);
  });

  it("deduplicates a capability named twice", () => {
    expect(scopesToRequest({ table: CALENDAR_SCOPE_TABLE, capabilities: ["events", "events"] })).toStrictEqual([
      CALENDAR_SCOPES.identity,
      CALENDAR_SCOPES.events,
    ]);
  });
});

describe("VERB_CAPABILITIES", () => {
  it("asks the two event verbs for the NARROW events capability, never the whole calendar surface", () => {
    expect(VERB_CAPABILITIES["list"]).toStrictEqual(["events"]);
    expect(VERB_CAPABILITIES["read"]).toStrictEqual(["events"]);
  });

  it("asks the calendar-list verb for the wider capability, because nothing else can see it", () => {
    expect(VERB_CAPABILITIES["calendars"]).toStrictEqual(["calendars"]);
  });

  it("asks the availability verb for freebusy only, so the read grant answers it and the events grant refuses", () => {
    expect(VERB_CAPABILITIES["free"]).toStrictEqual(["freebusy"]);
  });

  it("declares exactly ONE write scope, calendar.events.owned, asked for by the write verbs and no other", () => {
    expect(
      Object.values(CALENDAR_SCOPES).filter((uri) => !uri.endsWith("readonly") && !uri.endsWith("email")),
    ).toStrictEqual([CALENDAR_SCOPES.freebusy, CALENDAR_SCOPES.ownedEvents]);
    expect(CALENDAR_SCOPES.freebusy).toBe("https://www.googleapis.com/auth/calendar.freebusy");
    expect(
      Object.entries(VERB_CAPABILITIES)
        .filter(([, capabilities]) => capabilities.includes("ownedEvents"))
        .map(([verb]) => verb)
        .toSorted(),
    ).toStrictEqual(["book", "cancel", "commit", "edit", "reschedule", "respond"]);
  });

  it("gives every read verb a capability set that cannot satisfy a write", () => {
    for (const verb of ["calendars", "list", "read", "free"]) {
      expect(VERB_CAPABILITIES[verb]!.includes("ownedEvents")).toBe(false);
    }
  });

  it("makes every write verb read the event back too, so a write never plans against nothing", () => {
    for (const verb of ["book", "edit", "reschedule", "cancel", "respond", "commit"]) {
      expect(VERB_CAPABILITIES[verb]).toStrictEqual(["events", "ownedEvents"]);
    }
  });
});
