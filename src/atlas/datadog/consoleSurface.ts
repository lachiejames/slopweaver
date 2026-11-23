/**
 * Publish what the console walk saw: two console kinds, a `console` channel on every registry operation the
 * console itself called, and the gaps that say what the walk could not see.
 *
 * ## The compiled sync and this share one generation and never each other's kinds
 *
 * `sync.ts` publishes the registry kinds and omits `console-page`/`console-request`; this publishes those two,
 * plus the registry kinds it CORROBORATES (each with its `console` channel merged and its `console` coverage
 * cell rewritten), and `publishAtlas` leaves an omitted kind's file untouched. Neither pass can truncate the
 * other's work.
 *
 * ## Coverage is graded against every declared page, not against the ones that worked
 *
 * `console-page`'s cell says how many of the DECLARED routes the walk ATTEMPTED and how many rendered, so a
 * run that lost its session after four of the declared routes reports `deferred` with the fraction in its reason rather than
 * `synced` because it wrote some rows. `surfaceFill.ts` reads that cell, so the descriptor cannot disagree
 * with the coverage table.
 *
 * ## What the palette body becomes, and what it never becomes
 *
 * `POST /api/ui/search/suggestions/entities` lists this organisation's dashboards, monitors, users and the
 * rest by NAME. The entities of this atlas are operations, so there is nothing for a name to corroborate
 * and no row for one to sit in; the body is reduced like any other console call (field names), and what it
 * LISTS is {@link paletteBuckets} — a count per entity kind, on the coverage reason and the page. A person's
 * name reaches disk nowhere on this path.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasGapRecheck } from "../kit/gaps.js";

import { corroborations, pageEntity, requestEntity } from "./consoleEntities.js";
import { consoleRechecks, walkGaps } from "./consoleGaps.js";
import { DATADOG_CONSOLE_ROUTES, undeclaredDestinations } from "./consolePages.js";
import type { DatadogPaletteSummary } from "./consolePalette.js";
import { consoleReason, consoleUnblockedBy, type WalkTally, walkTally } from "./consoleTally.js";
import type { DatadogWalkResult } from "./consoleWalk.js";
import {
  type DatadogCoverageCell,
  type DatadogEntity,
  type DatadogGap,
  type DatadogKindFile,
  type DatadogKindStatus,
  type DatadogManifest,
  emptyDatadogManifest,
} from "./documents.js";
import { reconcileDatadogGaps } from "./gaps.js";
import { mergeDatadogChannel } from "./merge.js";
import { DATADOG_CONSOLE_KINDS, type DatadogConsoleKind, type DatadogKind } from "./model.js";
import { publishDatadogAtlas, readDatadogAtlas } from "./store.js";
import { emptyDatadogKindFile } from "./sync.js";

/** What publishing a walk did. */
export interface DatadogConsoleOutcome {
  /** How many routes the REGISTRY declares — the real denominator, never this run own slice of it. */
  readonly declaredCount: number;
  /** How many of the declared routes this run was handed: `declaredCount` unless `--limit` bounded it. */
  readonly pageCount: number;
  /** Declared routes a bound left out of this run entirely. */
  readonly omittedCount: number;
  /** Declared routes this run was handed and never reached, because its session went part-way. */
  readonly notAttemptedCount: number;
  readonly attemptedCount: number;
  readonly landedCount: number;
  readonly requestCount: number;
  readonly undeclaredCount: number;
  /** How the live nav differed from the declared list, or `null` when the nav leg did not run. */
  readonly navDrift: { readonly undeclared: readonly string[]; readonly gone: readonly string[] } | null;
  /** Registry kinds that received a `console` channel this run, sorted. */
  readonly corroboratedKinds: readonly string[];
  readonly palette: DatadogPaletteSummary | null;
  readonly written: readonly string[];
}

/** A synced or deferred `console` cell, built directly: the kit's builder is shaped around API reads. */
function consoleCell({
  kind,
  at,
  complete,
  reason,
  unblockedBy,
}: {
  kind: string;
  at: string;
  complete: boolean;
  reason: string;
  unblockedBy: string | null;
}): DatadogCoverageCell {
  return {
    channel: "console",
    lastSuccessAt: at,
    latestAttemptFailed: false,
    reason,
    role: "corroborating",
    scope: kind,
    state: complete ? "synced" : "deferred",
    surface: "console",
    unblockedBy,
  };
}

/** Replace one kind's `console` cell, leaving the other channels' cells exactly as they were. */
function withConsoleCell({
  cells,
  cell,
}: {
  cells: readonly DatadogCoverageCell[];
  cell: DatadogCoverageCell;
}): readonly DatadogCoverageCell[] {
  return [...cells.filter((held) => held.surface !== "console"), cell];
}

