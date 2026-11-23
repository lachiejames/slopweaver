import { describe, expect, it } from "vitest";

import {
  AIRTABLE_OBSERVATIONAL_POSTS,
  AIRTABLE_PROBE_ONLY_OPERATIONS,
  AIRTABLE_VOLUME_JUDGED_OPERATIONS,
  AIRTABLE_VOLUMINOUS_OPERATIONS,
} from "../../../../atlas/airtable/exclusions.js";
import { AIRTABLE_SPEC_CENSUS, AIRTABLE_UNSERVED_TAGS } from "../../../../atlas/airtable/generated/specLock.js";
import { AIRTABLE_SURFACES } from "../../../../atlas/airtable/generated/surfaces.js";
import { AIRTABLE_ATLAS_KINDS } from "../../../../atlas/airtable/kinds.js";

/** Verbs that CREATE, CHANGE or REMOVE. An admitted operation whose id starts with one of these is a defect. */
const MUTATING_VERBS = [
  "add",
  "create",
  "delete",
  "grant",
  "install",
  "manage",
  "move",
  "patch",
  "post",
  "put",
  "refresh",
  "remove",
  "revoke",
  "update",
];

describe("the generated Airtable surface registry", () => {
  it("holds exactly the operations the pinned census declares", () => {
    expect(AIRTABLE_SURFACES.length).toBe(AIRTABLE_SPEC_CENSUS.operations);
  });

  it("names every operation uniquely, which is what makes the id usable as a surface name", () => {
    expect(new Set(AIRTABLE_SURFACES.map((row) => row.name)).size).toBe(AIRTABLE_SPEC_CENSUS.operationIds);
  });

  it("places every row in a kind this atlas actually holds", () => {
    const unplaced = AIRTABLE_SURFACES.filter((row) => !AIRTABLE_ATLAS_KINDS.includes(row.kind));

    expect(unplaced.map((row) => row.name)).toEqual([]);
  });

  it("gives every excluded row a refusal reason and every entity row none", () => {
    const excludedWithoutReason = AIRTABLE_SURFACES.filter(
      (row) => row.disposition === "excluded" && row.exclusionReason === null,
    );
    const entityWithReason = AIRTABLE_SURFACES.filter(
      (row) => row.disposition === "entity" && row.dispositionBecause !== null,
    );

    expect(excludedWithoutReason.map((row) => row.name)).toEqual([]);
    expect(entityWithReason.map((row) => row.name)).toEqual([]);
  });

  // The Datadog atlas admitted `POST /api/v2/replay/heatmap/snapshots` because the path ends in a plural
  // noun, and it was `createReplayHeatmapSnapshot`. Airtable names every operation too, so the same cheap
  // second opinion applies to a hand-reviewed list that will be grown by somebody else later.
  it("admits no non-GET whose own operation id begins with a mutating verb", () => {
    const admitted = AIRTABLE_SURFACES.filter((row) => row.method !== "GET" && row.disposition !== "excluded");
    const suspicious = admitted.filter((row) => MUTATING_VERBS.some((verb) => row.name.startsWith(verb)));

    expect(admitted.map((row) => row.name)).toEqual([...AIRTABLE_OBSERVATIONAL_POSTS]);
    expect(suspicious.map((row) => row.name)).toEqual([]);
  });

  it("refuses every write, so the excluded count is the non-GET count less the one observational POST", () => {
    const nonGet =
      AIRTABLE_SPEC_CENSUS.methodCounts.DELETE +
      AIRTABLE_SPEC_CENSUS.methodCounts.PATCH +
      AIRTABLE_SPEC_CENSUS.methodCounts.POST +
      AIRTABLE_SPEC_CENSUS.methodCounts.PUT;

    expect(AIRTABLE_SURFACES.filter((row) => row.disposition === "excluded").length).toBe(
      nonGet - AIRTABLE_OBSERVATIONAL_POSTS.length,
    );
  });

  it("shape-indexes exactly the three declared voluminous operations", () => {
    const indexed = AIRTABLE_SURFACES.filter((row) => row.disposition === "shape-index").map((row) => row.name);

    expect(indexed.toSorted()).toEqual(AIRTABLE_VOLUMINOUS_OPERATIONS.map((row) => row.operationId).toSorted());
  });

  it("stores nothing for exactly the declared probe-only operation", () => {
    const probes = AIRTABLE_SURFACES.filter((row) => row.disposition === "probe-only").map((row) => row.name);

    expect(probes).toEqual(AIRTABLE_PROBE_ONLY_OPERATIONS.map((row) => row.operationId));
  });

  // The criterion cuts THROUGH the auditing family rather than along it: one path segment separates the
  // event stream from the export requests somebody made against it, and they get opposite dispositions.
  it("shape-indexes the audit EVENT stream while keeping audit export REQUESTS as entities", () => {
    const events = AIRTABLE_SURFACES.find((row) => row.name === "audit-log-events")!;
    const requests = AIRTABLE_SURFACES.find((row) => row.name === "list-audit-log-requests")!;

    expect(events.disposition).toBe("shape-index");
    expect(requests.disposition).toBe("entity");
    expect(events.tag).toBe("auditLogs");
    expect(requests.tag).toBe("auditing");
  });

  it("marks the records families as volume-judged per scope and leaves them as entities", () => {
    const judged = AIRTABLE_SURFACES.filter((row) => row.volumeJudgedPerScope);

    expect(judged.map((row) => row.name).toSorted()).toEqual([...AIRTABLE_VOLUME_JUDGED_OPERATIONS].toSorted());
    expect(judged.map((row) => row.disposition)).toEqual(judged.map(() => "entity"));
  });

  it("serves no operation at all for the tags recorded as browser-only", () => {
    const served = new Set(AIRTABLE_SURFACES.map((row) => row.tag));
    const wronglyServed = AIRTABLE_UNSERVED_TAGS.filter((tag) => served.has(tag));

    expect(wronglyServed).toEqual([]);
    expect(served.size).toBe(AIRTABLE_SPEC_CENSUS.tagsWithOperations);
  });

  it("fans one operation out to the field and view kinds, because its response carries them nested", () => {
    const schema = AIRTABLE_SURFACES.find((row) => row.name === "get-base-schema")!;

    expect(schema.kind).toBe("table");
    expect([...schema.alsoFeeds].toSorted()).toEqual(["field", "view"]);
  });
});
