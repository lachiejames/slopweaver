/**
 * `atlas datadog sync` — publish the COMPILED CATALOGUE: every operation the pinned client declares, as an
 * entity in its own kind's file, with an honest coverage cell for the two channels this build cannot fill.
 *
 * ## What this verb can and cannot claim
 *
 * It reads a registry committed to this repository and reaches no organisation, so a `synced` cell here
 * says the pinned client was compiled in full and says NOTHING about what these credentials may call.
 * Reading a compiled operation as a capability is the single most available mistake with this atlas, so the
 * `api` channel gets its own cell on every kind saying it has never been called, and its own gap. A cell is
 * where that refusal has to live: prose in a header is not something `atlas datadog coverage` prints.
 *
 * ## No credential is presented and no request is made
 *
 * The same shape as `atlas airtable sync` and `atlas notion sync` — a pure local publish. `effect` on the
 * manifest row is therefore `local-state` rather than `external-read`, and this verb works identically on an
 * installation holding no Datadog keys at all.
 *
 * ## The census assertion is aimed at THIS code, not at Datadog
 *
 * `generated/surfaces.ts` is committed and `generated/sdkLock.ts` pins the census the generator measured it
 * against, so neither can move between runs. The assertion below therefore catches a change in the
 * REGISTRY relative to its own pin — a hand-edit of a generated file, a regeneration whose diff nobody
 * read, a merge that dropped rows. `sdkLock.ts` records the case that makes this worth having: an earlier
 * extraction over the same tree returned 1,734 because a regex lookahead lost one operation, and the census
 * is what caught it.
 *
 * ## Two gaps are raised on every successful run and cannot be closed from here
 *
 * `api-never-called` and `console-never-walked`, once per kind, plus two cross-kind gaps on the `root`
 * kind. Nothing this verb does can close any of them, and an atlas whose gap list emptied because the only
 * pass that could run had run would be reporting a completeness it does not have.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { DATADOG_COMPILED_CHANNEL, datadogRowsByKind, projectDatadogCatalogue } from "./catalogue.js";
import { datadogCatalogueCoverage } from "./catalogueCoverage.js";
import {
  DATADOG_ATLAS_SCHEMA_VERSION,
  type DatadogCoverageCell,
  type DatadogGap,
  type DatadogKindFile,
  type DatadogManifest,
  emptyDatadogManifest,
} from "./documents.js";
import { datadogKindExclusionFor } from "./exclusions.js";
import { openDatadogGap, reconcileDatadogGaps } from "./gaps.js";
import { DATADOG_SDK_PIN } from "./generated/sdkLock.js";
import { DATADOG_SURFACES } from "./generated/surfaces.js";
import { mergeDatadogChannel } from "./merge.js";
import { DATADOG_ATLAS_PLATFORM, DATADOG_REGISTRY_KINDS, type DatadogKind, type DatadogRegistryKind } from "./model.js";
import { type DatadogAtlasSnapshot, publishDatadogAtlas, readDatadogAtlas } from "./store.js";
import type { DatadogDisposition, DatadogSurfaceRow } from "./surfaceRow.js";

/**
 * The kind the two cross-kind gaps are filed under.
 *
 * A gap about the whole atlas still has to live in a kind file, and the sibling Microsoft 365 sync puts its
 * cross-kind gaps into EVERY kind it builds — which writes one question into 74 files and makes a reader
 * counting open gaps count it 74 times. Datadog files them once, under the provider's own `root` kind,
 * which is the closest thing the registry has to "the API itself".
 * @internal
 */
export const DATADOG_CROSS_KIND_GAP_KIND = "root";

/** What a sync did, which is what `--json` prints. */
export interface DatadogSyncOutcome {
  readonly operationCount: number;
  readonly kindCount: number;
  readonly dispositionCounts: Readonly<Record<DatadogDisposition, number>>;
  readonly sdkVersion: string;
  readonly written: readonly string[];
}

/**
 * Every way the committed registry can disagree with the census `sdkLock.ts` pins.
 *
 * Exported so a test can drive it directly: the numbers it checks are the whole point of the assertion, and
 * a check reachable only through a full publish is a check nothing exercises.
 *
 * @returns every disagreement, or `null` when the registry is exactly the pinned one
 */
