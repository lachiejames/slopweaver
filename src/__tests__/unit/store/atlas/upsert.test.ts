/**
 * `atlas_kind_status`'s upsert `set` list, against the table it is a mirror of.
 *
 * The same guard as `../boardUpsert.test.ts`, for the same measured class: a hand-maintained mirror of a
 * table rots quietly, because a column added to `values` and missed in `onConflictDoUpdate`'s `set` writes
 * nothing on CONFLICT — and a fresh database cannot catch it, since every row there goes through INSERT.
 * On this table the symptom would be a re-import recording a new `digest` beside the OLD `entity_count`,
 * so the row would claim to be the current generation while its count belonged to the previous one.
 *
 * Pure: the expectation is DERIVED from the table's own column list rather than restated, so a column
 * added later fails here instead of being silently left out of the mirror.
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ATLAS_COVERAGE_STATES, ATLAS_ENTITY_STATES, ATLAS_EVIDENCE_ROLES } from "../../../../atlas/kit/contract.js";

import { ATLAS_KIND_STATUS_UPSERT_SET } from "../../../../store/atlas/store.js";
// From the schema MODULE rather than the barrel: the enums below are declared here, and a test that only
// ever reached them through the barrel would not notice this file being dropped from it.
import {
  atlasCoverageStateEnum,
  atlasEntityStateEnum,
  atlasEvidenceRoleEnum,
  atlasKindStatusTable,
} from "../../../../store/schema/atlas.js";

/**
 * Columns the upsert must NOT name, with the reason each is excluded.
 *
 * `platform` and `kind` are the conflict target, so overwriting either would defeat the upsert.
 * `loadedAt` is deliberately not here: it must be PRESENT, set to `now()` rather than copied from
 * `excluded`, because it records when THIS import wrote the row.
 */
const EXCLUDED = ["platform", "kind"] as const;

describe("ATLAS_KIND_STATUS_UPSERT_SET", () => {
  it("names every column the table declares except its conflict target", () => {
    const columns = Object.keys(getTableColumns(atlasKindStatusTable));
    const expected = columns.filter((column) => !EXCLUDED.some((skip) => skip === column)).toSorted();
    expect(Object.keys(ATLAS_KIND_STATUS_UPSERT_SET).toSorted()).toEqual(expected);
  });

  it("names neither key column, so a conflicting row keeps the identity it was found by", () => {
    expect(Object.keys(ATLAS_KIND_STATUS_UPSERT_SET)).not.toContain("platform");
    expect(Object.keys(ATLAS_KIND_STATUS_UPSERT_SET)).not.toContain("kind");
  });

  it("stamps loadedAt with now() rather than copying the excluded row's value", () => {
    // Drizzle's `sql` object serialises its own `queryChunks`, so the fragment is readable without
    // reaching into the driver — and `String()` on it would be `[object Object]`, which asserts nothing.
    expect(JSON.stringify(ATLAS_KIND_STATUS_UPSERT_SET.loadedAt)).toContain("now()");
    expect(JSON.stringify(ATLAS_KIND_STATUS_UPSERT_SET.digest)).toContain("excluded.digest");
  });
});

describe("the three atlas enums are the kit's own vocabularies", () => {
  // Generated from `src/atlas/kit/contract.ts`'s tuples rather than restated, so widening one in the kit
  // cannot leave a Postgres enum behind. A second list is a list that eventually disagrees — the same
  // reason `../schemaDrift.test.ts` holds the memory vocabularies against their unions.
  it("grades an entity's presence with exactly the two states the kit's merge assigns", () => {
    expect(atlasEntityStateEnum.enumValues).toEqual([...ATLAS_ENTITY_STATES]);
  });

  it("grades a scope's readability with the kit's coverage states, which share no member with those", () => {
    expect(atlasCoverageStateEnum.enumValues).toEqual([...ATLAS_COVERAGE_STATES]);
    expect(atlasCoverageStateEnum.enumValues).not.toContain("observed");
  });

  it("grades a surface's evidence with the kit's three roles", () => {
    expect(atlasEvidenceRoleEnum.enumValues).toEqual([...ATLAS_EVIDENCE_ROLES]);
  });
});
