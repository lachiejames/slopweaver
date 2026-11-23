/**
 * The Linear write wiring's two derive-free readers over a throwaway home: the recorded state catalog for a
 * team, and the dry-run assignee reading over a derived roster, a MATCHING freshness stamp (an all-zero
 * observation for a home with no corpus) and a human roster held in the store. The refreshing variants may run a
 * derive, so they are not called here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assigneeFromIdentityUnrefreshed, stateCatalogFor } from "../../../../../cli/commands/linear/wiring.js";
import { silverIdentitiesPath } from "../../../../../corpus/corpusPaths.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type StateCatalog, writeStateCatalog } from "../../../../../outbound/linear/stateCatalog.js";
import { emptyObservation } from "../../../../../silver/derive/freshness.js";
import { freshnessStampPath } from "../../../../../silver/derive/stamp.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A fresh, empty state home that the suite removes afterwards. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "linear-wiring-"));
  homes.push(home);
  return home;
}

const CATALOG: StateCatalog = {
  members: [{ displayName: "ada", id: "lin-ada" }],
  readAtIso: "2026-01-01T00:00:00.000Z",
  states: [
    { id: "state-todo", name: "Todo", type: "unstarted" },
    { id: "state-done", name: "Done", type: "completed" },
  ],
  teamId: "team-1",
  teamKey: "ENG",
};

describe("stateCatalogFor", () => {
  it("returns the whole catalog recorded for the team", () => {
    const home = emptyHome();
    writeStateCatalog({ catalog: CATALOG, home });

    expect(stateCatalogFor({ home, teamId: "team-1" })).toEqual(CATALOG);
  });

  it("returns undefined for a neighbouring team nobody has read", () => {
    const home = emptyHome();
    writeStateCatalog({ catalog: CATALOG, home });

    expect(stateCatalogFor({ home, teamId: "team-2" })).toBe(undefined);
  });
});

/**
 * A home whose derived roster holds Ada (Linear `lin-ada`, handle `ada`) and whose human roster confirms
 * Grace (Linear `lin-grace`, handle `grace`) under the record id `U0GRACE` and handle `gracie`.
 */
function homeWithRosters(): string {
  const home = emptyHome();
  const identitiesPath = silverIdentitiesPath({ home });
  mkdirSync(dirname(identitiesPath), { recursive: true });
  writeFileSync(
    identitiesPath,
    JSON.stringify({
      candidates: [],
      people: [
        { confidence: "handle", id: "p1", identities: [{ handle: "ada", nativeId: "lin-ada", source: "linear" }] },
      ],
    }),
    "utf8",
  );
  // The stamp records the roster revision the derive saw; the memory port seeds the same row at revision 1, so
  // the roster built "before" the stamp matches what the store holds.
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

/** The store's human roster: Grace (Linear `lin-grace`, handle `grace`) under the record id `U0GRACE`. */
const GRACE_ROSTER = memoryIdentityRosterPort({
  records: [
    {
      handle: "gracie",
      id: "U0GRACE",
      identities: [{ handle: "grace", nativeId: "lin-grace", source: "linear" }],
      name: "Grace",
    },
  ],
});

/**
 * The roster report both rosters above produce: one derived person, four derived keys (`p1`, `lin-ada`,
 * `ada`, `@ada`) plus six override keys (`U0GRACE`, `gracie`, `@gracie`, `lin-grace`, `grace`, `@grace`).
 */
const ROSTER = {
  addressableKeys: 10,
  collisions: [],
  derivedPeople: 1,
  freshness: { kind: "fresh" },
  heldPeople: 0,
};

describe("assigneeFromIdentityUnrefreshed", () => {
  it("resolves an exact derived key to that person's Linear id, from the derived layer", async () => {
    expect(
      unwrap(
        await assigneeFromIdentityUnrefreshed({
          home: homeWithRosters(),
          identityRoster: GRACE_ROSTER,
          person: "@ada",
        }),
      ),
    ).toEqual({
      held: false,
      roster: ROSTER,
      target: { linearId: "lin-ada", origin: "derived" },
    });
  });

  it("resolves an exact override key to that person's Linear id, from the human roster", async () => {
    expect(
      unwrap(
        await assigneeFromIdentityUnrefreshed({
          home: homeWithRosters(),
          identityRoster: GRACE_ROSTER,
          person: "gracie",
        }),
      ),
    ).toEqual({
      held: false,
      roster: ROSTER,
      target: { linearId: "lin-grace", origin: "override" },
    });
  });

  it("resolves nobody for a near-miss that differs from a real key only by case", async () => {
    expect(
      unwrap(
        await assigneeFromIdentityUnrefreshed({ home: homeWithRosters(), identityRoster: GRACE_ROSTER, person: "Ada" }),
      ),
    ).toEqual({
      held: false,
      roster: ROSTER,
      target: undefined,
    });
  });

  it("resolves nobody, and reports the same roster, when the form assigns no one", async () => {
    expect(
      unwrap(
        await assigneeFromIdentityUnrefreshed({
          home: homeWithRosters(),
          identityRoster: GRACE_ROSTER,
          person: undefined,
        }),
      ),
    ).toEqual({
      held: false,
      roster: ROSTER,
      target: undefined,
    });
  });

  it("reads an empty home as an absent roster with no addressable key", async () => {
    const resolution = unwrap(
      await assigneeFromIdentityUnrefreshed({
        home: emptyHome(),
        identityRoster: memoryIdentityRosterPort(),
        person: "ada",
      }),
    );

    expect(resolution.target).toBe(undefined);
    expect(resolution.roster.freshness.kind).toBe("absent");
    expect(resolution.roster.addressableKeys).toBe(0);
    expect(resolution.roster.derivedPeople).toBe(0);
  });

  it("answers the roster's typed refusal, never a resolution, when the store cannot be opened", async () => {
    const refusal = unwrapErr(
      await assigneeFromIdentityUnrefreshed({
        home: homeWithRosters(),
        identityRoster: unavailableIdentityRosterPort(),
        person: "@ada",
      }),
    );

    expect(refusal.code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
  });
});
