/**
 * The Jam compiled channel folded onto what the store already holds — every kind's next file, and the manifest
 * stamped over them.
 *
 * Pure, the same way `syncGaps.ts` is: the held generation arrives as a value, and `sync.ts` keeps the control
 * invariant, the read, the lock and the write.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { assembleWalkKind } from "../kit/walkPublish.js";

import { failedJamCoverageCell, succeededJamCoverageCell } from "./coverage.js";
import { type JamAtlasError, JamAtlasErrors } from "./errors.js";
import { reconcileJamGaps } from "./gaps.js";
import { JAM_CENSUS } from "./generated/specLock.js";
import { JAM_INTEGRATIONS, JAM_OPERATIONS, JAM_ROUTES, JAM_SCOPES } from "./generated/surfaces.js";
import { mergeJamChannel } from "./merge.js";
import {
  emptyJamKindFile,
  initialJamManifest,
  JAM_INTEGRATION_KIND,
  JAM_OPERATION_KIND,
  JAM_PAGE_KIND,
  JAM_ROUTE_KIND,
  JAM_SCOPE_KIND,
  type JamAtlasEntity,
  type JamAtlasKind,
  type JamAtlasKindFile,
  type JamAtlasManifest,
  type JamCoverageCell,
} from "./model.js";
import { projectJamIntegration, projectJamOperation, projectJamRoute, projectJamScope } from "./projection.js";
import {
  JAM_BROWSER_UNBLOCKED_BY,
  JAM_MCP_SURFACE,
  JAM_MCP_UNBLOCKED_BY,
  JAM_ROUTE_SURFACE,
  JAM_SPEC_SURFACE,
  JAM_WEB_APP_SURFACE,
} from "./surfaces.js";
import { compiledGaps, compiledRechecks } from "./syncGaps.js";

/**
 * Every entity the compiled channel contributes to one kind.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, sorted by provider key so two runs at the same instant write identical bytes
 */
