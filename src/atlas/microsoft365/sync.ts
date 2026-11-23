/**
 * `atlas microsoft365 sync` — publish the COMPILED surface: every operation the pinned Microsoft Graph
 * specification declares, onto each kind's `compiled` channel.
 *
 * ## What this verb can and cannot claim
 *
 * It reads a public document and reaches no tenant, so a `synced` cell here says the pinned specification was
 * compiled in full and says NOTHING about what this installation may call. The `graph-api` surface stays
 * `declared-unfilled` and every kind carries a `not-configured` cell for it, because reading a compiled
 * operation as a capability is the single most available mistake with this atlas and a coverage cell is where
 * it has to be refused.
 *
 * ## The census assertion is aimed at THIS code, not at Microsoft
 *
 * The document is pinned to an immutable commit and digest-verified before it is parsed, so its own numbers
 * cannot move. The assertion below therefore catches a change in the READER — a `$ref` that stopped being
 * resolved, an HTTP method quietly dropped from the walk — which is the failure a digest cannot see and the
 * one that actually happened once already during this atlas's construction: parameters arriving by `$ref`
 * were skipped, and every one of the 9,378 GETs reported as unpageable.
 *
 * ## Three gaps are raised on every successful run, and that is correct
 *
 * `graph-credential-absent`, `beta-surface-not-compiled` and one `browser-page-not-attempted` per declared
 * console page. None of them can be closed by anything this verb does, and an atlas whose gap list emptied
 * because the only pass that could run had run would be reporting completeness it does not have.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { buildCompiledKindFile, countByDisposition, groupRowsByKind, unfiredRuleIds } from "../kit/compiledSync.js";

import { MICROSOFT365_BROWSER_PAGES } from "./browserPages.js";
import { failedMicrosoft365CoverageCell, succeededMicrosoft365CoverageCell } from "./coverage.js";
import { declaredPageGaps } from "./declaredPageGaps.js";
import { microsoft365DispositionRuleIds } from "./dispositions.js";
import { Microsoft365AtlasErrors, microsoft365AtlasErrorLines } from "./errors.js";
import { reconcileMicrosoft365Gaps } from "./gaps.js";
import { mergeMicrosoft365Channel } from "./merge.js";
import {
  emptyMicrosoft365KindFile,
  initialMicrosoft365Manifest,
  MICROSOFT365_KINDS,
  MICROSOFT365_PAGE_KIND,
  type Microsoft365AtlasKindFile,
  type Microsoft365AtlasManifest,
  type Microsoft365Disposition,
  type Microsoft365Kind,
} from "./model.js";
import { projectMicrosoft365Operations } from "./projection.js";
import { MICROSOFT365_SPEC_PIN } from "./specLock.js";
import { type Microsoft365OperationRow, readMicrosoft365Surface } from "./specRead.js";
import { loadMicrosoft365Spec, type SpecFetchLike } from "./specSource.js";
import {
  type Microsoft365AtlasPaths,
  type Microsoft365AtlasSnapshot,
  publishMicrosoft365Atlas,
  readMicrosoft365Atlas,
} from "./store.js";
import { microsoft365CensusMismatch } from "./syncCensus.js";
import { operationGaps } from "./syncGaps.js";

/**
 * The surface name the compiled channel's coverage is reported under. Matches the descriptor's own.
 *
 * @internal
 */
export const MICROSOFT365_SPEC_SURFACE = "graph-specification";

/**
 * The surface name the live Graph channel's coverage is reported under, filled or not.
 *
 * @internal
 */
export const MICROSOFT365_API_SURFACE = "graph-api";

/**
 * The surface name the browser walk's coverage is reported under.
 *
 * @internal
 */
export const MICROSOFT365_CONSOLE_SURFACE = "admin-consoles";

/** What a sync did, which is what `--json` prints. */
export interface Microsoft365SyncOutcome {
  readonly specOrigin: "cache" | "fetch";
  readonly specPath: string;
  readonly operationCount: number;
  readonly dispositionCounts: Readonly<Record<Microsoft365Disposition, number>>;
  readonly kindCount: number;
  readonly declaredPageCount: number;
  readonly written: readonly string[];
}

/**
 * Compile the pinned specification and publish it.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param fetchImpl the HTTP seam used only when the pinned document is not already cached
 * @returns what was published, or every reason it could not be
 */
