/**
 * The coverage cell one sync writes per planned path, keyed by the path template.
 *
 * Split out of `sync.ts`, which grades kinds and publishes; this file only says what each path's cell reads.
 */
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import { KNOWBE4_API_SURFACE } from "./descriptor.js";
import { KNOWBE4_UNREAD_PARTITIONS, type Knowbe4FillCall, SUBSCRIPTION_UNBLOCKED_BY } from "./fill/plan.js";
import type { Knowbe4CallFailed, Knowbe4FillObservation } from "./fill/run.js";
import type { Knowbe4AtlasKind, Knowbe4AtlasKindFile, Knowbe4AtlasManifest } from "./model.js";

type CoverageCell = Knowbe4AtlasKindFile["coverage"][number];

/** The claim boundary the `api` channel reads under. */
const VISIBILITY = "api-reporting-token-and-tier";

/** What the store held before this run, as much of it as grading needs. */
export interface Knowbe4PriorGeneration {
  readonly files: Readonly<Record<Knowbe4AtlasKind, Knowbe4AtlasKindFile | null>>;
  readonly manifest: Knowbe4AtlasManifest | null;
}

/**
 * The cell a kind held for one scope last time, so a failed attempt carries its success forward.
 *
 * @param prior what the store held
 * @param kind the kind
 * @param scope the cell's scope
 * @returns the earlier cell, or `null` when there was none
 */
function previousCell({
  prior,
  kind,
  scope,
}: {
  prior: Knowbe4PriorGeneration;
  kind: Knowbe4AtlasKind;
  scope: string;
}): CoverageCell | null {
  const file = prior.files[kind];
  if (file === null) {
    return null;
  }
  const found = file.coverage.find((cell) => cell.channel === "api" && cell.scope === scope);
  if (found === undefined) {
    return null;
  }
  return found;
}

/**
 * How a failure reads in a cell or an attempt's reasons — KnowBe4's status when there was one, then its words.
 *
 * @param failure the failed path
 * @returns the sentence tail, e.g. `answered 403 — KnowBe4 answered 403 on /v1/users`
 */
export function failureWords({ failure }: { failure: Knowbe4CallFailed }): string {
  if (failure.status === null) {
    return `failed before KnowBe4 answered — ${failure.message}`;
  }
  return `answered ${String(failure.status)} — ${failure.message}`;
}

/**
 * The `api` cell one planned path earns.
 *
 * @param call the planned path
 * @param fill what the run brought back
 * @param prior what the store held
 * @returns the cell
 */
export function pathCell({
  call,
  fill,
  prior,
}: {
  call: Knowbe4FillCall;
  fill: Knowbe4FillObservation;
  prior: Knowbe4PriorGeneration;
}): CoverageCell {
  const answered = fill.answered.find((entry) => entry.template === call.template);
  if (answered !== undefined && answered.truncatedBy !== null) {
    // A bounded read is not a whole look, so its cell keeps the last whole read's success and marks this
    // attempt failed — the kind's file is the kind as of that success, never as of this run.
    const cell = failedCoverageCell({
      previous: previousCell({ kind: call.kind, prior, scope: call.template }),
      reason: `${call.template} answered ${String(answered.items.length)} row(s) and stopped at ${answered.truncatedBy} with more to read`,
      role: "authoritative",
      scope: call.template,
      state: "deferred",
      surface: KNOWBE4_API_SURFACE,
      unblockedBy:
        "a wider bound in src/atlas/knowbe4/fill/run.ts, weighed against the account's shared daily allowance",
      visibilityScope: VISIBILITY,
    });
    return { ...cell, artifacts: [], channel: "api", visibilityScope: VISIBILITY };
  }
  if (answered !== undefined) {
    const cell = succeededCoverageCell({
      artifacts: [],
      at: fill.filledAtIso,
      reason: `${call.template} answered ${String(answered.items.length)} row(s), each kept as allowlisted fields only`,
      role: "authoritative",
      scope: call.template,
      state: "synced",
      surface: KNOWBE4_API_SURFACE,
      visibilityScope: VISIBILITY,
    });
    return { ...cell, artifacts: [], channel: "api", visibilityScope: VISIBILITY };
  }
  const failed = fill.failed.find((entry) => entry.template === call.template)!;
  const cell = failedCoverageCell({
    previous: previousCell({ kind: call.kind, prior, scope: call.template }),
    reason: `${call.template} ${failureWords({ failure: failed })}`,
    role: "authoritative",
    scope: call.template,
    state: "unreadable",
    surface: KNOWBE4_API_SURFACE,
    unblockedBy: failed.status === 403 ? SUBSCRIPTION_UNBLOCKED_BY : null,
    visibilityScope: VISIBILITY,
  });
  return { ...cell, artifacts: [...cell.artifacts], channel: "api", visibilityScope: VISIBILITY };
}

/**
 * The `excluded` cells a planned path carries for the parts of its list the sync deliberately does not read, so
 * a kind never reads as holding what it never asked for.
 *
 * @param call the planned path
 * @param at this run's ISO timestamp
 * @returns one cell per unread partition of the path — none for most paths
 */
export function unreadPartitionCells({ call, at }: { call: Knowbe4FillCall; at: string }): readonly CoverageCell[] {
  return KNOWBE4_UNREAD_PARTITIONS.filter((partition) => partition.template === call.template).map((partition) => {
    const cell = succeededCoverageCell({
      artifacts: [],
      at,
      reason: `${partition.template}?${partition.query} is not read: ${partition.because}`,
      role: "authoritative",
      scope: `${partition.template}?${partition.query}`,
      state: "excluded",
      surface: KNOWBE4_API_SURFACE,
      unblockedBy: "a read of the partition, once the first credentialed sync shows whether the plain list holds it",
      visibilityScope: VISIBILITY,
    });
    return { ...cell, artifacts: [], channel: "api", visibilityScope: VISIBILITY };
  });
}
