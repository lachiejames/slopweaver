import { describe, expect, it } from "vitest";

import {
  FIGMA_NOT_ENUMERABLE_OPERATIONS,
  FIGMA_OBSERVATIONAL_POSTS,
  FIGMA_PROBE_ONLY_OPERATIONS,
  FIGMA_RENDER_ONLY_OPERATIONS,
  FIGMA_VOLUMINOUS_OPERATIONS,
} from "../../../../atlas/figma/exclusions.js";
import {
  FIGMA_DEPRECATED_OPERATIONS,
  FIGMA_FULLY_DEPRECATED_TAGS,
  FIGMA_SPEC_CENSUS,
  FIGMA_UNDECLARED_ENDPOINTS,
  FIGMA_UNSERVED_TAGS,
} from "../../../../atlas/figma/generated/specLock.js";
import { FIGMA_SURFACES } from "../../../../atlas/figma/generated/surfaces.js";
import { FIGMA_ATLAS_KINDS } from "../../../../atlas/figma/kinds.js";

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
  "publish",
  "put",
  "refresh",
  "remove",
  "revoke",
  "update",
];

describe("the generated Figma surface registry", () => {
  it("holds exactly the operations the pinned census declares", () => {
    expect(FIGMA_SURFACES.length).toBe(FIGMA_SPEC_CENSUS.operations);
  });

  it("names every operation uniquely, which is what makes the id usable as a surface name", () => {
    expect(new Set(FIGMA_SURFACES.map((row) => row.name)).size).toBe(FIGMA_SPEC_CENSUS.operationIds);
  });

  it("places every row in a kind this atlas actually holds", () => {
    const unplaced = FIGMA_SURFACES.filter((row) => !FIGMA_ATLAS_KINDS.includes(row.kind));

    expect(unplaced.map((row) => row.name)).toEqual([]);
  });

  it("gives every excluded row a refusal reason and every entity row none", () => {
    const excludedWithoutReason = FIGMA_SURFACES.filter(
      (row) => row.disposition === "excluded" && row.exclusionReason === null,
    );
    const entityWithReason = FIGMA_SURFACES.filter(
      (row) => row.disposition === "entity" && row.dispositionBecause !== null,
    );

    expect(excludedWithoutReason.map((row) => row.name)).toEqual([]);
    expect(entityWithReason.map((row) => row.name)).toEqual([]);
  });

  // The Datadog atlas admitted `POST /api/v2/replay/heatmap/snapshots` because the path ends in a plural
  // noun, and it was `createReplayHeatmapSnapshot`. Figma names every operation too, so the same cheap
  // second opinion applies to a hand-reviewed list that will be grown by somebody else later.
  it("admits no non-GET whose own operation id begins with a mutating verb", () => {
    const admitted = FIGMA_SURFACES.filter((row) => row.method !== "GET" && row.disposition !== "excluded");
    const suspicious = admitted.filter((row) => MUTATING_VERBS.some((verb) => row.name.startsWith(verb)));

    expect(admitted.map((row) => row.name)).toEqual([...FIGMA_OBSERVATIONAL_POSTS]);
    expect(suspicious.map((row) => row.name)).toEqual([]);
  });

  it("refuses every write, so eleven of the twelve non-GET operations are excluded as mutating", () => {
    const nonGet =
      FIGMA_SPEC_CENSUS.methodCounts.DELETE + FIGMA_SPEC_CENSUS.methodCounts.POST + FIGMA_SPEC_CENSUS.methodCounts.PUT;
    const mutating = FIGMA_SURFACES.filter((row) => row.exclusionReason === "mutating");

    expect(mutating.length).toBe(nonGet - FIGMA_OBSERVATIONAL_POSTS.length);
    expect(mutating.filter((row) => row.method === "GET").map((row) => row.name)).toEqual([]);
  });

  it("shape-indexes exactly the declared voluminous operations", () => {
    const indexed = FIGMA_SURFACES.filter((row) => row.disposition === "shape-index").map((row) => row.name);

    expect(indexed.toSorted()).toEqual(FIGMA_VOLUMINOUS_OPERATIONS.map((row) => row.operationId).toSorted());
  });

  it("stores nothing for exactly the declared probe-only operation", () => {
    const probes = FIGMA_SURFACES.filter((row) => row.disposition === "probe-only").map((row) => row.name);

    expect(probes).toEqual(FIGMA_PROBE_ONLY_OPERATIONS.map((row) => row.operationId));
  });

  it("excludes exactly the declared render-only and not-enumerable operations", () => {
    const rendered = FIGMA_SURFACES.filter((row) => row.exclusionReason === "render-only").map((row) => row.name);
    const unwalkable = FIGMA_SURFACES.filter((row) => row.exclusionReason === "not-enumerable").map((row) => row.name);

    expect(rendered.toSorted()).toEqual(FIGMA_RENDER_ONLY_OPERATIONS.map((row) => row.operationId).toSorted());
    expect(unwalkable.toSorted()).toEqual(FIGMA_NOT_ENUMERABLE_OPERATIONS.map((row) => row.operationId).toSorted());
  });

  // The criterion cuts THROUGH the Library Analytics family rather than along it: one path segment
  // separates the dated action feed from the current usage listing, and they get opposite dispositions.
  it("shape-indexes library ACTION feeds while keeping their USAGE siblings as entities", () => {
    const actions = FIGMA_SURFACES.find((row) => row.name === "getLibraryAnalyticsComponentActions")!;
    const usages = FIGMA_SURFACES.find((row) => row.name === "getLibraryAnalyticsComponentUsages")!;

    expect(actions.disposition).toBe("shape-index");
    expect(usages.disposition).toBe("entity");
    expect(actions.tag).toBe("Library Analytics");
    expect(usages.tag).toBe("Library Analytics");
    expect(usages.kind).toBe("component");
  });

  it("serves at least one operation for every tag it declares, so the unserved list is empty", () => {
    const served = new Set(FIGMA_SURFACES.map((row) => row.tag));

    expect(FIGMA_UNSERVED_TAGS).toEqual([]);
    expect(served.size).toBe(FIGMA_SPEC_CENSUS.tagsWithOperations);
    expect(served.size).toBe(FIGMA_SPEC_CENSUS.tags);
  });

  // Figma retired a whole declared surface in place rather than removing it. The atlas keeps every row,
  // because an operation the platform still serves is still reachable.
  it("keeps every deprecated operation in the registry with an ordinary disposition", () => {
    const deprecated = FIGMA_SURFACES.filter((row) => row.deprecated);

    expect(deprecated.map((row) => row.name).toSorted()).toEqual([...FIGMA_DEPRECATED_OPERATIONS].toSorted());
    expect(deprecated.length).toBe(FIGMA_SPEC_CENSUS.deprecatedOperations);
    expect(deprecated.filter((row) => row.disposition === "excluded").map((row) => row.name)).toEqual([]);
  });

  it("records the Projects tag as wholly deprecated, and no other tag", () => {
    const tags = new Set(FIGMA_SURFACES.map((row) => row.tag));
    const wholly = [...tags].filter((tag) =>
      FIGMA_SURFACES.filter((row) => row.tag === tag).every((row) => row.deprecated),
    );

    expect(wholly.toSorted()).toEqual([...FIGMA_FULLY_DEPRECATED_TAGS].toSorted());
  });

  it("fans the whole-file read out to the asset kinds its response carries nested", () => {
    const file = FIGMA_SURFACES.find((row) => row.name === "getFile")!;

    expect(file.kind).toBe("file");
    expect([...file.alsoFeeds].toSorted()).toEqual(["component", "component-set", "style"]);
  });

  // The headline finding, asserted rather than only written down: nothing in this document returns the set
  // of teams, so every team-scoped operation needs an id only the browser supplies.
  it("declares no operation whose path can be called without an identifier the caller already holds", () => {
    const teamScoped = FIGMA_SURFACES.filter((row) => row.path.includes("{team_id}"));
    const rootEnumerators = FIGMA_SURFACES.filter(
      (row) => row.disposition !== "excluded" && !row.path.includes("{") && row.kind !== "credential",
    );

    expect(teamScoped.length).toBeGreaterThan(0);
    expect(rootEnumerators.map((row) => row.name).toSorted()).toEqual([
      "getActivityLogs",
      "getAiUsageDaily",
      "getDeveloperLogs",
      "getWebhooks",
    ]);
    expect(rootEnumerators.filter((row) => row.disposition === "entity").map((row) => row.name)).toEqual([
      "getWebhooks",
    ]);
  });

  it("names three OAuth endpoints the document itself declares no path for", () => {
    const declaredPaths = new Set(FIGMA_SURFACES.map((row) => row.path));
    const leaked = FIGMA_UNDECLARED_ENDPOINTS.filter((endpoint) => declaredPaths.has(new URL(endpoint.url).pathname));

    expect(FIGMA_UNDECLARED_ENDPOINTS.length).toBe(3);
    expect(leaked.map((endpoint) => endpoint.url)).toEqual([]);
  });
});
