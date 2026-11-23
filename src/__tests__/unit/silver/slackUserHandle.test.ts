import { describe, expect, it } from "vitest";
import type { DerivedPerson, DerivedRoster } from "../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import { slackUserDisplayHandle } from "../../../silver/slackUserHandle.js";

const roster = ({ people }: { people: readonly DerivedPerson[] }): DerivedRoster => ({
  heldPersonIds: new Set(),
  people,
});

const person = ({
  id,
  nativeId,
  handle,
  name,
}: {
  id: string;
  nativeId: string;
  handle?: string;
  name?: string;
}): DerivedPerson => ({
  confidence: "email",
  id,
  identities: [
    {
      nativeId,
      source: "slack",
      ...(handle !== undefined ? { handle } : {}),
      ...(name !== undefined ? { name } : {}),
    },
  ],
});

describe("slackUserDisplayHandle", () => {
  it("resolves a Slack user id the derived roster knows", () => {
    const derived = roster({ people: [person({ handle: "wren", id: "person:wren", nativeId: "UWREN" })] });

    expect(slackUserDisplayHandle({ derived, overrides: [], userId: "UWREN" })).toBe("@wren");
  });

  it("lets the human override roster win over the derived roster", () => {
    const derived = roster({ people: [person({ handle: "derived-wren", id: "person:wren", nativeId: "UWREN" })] });
    const overrides: readonly IdentityRecord[] = [
      {
        handle: "pinned-wren",
        id: "person:wren",
        identities: [{ nativeId: "UWREN", source: "slack" }],
        name: "Wren",
      },
    ];

    expect(slackUserDisplayHandle({ derived, overrides, userId: "UWREN" })).toBe("@pinned-wren");
  });

  it("returns an unknown id unchanged rather than inventing a name", () => {
    const derived = roster({ people: [person({ handle: "wren", id: "person:wren", nativeId: "UWREN" })] });

    expect(slackUserDisplayHandle({ derived, overrides: [], userId: "UNOBODY" })).toBe("UNOBODY");
  });

  it("refuses an id two people claim, handing back the raw id", () => {
    const derived = roster({
      people: [
        person({ handle: "one", id: "person:one", nativeId: "USHARED" }),
        person({ handle: "two", id: "person:two", nativeId: "USHARED" }),
      ],
    });

    expect(slackUserDisplayHandle({ derived, overrides: [], userId: "USHARED" })).toBe("USHARED");
  });

  it("passes over a roster entry that pins no source id, so the derived roster still answers", () => {
    const derived = roster({ people: [person({ handle: "derived-wren", id: "person:wren", nativeId: "UWREN" })] });
    const overrides: readonly IdentityRecord[] = [{ handle: "display-only", id: "UWREN", name: "Wren" }];

    expect(slackUserDisplayHandle({ derived, overrides, userId: "UWREN" })).toBe("@derived-wren");
  });

  it("refuses when the HUMAN roster itself claims one id twice", () => {
    const overrides: readonly IdentityRecord[] = [
      { handle: "one", id: "person:one", identities: [{ nativeId: "USHARED", source: "slack" }], name: "One" },
      { handle: "two", id: "person:two", identities: [{ nativeId: "USHARED", source: "slack" }], name: "Two" },
    ];

    expect(slackUserDisplayHandle({ derived: roster({ people: [] }), overrides, userId: "USHARED" })).toBe("USHARED");
  });

  it("falls back to the identity's name when it carries no handle", () => {
    const derived = roster({ people: [person({ id: "person:wren", name: "Wren H", nativeId: "UWREN" })] });

    expect(slackUserDisplayHandle({ derived, overrides: [], userId: "UWREN" })).toBe("@Wren H");
  });

  it("ignores a non-Slack identity carrying the same native id", () => {
    const derived: DerivedRoster = {
      heldPersonIds: new Set(),
      people: [{ confidence: "email", id: "person:wren", identities: [{ nativeId: "UWREN", source: "github" }] }],
    };

    expect(slackUserDisplayHandle({ derived, overrides: [], userId: "UWREN" })).toBe("UWREN");
  });

  it("strips a leading @ before matching", () => {
    const derived = roster({ people: [person({ handle: "wren", id: "person:wren", nativeId: "UWREN" })] });

    expect(slackUserDisplayHandle({ derived, overrides: [], userId: "@UWREN" })).toBe("@wren");
  });

  it("resolves an id the OLD roster-id-keyed lookup could never match", () => {
    // `resolveHandle` keyed its map on each record's own `id` (`person:wren`), so a Slack user id fell
    // through unchanged every time. The same input now resolves — this is the regression that was invisible.
    const overrides: readonly IdentityRecord[] = [
      { handle: "wren", id: "person:wren", identities: [{ nativeId: "UWREN", source: "slack" }], name: "Wren" },
    ];

    expect(slackUserDisplayHandle({ derived: roster({ people: [] }), overrides, userId: "UWREN" })).toBe("@wren");
  });
});
