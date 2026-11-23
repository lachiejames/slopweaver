/**
 * Building and reading this atlas's coverage cells.
 *
 * The cell shape and its constructors are the kit's. What this atlas adds is one field, `channel`, recorded
 * alongside the kit's `surface` because the same platform is reached through four independent channels and
 * each keeps its own coverage — see `model.ts` on why one succeeding must never erase what another knew, and
 * why the four carry unrelated visibility ceilings.
 *
 * The four surfaces those channels are reported under, and the four cells an operation kind carries, moved
 * here from `sync.ts` (the file-size ratchet, step 3): a sync now asks {@link operationCoverage} for a
 * kind's whole coverage row and states none of it itself.
 */
import type { AtlasCoverageCell } from "../kit/coverage.js";
import { coverageFreshness, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { FreshnessAssessment } from "../kit/freshness.js";
import { atlasFreshnessWindowMs } from "../kit/freshnessWindow.js";

import type { BrazeCollectionOperationRow } from "./collection.js";
import { BRAZE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { BrazeDocsOperationRow } from "./docsCatalogue.js";
import type {
  BrazeArtifactRef,
  BrazeAtlasKindFile,
  BrazeChannel,
  BrazeCoverageCell,
  BrazeCoverageState,
  BrazeEvidenceRole,
} from "./model.js";
import { brazeVisibilityScopeFor } from "./model.js";

/**
 * Judge whether a coverage cell may still be presented as current.
 *
 * @param cell the cell to judge
 * @param nowMs the current time in epoch milliseconds, passed in so this stays pure
 * @returns the freshness verdict and the notes to print
 *
 * @internal
 */
export function brazeCoverageFreshness({
  cell,
  nowMs,
}: {
  cell: BrazeCoverageCell;
  nowMs: number;
}): FreshnessAssessment {
  return coverageFreshness({ cell, nowMs, windowMs: atlasFreshnessWindowMs({ descriptor: BRAZE_ATLAS_DESCRIPTOR }) });
}

/**
 * Build a coverage cell for an acquisition attempt that succeeded.
 *
 * @param surface the surface this cell covers
 * @param channel which channel produced this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope acquired
 * @param state the coverage state this success earned
 * @param reason why, in English
 * @param artifacts the evidence backing this look
 * @param at this run's ISO timestamp
 * @returns the cell, stamped as a fresh success
 *
 * @internal — the published channels' cells are built by {@link operationCoverage} in this file; no caller
 * outside it names this directly.
 */
export function succeededBrazeCoverageCell({
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  artifacts,
  at,
}: {
  surface: string;
  channel: BrazeChannel;
  role: BrazeEvidenceRole;
  scope: string;
  state: BrazeCoverageState;
  reason: string;
  artifacts: readonly BrazeArtifactRef[];
  at: string;
}): BrazeCoverageCell {
  const cell: AtlasCoverageCell = succeededCoverageCell({
    artifacts,
    at,
    reason,
    role,
    scope,
    state,
    surface,
    visibilityScope: brazeVisibilityScopeFor({ channel }),
  });
  // The stored schema declares a mutable array, so copy rather than alias the kit's readonly view.
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: brazeVisibilityScopeFor({ channel }) };
}

/**
 * Build a coverage cell for an acquisition attempt that failed. The prior success is carried forward rather
 * than erased — a failed attempt must not make an earlier successful look disappear, only stop being current.
 *
 * @param previous the cell as it stood before this attempt, or `null` if this surface has never been touched
 * @param surface the surface this cell covers
 * @param channel which channel attempted this look
 * @param role what this channel's evidence is worth for this surface
 * @param scope the concrete scope attempted
 * @param state the coverage state this failure earned
 * @param reason why, in English
 * @param unblockedBy what would resolve this, when known
 * @returns the cell, with the prior success (if any) retained and this attempt marked failed
 */
export function failedBrazeCoverageCell({
  previous,
  surface,
  channel,
  role,
  scope,
  state,
  reason,
  unblockedBy,
}: {
  previous: BrazeCoverageCell | null;
  surface: string;
  channel: BrazeChannel;
  role: BrazeEvidenceRole;
  scope: string;
  state: BrazeCoverageState;
  reason: string;
  unblockedBy: string | null;
}): BrazeCoverageCell {
  const cell: AtlasCoverageCell = failedCoverageCell({
    previous,
    reason,
    role,
    scope,
    state,
    surface,
    unblockedBy,
    visibilityScope: brazeVisibilityScopeFor({ channel }),
  });
  return { ...cell, artifacts: [...cell.artifacts], channel, visibilityScope: brazeVisibilityScopeFor({ channel }) };
}

/**
 * The surface the endpoint reference's coverage is reported under. Matches the descriptor's own.
 *
 * @internal
 */
export const BRAZE_DOCS_SURFACE = "endpoint-reference";

/**
 * The surface the Postman collection's coverage is reported under.
 *
 * @internal
 */
export const BRAZE_COLLECTION_SURFACE = "postman-collection";

/**
 * The surface the live REST channel's coverage is reported under, filled or not.
 *
 * @internal
 */
export const BRAZE_API_SURFACE = "rest-api";

/**
 * The surface the browser walk's coverage is reported under.
 *
 * @internal
 */
export const BRAZE_DASHBOARD_SURFACE = "dashboard";

/**
 * The four coverage cells every operation kind carries, one per channel.
 *
 * @param docsRows what the endpoint reference described for this kind
 * @param collectionRows what the Postman collection described for this kind
 * @param stored the kind file as it stood before this sync
 * @param at this run's ISO timestamp
 * @returns the kind's whole coverage row: every unmanaged cell kept, and the four managed ones rebuilt
 *
 * @internal
 */
export function operationCoverage({
  docsRows,
  collectionRows,
  stored,
  at,
}: {
  docsRows: readonly BrazeDocsOperationRow[];
  collectionRows: readonly BrazeCollectionOperationRow[];
  stored: BrazeAtlasKindFile;
  at: string;
}): BrazeAtlasKindFile["coverage"] {
  const managed = new Set([BRAZE_DOCS_SURFACE, BRAZE_COLLECTION_SURFACE, BRAZE_API_SURFACE, BRAZE_DASHBOARD_SURFACE]);
  const previousFor = ({ surface }: { surface: string }): BrazeAtlasKindFile["coverage"][number] | null => {
    const found = stored.coverage.find((cell) => cell.surface === surface);
    // A surface this kind has never been looked at through carries no prior cell, and `null` is what the
    // failed-cell constructors read as "never touched" — say that here rather than letting `??` say it.
    if (found === undefined) {
      return null;
    }
    return found;
  };
  return [
    ...stored.coverage.filter((cell) => !managed.has(cell.surface)),
    publishedCoverageCell({ at, count: docsRows.length, surface: BRAZE_DOCS_SURFACE }),
    publishedCoverageCell({ at, count: collectionRows.length, surface: BRAZE_COLLECTION_SURFACE }),
    restCoverageCell({ previous: previousFor({ surface: BRAZE_API_SURFACE }) }),
    dashboardCoverageCell({ previous: previousFor({ surface: BRAZE_DASHBOARD_SURFACE }) }),
  ];
}

/** One published channel's cell. Both read a document and neither says anything about a workspace. */
function publishedCoverageCell({
  surface,
  count,
  at,
}: {
  surface: string;
  count: number;
  at: string;
}): BrazeAtlasKindFile["coverage"][number] {
  const isReference = surface === BRAZE_DOCS_SURFACE;
  return succeededBrazeCoverageCell({
    artifacts: [],
    at,
    channel: isReference ? "docs" : "collection",
    reason: isReference
      ? `${String(count)} operation(s) read from Braze's own endpoint reference. This says the published ` +
        "pages were read in full and nothing about what this installation may call"
      : `${String(count)} operation(s) read from Braze's official Postman collection. It is corroborating ` +
        "rather than authoritative: where it disagrees with the reference, the reference is the vendor " +
        "describing its product and this is a convenience artefact that has drifted",
    role: isReference ? "authoritative" : "corroborating",
    scope: isReference ? "published-reference-operations" : "published-collection-operations",
    state: "synced",
    surface,
  });
}

/** The live REST channel's cell: never filled, because no workspace API key exists. */
function restCoverageCell({
  previous,
}: {
  previous: BrazeAtlasKindFile["coverage"][number] | null;
}): BrazeAtlasKindFile["coverage"][number] {
  return failedBrazeCoverageCell({
    channel: "api",
    previous,
    reason:
      "no Braze workspace API key is configured, so the REST API has never been called and no entity of " +
      "this workspace has been read. Every operation above is a declaration, not a capability",
    role: "authoritative",
    scope: "workspace-entities",
    state: "not-configured",
    surface: BRAZE_API_SURFACE,
    unblockedBy:
      "a read-only workspace API key from the dashboard's Settings > API Keys page, which needs the Braze " +
      "account this installation does not have — an access request the owner raises, never this atlas",
  });
}

/** The browser channel's cell for an operation kind: never filled, because no Braze account exists. */
function dashboardCoverageCell({
  previous,
}: {
  previous: BrazeAtlasKindFile["coverage"][number] | null;
}): BrazeAtlasKindFile["coverage"][number] {
  return failedBrazeCoverageCell({
    channel: "browser",
    previous,
    reason:
      "this installation has no Braze account, so no dashboard page has been reached, photographed or " +
      "graded for this kind",
    role: "corroborating",
    scope: "dashboard-pages",
    state: "not-configured",
    surface: BRAZE_DASHBOARD_SURFACE,
    unblockedBy:
      "a Braze dashboard invite at the level `SOP: Braze Access` describes, then a walk of the declared " +
      "routes in the owner's own Chrome",
  });
}
