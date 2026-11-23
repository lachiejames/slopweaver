/**
 * How one kind is graded from the two acquisitions: the coverage cell it carries and the gaps it raises.
 *
 * `sync.ts` acquires, merges and publishes; everything here decides what each kind's file SAYS about the
 * run that wrote it. The schema kinds publish a `synced` cell from the introspection, the registry kinds
 * carry the registry half's own state, and a registry half that did not sync raises a gap per kind, so
 * the open question is on the gap list rather than inferable from an absence. Pure: no read, no write.
 */
import { succeededHiveCoverageCell } from "./coverage.js";
import { openHiveGap } from "./gaps.js";
import type { HiveAtlasKind, HiveAtlasKindFile } from "./model.js";
import type { HiveRegistryHalf, HiveRegistryOutcome } from "./registryAcquire.js";
import type { HiveSchemaSurface } from "./schemaRead.js";

/**
 * The surface name the introspected schema's coverage is reported under.
 *
 * @internal
 */
export const HIVE_SCHEMA_SURFACE = "registry-graphql-schema";

/**
 * The surface name the registry's own content is reported under.
 *
 * @internal
 */
export const HIVE_REGISTRY_SURFACE = "registry-content";

/**
 * The surface name the declared console page map is reported under, before any walk has run.
 *
 * @internal
 */
export const HIVE_CONSOLE_MAP_SURFACE = "console-page-map";

/** What both acquisitions produced, before anything is merged or published. */
export type HiveAcquisition = HiveRegistryHalf & { readonly schema: HiveSchemaSurface };

/**
 * Whether a kind comes from the introspection rather than from the content query.
 *
 * @returns `true` for `operation` and `type`, the two kinds the introspection alone answers
 */
export function isSchemaKind({ kind }: { kind: HiveAtlasKind }): boolean {
  return kind === "operation" || kind === "type";
}

/** The surface one kind's coverage cell is reported under. */
function surfaceFor({ kind }: { kind: HiveAtlasKind }): string {
  if (isSchemaKind({ kind })) {
    return HIVE_SCHEMA_SURFACE;
  }
  return kind === "page" ? HIVE_CONSOLE_MAP_SURFACE : HIVE_REGISTRY_SURFACE;
}

/**
 * This run's coverage for one kind, replacing only the cell this surface owns.
 *
 * @returns the kind's stored cells with this surface's API cell replaced by this run's
 */
export function coverageFor({
  acquisition,
  kind,
  stored,
  at,
}: {
  acquisition: HiveAcquisition;
  kind: HiveAtlasKind;
  stored: HiveAtlasKindFile;
  at: string;
}): HiveAtlasKindFile["coverage"] {
  const surface = surfaceFor({ kind });
  const kept = stored.coverage.filter((cell) => cell.surface !== surface || cell.channel !== "api");
  if (isSchemaKind({ kind })) {
    return [
      ...kept,
      succeededHiveCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason:
          `${String(acquisition.schema.operations.length)} root field(s) and ` +
          `${String(acquisition.schema.types.length)} named type(s) read by one introspection of Hive's own ` +
          "schema, which is the whole callable surface and cannot drift from the running server",
        role: "authoritative",
        scope: "introspected-schema",
        state: "synced",
        surface,
      }),
    ];
  }
  return [...kept, registryCell({ acquisition, at, kind, surface })];
}

/** The registry half's own cell, whose STATE is the whole point of grading the two acquisitions apart. */
function registryCell({
  acquisition,
  kind,
  surface,
  at,
}: {
  acquisition: HiveAcquisition;
  kind: HiveAtlasKind;
  surface: string;
  at: string;
}): HiveAtlasKindFile["coverage"][number] {
  const states: Readonly<Record<HiveRegistryOutcome, HiveAtlasKindFile["coverage"][number]["state"]>> = {
    failed: "unreadable",
    "not-configured": "not-configured",
    synced: "synced",
    unsupported: "unavailable",
  };
  const reason = registryCellReason({ acquisition });
  return succeededHiveCoverageCell({
    artifacts: [],
    at,
    channel: "api",
    reason: kind === "page" ? `${reason} — every console route is expanded from those slugs` : reason,
    role: kind === "page" ? "discovery" : "authoritative",
    scope: kind === "page" ? "declared-console-routes" : "registry-hierarchy",
    state: states[acquisition.outcome],
    surface,
  });
}

/** What the registry half's cell says: what it read when it synced, and its own reason when it did not. */
function registryCellReason({ acquisition }: { acquisition: HiveAcquisition }): string {
  if (acquisition.outcome !== "synced") {
    return acquisition.reason;
  }
  const { organizations, projects, targets } = acquisition.registry;
  return (
    `${String(organizations.length)} organisation(s), ${String(projects.length)} project(s) and ` +
    `${String(targets.length)} target(s) read from the registry`
  );
}

/**
 * This run's gaps for one kind, replacing only the conditions this run actually judged.
 *
 * @returns the kind's stored gaps with the registry conditions cleared, plus this run's own when it raised one
 */
export function gapsFor({
  acquisition,
  kind,
  stored,
  at,
}: {
  acquisition: HiveAcquisition;
  kind: HiveAtlasKind;
  stored: HiveAtlasKindFile;
  at: string;
}): HiveAtlasKindFile["gaps"] {
  if (isSchemaKind({ kind }) || acquisition.outcome === "synced") {
    return stored.gaps.filter(
      (gap) => gap.condition !== "registry-not-configured" && gap.condition !== "registry-query-unsupported",
    );
  }
  const condition = acquisition.outcome === "unsupported" ? "registry-query-unsupported" : "registry-not-configured";
  const kept = stored.gaps.filter((gap) => gap.condition !== condition);
  return [
    ...kept,
    openHiveGap({
      at,
      condition,
      kind,
      reason: gapReason({ kind, reason: acquisition.reason }),
      // Scoped by KIND so the four gaps this raises are four distinct ids rather than one id repeated
      // across four files — a gap list where two rows share an id cannot be reconciled row by row.
      scope: `graphql-hive:${kind}`,
      surfaces: ["api"],
    }),
  ];
}

/**
 * What one raised gap says, which differs for the page kind.
 *
 * A registry kind's gap is simply the registry half's own reason. The page kind's is not: its root-scope
 * addresses ARE published, and only the scoped ones are missing, so repeating the registry's reason alone
 * would read as "no console address is known" when two of them are.
 *
 * @param reason the registry half's own reason, which exists on every run that raises a gap
 * @param kind the kind this gap hangs off
 * @returns the reason to record
 */
function gapReason({ reason, kind }: { reason: string; kind: HiveAtlasKind }): string {
  if (kind !== "page") {
    return reason;
  }
  return (
    "only the root-scope console addresses are declared: every organisation-, project- and target-scoped " +
    `route expands from registry slugs this run could not read. ${reason}`
  );
}