/** The kit's readonly attempt record, in the mutable shape the manifest schema infers. */
function okStatus({ at, entityCount }: { at: string; entityCount: number }): DatadogKindStatus {
  return { digest: null, entityCount, lastAttempt: { at, outcome: "ok", reasons: [] }, lastSuccessAt: at };
}

/** Fold observed console-channel entities into one kind's stored file, with its new cell and gaps. */
function foldKind({
  kind,
  stored,
  observed,
  cell,
  gaps,
  rechecks,
  at,
}: {
  kind: DatadogKind;
  stored: DatadogKindFile;
  observed: readonly DatadogEntity[];
  cell: DatadogCoverageCell;
  gaps: readonly DatadogGap[];
  rechecks: readonly AtlasGapRecheck[];
  at: string;
}): Result<{ file: DatadogKindFile; status: DatadogKindStatus }> {
  const merged = mergeDatadogChannel({ at, channel: "console", observed, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const reconciled = reconcileDatadogGaps({
    at,
    observed: gaps.filter((gap) => gap.kind === kind),
    rechecks,
    runFailed: false,
    stored: stored.gaps,
  });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return ok({
    file: {
      ...stored,
      coverage: [...withConsoleCell({ cell, cells: stored.coverage })],
      entities: [...merged.value],
      gaps: [...reconciled.value],
      updatedAt: at,
    },
    status: okStatus({ at, entityCount: merged.value.length }),
  });
}

/**
 * Publish one console walk into the generation, leaving every kind it did not touch exactly as it was.
 *
 * @param walk what the walk produced
 * @param origin the console origin the walk ran against
 * @param at this run's ISO timestamp
 * @param home the state home; omitted takes the ambient one
 * @returns what was published, or every reason nothing was
 */
export function publishDatadogConsoleWalk({
  walk,
  origin,
  at,
  home,
}: {
  walk: DatadogWalkResult;
  origin: string;
  at: string;
  home?: string;
}): Result<DatadogConsoleOutcome> {
  const snapshot = readDatadogAtlas(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const prior = snapshot.value.manifest;
  const manifest: DatadogManifest = priorOrEmpty({ at, prior });
  const tally = walkTally({ walk });
  const gaps = walkGaps({ at, drift: tally.drift, origin, palette: tally.palette, walk });
  const stored = ({ kind }: { kind: DatadogKind }): DatadogKindFile =>
    storedOrEmpty({ at, held: snapshot.value.files[kind], kind });

  const files: Partial<Record<DatadogKind, DatadogKindFile>> = {};
  const statuses: Partial<Record<DatadogKind, DatadogKindStatus>> = {};
  const fold = (input: Parameters<typeof foldKind>[0]): Result<null> => {
    const folded = foldKind(input);
    if (folded.isErr()) {
      return err(folded.error);
    }
    files[input.kind] = folded.value.file;
    statuses[input.kind] = folded.value.status;
    return ok(null);
  };

  for (const kind of DATADOG_CONSOLE_KINDS) {
    const folded = fold(consoleKindFold({ at, gaps, kind, origin, stored, tally, walk }));
    if (folded.isErr()) {
      return err(folded.error);
    }
  }

  const corroborated = corroborations({ at, origin, walk });
  for (const [kind, entities] of corroborated) {
    const folded = fold(corroboratedFold({ at, entities, kind, stored, tally }));
    if (folded.isErr()) {
      return err(folded.error);
    }
  }

  const published = publishDatadogAtlas({
    derivedFrom: prior,
    files,
    ...(home === undefined ? {} : { home }),
    manifest: { ...manifest, kinds: { ...manifest.kinds, ...statuses }, updatedAt: at },
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(outcomeOf({ corroborated: [...corroborated.keys()], origin, tally, walk, written: published.value }));
}

/**
 * What the caller is told this publish did.
 *
 * @param walk what the walk produced
 * @param tally this run's numbers
 * @param corroborated the registry kinds that received a console channel
 * @param origin the console origin, for counting the landings the registry does not declare
 * @param written the files the publish wrote
 * @returns the outcome
 */
function outcomeOf({
  walk,
  tally,
  corroborated,
  origin,
  written,
}: {
  walk: DatadogWalkResult;
  tally: WalkTally;
  corroborated: readonly string[];
  origin: string;
  written: readonly string[];
}): DatadogConsoleOutcome {
  return {
    attemptedCount: tally.attempted,
    corroboratedKinds: [...corroborated].toSorted(),
    landedCount: tally.landed,
    navDrift: tally.drift,
    declaredCount: DATADOG_CONSOLE_ROUTES.length,
    notAttemptedCount: tally.notAttempted,
    omittedCount: tally.omitted,
    pageCount: walk.pages.length,
    palette: tally.palette,
    requestCount: walk.requests.length,
    undeclaredCount: undeclaredDestinations({ finalUrls: walk.finalUrls, origin }).length,
    written,
  };
}

/** The manifest to merge onto: the stored one, or an empty generation when nothing has been published. */
function priorOrEmpty({ prior, at }: { prior: DatadogManifest | null; at: string }): DatadogManifest {
  if (prior === null) {
    return emptyDatadogManifest({ updatedAt: at });
  }
  return prior;
}

/** One kind's stored file, or an empty one when this generation has none. */
function storedOrEmpty({
  held,
  kind,
  at,
}: {
  held: DatadogKindFile | null | undefined;
  kind: DatadogKind;
  at: string;
}): DatadogKindFile {
  if (held === undefined || held === null) {
    return emptyDatadogKindFile({ at, kind });
  }
  return held;
}

/** How one kind's stored file is reached — the publish's own closure over this run's snapshot. */
type StoredFile = (input: { kind: DatadogKind }) => DatadogKindFile;

/**
 * The fold for one CONSOLE kind: its entities, its cell and the gaps this run raised for it.
 *
 * @param kind which of the two console kinds
 * @param walk what the walk produced
 * @param tally this run's numbers
 * @param gaps every gap this run raised, filtered per kind inside the fold
 * @param stored how to reach a kind's stored file
 * @param origin the console origin
 * @param at this run's ISO timestamp
 * @returns the fold input
 */
function consoleKindFold({
  kind,
  walk,
  tally,
  gaps,
  stored,
  origin,
  at,
}: {
  kind: DatadogConsoleKind;
  walk: DatadogWalkResult;
  tally: WalkTally;
  gaps: readonly DatadogGap[];
  stored: StoredFile;
  origin: string;
  at: string;
}): Parameters<typeof foldKind>[0] {
  const observed =
    kind === "console-page"
      ? walk.pages.map((page) => pageEntity({ at, origin, page }))
      : walk.requests.map((request) => requestEntity({ at, origin, request }));
  return {
    at,
    cell: consoleCell({
      at,
      complete: tally.complete,
      kind,
      reason: consoleReason({ kind, tally, walk }),
      unblockedBy: consoleUnblockedBy({ tally }),
    }),
    gaps,
    kind,
    observed,
    rechecks: consoleRechecks({ kind }),
    stored: stored({ kind }),
  };
}

/**
 * The fold for one REGISTRY kind the console corroborated: its operations' console channel, and the cell
 * that says how many of the kind's catalogued operations the console itself called.
 *
 * @param kind the registry kind
 * @param entities its operations, each carrying a console channel
 * @param stored how to reach a kind's stored file
 * @param at this run's ISO timestamp
 * @returns the fold input
 */
function corroboratedFold({
  kind,
  entities,
  stored,
  tally,
  at,
}: {
  kind: DatadogKind;
  entities: readonly DatadogEntity[];
  stored: StoredFile;
  tally: WalkTally;
  at: string;
}): Parameters<typeof foldKind>[0] {
  const held = stored({ kind });
  // A corroboration is a floor, never a total: the pages this run did not open may call more of this kind.
  // BOTH causes are counted — counting only `omitted` let an unbounded walk interrupted after its first
  // corroboration report that it "left 0 declared page(s) unvisited", because only `omitted` was read.
  const unvisited = tally.omitted + tally.notAttempted;
  const boundClause = tally.complete
    ? ""
    : `, over a run that left ${String(unvisited)} declared page(s) unvisited — so this is a floor, not this kind's console total`;
  // Divided by what the REGISTRY declares for this kind, never by what happens to be stored: the walk does
  // not require a compiled sync first, and a fresh home published "called 1 of the 0 operation(s) the
  // catalogue holds" (same probe). `held.entities` is this kind's stored file, which is empty until a sync.
  const declared = held.entities.length;
  const ofClause =
    declared === 0
      ? "; no compiled catalogue is stored for this kind yet, so there is no denominator to divide by — run `slopweaver atlas datadog sync`"
      : ` of the ${String(declared)} operation(s) the catalogue holds for \`${kind}\``;
  return {
    at,
    cell: consoleCell({
      at,
      // Graded by the SAME tally as the two console kinds, and for the same reason. A corroborated kind's
      // `synced` says the console surface was exercised for it; a run that opened one declared page and
      // never the rest cannot claim that, however genuinely it called this kind's operation on the one it did open.
      // This arm reads `tally.complete` rather than hard-coding `true`.
      complete: tally.complete,
      kind,
      reason: `the console itself called ${String(entities.length)}${ofClause} while its pages rendered; each carries the console's own request shape on its console channel${boundClause}`,
      unblockedBy: consoleUnblockedBy({ tally }),
    }),
    gaps: [],
    kind,
    observed: entities,
    rechecks: [{ condition: "console-never-walked", resolved: true, scope: kind }],
    stored: held,
  };
}
