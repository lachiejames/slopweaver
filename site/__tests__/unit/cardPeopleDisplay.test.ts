/**
 * How a card names people (`site/lib/cardPeopleDisplay.ts`): chips only in the properties, a first name
 * everywhere else, the whole name where two colleagues share one, and "you" for the owner, never a chip or a name.
 */
import { describe, expect, it } from "vitest";

import { inlinePersonName, personWords, propertyPeople } from "../../lib/cardPeopleDisplay";
import { type CardPeople, cardPeople } from "../../lib/personMentions";
import type { SlackPeople } from "../../lib/slackPeople";

/** Two Kyles, a Quinn nobody shares a first name with, the owner, and a member with no name on record. */
const ROSTER: SlackPeople = new Map([
  ["U0KYLEA", { firstNameUnique: false, handle: "kylea", name: "Kyle Arnold", nameUnique: true }],
  ["U0KYLEB", { firstNameUnique: false, handle: "kyleb", name: "Kyle Bacon", nameUnique: true }],
  ["U0QUINN", { firstNameUnique: true, handle: "quinn", name: "Quinn Riley", nameUnique: true }],
  ["U0SYNADAOWN", { firstNameUnique: true, handle: "ada", name: "Ada Owner", nameUnique: true }],
  ["U0NONAME", { firstNameUnique: false, handle: "noname", name: undefined }],
]);

/** The roster as a card holds it, with Ada as the owner. */
const PEOPLE: CardPeople = cardPeople({ board: [], owner: "U0SYNADAOWN", roster: ROSTER });

describe("inlinePersonName", () => {
  it("names a colleague nobody shares a first name with by that first name", () => {
    expect(inlinePersonName({ fallback: "U0QUINN", person: PEOPLE.get("U0QUINN") })).toBe("Quinn");
  });

  it("names each of two colleagues who share a first name by their whole name", () => {
    expect(["U0KYLEA", "U0KYLEB"].map((id) => inlinePersonName({ fallback: id, person: PEOPLE.get(id) }))).toEqual([
      "Kyle Arnold",
      "Kyle Bacon",
    ]);
  });

  it("calls the owner you, never their name", () => {
    expect(inlinePersonName({ fallback: "U0SYNADAOWN", person: PEOPLE.get("U0SYNADAOWN") })).toBe("you");
  });

  it("keeps what the sentence said for someone the roster does not hold, or holds with no name", () => {
    expect(inlinePersonName({ fallback: "@stranger", person: undefined })).toBe("@stranger");
    expect(inlinePersonName({ fallback: "U0NONAME", person: PEOPLE.get("U0NONAME") })).toBe("U0NONAME");
  });
});

describe("personWords", () => {
  /** A sentence's words around one person, as `inlineSegments` splits it. */
  const around = ({ before, id, label, after }: { before: string; id: string; label: string; after: string }) =>
    personWords({
      people: PEOPLE,
      segments: [
        { kind: "text", text: before },
        { id, kind: "person", label },
        { kind: "text", text: after },
      ],
    });

  it("draws a colleague as their first name and joins the sentence back into one piece", () => {
    expect(around({ after: " asked for it.", before: "Yesterday ", id: "U0QUINN", label: "Quinn Riley" })).toEqual([
      { kind: "text", text: "Yesterday Quinn asked for it." },
    ]);
  });

  it("draws the owner as you, agreeing the verb after it", () => {
    expect(around({ after: " is the reviewer.", before: "Here ", id: "U0SYNADAOWN", label: "Ada" })).toEqual([
      { kind: "text", text: "Here you are the reviewer." },
    ]);
  });

  it("draws the owner's possessive as your, capitalised where it opens a sentence", () => {
    expect(
      around({ after: "'s pull request merged.", before: "It landed. ", id: "U0SYNADAOWN", label: "Ada" }),
    ).toEqual([{ kind: "text", text: "It landed. Your pull request merged." }]);
  });

  it("leaves a word that only starts like a verb alone", () => {
    expect(around({ after: " isolated it.", before: "", id: "U0SYNADAOWN", label: "Ada" })).toEqual([
      { kind: "text", text: "You isolated it." },
    ]);
  });

  it("keeps a citation between two names as its own piece", () => {
    const link = { kind: "cite", label: "ABC-1", url: "https://linear.app/acme/issue/ABC-1" } as const;
    expect(
      personWords({
        people: PEOPLE,
        segments: [{ id: "U0KYLEA", kind: "person", label: "Kyle" }, { kind: "text", text: " opened " }, link],
      }),
    ).toEqual([{ kind: "text", text: "Kyle Arnold opened " }, link]);
  });
});

describe("propertyPeople", () => {
  it("lists each person once in the order given, leaves the owner out, and returns the ids nobody names", () => {
    const listed = propertyPeople({
      ids: ["U0QUINN", "U0SYNADAOWN", "U0KYLEA", "U0QUINN", "U0GONE"],
      people: PEOPLE,
    });
    expect(listed.people.map((person) => person.id)).toEqual(["U0QUINN", "U0KYLEA"]);
    expect(listed.unresolved).toEqual(["U0GONE"]);
  });

  it("lists nobody for no ids", () => {
    expect(propertyPeople({ ids: [], people: PEOPLE })).toEqual({ people: [], unresolved: [] });
  });
});
