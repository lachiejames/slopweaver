/**
 * The candidate search — the half of a mention refusal that makes it actionable.
 *
 * It matches on display NAME, which every other rule in `personIndex.ts` forbids as a key, and that is safe
 * for exactly one reason: nothing resolves through it. These tests pin both halves — that it finds the
 * person a human meant, and that it is EXACT after normalising rather than a substring sweep that would
 * answer `to` with everyone whose name contains those two letters.
 */
import { describe, expect, it } from "vitest";

import { linearPersonCandidates } from "../../../../outbound/linear/personIndex.js";
import type { DerivedPerson, DerivedRoster } from "../../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../../silver/identity.js";

const ID_ADA = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ID_GRACE = "9c858901-8a57-4791-81fe-4c455b099bc9";

function roster({ people }: { people: readonly DerivedPerson[] }): DerivedRoster {
  return { heldPersonIds: new Set(), people };
}

const ADA: DerivedPerson = {
  confidence: "email",
  id: "p-ada",
  identities: [
    {
      email: "ada.lovelace@example.test",
      handle: "ada.lovelace",
      name: "Ada Lovelace",
      nativeId: ID_ADA,
      source: "linear",
    },
  ],
  kind: "person",
};

const SLACK_ONLY: DerivedPerson = {
  confidence: "single-source",
  id: "p-linus",
  identities: [{ handle: "linus", name: "Linus", nativeId: "U-linus", source: "slack" }],
  kind: "person",
};

describe("linearPersonCandidates", () => {
  it("finds a person by their display name, which is never an addressable key", () => {
    const found = linearPersonCandidates({ derived: roster({ people: [ADA] }), key: "Ada Lovelace", overrides: [] });

    expect(found).toEqual([
      {
        email: "ada.lovelace@example.test",
        handle: "ada.lovelace",
        linearId: ID_ADA,
        name: "Ada Lovelace",
        personId: "p-ada",
      },
    ]);
  });

  it("finds a person by the LOCAL PART of their email, which is how a human usually types a name", () => {
    const found = linearPersonCandidates({ derived: roster({ people: [ADA] }), key: "ada.lovelace", overrides: [] });

    expect(found.map((candidate) => candidate.personId)).toEqual(["p-ada"]);
  });

  it("finds someone whose only account is outside Linear, and reports no Linear id for them", () => {
    const found = linearPersonCandidates({ derived: roster({ people: [SLACK_ONLY] }), key: "Linus", overrides: [] });

    expect(found[0]!.linearId).toBe(undefined);
    expect(found[0]!.personId).toBe("p-linus");
  });

  it("does NOT match a prefix — a refusal listing everyone whose name starts with `ad` helps nobody", () => {
    expect(linearPersonCandidates({ derived: roster({ people: [ADA] }), key: "ad", overrides: [] })).toEqual([]);
  });

  it("searches the HUMAN roster's own name and handle, which live on the record rather than an identity", () => {
    const override: IdentityRecord = {
      email: "grace@example.test",
      handle: "grace-h",
      id: "p-grace",
      identities: [{ handle: "grace-h", nativeId: ID_GRACE, source: "linear" }],
      name: "Grace Hopper",
    };
    const found = linearPersonCandidates({
      derived: roster({ people: [] }),
      key: "Grace Hopper",
      overrides: [override],
    });

    expect(found.map((candidate) => candidate.linearId)).toEqual([ID_GRACE]);
  });

  it("reports one entry per person, ordered by canonical id, so a refusal reads the same every time", () => {
    const second: DerivedPerson = { ...ADA, id: "p-aardvark" };
    const found = linearPersonCandidates({
      derived: roster({ people: [ADA, second] }),
      key: "Ada Lovelace",
      overrides: [],
    });

    expect(found.map((candidate) => candidate.personId)).toEqual(["p-aardvark", "p-ada"]);
  });
});
