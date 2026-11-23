import { describe, expect, it } from "vitest";

import { numberOf, textOf, trelicaContactsOf } from "../../../../atlas/trelica/fields.js";

describe("textOf", () => {
  it("trims a present string", () => {
    expect(textOf({ key: "name", record: { name: "  Slack  " } })).toBe("Slack");
  });

  it("reads a blank string as absent, so it never reaches a min(1) schema", () => {
    expect(textOf({ key: "name", record: { name: "   " } })).toBe(null);
  });

  it("reads a non-string as absent", () => {
    expect(textOf({ key: "name", record: { name: 7 } })).toBe(null);
  });
});

describe("numberOf", () => {
  it("keeps a finite number, zero included", () => {
    expect(numberOf({ key: "userCount", record: { userCount: 0 } })).toBe(0);
  });

  it("reads a non-finite number as absent", () => {
    expect(numberOf({ key: "userCount", record: { userCount: Number.NaN } })).toBe(null);
  });
});

describe("trelicaContactsOf", () => {
  it("reads the person nested under contact, with its role, owner flag and termination", () => {
    const contacts = trelicaContactsOf({
      record: {
        internalContacts: [
          {
            contact: { email: "b@example.test", name: "Bea" },
            isOwner: false,
            roleId: "itAdmin",
            terminated: true,
          },
          { contact: { name: "Al" }, isOwner: true, roleId: "businessOwner", terminated: false },
        ],
      },
    });
    expect(contacts).toEqual([
      { email: null, isOwner: true, name: "Al", role: "businessOwner", terminated: false },
      { email: "b@example.test", isOwner: false, name: "Bea", role: "itAdmin", terminated: true },
    ]);
  });

  it("drops an entry whose name sits on the entry rather than a nested person", () => {
    expect(trelicaContactsOf({ record: { internalContacts: [{ isOwner: true, name: "Flat" }] } })).toEqual([]);
  });

  it("answers no contacts when the field is not a list", () => {
    expect(trelicaContactsOf({ record: { internalContacts: null } })).toEqual([]);
  });
});
