/**
 * The corpus policy lists derived from the integration registry — who a roster entry may name, which sources can move
 * the roster, which are private by construction, whose container is an allowlist unit, and where a person's mention
 * is demand for a resync: each equals the
 * hand-kept list it replaced, and a fixture integration with only a manifest appears in each list it declares.
 */
import { describe, expect, it } from "vitest";

import { isAlwaysPrivateSource } from "../../../corpus/visibility.js";
import {
  ALL_CORPUS_SOURCES,
  ALWAYS_PRIVATE_SOURCES,
  CONTAINER_SCOPED_SOURCES,
  corpusSourcesOf,
  IDENTITY_SOURCES,
  RESYNC_DEMAND_SOURCES,
  ROSTER_SOURCES,
} from "../../../integrations/corpusSources.js";
import type { IntegrationManifest } from "../../../integrations/manifest.js";
import { integrations, registeredIntegrations } from "../../../integrations/registry.js";
import { RESYNC_DEMAND_SOURCES as DEMAND_RESYNC_DEMAND_SOURCES } from "../../../live/resync/demand.js";
import { ROSTER_SOURCES as FRESHNESS_ROSTER_SOURCES } from "../../../silver/derive/freshness.js";
import { type IdentitySource, IDENTITY_SOURCES as SILVER_IDENTITY_SOURCES } from "../../../silver/identity.js";

/** `true` only when `A` and `B` are the same type; `false` when either has a member the other lacks. */
type SameType<A, B> = [A, B] extends [B, A] ? true : false;

/** The literal `src/silver/identity.ts` spelled by hand before it was derived. */
const HAND_KEPT_IDENTITY = ["github", "slack", "linear", "notion"];
/** The literal `src/silver/derive/freshness.ts` spelled by hand, in id order. */
const HAND_KEPT_ROSTER = ["github", "linear", "notion", "self", "slack"];
/** The set `src/corpus/visibility.ts` spelled by hand. */
const HAND_KEPT_ALWAYS_PRIVATE = ["self", "gmail", "calendar", "fathom", "chatgpt", "outlook-calendar"];
/** The literal `src/corpus/sliceShape.ts` spelled by hand, in an order nothing observed. */
const HAND_KEPT_CONTAINER_SCOPED = ["slack", "github", "linear", "notion", "gmail", "self"];
/** The literal `src/live/resync/demand.ts` spelled by hand. */
const HAND_KEPT_RESYNC_DEMAND = ["slack", "linear", "notion", "gmail", "calendar", "fathom", "outlook-calendar"];

/** A manifest-only org-shared fixture: it names people, its container is an allowlist unit, and it is not private. */
const SHARED_FIXTURE = {
  corpus: {
    allSourcesSweep: true,
    alwaysPrivate: false,
    containerScoped: true,
    identityRoster: true,
    ordinal: 10,
    progressPhase: false,
    resyncDemand: true,
    upfrontTokenGate: false,
  },
  features: { ingest: async () => (await import("../../../corpus/github/fetch.js")).collectSearchHits },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

/** The opposite on every policy field: private, nameless authors, no container worth tallying. */
const PRIVATE_FIXTURE = {
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 10,
    progressPhase: false,
    resyncDemand: false,
    upfrontTokenGate: false,
  },
  features: { ingest: async () => (await import("../../../corpus/github/fetch.js")).collectSearchHits },
  id: "acme",
  name: "Acme",
} as const satisfies IntegrationManifest;

