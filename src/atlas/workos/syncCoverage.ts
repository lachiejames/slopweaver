/**
 * The coverage cells one sync carries out — this atlas's per-kind record of which surface was read, and how.
 *
 * Computed apart from the run that publishes it, the same way `syncGaps.ts` computes the gap list: `sync.ts`
 * acquires and writes, and everything here decides the one `api`-channel cell each kind's file carries out of
 * that run, leaving every cell another surface or channel owns exactly as it stood.
 */
import {
  describeWorkosGrade,
  isWorkosContentKind,
  type WorkosContentKind,
  type WorkosContentOutcome,
  type WorkosFamilyGrade,
} from "./contentAcquire.js";
import { failedWorkosCoverageCell, succeededWorkosCoverageCell } from "./coverage.js";
import { WORKOS_DASHBOARD_ROUTES, WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE } from "./dashboardPages.js";
import type { WorkosEnvironmentResolution } from "./environmentId.js";
import type { WorkosAtlasKind, WorkosAtlasKindFile } from "./model.js";
import { workosRouteIsPresent } from "./routeProbe.js";
import { environmentProvenance, environmentScopedRouteCount, type WorkosAcquisition } from "./syncGaps.js";

/**
 * The surface name the measured route map is reported under. Matches `descriptor.ts`.
 * @internal
 */
export const WORKOS_ROUTE_SURFACE = "api-route-map";
/**
 * The surface name the credentialled entity reads are reported under. Matches `descriptor.ts`.
 * @internal
 */
export const WORKOS_CONTENT_SURFACE = "api-content";
/**
 * The surface name the declared dashboard addresses are reported under. Matches `descriptor.ts`.
 * @internal
 */
export const WORKOS_PAGE_MAP_SURFACE = "dashboard-page-map";
/** The surface one kind's coverage cell is reported under. */
function surfaceFor({ kind }: { kind: WorkosAtlasKind }): string {
  if (kind === "operation") {
    return WORKOS_ROUTE_SURFACE;
  }
  return kind === "page" ? WORKOS_PAGE_MAP_SURFACE : WORKOS_CONTENT_SURFACE;
}
/**
 * This run's coverage for one kind, replacing only the cell this surface owns.
 *
 * @returns every coverage cell the kind's file carries out of this run
 */
export function coverageFor({
  acquisition,
  kind,
  stored,
  environment,
  at,
}: {
  acquisition: WorkosAcquisition;
  kind: WorkosAtlasKind;
  stored: WorkosAtlasKindFile;
  environment: WorkosEnvironmentResolution;
  at: string;
}): WorkosAtlasKindFile["coverage"] {
  const surface = surfaceFor({ kind });
  const kept = stored.coverage.filter((cell) => cell.surface !== surface || cell.channel !== "api");
  if (kind === "operation") {
    const present = acquisition.probed.filter((row) => workosRouteIsPresent({ verdict: row.classification.verdict }));
    return [
      ...kept,
      succeededWorkosCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason:
          `${String(acquisition.probed.length)} candidate (method, path) pair(s) probed against the running ` +
          `API with no credential; ${String(present.length)} proved present by the server's own answer and ` +
          `${String(acquisition.probed.length - present.length)} proved not routed under that method`,
        role: "authoritative",
        scope: "probed-route-table",
        state: "synced",
        surface,
      }),
    ];
  }
  if (!isWorkosContentKind(kind)) {
    return [
      ...kept,
      succeededWorkosCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason:
          `${String(WORKOS_DASHBOARD_ROUTES.length)} dashboard address(es) declared with their exact URLs, ` +
          `${String(environmentScopedRouteCount())} of them under this install's environment segment ` +
          `(${environmentProvenance({ environment })}). Only ${WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE.path} is ` +
          `corroborated without a session — it redirects to ${WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE.observedRedirect} ` +
          "rather than to the sign-in catch-all every other path answers, so the rest are declared and not " +
          "evidenced",
        role: "discovery",
        scope: "declared-dashboard-routes",
        state: "synced",
        surface,
      }),
    ];
  }
  return [...kept, contentCell({ acquisition, at, kind, previous: storedApiCell({ stored, surface }), surface })];
}
/**
 * The stored `api`-channel cell for one surface, as a NULLABLE rather than an optional.
 *
 * Written as a loop with an `if` naming the absent case rather than a `find` and a default, because
 * `no-silent-fallback` bans the `??` and `oxlint` rewrites the equivalent ternary back into one. The kit's
 * failed-cell constructor takes `null` for "this surface has never been touched", so the conversion has to
 * happen somewhere; here it is one branch a reader can see.
 *
 * @param stored the kind file as the generation holds it
 * @param surface which surface's cell to find
 * @returns the cell, or `null` when this channel has never covered that surface
 */