function compiledEntities({ kind, at }: { kind: JamAtlasKind; at: string }): readonly JamAtlasEntity[] {
  const built = ((): readonly JamAtlasEntity[] => {
    if (kind === JAM_OPERATION_KIND) {
      return JAM_OPERATIONS.map((row) => projectJamOperation({ at, row }));
    }
    if (kind === JAM_SCOPE_KIND) {
      return JAM_SCOPES.map((row) => projectJamScope({ at, row }));
    }
    if (kind === JAM_ROUTE_KIND) {
      return JAM_ROUTES.map((row) => projectJamRoute({ at, row }));
    }
    if (kind === JAM_INTEGRATION_KIND) {
      return JAM_INTEGRATIONS.map((row) => projectJamIntegration({ at, row }));
    }
    return [];
  })();
  return [...built].toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * Whether the compiled channel fills this kind at all, or defers it to another channel.
 *
 * One predicate for the coverage cell's state and for the file's clock, because they are the same fact: a
 * kind the compiled channel defers keeps the clock of whichever channel last filled it. Stamping this run's
 * instant on a deferred kind is what `kit/manifestClock.ts` refuses as "two clocks" — the file would say now
 * while the status published beside it still, correctly, reports the walk's success. `notion/sync.ts` and
 * `inngest/sync.ts` carry the same fix, each because the unfixed shape refuses every sync.
 */
function compiledFillsKind({ kind }: { kind: JamAtlasKind }): boolean {
  return kind !== JAM_PAGE_KIND;
}

/**
 * Which surface a kind's compiled coverage is reported under.
 *
 * `route` is its own surface because the probe is a different acquisition with its own failure mode — a
 * table can compile perfectly while every host is unreachable — and grading the two together would let one
 * hide the other.
 */
function compiledSurfaceFor({ kind }: { kind: JamAtlasKind }): typeof JAM_SPEC_SURFACE | typeof JAM_ROUTE_SURFACE {
  return kind === JAM_ROUTE_KIND ? JAM_ROUTE_SURFACE : JAM_SPEC_SURFACE;
}

/** The reason one kind's compiled coverage cell carries, naming what was actually counted. */
function compiledReasonFor({ kind, entities }: { kind: JamAtlasKind; entities: number }): string {
  if (kind === JAM_ROUTE_KIND) {
    return (
      `${String(entities)} route(s) probed with no credential across two hosts: ` +
      `${String(JAM_CENSUS.routesAnswered)} answered, ${String(JAM_CENSUS.routesRoutedNoLeaf)} reached the ` +
      `application router with no handler, ${String(JAM_CENSUS.routesNotRouted)} were never routed at all. ` +
      "The denominator is a table in this repository rather than a list Jam publishes — see the permanently " +
      "open `route-denominator-is-local` gap"
    );
  }
  if (kind === JAM_PAGE_KIND) {
    return "the compiled channel has nothing to say about a browser page; the walk is what fills this kind";
  }
  return `${String(entities)} ${kind}(s) compiled from Jam's own published documents, with no credential and no request`;
}

/**
 * The two cells that say an unreached channel is unreached, for a kind nothing has reached it on.
 *
 * Returned rather than written so {@link compiledKindFile} can drop the one whose channel a walk has since
 * filled: a `not-configured` cell is a claim about today, and the stored cell is the one with evidence
 * behind it.
 */
function unreachedChannelCells(): readonly JamCoverageCell[] {
  return [
    failedJamCoverageCell({
      channel: "api",
      previous: null,
      reason:
        "no Jam access token exists in this installation, so the MCP resource has never been called and " +
        "nothing of this workspace has been read",
      role: "authoritative",
      scope: "jam",
      state: "not-configured",
      surface: JAM_MCP_SURFACE,
      unblockedBy: JAM_MCP_UNBLOCKED_BY,
    }),
    failedJamCoverageCell({
      channel: "browser",
      previous: null,
      reason: "no page has been visited or witnessed in the owner's own Chrome",
      role: "authoritative",
      scope: "jam",
      state: "not-configured",
      surface: JAM_WEB_APP_SURFACE,
      unblockedBy: JAM_BROWSER_UNBLOCKED_BY,
    }),
  ];
}

/**
 * One kind's next file: this run's compiled channel folded onto whatever the store already holds.
 *
 * `assembleWalkKind` is the kit's own control flow and is channel-agnostic despite its name — merge,
 * reconcile, abort on the first failure, then replace THIS surface's coverage cell and carry every other
 * one forward. Reusing it here is what stops the sync and the walk from having two different answers to the
 * same question, which is how one of them came to have no answer at all.
 *
 * @param kind the kind to build
 * @param stored the kind file as the store already holds it, empty on a first publish
 * @param at this run's ISO timestamp
 * @returns the file, complete, or why this run cannot be folded onto what is held
 */
function compiledKindFile({
  kind,
  stored,
  at,
}: {
  kind: JamAtlasKind;
  stored: JamAtlasKindFile;
  at: string;
}): Result<JamAtlasKindFile, JamAtlasError> {
  const entities = compiledEntities({ at, kind });
  const fields = assembleWalkKind({
    at,
    cell: succeededJamCoverageCell({
      artifacts: [],
      at,
      channel: "compiled",
      reason: compiledReasonFor({ entities: entities.length, kind }),
      role: kind === JAM_ROUTE_KIND ? "discovery" : "authoritative",
      scope: "jam",
      state: compiledFillsKind({ kind }) ? "synced" : "deferred",
      surface: compiledSurfaceFor({ kind }),
    }),
    merge: () => mergeJamChannel({ at, channel: "compiled", observed: entities, stored: stored.entities }),
    // The reconciliation accumulates, so a gap the walk opened survives a sync — and the rechecks are what
    // keep that from being one-way: this run recomputed every condition the compiled channel can raise, so
    // one it did NOT raise is genuinely answered and closes. See {@link compiledRechecks}.
    reconcile: () =>
      reconcileJamGaps({
        at,
        observed: compiledGaps({ at, kind }),
        rechecks: compiledRechecks({ kind }),
        runFailed: false,
        stored: stored.gaps,
      }),
    stored,
    surface: compiledSurfaceFor({ kind }),
  });
  if (fields.isErr()) {
    return err(JamAtlasErrors.storeUnwritable({ reasons: fields.error }));
  }
  const covered = new Set(fields.value.coverage.map((cell) => cell.surface));
  const unreached = unreachedChannelCells().filter((cell) => !covered.has(cell.surface));
  const updatedAt = compiledFillsKind({ kind }) ? at : stored.updatedAt;
  return ok({ ...stored, ...fields.value, coverage: [...fields.value.coverage, ...unreached], updatedAt });
}

/**
 * Everything a fold needs to know about what is already published.
 *
 * Named rather than inlined because it is the one contract `buildJamGeneration` and its caller share, and
 * spelling it in both signatures is how the two drift. `null` on either member is a first publish.
 */
export interface JamHeldGeneration {
  /** Each kind's file as the store holds it; a kind absent or `null` has never been published. */
  readonly files: Readonly<Partial<Record<JamAtlasKind, JamAtlasKindFile | null>>>;
  /** The manifest as the store holds it, or `null` before anything has been published. */
  readonly manifest: JamAtlasManifest | null;
}

/** The kind file to fold onto: what is held, or an empty one on a first publish. */
function heldFile({ held, kind, at }: { held: JamHeldGeneration; kind: JamAtlasKind; at: string }): JamAtlasKindFile {
  const stored = held.files[kind];
  if (stored == null) {
    return emptyJamKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/**
 * Every kind's next file, each one this run's compiled channel folded onto what is held.
 *
 * Written out per kind rather than looped because the return is a TOTAL record over the kinds and a loop
 * cannot prove it filled every key — the same reason `browserSurface.ts` names its three.
 *
 * @param at this run's ISO timestamp
 * @param held what the store already holds
 * @returns all five files, or the first reason one cannot be folded
 */
export function foldedKindFiles({
  at,
  held,
}: {
  at: string;
  held: JamHeldGeneration;
}): Result<Record<JamAtlasKind, JamAtlasKindFile>, JamAtlasError> {
  const integration = compiledKindFile({
    at,
    kind: JAM_INTEGRATION_KIND,
    stored: heldFile({ at, held, kind: JAM_INTEGRATION_KIND }),
  });
  if (integration.isErr()) {
    return err(integration.error);
  }
  const operation = compiledKindFile({
    at,
    kind: JAM_OPERATION_KIND,
    stored: heldFile({ at, held, kind: JAM_OPERATION_KIND }),
  });
  if (operation.isErr()) {
    return err(operation.error);
  }
  const page = compiledKindFile({ at, kind: JAM_PAGE_KIND, stored: heldFile({ at, held, kind: JAM_PAGE_KIND }) });
  if (page.isErr()) {
    return err(page.error);
  }
  const route = compiledKindFile({ at, kind: JAM_ROUTE_KIND, stored: heldFile({ at, held, kind: JAM_ROUTE_KIND }) });
  if (route.isErr()) {
    return err(route.error);
  }
  const scope = compiledKindFile({ at, kind: JAM_SCOPE_KIND, stored: heldFile({ at, held, kind: JAM_SCOPE_KIND }) });
  if (scope.isErr()) {
    return err(scope.error);
  }
  return ok({
    integration: integration.value,
    operation: operation.value,
    page: page.value,
    route: route.value,
    scope: scope.value,
  });
}

/** The manifest as it stood before this run: what is held, or an empty one on a first publish. */
function heldManifest({ held, at }: { held: JamHeldGeneration; at: string }): JamAtlasManifest {
  const stored = held.manifest;
  if (stored == null) {
    return initialJamManifest({ updatedAt: at });
  }
  return stored;
}

/**
 * The manifest this run publishes: a success on every kind the compiled channel fills, and the stored
 * success carried forward on the one it defers.
 *
 * `page` records this run's ATTEMPT and takes its success from the store, never from this run: the compiled
 * channel writes the kind's file — the disclosure and denominator gaps, and a `not-configured` cell for each
 * channel nothing has reached — while claiming no success of its own. Before any walk that is an attempt
 * with no success, the combination `store.ts`'s `gradeNeverSucceeded` exists to tell apart from a
 * half-written first generation, and what keeps the browser surface honestly `declared-unfilled`. After one,
 * the walk's success is what stands, and {@link compiledFillsKind} keeps the file's own clock beside it.
 *
 * @param files this run's folded kind files, which is where every entity count comes from
 * @param held what the store already holds
 * @param at this run's ISO timestamp
 * @returns the manifest to publish
 */
export function syncManifest({
  files,
  held,
  at,
}: {
  files: Record<JamAtlasKind, JamAtlasKindFile>;
  held: JamHeldGeneration;
  at: string;
}): JamAtlasManifest {
  const attempt = { at, outcome: "ok" as const, reasons: [] };
  const base = heldManifest({ at, held });
  const stamped = ({
    kind,
  }: {
    kind: JamAtlasKind;
  }): { digest: null; entityCount: number; lastAttempt: typeof attempt; lastSuccessAt: string } => ({
    digest: null,
    entityCount: files[kind].entities.length,
    lastAttempt: attempt,
    lastSuccessAt: at,
  });
  return {
    ...base,
    kinds: {
      integration: stamped({ kind: JAM_INTEGRATION_KIND }),
      operation: stamped({ kind: JAM_OPERATION_KIND }),
      page: {
        digest: null,
        entityCount: files.page.entities.length,
        lastAttempt: attempt,
        lastSuccessAt: base.kinds.page.lastSuccessAt,
      },
      route: stamped({ kind: JAM_ROUTE_KIND }),
      scope: stamped({ kind: JAM_SCOPE_KIND }),
    },
    updatedAt: at,
  };
}
