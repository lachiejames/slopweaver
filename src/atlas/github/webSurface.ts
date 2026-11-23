/**
 * Publish what the admin walk saw into the atlas's two browser kinds.
 *
 * The API sync and this share the same generation and never each other's kinds: `sync.ts` publishes the
 * configuration and operation kinds and omits `admin-page`/`web-request`, this publishes those two and
 * omits the rest, and `publishAtlas` leaves an omitted kind's file untouched. That is the mechanism by
 * which one surface cannot truncate the other's work, and it is why neither passes a full file map.
 *
 * ## Coverage is graded against what the walk PROVED, and it is rarely `synced`
 *
 * `admin-page` earns `synced` only when the frontier actually closed — a whole round of expansion
 * discovering nothing new — AND every page it reached was photographed. Anything else is `deferred` with
 * the shortfall in its own reason. That is a deliberate departure from the sibling walk, whose coverage
 * helper always writes `synced` and whose file header describes a partial-walk grading it does not
 * implement; a `--limit` run there publishes a slice and reports success.
 *
 * The honest reading of `deferred` here is "populated, not exhausted", and it is what a frontier can
 * support. `browser-denominator-unproven` stays open in every generation regardless, because no run can
 * close it: GitHub publishes no authenticated settings sitemap, so even a closed frontier proves only that
 * every link GitHub RENDERED was followed — never that every admin page was found.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { reconcileGaps } from "../kit/gaps.js";

import { githubKindScope, replaceGithubCoverageCell, succeededGithubCoverageCell } from "./coverage.js";
import type { GithubAdminPage, GithubWebRequest } from "./entities.js";
import {
  assembleGithubKindFile,
  type GithubGap,
  type GithubKindFile,
  type GithubManifest,
  initialGithubManifest,
} from "./kindFiles.js";
import type { GithubKind } from "./model.js";
import { type ProjectionContext, projectGithubAdminPage, projectGithubWebRequest } from "./projection.js";
import { mergeGithubKind, provenCompleteRead } from "./reconcile.js";
import { type GithubAtlasPaths, publishGithubAtlas, readGithubAtlas } from "./store.js";
import type { GithubWebWalkResult } from "./webWalk.js";
import { frontierClosed, summariseOutcomes, walkGaps } from "./webWalkProof.js";

/**
 * What publishing a walk did.
 *
 * @internal
 */
export interface WebSurfaceOutcome {
  readonly pageCount: number;
  readonly landedCount: number;
  readonly photographedCount: number;
  readonly requestCount: number;
  /** Requests GitHub's own published description does not declare — the browser-only surface. */
  readonly undeclaredRequestCount: number;
  readonly written: readonly string[];
}

/**
 * What the `admin-page` coverage cell says this walk actually proved.
 *
 * @param walk what the walk produced
 * @param closed whether frontier expansion reached a fixed point
 * @returns the reason line, which is what a reader sees in `atlas github coverage`
 */
function pageCoverageReason({ walk, closed }: { walk: GithubWebWalkResult; closed: boolean }): string {
  if (closed) {
    return `the frontier closed after ${String(walk.roundsRun)} round(s): ${String(walk.pages.length)} page(s) discovered and attempted — ${summariseOutcomes({ walk })}, ${String(walk.artifactsWritten)} screenshot(s) kept`;
  }
  return `${String(walk.pages.length)} page(s) attempted over ${String(walk.roundsRun)} round(s) with ${String(walk.frontierRemaining.length)} still unvisited — ${summariseOutcomes({ walk })}`;
}

/**
 * Project a whole walk into the two browser kinds' entities.
 *
 * @param walk what the walk produced
 * @param origin the web origin the walk was bound to
 * @param declaredRoutes every `METHOD /pathShape` GitHub's own description declares
 * @param at this run's ISO timestamp
 * @returns the projected pages and requests
 */
function projectWalk({
  walk,
  origin,
  declaredRoutes,
  at,
}: {
  walk: GithubWebWalkResult;
  origin: string;
  declaredRoutes: ReadonlySet<string>;
  at: string;
}): { observedPages: readonly GithubAdminPage[]; observedRequests: readonly GithubWebRequest[] } {
  const context = webContext({ at, origin });
  return {
    observedPages: walk.pages.map((page) =>
      projectGithubAdminPage({ context, origin, page, scopeRef: scopeOfPath({ path: page.path }) }),
    ),
    observedRequests: walk.requests.map((request) =>
      projectGithubWebRequest({
        context,
        declaredInOpenApi: declaredRoutes.has(`${request.method} ${request.pathShape}`),
        request,
      }),
    ),
  };
}