function storedApiCell({
  stored,
  surface,
}: {
  stored: WorkosAtlasKindFile;
  surface: string;
}): WorkosAtlasKindFile["coverage"][number] | null {
  for (const cell of stored.coverage) {
    if (cell.surface === surface && cell.channel === "api") {
      return cell;
    }
  }
  return null;
}
/**
 * The content half's own cell, whose STATE is the whole point of grading the two halves apart — and, since
 * one refusing endpoint no longer empties the others, of grading the four families apart too.
 *
 * A family whose own read FAILED goes through the failed constructor, which keeps the prior success's
 * timestamp rather than stamping a new one. That distinction did not matter while the whole content half
 * shared an outcome — every family was equally wrong and the run published nothing. It is the point now:
 * three families really did look and one really did not, and the cell is the only record that can tell a
 * freshness sweep which is which. A cell claiming `lastSuccessAt: <now>` on a read that answered HTTP 500
 * is exactly the lie this change exists to stop, one level down.
 */
function contentCell({
  acquisition,
  kind,
  previous,
  surface,
  at,
}: {
  acquisition: WorkosAcquisition;
  kind: WorkosContentKind;
  previous: WorkosAtlasKindFile["coverage"][number] | null;
  surface: string;
  at: string;
}): WorkosAtlasKindFile["coverage"][number] {
  const counts: Readonly<Record<WorkosContentKind, number>> = {
    connection: acquisition.content.connections.length,
    directory: acquisition.content.directories.length,
    organization: acquisition.content.organizations.length,
    user: acquisition.content.users.length,
  };
  const grade = acquisition.families[kind];
  const reason = contentCellReason({ count: counts[kind], grade, kind });
  if (grade.outcome === "failed") {
    return failedWorkosCoverageCell({
      channel: "api",
      previous,
      reason,
      role: "authoritative",
      scope: "api-key-environment",
      state: "unreadable",
      surface,
      unblockedBy: null,
    });
  }
  const states: Readonly<Record<WorkosContentOutcome, WorkosAtlasKindFile["coverage"][number]["state"]>> = {
    failed: "unreadable",
    "not-configured": "not-configured",
    synced: "synced",
    truncated: "deferred",
  };
  return succeededWorkosCoverageCell({
    artifacts: [],
    at,
    channel: "api",
    reason,
    role: "authoritative",
    scope: "api-key-environment",
    state: states[grade.outcome],
    surface,
  });
}
/**
 * What one content family's coverage cell says, in English.
 *
 * A family that was never attempted reports the reason alone: "0 organisation(s) read from the API" is
 * true of a run with no key and reads as a measurement, which is the shape this atlas refuses everywhere
 * else. A family that WAS attempted leads with its count, because that count is the thing a reader came
 * for.
 *
 * @param kind the family
 * @param count how many of it this run published
 * @param grade the family's own grade
 * @returns the cell's reason
 */
function contentCellReason({
  kind,
  count,
  grade,
}: {
  kind: WorkosContentKind;
  count: number;
  grade: WorkosFamilyGrade;
}): string {
  if (grade.outcome === "not-configured") {
    return describeWorkosGrade({ grade });
  }
  const read = `${String(count)} ${kind}(s) read from the API`;
  if (grade.reason === null) {
    return read;
  }
  return `${read} — ${grade.reason}`;
}
