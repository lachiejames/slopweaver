/**
 * The three coverage cells every kind carries after a compiled sync: one success and two honest refusals.
 *
 * Kept apart from `sync.ts` because these cells are the whole of what a compiled sync CLAIMS, and the claim
 * is the part a reviewer has to be able to read on its own: the compiled channel says the pinned client was
 * read in full, and the `api` and `console` channels each say, in their own cell, that this pass did not
 * reach them.
 */
import { type AtlasCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { AtlasProjection } from "../kit/projection.js";

import { DATADOG_COMPILED_CHANNEL, DATADOG_COMPILED_SCOPE } from "./catalogue.js";
import { storedDatadogCoverageCell } from "./coverage.js";
import type { DatadogCoverageCell } from "./documents.js";
import { DATADOG_VISIBILITY_SCOPE, type DatadogKind } from "./model.js";
import type { DatadogDisposition, DatadogSurfaceRow } from "./surfaceRow.js";
import { summariseDatadogWithholding, withholdingSentence } from "./withheld.js";

/**
 * The three cells one kind carries after a compiled sync, beside every cell another pass owns.
 *
 * A cell per CHANNEL, keyed on `surface`, so a later live pass replaces the `api` cell and leaves this one
 * exactly as it is — `coverage.ts`'s header carries why `surface` is the channel here.
 *
 * @param rows the kind's registry rows, which the compiled cell counts by disposition
 * @param projections what projecting those rows withheld, which the compiled cell must say
 * @param stored the kind's cells as the last generation held them
 * @param at this run's ISO timestamp
 * @returns every cell another pass owns, then the compiled, `api` and `console` cells, in that order
 */
export function datadogCatalogueCoverage({
  kind,
  rows,
  projections,
  stored,
  at,
}: {
  kind: DatadogKind;
  rows: readonly DatadogSurfaceRow[];
  projections: readonly AtlasProjection[];
  stored: readonly DatadogCoverageCell[];
  at: string;
}): DatadogCoverageCell[] {
  const mine = new Set<string>([DATADOG_COMPILED_CHANNEL, "api", "console"]);
  return [
    ...stored.filter((cell) => !mine.has(cell.surface)),
    storedDatadogCoverageCell({
      cell: compiledCell({ at, kind, projections, rows }),
      channel: DATADOG_COMPILED_CHANNEL,
    }),
    apiCell({ kind, previous: previousCell({ stored, surface: "api" }) }),
    consoleCell({ kind, previous: previousCell({ stored, surface: "console" }) }),
  ];
}

/** One channel's cell as the last generation held it — none, by design, on a kind's first sync. */
function previousCell({
  stored,
  surface,
}: {
  stored: readonly DatadogCoverageCell[];
  surface: "api" | "console";
}): DatadogCoverageCell | null {
  const held = stored.find((cell) => cell.surface === surface);
  if (held === undefined) {
    return null;
  }
  return held;
}

/**
 * The compiled channel's own cell.
 *
 * Built here rather than through `coverage.ts`'s {@link import("./coverage.js").datadogCoverageCell}
 * deliberately. That builder's `disposition` argument makes a `shape-index` family state that its
 * occurrence bodies were never stored — true of a LIVE read and false of this one, where the stored detail
 * is the registry row and nothing was withheld at all. Forcing a disposition through it would have made 78
 * cells say something untrue to reuse eight lines. What IS reused is the withholding sentence, which is the
 * part that must not be forgotten.
 */
function compiledCell({
  kind,
  rows,
  projections,
  at,
}: {
  kind: DatadogKind;
  rows: readonly DatadogSurfaceRow[];
  projections: readonly AtlasProjection[];
  at: string;
}): AtlasCoverageCell {
  const counts: Record<DatadogDisposition, number> = { entity: 0, excluded: 0, "probe-only": 0, "shape-index": 0 };
  for (const row of rows) {
    counts[row.disposition] += 1;
  }
  const withholding = summariseDatadogWithholding({ dropped: projections.flatMap((one) => [...one.dropped]) });
  const reason = [
    `${String(rows.length)} operation(s) compiled from ${DATADOG_COMPILED_SCOPE}: ${String(counts.entity)} entity, ${String(counts["shape-index"])} shape-index, ${String(counts["probe-only"])} probe-only, ${String(counts.excluded)} excluded`,
    "this says the pinned client was read in full and says NOTHING about what this organisation answers — an operation here is a declaration, never a capability",
    withholdingSentence({ withholding }),
  ]
    .filter((part) => part.length > 0)
    .join("; ");
  return succeededCoverageCell({
    artifacts: [],
    at,
    reason,
    // `discovery`, never `authoritative`: this surface can establish that an operation EXISTS and can
    // establish nothing about its contents, which is exactly `kit/contract.ts`'s definition. Grading it
    // authoritative would present this atlas as a source of record for facts about the organisation, which
    // it is not.
    role: "discovery",
    scope: kind,
    state: "synced",
    surface: DATADOG_COMPILED_CHANNEL,
    visibilityScope: DATADOG_VISIBILITY_SCOPE,
  });
}

/**
 * The `api` channel's cell: configured or not, nothing in this build has ever called it. A success an
 * earlier live pass recorded is carried forward; a kind no pass has answered for has none to carry.
 */
function apiCell({ kind, previous }: { kind: DatadogKind; previous: DatadogCoverageCell | null }): DatadogCoverageCell {
  return {
    channel: "api",
    lastSuccessAt: previous === null ? null : previous.lastSuccessAt,
    latestAttemptFailed: true,
    reason:
      "no call has been made to this organisation for this kind: this build has no live Datadog pass, so the question of whether these credentials could read it has not been asked. Whether this installation holds valid keys at all is a separate fact, and `slopweaver datadog verify` is what answers it",
    role: "authoritative",
    scope: kind,
    state: "deferred",
    surface: "api",
    unblockedBy:
      "a live pass over the registry's entity and shape-index operations. The `synthetics` kind is NOT among them and will not become so by running one: it is excluded whole with reason `unsupported-sensitive-shape`, because its response models carry free-form fields this atlas has no allowlist projection for. Building the projection `sensitiveFields.ts` specifies is what admits it",
  };
}

/**
 * The `console` channel's cell. A cell a walk has written is kept exactly as it is — the compiled pass
 * knows nothing about the console and must not overwrite the one record that does — and a kind no walk has
 * corroborated gets the honest floor.
 */
function consoleCell({
  kind,
  previous,
}: {
  kind: DatadogKind;
  previous: DatadogCoverageCell | null;
}): DatadogCoverageCell {
  if (previous !== null && previous.lastSuccessAt !== null) {
    return previous;
  }
  return {
    channel: "console",
    lastSuccessAt: null,
    latestAttemptFailed: true,
    reason:
      "no console call answered by one of this kind's operations has been observed. The page list is settled — the live left nav, read in the owner's own Chrome and declared in consolePages.ts — so what is missing is a walk, not a denominator",
    role: "corroborating",
    scope: kind,
    state: "deferred",
    surface: "console",
    unblockedBy: "slopweaver atlas datadog walk",
  };
}