export async function syncMicrosoft365CompiledSurface({
  paths,
  at,
  fetchImpl,
}: {
  paths: Microsoft365AtlasPaths;
  at: string;
  fetchImpl?: SpecFetchLike;
}): Promise<Result<Microsoft365SyncOutcome>> {
  const spec = await loadMicrosoft365Spec(
    fetchImpl === undefined ? { root: paths.directory } : { fetchImpl, root: paths.directory },
  );
  if (spec.isErr()) {
    return err(spec.error);
  }
  const surface = readMicrosoft365Surface({ text: spec.value.text });
  if (surface.isErr()) {
    return err(surface.error);
  }
  const censusFailure = microsoft365CensusMismatch({ census: surface.value.census });
  if (censusFailure !== null) {
    return err(censusFailure);
  }
  if (surface.value.unknownRoots.length > 0) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.rootsUnknown(surface.value) }));
  }
  return publishCompiled({ at, paths, rows: surface.value.rows, spec: spec.value });
}

/** Read the generation, merge the compiled channel onto it, and publish. */
function publishCompiled({
  paths,
  at,
  rows,
  spec,
}: {
  paths: Microsoft365AtlasPaths;
  at: string;
  rows: readonly Microsoft365OperationRow[];
  spec: { origin: "cache" | "fetch"; path: string };
}): Result<Microsoft365SyncOutcome> {
  const snapshot = readMicrosoft365Atlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const built = buildKindFiles({ at, rows, snapshot: snapshot.value });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishMicrosoft365Atlas({
    derivedFrom: snapshot.value.manifest,
    files: built.value.files,
    manifest: syncManifest({ at, counts: built.value.counts, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    declaredPageCount: MICROSOFT365_BROWSER_PAGES.length,
    dispositionCounts: dispositionCounts({ rows }),
    kindCount: MICROSOFT365_KINDS.length,
    operationCount: rows.length,
    specOrigin: spec.origin,
    specPath: spec.path,
    written: published.value,
  });
}

/**
 * Build every kind's next file from what this run compiled and what the store already holds.
 *
 * Split out of {@link publishCompiled} because the two are different jobs: this one is pure over the snapshot
 * it is handed, and that one is the read-check-write shell around it.
 */
function buildKindFiles({
  rows,
  snapshot,
  at,
}: {
  rows: readonly Microsoft365OperationRow[];
  snapshot: Microsoft365AtlasSnapshot;
  at: string;
}): Result<{
  files: Partial<Record<Microsoft365Kind, Microsoft365AtlasKindFile>>;
  counts: Readonly<Record<Microsoft365Kind, number>>;
}> {
  const byKind = groupRowsByKind({ kindOf: (row: Microsoft365OperationRow) => row.kind, rows });
  const files: Partial<Record<Microsoft365Kind, Microsoft365AtlasKindFile>> = {};
  const counts: Partial<Record<Microsoft365Kind, number>> = {};
  const deadRules = unfiredRuleIds({
    declared: microsoft365DispositionRuleIds(),
    ruleIdOf: (row: Microsoft365OperationRow) => row.dispositionRuleId,
    rows,
  });
  for (const kind of MICROSOFT365_KINDS) {
    const stored = snapshot.files[kind] ?? emptyMicrosoft365KindFile({ kind, updatedAt: at });
    const next =
      kind === MICROSOFT365_PAGE_KIND
        ? declaredPagesFile({ at, stored })
        : operationKindFile({ at, deadRules, kind, rows: byKind.get(kind) ?? [], stored });
    if (next.isErr()) {
      return err(next.error);
    }
    files[kind] = next.value;
    counts[kind] = next.value.entities.length;
  }
  // `as`: every kind was just visited, so the partial is complete. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ counts: counts as Record<Microsoft365Kind, number>, files });
}

/** One operation kind's next file: the compiled channel merged on, its two coverage cells, and its gaps. */
function operationKindFile({
  kind,
  rows,
  stored,
  deadRules,
  at,
}: {
  kind: Microsoft365Kind;
  rows: readonly Microsoft365OperationRow[];
  stored: Microsoft365AtlasKindFile;
  deadRules: readonly string[];
  at: string;
}): Result<Microsoft365AtlasKindFile> {
  return buildCompiledKindFile({
    at,
    coverage: operationCoverage({ at, rows, stored }),
    kind,
    mergeChannel: ({ stored: held, observed }) =>
      mergeMicrosoft365Channel({ at, channel: "compiled", observed, stored: held }),
    observed: projectMicrosoft365Operations({ at, rows }),
    observedGaps: operationGaps({ at, deadRules, kind }),
    reconcile: ({ stored: held, observed, rechecks }) =>
      reconcileMicrosoft365Gaps({ at, observed, rechecks, runFailed: false, stored: held }),
    stored,
  });
}

/** How many operations this run gave each disposition, over the three members this atlas declares. */
function dispositionCounts({
  rows,
}: {
  rows: readonly Microsoft365OperationRow[];
}): Readonly<Record<Microsoft365Disposition, number>> {
  return countByDisposition({
    dispositionOf: (row) => row.disposition,
    empty: { excluded: 0, reachable: 0, voluminous: 0 },
    rows,
  });
}

/** The two coverage cells every operation kind carries: what was compiled, and what has never been called. */
function operationCoverage({
  rows,
  stored,
  at,
}: {
  rows: readonly Microsoft365OperationRow[];
  stored: Microsoft365AtlasKindFile;
  at: string;
}): Microsoft365AtlasKindFile["coverage"] {
  const counts = dispositionCounts({ rows });
  const kept = stored.coverage.filter(
    (cell) => cell.surface !== MICROSOFT365_SPEC_SURFACE && cell.surface !== MICROSOFT365_API_SURFACE,
  );
  const previousApi = stored.coverage.find((cell) => cell.surface === MICROSOFT365_API_SURFACE) ?? null;
  return [
    ...kept,
    succeededMicrosoft365CoverageCell({
      artifacts: [],
      at,
      channel: "compiled",
      reason:
        `${String(rows.length)} operation(s) compiled from the pinned Graph ${MICROSOFT365_SPEC_PIN.commit.slice(0, 12)} ` +
        `specification: ${String(counts.reachable)} reachable, ${String(counts.voluminous)} voluminous ` +
        `(enumerated and declared, never stored whole), ${String(counts.excluded)} excluded. This says the ` +
        "document was read in full and nothing about what this installation may call",
      role: "authoritative",
      scope: "graph-v1.0-operations",
      state: "synced",
      surface: MICROSOFT365_SPEC_SURFACE,
    }),
    failedMicrosoft365CoverageCell({
      channel: "api",
      previous: previousApi,
      reason:
        "no Entra application registration is configured on this installation, so Graph has never been " +
        "called and no entity of this tenant's has been read. Every operation above is a declaration, not a " +
        "capability",
      role: "authoritative",
      scope: "tenant-entities",
      state: "not-configured",
      surface: MICROSOFT365_API_SURFACE,
      unblockedBy:
        "an Entra application registration with the read-only Graph scopes this atlas needs, consented by a " +
        "directory administrator — a widening of access, and the owner's to grant",
    }),
  ];
}

/**
 * The `page` kind after a sync: no entity, one `deferred` coverage cell, and one gap per declared page.
 *
 * A declared-but-unvisited page is deliberately NOT published as an entity. `kit/read.ts` requires an
 * entity's observations to be non-empty, and a page no channel has seen has none — so publishing one would
 * make an empty row look like a reached page, which is the exact failure the browser surface's whole design
 * is aimed at. A gap per page is the honest carrier: it names the route, it survives until a walk closes it,
 * and `coverage --open-only` lists all 74 of them.
 */
function declaredPagesFile({
  stored,
  at,
}: {
  stored: Microsoft365AtlasKindFile;
  at: string;
}): Result<Microsoft365AtlasKindFile> {
  const observed = declaredPageGaps({ at });
  const gaps = reconcileMicrosoft365Gaps({ at, observed, rechecks: [], runFailed: false, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  const kept = stored.coverage.filter((cell) => cell.surface !== MICROSOFT365_CONSOLE_SURFACE);
  const previous = stored.coverage.find((cell) => cell.surface === MICROSOFT365_CONSOLE_SURFACE) ?? null;
  return ok({
    ...stored,
    coverage: [
      ...kept,
      failedMicrosoft365CoverageCell({
        channel: "browser",
        previous,
        reason:
          `${String(MICROSOFT365_BROWSER_PAGES.length)} page(s) declared across seven admin consoles and 0 ` +
          "visited — no walk has run. The list never shrinks: an unreachable route becomes a gap against the " +
          "page, never a deletion from the declaration",
        role: "corroborating",
        scope: "admin-console-pages",
        state: "deferred",
        surface: MICROSOFT365_CONSOLE_SURFACE,
        unblockedBy:
          "a walk of the declared pages in the owner's own Chrome through the Playwright extension relay " +
          "(`browser/playwrightCli.ts`), with the console signed in",
      }),
    ],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/** Stamp every kind's status from what this run actually published. */
function syncManifest({
  manifest,
  counts,
  at,
}: {
  manifest: Microsoft365AtlasManifest | null;
  counts: Readonly<Record<Microsoft365Kind, number>>;
  at: string;
}): Microsoft365AtlasManifest {
  const base = manifest ?? initialMicrosoft365Manifest({ updatedAt: at });
  const kinds: Microsoft365AtlasManifest["kinds"] = { ...base.kinds };
  for (const kind of MICROSOFT365_KINDS) {
    kinds[kind] = {
      digest: null,
      entityCount: counts[kind],
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