export function datadogRegistryCensusMismatch(): readonly string[] | null {
  const problems: string[] = [];
  const expect = ({ label, got, want }: { label: string; got: number; want: number }): void => {
    if (got !== want) {
      problems.push(`${label}: the registry carries ${String(got)}, sdkLock.ts pins ${String(want)}`);
    }
  };
  expect({ got: DATADOG_SURFACES.length, label: "operations", want: DATADOG_SDK_PIN.census.total });
  for (const method of ["DELETE", "GET", "PATCH", "POST", "PUT"] as const) {
    expect({
      got: DATADOG_SURFACES.filter((row) => row.method === method).length,
      label: `${method} operations`,
      want: DATADOG_SDK_PIN.census[method],
    });
  }
  expect({
    got: DATADOG_SURFACES.filter((row) => row.unstable).length,
    label: "unstable operations",
    want: DATADOG_SDK_PIN.unstableOperations,
  });
  if (problems.length === 0) {
    return null;
  }
  return [
    "the committed operation registry does not match the census pinned beside it, so nothing was published",
    ...problems,
    "`generated/surfaces.ts` is a GENERATED file and `generated/sdkLock.ts` is its pin, so this is a change in this repository rather than in Datadog — regenerate with `yarn tsx tools/generateDatadogSurfaces.ts` and review the diff, or restore the rows a merge dropped",
  ];
}

/**
 * Every registry kind the model does not declare, which would mean rows with no file to go in.
 *
 * @returns the undeclared kinds, sorted, or an empty list when the two agree
 */
export function datadogUndeclaredKinds(): readonly string[] {
  const declared = new Set<string>(DATADOG_REGISTRY_KINDS);
  return [...new Set(DATADOG_SURFACES.filter((row) => !declared.has(row.kind)).map((row) => row.kind))].toSorted();
}

/**
 * Compile the committed registry and publish it as a generation.
 *
 * @param at this run's ISO timestamp
 * @param home the resolved `$SLOPWEAVER_HOME`; omitted takes the ambient one
 * @returns what was published, or every reason it could not be
 */
export function syncDatadogCatalogue({ at, home }: { at: string; home?: string }): Result<DatadogSyncOutcome> {
  const censusFailure = datadogRegistryCensusMismatch();
  if (censusFailure !== null) {
    return err(censusFailure);
  }
  const undeclared = datadogUndeclaredKinds();
  if (undeclared.length > 0) {
    return err([
      `the registry carries ${String(undeclared.length)} kind(s) the model does not declare: ${undeclared.join(", ")}`,
      "nothing was published — a row with no kind file is a row this atlas would silently drop, which is the one thing an atlas may not do. Add each to DATADOG_REGISTRY_KINDS in `model.ts`; `atlasHome.ts` computes the file map from that list, so nothing else changes",
    ]);
  }
  const snapshot = readDatadogAtlas(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const built = buildKindFiles({ at, snapshot: snapshot.value });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishDatadogAtlas({
    files: built.value.files,
    ...(home === undefined ? {} : { home }),
    manifest: syncManifest({ at, counts: built.value.counts, manifest: snapshot.value.manifest }),
    derivedFrom: snapshot.value.manifest,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    dispositionCounts: dispositionCounts(),
    kindCount: DATADOG_REGISTRY_KINDS.length,
    operationCount: DATADOG_SURFACES.length,
    sdkVersion: DATADOG_SDK_PIN.version,
    written: published.value,
  });
}

/**
 * Build every kind's next file from the registry and what the store already holds.
 *
 * Pure over the snapshot it is handed, which is what makes the whole publish testable without touching the
 * ambient home.
 */
function buildKindFiles({ snapshot, at }: { snapshot: DatadogAtlasSnapshot; at: string }): Result<{
  files: Partial<Record<DatadogKind, DatadogKindFile>>;
  counts: Readonly<Record<DatadogRegistryKind, number>>;
}> {
  const byKind = datadogRowsByKind();
  const files: Partial<Record<DatadogKind, DatadogKindFile>> = {};
  const counts: Partial<Record<DatadogRegistryKind, number>> = {};
  for (const kind of DATADOG_REGISTRY_KINDS) {
    const stored = snapshot.files[kind] ?? emptyDatadogKindFile({ at, kind });
    const next = kindFile({ at, kind, rows: byKind.get(kind) ?? [], stored });
    if (next.isErr()) {
      return err(next.error);
    }
    files[kind] = next.value;
    counts[kind] = next.value.entities.length;
  }
  // `as`: every kind was just visited, so the partial is complete. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ counts: counts as Record<DatadogRegistryKind, number>, files });
}

/**
 * An empty file for one kind, which is what a first sync merges onto.
 *
 * @param at this run's ISO timestamp
 * @returns the empty file
 * @internal
 */
export function emptyDatadogKindFile({ kind, at }: { kind: DatadogKind; at: string }): DatadogKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: DATADOG_ATLAS_PLATFORM,
    schemaVersion: DATADOG_ATLAS_SCHEMA_VERSION,
    updatedAt: at,
  };
}

