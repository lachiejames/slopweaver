/**
 * The three kind files the API-surface sync publishes — `method`, `app` and `role` — each with only its own
 * coverage cells replaced, and the four `method` cells it owns — split out of `sync.ts`, which is the publish
 * shell around them.
 */
import { succeededTrelicaCoverageCell, withTrelicaCoverageCell } from "./coverage.js";
import type { TrelicaFirstPartyRun } from "./firstPartyRun.js";
import { TRELICA_CALLS } from "./inventory.js";
import {
  trelicaEntityFileWith as entityFileWith,
  storedTrelicaKindFile as storedKindFile,
  TRELICA_FIRST_PARTY_SURFACE,
} from "./kindFiles.js";
import type { TrelicaAtlasGap, TrelicaAtlasKindFile, TrelicaCoverageCell } from "./model.js";
import type { TrelicaPublishedSurface } from "./publishedSpec.js";
import type { TrelicaAtlasSnapshot } from "./store.js";

/**
 * The surface name the published API's declared MAP is reported under.
 *
 * @internal
 */
export const TRELICA_PUBLISHED_SURFACE = "published-api";

/**
 * The surface name the published API's DATA reachability is reported under.
 *
 * @internal
 */
export const TRELICA_PUBLISHED_DATA_SURFACE = "published-api-data";

/**
 * The surface name the deliberately-unstored voluminous families are declared under.
 *
 * @internal
 */
export const TRELICA_VOLUMINOUS_SURFACE = "voluminous-families";

/** Every kind's merged entity list for one run, and how many of each this run observed fresh. */
export interface TrelicaMergedChannels {
  readonly methods: readonly TrelicaAtlasKindFile["entities"][number][];
  readonly apps: readonly TrelicaAtlasKindFile["entities"][number][];
  readonly roles: readonly TrelicaAtlasKindFile["entities"][number][];
  readonly publishedMethods: number;
  readonly freshApps: number;
  readonly freshRoles: number;
}

/**
 * The three kind files this sync publishes, each with only its own coverage cells replaced.
 *
 * @returns the `method`, `app` and `role` files to publish, every other cell on each left as stored
 */
export function apiKindFiles({
  snapshot,
  storedMethods,
  merged,
  gaps,
  surface,
  run,
  at,
}: {
  snapshot: TrelicaAtlasSnapshot;
  storedMethods: TrelicaAtlasKindFile;
  merged: TrelicaMergedChannels;
  gaps: readonly TrelicaAtlasGap[];
  surface: TrelicaPublishedSurface;
  run: TrelicaFirstPartyRun;
  at: string;
}): { methodFile: TrelicaAtlasKindFile; appFile: TrelicaAtlasKindFile; roleFile: TrelicaAtlasKindFile } {
  const refused = ({ callId }: { callId: string }): "deferred" | "synced" =>
    run.failures.some((failure) => failure.callId === callId) ? "deferred" : "synced";
  return {
    appFile: entityFileWith({
      at,
      entities: merged.apps,
      reason: `${String(merged.freshApps)} application(s) across the organisation-wide inventory and the end-user catalogue`,
      state: refused({ callId: TRELICA_CALLS.appInventory.id }),
      stored: storedKindFile({ at, kind: "app", snapshot }),
    }),
    methodFile: methodFileWith({ at, entities: merged.methods, gaps, run, stored: storedMethods, surface }),
    roleFile: entityFileWith({
      at,
      entities: merged.roles,
      reason: `${String(merged.freshRoles)} role(s) this tenant defines`,
      state: refused({ callId: TRELICA_CALLS.roles.id }),
      stored: storedKindFile({ at, kind: "role", snapshot }),
    }),
  };
}

/** The four cells this sync owns on the `method` kind, in the order a reader wants them. */
// Splitting this would hide that these four are the complete set, and that each is REPLACED rather than
// appended onto whatever the walk left behind.
// max-lines-exempt: a flat table of the four coverage cells this sync owns, one entry per cell
function syncMethodCells({
  surface,
  run,
  at,
}: {
  surface: TrelicaPublishedSurface;
  run: TrelicaFirstPartyRun;
  at: string;
}): readonly TrelicaCoverageCell[] {
  const operations = surface.documents.reduce((total, document) => total + document.operations.length, 0);
  const attempted = String(surface.documents.length + surface.unreadable.length);
  return [
    succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "published-api",
      reason: `${String(operations)} operation(s) across ${String(surface.documents.length)} of ${attempted} document(s) the vendor's own client names`,
      role: "authoritative",
      scope: "declared-operations",
      state: surface.unreadable.length === 0 ? "synced" : "deferred",
      surface: TRELICA_PUBLISHED_SURFACE,
    }),
    succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "published-api",
      reason:
        "the published API's DATA is not reachable from this installation: it authenticates an OAuth2 client " +
        "held nowhere here, and answers 403 to the session cookie the first-party channel uses. The map above " +
        "is complete and says nothing about this",
      role: "authoritative",
      scope: "published-api-records",
      state: "not-configured",
      surface: TRELICA_PUBLISHED_DATA_SURFACE,
    }),
    succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "first-party-api",
      reason:
        `${String(run.results.length)} of ${String(run.results.length + run.failures.length)} admitted call(s) ` +
        "answered, each one a read this account's own roles already open",
      role: "authoritative",
      scope: "admitted-calls",
      state: run.failures.length === 0 ? "synced" : "deferred",
      surface: TRELICA_FIRST_PARTY_SURFACE,
    }),
    succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "first-party-api",
      reason:
        "spend transactions and audit activity are reached and deliberately not stored row by row — they are " +
        "time-series observations rather than configuration, so the atlas records that the family exists and " +
        "holds the per-application trailing-year total instead of a row per record",
      role: "discovery",
      scope: "spend-transactions-and-audit-activity",
      state: "excluded",
      surface: TRELICA_VOLUMINOUS_SURFACE,
    }),
  ];
}

/** The method kind with all four of this sync's cells replaced and the walk's own left alone. */
function methodFileWith({
  stored,
  entities,
  gaps,
  surface,
  run,
  at,
}: {
  stored: TrelicaAtlasKindFile;
  entities: readonly TrelicaAtlasKindFile["entities"][number][];
  gaps: readonly TrelicaAtlasGap[];
  surface: TrelicaPublishedSurface;
  run: TrelicaFirstPartyRun;
  at: string;
}): TrelicaAtlasKindFile {
  const coverage = syncMethodCells({ at, run, surface }).reduce(
    (cells: readonly TrelicaCoverageCell[], replacement) => withTrelicaCoverageCell({ cells, replacement }),
    stored.coverage,
  );
  return { ...stored, coverage: [...coverage], entities: [...entities], gaps: [...gaps], updatedAt: at };
}
