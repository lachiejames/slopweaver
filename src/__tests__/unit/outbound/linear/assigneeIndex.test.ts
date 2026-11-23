import { describe, expect, it } from "vitest";

import {
  assigneeRefusals,
  buildAssigneeIndex,
  resolveAssigneeKey,
  staleAssigneeRefusals,
} from "../../../../outbound/linear/assigneeIndex.js";
import type { DeriveFreshness } from "../../../../silver/derive/freshness.js";
import type { DerivedPerson, DerivedRoster } from "../../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../../silver/identity.js";

const FRESH: DeriveFreshness = { kind: "fresh" };

/** A derived person with a Linear identity plus a Slack one — the shape derive really persists. */
function person({
  id,
  handle,
  linearId,
  email,
}: {
  id: string;
  handle: string;
  linearId?: string;
  email?: string;
}): DerivedPerson {
  return {
    confidence: "email",
    id,
    identities: [
      { handle: `${handle}-slack`, nativeId: `U-${handle}`, source: "slack" },
      ...(linearId === undefined
        ? []
        : [
            {
              handle,
              name: `Display Name ${handle}`,
              nativeId: linearId,
              source: "linear" as const,
              ...(email === undefined ? {} : { email }),
            },
          ]),
    ],
    kind: "person",
  };
}

function roster({ people, held = [] }: { people: readonly DerivedPerson[]; held?: readonly string[] }): DerivedRoster {
  return { heldPersonIds: new Set(held), people };
}

describe("buildAssigneeIndex", () => {
  it("keys on the canonical id, the Linear id, the handle, `@handle` and the Linear email", () => {
    const { index } = buildAssigneeIndex({
      derived: roster({ people: [person({ email: "ada@example.test", handle: "ada", id: "p1", linearId: "L-ada" })] }),
      overrides: [],
    });

    expect([...index.keys()].toSorted()).toEqual(["@ada", "L-ada", "ada", "ada@example.test", "p1"]);
    expect(index.get("ada")).toEqual({ linearId: "L-ada", origin: "derived" });
  });

  it("offers NO key for a person with no Linear identity — they have no account to assign", () => {
    const { index } = buildAssigneeIndex({
      derived: roster({ people: [person({ handle: "grace", id: "p2" })] }),
      overrides: [],
    });

    expect([...index.keys()]).toEqual([]);
  });

  it("never keys on a display NAME, even though the identity carries one", () => {
    const { index } = buildAssigneeIndex({
      derived: roster({ people: [person({ handle: "ada", id: "p1", linearId: "L-ada" })] }),
      overrides: [],
    });

    expect(index.has("Display Name ada")).toBe(false);
  });

  it("DROPS a key two different people claim, and reports it", () => {
    const { index, collisions } = buildAssigneeIndex({
      derived: roster({
        people: [
          person({ handle: "ada", id: "p1", linearId: "L-one" }),
          person({ handle: "ada", id: "p2", linearId: "L-two" }),
        ],
      }),
      overrides: [],
    });

    expect(collisions).toEqual(["@ada", "ada"]);
    expect(index.has("ada")).toBe(false);
  });

  it("lets the human roster override the derived layer and rescue a dropped key", () => {
    const override: IdentityRecord = {
      handle: "ada",
      id: "p1",
      identities: [{ nativeId: "L-confirmed", source: "linear" }],
      name: "Ada",
    };
    const { index, collisions } = buildAssigneeIndex({
      derived: roster({
        people: [
          person({ handle: "ada", id: "p1", linearId: "L-one" }),
          person({ handle: "ada", id: "p2", linearId: "L-two" }),
        ],
      }),
      overrides: [override],
    });

    expect(index.get("ada")).toEqual({ linearId: "L-confirmed", origin: "override" });
    expect(collisions).toEqual([]);
  });
});

describe("resolveAssigneeKey", () => {
  it("resolves an exact key and reports the roster behind it", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [person({ handle: "ada", id: "p1", linearId: "L-ada" })] }),
      freshness: FRESH,
      overrides: [],
      person: "ada",
    });

    expect(resolution.target).toEqual({ linearId: "L-ada", origin: "derived" });
    expect(resolution.roster.derivedPeople).toBe(1);
    expect(resolution.held).toBe(false);
  });

  it("resolves NOTHING for a near-miss — exact match only, never a nearest guess", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [person({ handle: "ada", id: "p1", linearId: "L-ada" })] }),
      freshness: FRESH,
      overrides: [],
      person: "adaa",
    });

    expect(resolution.target).toBe(undefined);
  });

  it("resolves nothing when the form assigns nobody", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [] }),
      freshness: FRESH,
      overrides: [],
      person: undefined,
    });

    expect(resolution.target).toBe(undefined);
    expect(resolution.held).toBe(false);
  });
});

describe("assigneeRefusals", () => {
  it("refuses nothing when the form assigns nobody", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [] }),
      freshness: FRESH,
      overrides: [],
      person: undefined,
    });

    expect(assigneeRefusals({ person: undefined, resolution })).toEqual([]);
  });

  it("names a HELD link as held rather than as a missing key", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ held: ["p9"], people: [] }),
      freshness: FRESH,
      overrides: [],
      person: "p9",
    });
    const refusals = assigneeRefusals({ person: "p9", resolution });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("that identity link is HELD");
  });

  it("names a COLLIDED key as ambiguous rather than as a missing key", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({
        people: [
          person({ handle: "ada", id: "p1", linearId: "L-one" }),
          person({ handle: "ada", id: "p2", linearId: "L-two" }),
        ],
      }),
      freshness: FRESH,
      overrides: [],
      person: "ada",
    });
    const refusals = assigneeRefusals({ person: "ada", resolution });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("two different people claim that key");
  });

  it("points a plain miss at the read verb that prints every assignable id", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [person({ handle: "ada", id: "p1", linearId: "L-ada" })] }),
      freshness: FRESH,
      overrides: [],
      person: "nobody",
    });
    const refusals = assigneeRefusals({ person: "nobody", resolution });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("no exact match among the 4 assignable keys");
    expect(refusals[0]!).toContain("slopweaver linear states --team");
  });
});

describe("staleAssigneeRefusals", () => {
  it("refuses nothing on a fresh roster", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [person({ handle: "ada", id: "p1", linearId: "L-ada" })] }),
      freshness: FRESH,
      overrides: [],
      person: "ada",
    });

    expect(staleAssigneeRefusals({ person: "ada", resolution })).toEqual([]);
  });

  it("refuses nothing on a stale roster when the form assigns nobody", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [] }),
      freshness: { kind: "absent", why: "no stamp beside the roster" },
      overrides: [],
      person: undefined,
    });

    expect(staleAssigneeRefusals({ person: undefined, resolution })).toEqual([]);
  });

  it("refuses a write whose assignee rests on a roster that is still absent after the refresh had its chance", () => {
    const resolution = resolveAssigneeKey({
      derived: roster({ people: [] }),
      freshness: { kind: "absent", why: "no stamp beside the roster" },
      overrides: [],
      person: "ada",
    });
    const refusals = staleAssigneeRefusals({ person: "ada", resolution });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("slopweaver derive");
  });
});
