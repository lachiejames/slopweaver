/*
 * The per-kind grading: which surface a kind's API cell is reported under, what state the registry half's
 * outcome gives it, and which registry gaps a run raises or clears.
 */
import { describe, expect, it } from "vitest";

import { emptyHiveKindFile, HIVE_ATLAS_KINDS, type HiveAtlasKind } from "../../../../atlas/graphqlHive/model.js";
import { coverageFor, gapsFor, type HiveAcquisition, isSchemaKind } from "../../../../atlas/graphqlHive/syncGrading.js";

const AT = "2026-11-06T00:00:00.000Z";
const REASON = "no registry access token is configured for acme";

const NOT_CONFIGURED: HiveAcquisition = {
  outcome: "not-configured",
  reason: REASON,
  registry: { organizations: [], projects: [], targets: [] },
  schema: { operations: [], types: [] },
};

const UNSUPPORTED: HiveAcquisition = {
  outcome: "unsupported",
  reason: REASON,
  registry: { organizations: [], projects: [], targets: [] },
  schema: { operations: [], types: [] },
};

const SYNCED: HiveAcquisition = {
  outcome: "synced",
  reason: null,
  registry: { organizations: [], projects: [], targets: [] },
  schema: { operations: [], types: [] },
};

/** One kind's API cells from an empty stored file, projected to the fields grading decides. */
function cellsOf({
  acquisition,
  kind,
}: {
  acquisition: HiveAcquisition;
  kind: HiveAtlasKind;
}): readonly { channel: string; reason: string; role: string; scope: string; state: string; surface: string }[] {
  return coverageFor({ acquisition, at: AT, kind, stored: emptyHiveKindFile({ kind, updatedAt: AT }) }).map((cell) => ({
    channel: cell.channel,
    reason: cell.reason,
    role: cell.role,
    scope: cell.scope,
    state: cell.state,
    surface: cell.surface,
  }));
}

describe("isSchemaKind", () => {
  it("names exactly the two kinds the introspection answers", () => {
    expect(HIVE_ATLAS_KINDS.filter((kind) => isSchemaKind({ kind }))).toStrictEqual(["operation", "type"]);
  });
});

describe("coverageFor", () => {
  it("grades a schema kind synced on the schema surface whatever the registry half did", () => {
    expect(cellsOf({ acquisition: NOT_CONFIGURED, kind: "operation" })).toStrictEqual([
      {
        channel: "api",
        reason:
          "0 root field(s) and 0 named type(s) read by one introspection of Hive's own schema, which is the " +
          "whole callable surface and cannot drift from the running server",
        role: "authoritative",
        scope: "introspected-schema",
        state: "synced",
        surface: "registry-graphql-schema",
      },
    ]);
  });

  it("gives a registry kind the registry half's own state and reason", () => {
    expect(cellsOf({ acquisition: NOT_CONFIGURED, kind: "organization" })).toStrictEqual([
      {
        channel: "api",
        reason: REASON,
        role: "authoritative",
        scope: "registry-hierarchy",
        state: "not-configured",
        surface: "registry-content",
      },
    ]);
  });

  it("maps an unsupported registry query to an unavailable cell", () => {
    expect(cellsOf({ acquisition: UNSUPPORTED, kind: "target" }).map((cell) => cell.state)).toStrictEqual([
      "unavailable",
    ]);
  });

  it("reports the page kind on the console map as discovery", () => {
    expect(cellsOf({ acquisition: NOT_CONFIGURED, kind: "page" })).toStrictEqual([
      {
        channel: "api",
        reason: `${REASON} — every console route is expanded from those slugs`,
        role: "discovery",
        scope: "declared-console-routes",
        state: "not-configured",
        surface: "console-page-map",
      },
    ]);
  });
});

describe("gapsFor", () => {
  it("says only the scoped console routes are missing on the page kind", () => {
    const gaps = gapsFor({
      acquisition: NOT_CONFIGURED,
      at: AT,
      kind: "page",
      stored: emptyHiveKindFile({ kind: "page", updatedAt: AT }),
    });
    expect(gaps.map((gap) => ({ condition: gap.condition, reason: gap.reason, scope: gap.scope }))).toStrictEqual([
      {
        condition: "registry-not-configured",
        reason:
          "only the root-scope console addresses are declared: every organisation-, project- and target-scoped " +
          `route expands from registry slugs this run could not read. ${REASON}`,
        scope: "graphql-hive:page",
      },
    ]);
  });

  it("raises the unsupported condition with the registry half's reason on a registry kind", () => {
    const gaps = gapsFor({
      acquisition: UNSUPPORTED,
      at: AT,
      kind: "project",
      stored: emptyHiveKindFile({ kind: "project", updatedAt: AT }),
    });
    expect(gaps.map((gap) => ({ condition: gap.condition, reason: gap.reason, scope: gap.scope }))).toStrictEqual([
      { condition: "registry-query-unsupported", reason: REASON, scope: "graphql-hive:project" },
    ]);
  });

  it("clears both registry conditions once the registry half syncs", () => {
    const empty = emptyHiveKindFile({ kind: "target", updatedAt: AT });
    const raised = [
      ...gapsFor({ acquisition: UNSUPPORTED, at: AT, kind: "target", stored: empty }),
      ...gapsFor({ acquisition: NOT_CONFIGURED, at: AT, kind: "target", stored: empty }),
    ];
    expect(raised.map((gap) => gap.condition)).toStrictEqual(["registry-query-unsupported", "registry-not-configured"]);
    expect(gapsFor({ acquisition: SYNCED, at: AT, kind: "target", stored: { ...empty, gaps: raised } })).toStrictEqual(
      [],
    );
  });
});