/** The projection context for one browser-surface read. */
function webContext({ at, origin }: { at: string; origin: string }): ProjectionContext {
  return { at, source: { endpoint: `${origin} (admin walk)`, observedAt: at, surface: "github-web" } };
}

/**
 * The scope one walked page belongs to: an organisation, an `owner/repo`, or the account itself.
 *
 * @param path the canonical same-origin path the walk visited
 * @returns the organisation login, the `owner/repo` coordinate, or `account` for the signed-in account's
 *   own settings, which belong to no organisation
 *
 * @internal
 */
export function scopeOfPath({ path }: { path: string }): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments[0] === "organizations" && segments[1] !== undefined) {
    return segments[1];
  }
  if (segments.length >= 3 && segments[2] === "settings" && segments[0] !== undefined && segments[1] !== undefined) {
    return `${segments[0]}/${segments[1]}`;
  }
  return "account";
}

/**
 * Publish one walk into the browser kinds of the current generation.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk produced
 * @param origin the web origin the walk was bound to
 * @param declaredRoutes every `METHOD /pathShape` GitHub's own description declares, so a browser-observed
 *   call can say whether it is on the published surface
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason publication was refused
 */
export function publishGithubWebWalk({
  paths,
  walk,
  origin,
  declaredRoutes,
  at,
}: {
  paths: GithubAtlasPaths;
  walk: GithubWebWalkResult;
  origin: string;
  declaredRoutes: ReadonlySet<string>;
  at: string;
}): Result<WebSurfaceOutcome> {
  const snapshot = readGithubAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { observedPages, observedRequests } = projectWalk({ at, declaredRoutes, origin, walk });
  const gaps = walkGaps({ at, walk });
  const closed = frontierClosed({ walk });
  // A page is credited as landed only when it was also photographed — `outcomeOf` already refuses to grade
  // an unphotographed page as landed, so these two counts are the same number by construction.
  const photographed = walk.pages.filter((page) => page.outcome === "landed").length;
  const folded = foldBothBrowserKinds({
    at,
    closed,
    gaps,
    observedPages,
    observedRequests,
    snapshot: snapshot.value,
    walk,
  });
  if (folded.isErr()) {
    return err(folded.error);
  }
  const files = folded.value;

  const prior = snapshot.value.manifest;
  const written = publishGithubAtlas({
    derivedFrom: prior,
    files,
    manifest: stampBrowserKinds({ at, files, prior }),
    paths,
  });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    landedCount: photographed,
    pageCount: walk.pages.length,
    photographedCount: photographed,
    requestCount: observedRequests.length,
    undeclaredRequestCount: observedRequests.filter((request) => !request.declaredInOpenApi).length,
    written: written.value,
  });
}

/**
 * Merge both browser kinds into their stored files.
 *
 * @param observedPages the projected admin pages
 * @param observedRequests the projected web requests
 * @param snapshot the generation currently on disk
 * @param gaps the gaps this walk raised
 * @param closed whether frontier expansion reached a fixed point
 * @param walk what the walk produced, for the page coverage reason
 * @param at this run's ISO timestamp
 * @returns the two files to publish, or the first refusal
 */
function foldBothBrowserKinds({
  observedPages,
  observedRequests,
  snapshot,
  gaps,
  closed,
  walk,
  at,
}: {
  observedPages: readonly GithubAdminPage[];
  observedRequests: readonly GithubWebRequest[];
  snapshot: { files: Readonly<Record<GithubKind, GithubKindFile | null>> };
  gaps: readonly GithubGap[];
  closed: boolean;
  walk: GithubWebWalkResult;
  at: string;
}): Result<Partial<Record<GithubKind, GithubKindFile>>> {
  const storedPages = snapshot.files["admin-page"];
  const storedRequests = snapshot.files["web-request"];
  const pageFile = foldBrowserKind({
    at,
    closed,
    coverageReason: pageCoverageReason({ closed, walk }),
    gaps,
    kind: "admin-page",
    observed: observedPages,
    stored: storedPages?.kind === "admin-page" ? storedPages : null,
  });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const undeclared = observedRequests.filter((request) => !request.declaredInOpenApi).length;
  const requestFile = foldBrowserKind({
    at,
    closed,
    coverageReason: `${String(observedRequests.length)} distinct endpoint(s) observed, of which ${String(undeclared)} are not declared in GitHub's own published description`,
    gaps,
    kind: "web-request",
    observed: observedRequests,
    stored: storedRequests?.kind === "web-request" ? storedRequests : null,
  });
  return requestFile.isErr()
    ? err(requestFile.error)
    : ok({ "admin-page": pageFile.value, "web-request": requestFile.value });
}