/** One kind's next file: the compiled channel merged on, three coverage cells, and its gaps. */
function kindFile({
  kind,
  rows,
  stored,
  at,
}: {
  kind: DatadogKind;
  rows: readonly DatadogSurfaceRow[];
  stored: DatadogKindFile;
  at: string;
}): Result<DatadogKindFile> {
  const projected = projectDatadogCatalogue({ at, kind, rows });
  const merged = mergeDatadogChannel({
    at,
    channel: DATADOG_COMPILED_CHANNEL,
    observed: projected.map((entry) => entry.entity),
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileDatadogGaps({
    at,
    observed: kindGaps({ at, kind, stored: stored.coverage }),
    rechecks: [],
    runFailed: false,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: datadogCatalogueCoverage({
      at,
      kind,
      projections: projected.map((entry) => entry.projection),
      rows,
      stored: stored.coverage,
    }),
    entities: [...merged.value],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/** How many operations the registry gives each disposition, over all four members. */
function dispositionCounts(): Readonly<Record<DatadogDisposition, number>> {
  const counts: Record<DatadogDisposition, number> = { entity: 0, excluded: 0, "probe-only": 0, "shape-index": 0 };
  for (const row of DATADOG_SURFACES) {
    counts[row.disposition] += 1;
  }
  return counts;
}

/**
 * Why one kind's `api-never-called` gap is open, which is a DIFFERENT sentence for an excluded kind.
 *
 * For every other kind the gap is pending: a live pass would close it. For a kind `exclusions.ts` refuses
 * whole, a live pass would not ask at all, so saying "nothing has asked yet" would promise a closure that
 * cannot arrive. The gap still exists rather than being dropped, because an atlas that omitted it would
 * answer "synthetics is covered" — the same failure excluding rather than deleting the rows avoids.
 *
 * @returns the gap's reason, naming the exclusion when the kind carries one
 */
function apiGapReason({ kind }: { kind: DatadogKind }): string {
  const excluded = datadogKindExclusionFor({ kind });
  if (excluded !== undefined) {
    return `the compiled catalogue says what Datadog offers for \`${kind}\`, and nothing will ask this organisation for any of it: every operation in this kind is excluded, reason \`${excluded.reason}\` — ${excluded.detail}. This gap closes when that exclusion is reversed, not when a live pass runs`;
  }
  return `the compiled catalogue says what Datadog offers for \`${kind}\`; nothing has asked this organisation for any of it, because this build has no live pass to ask with`;
}

/**
 * The gaps one kind carries after a successful compile, plus the cross-kind one on `root`.
 *
 * `console-never-walked` is raised only while the kind's stored `console` cell records no success: a
 * compiled sync that ran AFTER `atlas datadog walk` corroborated the kind must not reopen a gap the walk
 * closed, and the cell is the record of that. The denominator gap this used to raise on `root` is gone
 * with the reason for it — `consolePages.ts` and `descriptor.ts` carry the settled denominator.
 */
function kindGaps({
  kind,
  at,
  stored,
}: {
  kind: DatadogKind;
  at: string;
  stored: readonly DatadogCoverageCell[];
}): readonly DatadogGap[] {
  const gaps: DatadogGap[] = [
    openDatadogGap({
      at,
      channel: "api",
      condition: "api-never-called",
      kind,
      reason: apiGapReason({ kind }),
      scope: kind,
    }),
  ];
  const walked = stored.find((cell) => cell.surface === "console")?.lastSuccessAt != null;
  if (!walked) {
    gaps.push(
      openDatadogGap({
        at,
        channel: "console",
        condition: "console-never-walked",
        kind,
        reason: `no console call answered by a \`${kind}\` operation has been observed, so nothing corroborates the API's account of it. Run: slopweaver atlas datadog walk`,
        scope: kind,
      }),
    );
  }
  if (kind !== DATADOG_CROSS_KIND_GAP_KIND) {
    return gaps;
  }
  gaps.push(
    openDatadogGap({
      at,
      channel: "api",
      condition: "sdk-undeclared-family",
      kind: null,
      reason:
        "`/api/v1/logs-analytics/list` and `/api/v1/logs-analytics/aggregate` are the unified event API behind every Datadog explorer, and they are absent from both artifacts `generated/sdkLock.ts` pins. They are reachable through `slopweaver datadog raw` and permanently outside this atlas's closed acquisition registry. Only Datadog declaring them in the client closes this",
      scope: "logs-analytics",
    }),
  );
  return gaps;
}

/** Stamp every kind's status from what this run actually published. */
function syncManifest({
  manifest,
  counts,
  at,
}: {
  manifest: DatadogManifest | null;
  counts: Readonly<Record<DatadogRegistryKind, number>>;
  at: string;
}): DatadogManifest {
  const base = manifest ?? emptyDatadogManifest({ updatedAt: at });
  const kinds: DatadogManifest["kinds"] = { ...base.kinds };
  for (const kind of DATADOG_REGISTRY_KINDS) {
    kinds[kind] = {
      digest: null,
      entityCount: counts[kind],
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
