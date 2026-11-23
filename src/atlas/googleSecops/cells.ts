/**
 * The coverage cells one fill writes — one per planned list, keyed by rpc, plus one per cloud-platform-only
 * kind naming the scope that would open it.
 *
 * Keyed by rpc because `dashboard` and `findings-refinement` are each read by two lists, so a
 * featured-dashboard 403 beside a native-dashboard success reads as exactly that rather than as one kind
 * half-synced for a reason nobody can find. Split out of `sync.ts`, which grades kinds and publishes; this
 * file only says what each list's cell reads.
 */
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import { CLOUD_PLATFORM_UNBLOCKED_BY, IAM_ROLE_UNBLOCKED_BY, type SecopsFillCall } from "./fill/plan.js";
import type { GoogleSecopsFillObservation, SecopsCallFailed } from "./fill/run.js";
import type { GoogleSecopsAtlasKind, GoogleSecopsAtlasKindFile, GoogleSecopsAtlasManifest } from "./model.js";

type CoverageCell = GoogleSecopsAtlasKindFile["coverage"][number];

/** The descriptor's one surface — every cell this atlas writes is on it. */
const SURFACE = "chronicle-api-v1";

/** The claim boundary the `api` channel reads under. */
const VISIBILITY = "api-granted-scope-and-iam-role";

/** The scope a cloud-platform-only kind's single cell is keyed by. */
const CLOUD_PLATFORM_ONLY_SCOPE = "cloud-platform-only";

/** What the store held before this run, as much of it as grading needs. */
export interface GoogleSecopsPriorGeneration {
  readonly files: Readonly<Record<GoogleSecopsAtlasKind, GoogleSecopsAtlasKindFile | null>>;
  readonly manifest: GoogleSecopsAtlasManifest | null;
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
  prior: GoogleSecopsPriorGeneration;
  kind: GoogleSecopsAtlasKind;
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
 * How a failure reads in a cell or an attempt's reasons — Google's status when there was one, then its words.
 *
 * @param failure the failed list
 * @returns the sentence tail, e.g. `answered 403 — The caller does not have permission`
 */
export function failureWords({ failure }: { failure: SecopsCallFailed }): string {
  if (failure.status === null) {
    return `failed before Google answered — ${failure.message}`;
  }
  return `answered ${String(failure.status)} — ${failure.message}`;
}

/**
 * The `api` cell one planned list earns.
 *
 * @param call the planned list
 * @param fill what the run brought back
 * @param prior what the store held
 * @returns the cell
 */
export function listCell({
  call,
  fill,
  prior,
}: {
  call: SecopsFillCall;
  fill: GoogleSecopsFillObservation;
  prior: GoogleSecopsPriorGeneration;
}): CoverageCell {
  const answered = fill.answered.find((entry) => entry.id === call.id);
  if (answered !== undefined) {
    const cell = succeededCoverageCell({
      artifacts: [],
      at: fill.filledAtIso,
      reason: answered.truncated
        ? `${call.rpc} answered ${String(answered.items.length)} item(s) and stopped at the page bound with more to read`
        : `${call.rpc} answered ${String(answered.items.length)} item(s), each kept as allowlisted fields only`,
      role: "authoritative",
      scope: call.rpc,
      state: answered.truncated ? "deferred" : "synced",
      surface: SURFACE,
      unblockedBy: answered.truncated ? "a page bound above SECOPS_MAX_FILL_PAGES in fill/run.ts" : null,
      visibilityScope: VISIBILITY,
    });
    return { ...cell, artifacts: [], channel: "api", visibilityScope: VISIBILITY };
  }
  const failed = fill.failed.find((entry) => entry.id === call.id)!;
  const cell = failedCoverageCell({
    previous: previousCell({ kind: call.kind, prior, scope: call.rpc }),
    reason: `${call.rpc} ${failureWords({ failure: failed })}`,
    role: "authoritative",
    scope: call.rpc,
    state: "unreadable",
    surface: SURFACE,
    unblockedBy: failed.status === 403 ? IAM_ROLE_UNBLOCKED_BY : null,
    visibilityScope: VISIBILITY,
  });
  return { ...cell, artifacts: [...cell.artifacts], channel: "api", visibilityScope: VISIBILITY };
}

/**
 * The cell a cloud-platform-only kind carries: never called, and why.
 *
 * @param kind which cloud-platform-only atlas kind this cell describes
 * @param prior what the store held
 * @returns the cell
 */
export function cloudPlatformOnlyCell({
  kind,
  prior,
}: {
  kind: GoogleSecopsAtlasKind;
  prior: GoogleSecopsPriorGeneration;
}): CoverageCell {
  const cell = failedCoverageCell({
    previous: previousCell({ kind, prior, scope: CLOUD_PLATFORM_ONLY_SCOPE }),
    reason:
      "every GET under this kind accepts only `cloud-platform`, which this grant does not carry, so none was called",
    role: "authoritative",
    scope: CLOUD_PLATFORM_ONLY_SCOPE,
    state: "not-configured",
    surface: SURFACE,
    unblockedBy: CLOUD_PLATFORM_UNBLOCKED_BY,
    visibilityScope: VISIBILITY,
  });
  return { ...cell, artifacts: [...cell.artifacts], channel: "api", visibilityScope: VISIBILITY };
}
