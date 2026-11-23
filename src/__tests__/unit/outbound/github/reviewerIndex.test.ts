import { describe, expect, it } from "vitest";

import {
  buildReviewerIndex,
  resolveReviewerKey,
  reviewerRefusals,
  staleReviewerRefusals,
} from "../../../../outbound/github/reviewerIndex.js";
import type { DeriveFreshness } from "../../../../silver/derive/freshness.js";
import type { DerivedPerson, DerivedRoster } from "../../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../../silver/identity.js";

const FRESH: DeriveFreshness = { kind: "fresh" };

/** A derived person with a GitHub identity plus a Slack one — the shape derive really persists. */
function person({ id, handle, login }: { id: string; handle: string; login?: string }): DerivedPerson {
  return {
    confidence: "handle",
    id,
    identities: [
      { handle: `${handle}-slack`, nativeId: `U-${handle}`, source: "slack" },
      ...(login === undefined
        ? []
        : [{ handle, name: `Display Name ${handle}`, nativeId: login, source: "github" as const }]),
    ],
    kind: "person",
  };
}

function roster({ people, held = [] }: { people: readonly DerivedPerson[]; held?: readonly string[] }): DerivedRoster {
  return { heldPersonIds: new Set(held), people };
}

describe("buildReviewerIndex", () => {
  it("keys on the canonical id, the login (folded) and both handle spellings", () => {
    const { index } = buildReviewerIndex({
      derived: roster({ people: [person({ handle: "Ada", id: "p1", login: "ada-gh" })] }),
      overrides: [],
    });

    expect([...index.keys()].toSorted()).toEqual(["@ada", "ada", "ada-gh", "p1"]);
    expect(index.get("ada-gh")).toEqual({ login: "ada-gh", origin: "derived" });
  });

  it("offers NO key for a person with no GitHub identity — they have no account to request review from", () => {
    const { index } = buildReviewerIndex({
      derived: roster({ people: [person({ handle: "grace", id: "p2" })] }),
      overrides: [],
    });

    expect([...index.keys()]).toEqual([]);
  });

  it("never keys on a display NAME, even though the identity carries one", () => {
    const { index } = buildReviewerIndex({
      derived: roster({ people: [person({ handle: "ada", id: "p1", login: "ada-gh" })] }),
      overrides: [],
    });

    expect(index.has("display name ada")).toBe(false);
  });

  it("DROPS a key two different people claim, and reports it", () => {
    const { collisions, index } = buildReviewerIndex({
      derived: roster({
        people: [
          person({ handle: "ada", id: "p1", login: "ada-one" }),
          person({ handle: "ada", id: "p2", login: "ada-two" }),
        ],
      }),
      overrides: [],
    });

    expect(collisions).toEqual(["@ada", "ada"]);
    expect(index.has("ada")).toBe(false);
    expect(index.has("@ada")).toBe(false);
    // Each person's own login and canonical id survive, only the shared handle (bare and `@`-prefixed) collided.
    expect(index.get("ada-one")).toEqual({ login: "ada-one", origin: "derived" });
    expect(index.get("p2")).toEqual({ login: "ada-two", origin: "derived" });
  });

  it("lets a human override RESCUE a key the derived layer dropped as ambiguous", () => {
    const overrides: readonly IdentityRecord[] = [
      { handle: "ada", id: "ada", identities: [{ nativeId: "ada-one", source: "github" }], name: "Ada" },
    ];
    const { index } = buildReviewerIndex({
      derived: roster({
        people: [
          person({ handle: "ada", id: "p1", login: "ada-one" }),
          person({ handle: "ada", id: "p2", login: "ada-two" }),
        ],
      }),
      overrides,
    });

    expect(index.get("ada")).toEqual({ login: "ada-one", origin: "override" });
  });
});

describe("resolveReviewerKey", () => {
  it("resolves an exact login case-INSENSITIVELY, returning the roster's own case", () => {
    const derived = roster({ people: [person({ handle: "ada", id: "p1", login: "AdaLovelace" })] });

    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "adalovelace", overrides: [] });

    expect(resolution.target).toEqual({ login: "AdaLovelace", origin: "derived" });
  });

  it("resolves nothing for a login the roster has never seen — never guessed", () => {
    const derived = roster({ people: [person({ handle: "ada", id: "p1", login: "ada-gh" })] });

    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "totally-unknown", overrides: [] });

    expect(resolution.target).toBeUndefined();
    expect(resolution.held).toBe(false);
  });

  it("reports a HELD candidate as held, never as a plain miss", () => {
    const derived = roster({ held: ["p1"], people: [] });

    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "p1", overrides: [] });

    expect(resolution.target).toBeUndefined();
    expect(resolution.held).toBe(true);
  });
});

describe("reviewerRefusals", () => {
  it("is silent once a login resolved", () => {
    const derived = roster({ people: [person({ handle: "ada", id: "p1", login: "ada-gh" })] });
    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "ada-gh", overrides: [] });

    expect(reviewerRefusals({ login: "ada-gh", resolution })).toEqual([]);
  });

  it("names the login and the held reason for a held candidate", () => {
    const derived = roster({ held: ["p1"], people: [] });
    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "p1", overrides: [] });

    const refusals = reviewerRefusals({ login: "p1", resolution });

    expect(refusals[0]).toContain('"p1"');
    expect(refusals[0]).toContain("HELD");
  });

  it("names the login and the addressable-key count for an unresolved, non-held login", () => {
    const derived = roster({ people: [person({ handle: "ada", id: "p1", login: "ada-gh" })] });
    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "bob-not-here", overrides: [] });

    const refusals = reviewerRefusals({ login: "bob-not-here", resolution });

    expect(refusals[0]).toContain('"bob-not-here"');
    expect(refusals[0]).toContain("no exact match");
  });
});

describe("staleReviewerRefusals", () => {
  it("refuses when the roster is stale and at least one resolution was attempted", () => {
    const stale: DeriveFreshness = { changed: [], derivedAtIso: "2026-08-01T00:00:00Z", kind: "stale" };
    const derived = roster({ people: [] });
    const resolution = resolveReviewerKey({ derived, freshness: stale, login: "someone", overrides: [] });

    expect(staleReviewerRefusals({ resolutions: [resolution] })).not.toEqual([]);
  });

  it("proceeds when nothing was resolved at all", () => {
    expect(staleReviewerRefusals({ resolutions: [] })).toEqual([]);
  });

  it("proceeds when the roster is fresh", () => {
    const derived = roster({ people: [person({ handle: "ada", id: "p1", login: "ada-gh" })] });
    const resolution = resolveReviewerKey({ derived, freshness: FRESH, login: "ada-gh", overrides: [] });

    expect(staleReviewerRefusals({ resolutions: [resolution] })).toEqual([]);
  });
});