/** Merge one browser kind's fresh observations into its stored file, with this run's coverage and gaps. */
function foldBrowserKind<TEntity extends GithubAdminPage | GithubWebRequest>({
  kind,
  observed,
  stored: storedFile,
  coverageReason,
  gaps,
  closed,
  at,
}: {
  kind: "admin-page" | "web-request";
  observed: readonly TEntity[];
  stored: { entities: readonly TEntity[]; coverage: GithubKindFile["coverage"]; gaps: GithubKindFile["gaps"] } | null;
  coverageReason: string;
  gaps: readonly GithubGap[];
  closed: boolean;
  at: string;
}): Result<GithubKindFile> {
  const stored = storedFile ?? { coverage: [], entities: [], gaps: [] };
  const proof = provenCompleteRead({
    kind,
    observed: observed.length,
    // A walk that closed its own frontier has seen everything it can see, which is what lets an absent page
    // be staled. Anything else — a lost session, an unvisited frontier entry, a failed navigation, a lost
    // body, a failed link read — has not, and `frontierClosed` is where all of those are judged.
    pagesExhausted: closed,
    reportedTotal: null,
  });
  const merged = mergeGithubKind({
    at,
    complete: proof.isErr() ? null : proof.value,
    observed,
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const reconciled = reconcileGaps({
    at,
    observed: gaps.filter((gap) => gap.kind === kind),
    rechecks: [],
    runFailed: false,
    stored: stored.gaps,
  });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return assembleGithubKindFile({
    at,
    coverage: replaceGithubCoverageCell({
      cell: browserCoverageCell({ at, closed, kind, reason: coverageReason }),
      cells: stored.coverage,
    }),
    entities: merged.value,
    gaps: reconciled.value,
    kind,
  });
}

/**
 * The coverage cell one browser kind earns from this walk.
 *
 * `synced` ONLY when the frontier closed. Otherwise the walk populated the surface without exhausting it,
 * which is exactly what `deferred` means — and is what the sibling CrowdStrike walk fails to say, its
 * coverage helper writing `synced` even for a `--limit` run.
 *
 * @param kind which browser kind the cell is for
 * @param closed whether frontier expansion reached a fixed point
 * @param reason what the walk saw, in English
 * @param at this run's ISO timestamp
 * @returns the cell
 */
function browserCoverageCell({
  kind,
  closed,
  reason,
  at,
}: {
  kind: "admin-page" | "web-request";
  closed: boolean;
  reason: string;
  at: string;
}): GithubKindFile["coverage"][number] {
  return succeededGithubCoverageCell({
    artifacts: [],
    at,
    reason,
    role: "authoritative",
    scope: githubKindScope({ kind, scopeRef: "github" }),
    state: closed ? "synced" : "deferred",
    surface: "github-web",
  });
}

/** Stamp the two browser kinds in the manifest, leaving every other kind's grading exactly as it was. */
function stampBrowserKinds({
  prior,
  files,
  at,
}: {
  prior: GithubManifest | null;
  files: Readonly<Partial<Record<GithubKind, GithubKindFile>>>;
  at: string;
}): GithubManifest {
  const base = prior ?? initialGithubManifest({ updatedAt: at });
  const kinds = { ...base.kinds };
  for (const kind of ["admin-page", "web-request"] as const) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    kinds[kind] = {
      // The kit's own publish stamps the digest; what is set here is everything it does not.
      digest: base.kinds[kind].digest,
      entityCount: file.entities.length,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { kinds, schemaVersion: base.schemaVersion, updatedAt: at };
}
