/**
 * The two LIVE channels' coverage cells for one kind — `admin-api` and `admin-console` — each built over the
 * cell the stored generation already holds for that kind and channel.
 *
 * ## Why the stored cell is an input at all
 *
 * A compile is derived from the registry plus whatever ONE run brought back, and the two live channels are
 * filled by different verbs: `fill` publishes with no walk, and `walk` publishes with no fill. Without the
 * stored cell, every publish rebuilt the other channel from nothing, so a walk erased the last successful
 * fill's `lastSuccessAt` and a refused fill erased the fill before it. `failedCoverageCell` (`kit/coverage.ts`)
 * already carries a prior success forward; what was missing was ever handing it one. `sync.ts` reads the
 * stored generation once and passes each kind's file here.
 */
import type { GoogleAdminFillObservation } from "./adminApi/observation.js";
import type { GoogleAdminWalkObservation } from "./consoleRoute.js";
import {
  googleAdminApiCoverageCell,
  googleAdminUnconfiguredCoverageCell,
  googleAdminUnreachedCoverageCell,
  googleAdminWalkedCoverageCell,
} from "./coverage.js";
import type {
  GoogleAdminAtlasChannel,
  GoogleAdminAtlasKind,
  GoogleAdminAtlasKindFile,
  GoogleAdminCoverageCell,
} from "./model.js";

/**
 * Every operation in a fill that landed on one kind.
 *
 * @param kind the kind to select
 * @param fill what the fill brought back, or `null` when none has run
 * @returns the operations reaching that kind, empty when none did
 */
export function filledFor({
  kind,
  fill,
}: {
  kind: GoogleAdminAtlasKind;
  fill: GoogleAdminFillObservation | null;
}): GoogleAdminFillObservation["operations"] {
  return fill === null ? [] : fill.operations.filter((operation) => operation.kind === kind);
}

/**
 * The cell a stored kind file holds for one channel.
 *
 * @param stored the kind's file as the store holds it, or `null` when no generation has written one
 * @param channel which channel's cell to find
 * @returns the stored cell, or `null` when there is no file or it carries no cell for that channel
 */
export function storedGoogleAdminCell({
  stored,
  channel,
}: {
  stored: GoogleAdminAtlasKindFile | null;
  channel: GoogleAdminAtlasChannel;
}): GoogleAdminCoverageCell | null {
  if (stored === null) {
    return null;
  }
  const cell = stored.coverage.find((candidate) => candidate.channel === channel);
  if (cell === undefined) {
    return null;
  }
  return cell;
}

/**
 * The `admin-api` coverage cell one kind earns, from a fill or from the absence of one.
 *
 * @param kind the kind to grade
 * @param fill what the fill brought back, or `null` when none has run
 * @param at this run's ISO timestamp
 * @param previous the stored `admin-api` cell for this kind, or `null` when none is stored
 * @returns the cell
 */
function adminApiCell({
  kind,
  fill,
  at,
  previous,
}: {
  kind: GoogleAdminAtlasKind;
  fill: GoogleAdminFillObservation | null;
  at: string;
  previous: GoogleAdminCoverageCell | null;
}): GoogleAdminCoverageCell {
  if (fill === null) {
    return googleAdminUnconfiguredCoverageCell({ at, channel: "admin-api", kind, previous });
  }
  const operations = filledFor({ fill, kind });
  const failures = fill.failed.filter((entry) => entry.kind === kind);
  if (operations.length === 0 && failures.length === 0) {
    const excluded = fill.excluded
      .filter((entry) => entry.kind === kind)
      .map((entry) => `${entry.id} (${entry.exclusion}) — ${entry.detail}`);
    return googleAdminUnreachedCoverageCell({ excluded, previous });
  }
  return googleAdminApiCoverageCell({
    // An aggregate read something real and stored no records, so it is `deferred` rather than `synced`. Judged
    // by the read's own payload shape, never by an empty `records`, which a genuinely empty collection has too.
    aggregate: operations.some((operation) => operation.aggregate),
    at: fill.filledAtIso,
    failures: failures.map((entry) => `${entry.id} answered ${String(entry.status)} — ${entry.message}`),
    kind,
    operations: operations.length,
    previous,
    records: operations.reduce((total, operation) => total + operation.records.length, 0),
    truncated: operations.some((operation) => operation.truncated),
  });
}

/**
 * Both live cells one kind carries, in channel order: `admin-api`, then `admin-console`.
 *
 * @param kind the kind to grade
 * @param at this run's ISO timestamp
 * @param fill what the fill brought back, or `null` when this run carried none
 * @param walk what the console walk brought back when this is the `page` kind and a walk ran, else `null`
 * @param stored the kind's file as the store holds it — the source of each channel's prior cell — or `null`
 *   when no generation has written one
 * @returns the two cells
 */
export function googleAdminLiveCoverageCells({
  kind,
  at,
  fill,
  walk,
  stored,
}: {
  kind: GoogleAdminAtlasKind;
  at: string;
  fill: GoogleAdminFillObservation | null;
  walk: GoogleAdminWalkObservation | null;
  stored: GoogleAdminAtlasKindFile | null;
}): readonly [GoogleAdminCoverageCell, GoogleAdminCoverageCell] {
  const api = adminApiCell({ at, fill, kind, previous: storedGoogleAdminCell({ channel: "admin-api", stored }) });
  const previous = storedGoogleAdminCell({ channel: "admin-console", stored });
  if (walk === null) {
    return [api, googleAdminUnconfiguredCoverageCell({ at, channel: "admin-console", kind, previous })];
  }
  return [
    api,
    googleAdminWalkedCoverageCell({
      at: walk.walkedAtIso,
      observed: walk.observedRoutes.length,
      opened: walk.pages.filter((page) => page.reached).length,
      previous,
    }),
  ];
}
