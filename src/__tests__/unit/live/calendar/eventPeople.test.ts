/**
 * Unit: who is on a calendar event — the owner's own entry, everyone else by address, and the entries nobody
 * can name — read from a Google snapshot, including one Google sent with no `attendees` or `organizer` at all.
 */
import { describe, expect, it } from "vitest";
import {
  addressOf,
  guestsOn,
  isOwnerEntry,
  organiserOn,
  othersOn,
  unnamedOn,
} from "../../../../live/calendar/eventPeople.js";

const ME = "me@x.test";

describe("addressOf", () => {
  it("lowercases an address", () => {
    expect(addressOf({ attendee: { email: "Bob@X.Test" } })).toBe("bob@x.test");
  });

  it("reads an entry with no address, a null one or an empty one as absent", () => {
    expect([
      addressOf({ attendee: {} }),
      addressOf({ attendee: { email: null } }),
      addressOf({ attendee: { email: "" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("isOwnerEntry", () => {
  it("trusts Google's self flag over an alias address", () => {
    expect(isOwnerEntry({ account: ME, entry: { email: "alias@x.test", self: true } })).toBe(true);
  });

  it("matches the bound address case-insensitively, and nobody else", () => {
    expect([
      isOwnerEntry({ account: ME, entry: { email: "ME@x.test" } }),
      isOwnerEntry({ account: ME, entry: { email: "bob@x.test", self: false } }),
    ]).toEqual([true, false]);
  });
});

describe("guestsOn", () => {
  it("is empty for a booking, which has no event yet", () => {
    expect(guestsOn({ event: undefined })).toEqual([]);
  });

  it("is empty for an event Google sent without attendees", () => {
    expect(guestsOn({ event: { id: "evt-1" } })).toEqual([]);
  });

  it("is the event's own attendee list when it carries one", () => {
    const attendees = [{ email: "bob@x.test" }];
    expect(guestsOn({ event: { attendees } })).toBe(attendees);
  });
});

describe("organiserOn", () => {
  it("is empty for a booking, which has no event yet, and for an event Google sent without an organiser", () => {
    expect([organiserOn({ event: undefined }), organiserOn({ event: { id: "evt-1" } })]).toEqual([[], []]);
  });

  it("is the one organiser entry, kept whether or not it carries an address", () => {
    expect(organiserOn({ event: { organizer: { email: "bob@x.test" } } })).toEqual([{ email: "bob@x.test" }]);
    expect(organiserOn({ event: { organizer: { self: true } } })).toEqual([{ self: true }]);
  });
});

describe("othersOn", () => {
  it("names everyone but the owner, lowercased and sorted, dropping an entry with no address", () => {
    const event = {
      attendees: [
        { email: "Zed@x.test" },
        { email: ME, self: true },
        { displayName: "Nameless" },
        { email: "amy@x.test" },
      ],
    };
    expect(othersOn({ account: ME, event })).toEqual(["amy@x.test", "zed@x.test"]);
  });

  it("names nobody on an event with no attendees", () => {
    expect(othersOn({ account: ME, event: { id: "evt-1" } })).toEqual([]);
  });
});

describe("unnamedOn", () => {
  it("counts an unnamed attendee and an unnamed foreign organiser", () => {
    const event = {
      attendees: [{ displayName: "Nameless" }, { email: "bob@x.test" }],
      organizer: { displayName: "Org" },
    };
    expect(unnamedOn({ account: ME, event })).toBe(2);
  });

  it("counts nothing on a cancelled stub carrying only its id, or with a null organiser", () => {
    expect([
      unnamedOn({ account: ME, event: { id: "evt-1" } }),
      unnamedOn({ account: ME, event: { id: "evt-1", organizer: null } }),
      unnamedOn({ account: ME, event: undefined }),
    ]).toEqual([0, 0, 0]);
  });

  it("does not count the owner's own entry, which Google marks self without an address", () => {
    const event = { attendees: [{ self: true }], organizer: { self: true } };
    expect(unnamedOn({ account: ME, event })).toBe(0);
  });
});
