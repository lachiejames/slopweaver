/**
 * The reviewer wiring over a throwaway home holding a derived roster, a MATCHING freshness stamp (an all-zero
 * observation for a home with no corpus, so the just-in-time path reads the roster as fresh and never runs a
 * derive), and a human roster held in the store. Both readers resolve in input order, case-insensitively and exactly,
 * with the human roster winning a key both layers claim.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  reviewersFromIdentity,
  reviewersFromIdentityUnrefreshed,
} from "../../../../../cli/commands/github/reviewerWiring.js";
import { silverIdentitiesPath } from "../../../../../corpus/corpusPaths.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ReviewerResolution } from "../../../../../outbound/github/reviewerIndex.js";
import { emptyObservation } from "../../../../../silver/derive/freshness.js";
import { freshnessStampPath } from "../../../../../silver/derive/stamp.js";
import type { IdentityRosterPort } from "../../../../../silver/identityRoster.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/**
 * A home whose derived roster holds Ada (`Ada-GH`) and Grace (`grace-gh`), stamped fresh against roster revision 1.
 */
function homeWithRosters(): string {
  const home = mkdtempSync(join(tmpdir(), "reviewer-wiring-"));
  homes.push(home);
  const identitiesPath = silverIdentitiesPath({ home });
  mkdirSync(dirname(identitiesPath), { recursive: true });
  writeFileSync(
    identitiesPath,
    JSON.stringify({
      candidates: [],
      people: [
        { confidence: "handle", id: "p1", identities: [{ handle: "ada", nativeId: "Ada-GH", source: "github" }] },
        { confidence: "handle", id: "p2", identities: [{ nativeId: "grace-gh", source: "github" }] },
      ],
    }),
    "utf8",
  );
  // The stamp records the roster revision the derive saw; the memory port seeds revision 1, so they match.
  writeFileSync(
    freshnessStampPath({ home }),
    JSON.stringify({
      ...emptyObservation(),
      derivedAtIso: "2026-01-01T00:00:00Z",
      overrideRevision: 1,
      version: 1,
    }),
    "utf8",
  );
  return home;
}

/** Each resolution's target, in order — the part a caller sends or refuses on. */
function targets({ resolutions }: { resolutions: readonly ReviewerResolution[] }): readonly unknown[] {
  return resolutions.map((resolution) => resolution.target);
}

const LOGINS = ["ADA-gh", "nobody-we-know", "grace-gh"];
const EXPECTED = [{ login: "Ada-GH", origin: "derived" }, undefined, { login: "Grace-GH-Real", origin: "override" }];

/** The store's human roster, which maps the key `grace-gh` to a different login, `Grace-GH-Real`. */
function holdingGrace(): IdentityRosterPort {
  return memoryIdentityRosterPort({
    records: [
      {
        handle: "gracie",
        id: "U0GRACE",
        identities: [{ handle: "grace-gh", nativeId: "Grace-GH-Real", source: "github" }],
        name: "Grace",
      },
    ],
  });
}

describe("reviewersFromIdentity", () => {
  it("resolves in input order: a case-folded derived login, an unknown login as nothing, the human roster winning", async () => {
    const resolutions = unwrap(
      await reviewersFromIdentity({
        askedAtIso: "2026-01-02T00:00:00.000Z",
        home: homeWithRosters(),
        identityRoster: holdingGrace(),
        logins: LOGINS,
      }),
    );

    expect(targets({ resolutions })).toEqual(EXPECTED);
    expect(resolutions[0]!.roster.freshness.kind).toBe("fresh");
  });

  it("answers no resolutions for no logins", async () => {
    const resolutions = unwrap(
      await reviewersFromIdentity({
        askedAtIso: "2026-01-02T00:00:00.000Z",
        home: homeWithRosters(),
        identityRoster: holdingGrace(),
        logins: [],
      }),
    );

    expect(resolutions).toEqual([]);
  });

  it("answers the roster's typed refusal, resolving nobody, when the store cannot be opened", async () => {
    const refusal = unwrapErr(
      await reviewersFromIdentity({
        askedAtIso: "2026-01-02T00:00:00.000Z",
        home: homeWithRosters(),
        identityRoster: unavailableIdentityRosterPort(),
        logins: LOGINS,
      }),
    );

    expect(refusal.code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
  });
});

describe("reviewersFromIdentityUnrefreshed", () => {
  it("resolves the same logins the same way from the rosters as they stand", async () => {
    const resolutions = unwrap(
      await reviewersFromIdentityUnrefreshed({
        home: homeWithRosters(),
        identityRoster: holdingGrace(),
        logins: LOGINS,
      }),
    );

    expect(targets({ resolutions })).toEqual(EXPECTED);
  });

  it("answers no resolutions for no logins", async () => {
    const resolutions = unwrap(
      await reviewersFromIdentityUnrefreshed({ home: homeWithRosters(), identityRoster: holdingGrace(), logins: [] }),
    );

    expect(resolutions).toEqual([]);
  });

  it("answers the roster's typed refusal, resolving nobody, when the store cannot be opened", async () => {
    const refusal = unwrapErr(
      await reviewersFromIdentityUnrefreshed({
        home: homeWithRosters(),
        identityRoster: unavailableIdentityRosterPort(),
        logins: LOGINS,
      }),
    );

    expect(refusal.code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
  });
});