describe("the corpus policy lists derived from the registry", () => {
  it("the identity and roster lists equal the hand-kept literals, in the same order", () => {
    expect(IDENTITY_SOURCES).toEqual(HAND_KEPT_IDENTITY);
    expect(ROSTER_SOURCES).toEqual(HAND_KEPT_ROSTER);
  });

  it("the always-private list holds the hand-kept set, in the hand-kept order as it happens", () => {
    expect(ALWAYS_PRIVATE_SOURCES).toEqual(HAND_KEPT_ALWAYS_PRIVATE);
  });

  it("the container-scoped list holds the hand-kept members, now in ordinal order", () => {
    expect(CONTAINER_SCOPED_SOURCES).toEqual(["github", "slack", "linear", "notion", "self", "gmail"]);
    expect(CONTAINER_SCOPED_SOURCES.toSorted()).toEqual(HAND_KEPT_CONTAINER_SCOPED.toSorted());
  });

  it("the resync demand list equals the hand-kept literal, in the same order, and demand.ts re-exports it", () => {
    expect(RESYNC_DEMAND_SOURCES).toEqual(HAND_KEPT_RESYNC_DEMAND);
    expect(DEMAND_RESYNC_DEMAND_SOURCES).toBe(RESYNC_DEMAND_SOURCES);
  });

  it("isAlwaysPrivateSource answers for every source exactly as the hand-kept set did", () => {
    expect(ALL_CORPUS_SOURCES.length).toBeGreaterThan(0);
    const answered = ALL_CORPUS_SOURCES.filter((source) => isAlwaysPrivateSource({ source }));
    expect(answered).toEqual(ALL_CORPUS_SOURCES.filter((source) => HAND_KEPT_ALWAYS_PRIVATE.includes(source)));
  });

  it("the modules that held the literals re-export the derived lists, so their readers are unchanged", () => {
    expect(SILVER_IDENTITY_SOURCES).toBe(IDENTITY_SOURCES);
    expect(FRESHNESS_ROSTER_SOURCES).toBe(ROSTER_SOURCES);
    const identityTyped: readonly true[] = [true satisfies SameType<(typeof IDENTITY_SOURCES)[number], IdentitySource>];
    expect(identityTyped).toEqual([true]);
  });

  it("widened manifests derive every policy list typed `string`, never `never`", () => {
    const widened = corpusSourcesOf({ manifests: integrations() });
    const sound: readonly true[] = [
      true satisfies SameType<(typeof widened.identityRoster)[number], string>,
      true satisfies SameType<(typeof widened.rosterWitness)[number], string>,
      true satisfies SameType<(typeof widened.alwaysPrivate)[number], string>,
      true satisfies SameType<(typeof widened.containerScoped)[number], string>,
      true satisfies SameType<(typeof widened.resyncDemand)[number], string>,
    ];
    expect(sound).toEqual([true, true, true, true, true]);
    expect([
      widened.identityRoster,
      widened.rosterWitness,
      widened.alwaysPrivate,
      widened.containerScoped,
      widened.resyncDemand,
    ]).toEqual([
      IDENTITY_SOURCES,
      ROSTER_SOURCES,
      ALWAYS_PRIVATE_SOURCES,
      CONTAINER_SCOPED_SOURCES,
      RESYNC_DEMAND_SOURCES,
    ]);
  });

  it("an org-shared fixture with only a manifest joins the identity, roster, container and demand lists, and not the private one", () => {
    const shared = corpusSourcesOf({ manifests: [...registeredIntegrations(), SHARED_FIXTURE] });
    expect(shared.identityRoster).toEqual([...IDENTITY_SOURCES, "acme"]);
    expect(shared.rosterWitness).toEqual(["acme", ...ROSTER_SOURCES]);
    expect(shared.containerScoped).toEqual([...CONTAINER_SCOPED_SOURCES, "acme"]);
    expect(shared.resyncDemand).toEqual([...RESYNC_DEMAND_SOURCES, "acme"]);
    expect(shared.alwaysPrivate).toEqual(ALWAYS_PRIVATE_SOURCES);
  });

  it("a private fixture with only a manifest joins the private list, and no other policy list", () => {
    const named = corpusSourcesOf({ manifests: [...registeredIntegrations(), PRIVATE_FIXTURE] });
    expect(named.alwaysPrivate).toEqual([...ALWAYS_PRIVATE_SOURCES, "acme"]);
    expect([named.identityRoster, named.rosterWitness, named.containerScoped, named.resyncDemand]).toEqual([
      IDENTITY_SOURCES,
      ROSTER_SOURCES,
      CONTAINER_SCOPED_SOURCES,
      RESYNC_DEMAND_SOURCES,
    ]);
  });

  it("orders by ordinal, or by id for the roster, never by the order the manifests arrive in", () => {
    const reversed = corpusSourcesOf({ manifests: registeredIntegrations().toReversed() });
    expect([
      reversed.identityRoster,
      reversed.rosterWitness,
      reversed.alwaysPrivate,
      reversed.containerScoped,
      reversed.resyncDemand,
    ]).toEqual([
      IDENTITY_SOURCES,
      ROSTER_SOURCES,
      ALWAYS_PRIVATE_SOURCES,
      CONTAINER_SCOPED_SOURCES,
      RESYNC_DEMAND_SOURCES,
    ]);
  });

  it("every policy list is frozen, so one reader cannot change another's answer", () => {
    expect(
      [IDENTITY_SOURCES, ROSTER_SOURCES, ALWAYS_PRIVATE_SOURCES, CONTAINER_SCOPED_SOURCES, RESYNC_DEMAND_SOURCES].map(
        Object.isFrozen,
      ),
    ).toEqual([true, true, true, true, true]);
  });
});
