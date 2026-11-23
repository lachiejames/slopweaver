/**
 * The gaps publishing the Figma surface maps opens: what the pinned document itself says the REST surface
 * cannot do, and which declared routes the signed-out probe confirmed only down to their gated prefix.
 *
 * Which gaps a run opens, and the one class it deliberately does not, is `./sync.ts`'s header; the gap
 * record and its reconciliation are `./gaps.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { FIGMA_BROWSER_PAGES, figmaAbsentRoutes, figmaConfirmedRoutes } from "./browserPages.js";
import { type FigmaGapRecheck, openFigmaGap, reconcileFigmaGaps } from "./gaps.js";
import { FIGMA_FULLY_DEPRECATED_TAGS, FIGMA_UNDECLARED_ENDPOINTS } from "./generated/specLock.js";
import type { FigmaAtlasGap, FigmaAtlasKindFile } from "./model.js";

/**
 * The method kind's gaps: what the pinned document itself says the REST surface cannot do.
 *
 * All three conditions are open by construction — nothing this atlas does can close any of them, and only
 * Figma publishing an endpoint can. They are here because an atlas that cannot close a gap should still be
 * the thing that says it is there.
 *
 * @returns the method file with its gaps reconciled against this run's findings
 */
export function methodGapsOnto({ file, at }: { file: FigmaAtlasKindFile; at: string }): Result<FigmaAtlasKindFile> {
  const deprecatedTags: readonly FigmaAtlasGap[] = FIGMA_FULLY_DEPRECATED_TAGS.map((tag) =>
    openFigmaGap({
      at,
      condition: "provider-declares-tag-wholly-deprecated",
      fields: [],
      kind: "method",
      reason:
        `every operation Figma's own OpenAPI document publishes under the tag "${tag}" carries ` +
        "`deprecated: true`, so a whole declared surface has been retired in place rather than removed. " +
        "The browser corroborates the succession from the other side: `/files/project/{projectId}` answers " +
        "`resource_type=folder` on its sign-in redirect, which is the v2 Folders vocabulary for the noun " +
        "the v1 API still calls a project. Only Figma removing or reviving the tag closes this",
      scope: `tag:${tag}`,
      surfaces: ["api", "browser"],
    }),
  );
  const undeclared: readonly FigmaAtlasGap[] = FIGMA_UNDECLARED_ENDPOINTS.map((endpoint) =>
    openFigmaGap({
      at,
      condition: "spec-references-undeclared-endpoint",
      fields: [],
      kind: "method",
      reason:
        `the document names ${endpoint.method} ${endpoint.url} at \`${endpoint.namedAt}\` and declares no ` +
        `path for it, so it appears in no operation listing. It holds ${endpoint.holds}. A reader who ` +
        "enumerated `paths` alone would conclude Figma has no OAuth surface at all",
      scope: `endpoint:${endpoint.method} ${endpoint.url}`,
      surfaces: ["api"],
    }),
  );
  const rootless = openFigmaGap({
    at,
    condition: "api-serves-no-root-enumerator",
    fields: [],
    kind: "method",
    reason:
      "no operation in the document returns the set of teams or organisations a credential can see. The " +
      "whole `Users` tag is `GET /v1/me`, which describes the caller and lists nothing, so every " +
      "team-scoped operation — components, component sets, styles, folders, the deprecated projects — " +
      "requires a `team_id` that only a browser URL supplies. This is the single fact that makes the " +
      "browser surface mandatory rather than corroborating on this platform, and only Figma publishing an " +
      "endpoint closes it",
    scope: "api:root-enumeration",
    surfaces: ["api"],
  });
  const observed = [...deprecatedTags, ...undeclared, rootless];
  const rechecks: readonly FigmaGapRecheck[] = observed.map((gap) => ({
    condition: gap.condition,
    resolved: false,
    scope: gap.scope,
  }));
  const reconciled = reconcileFigmaGaps({ at, observed, rechecks, runFailed: false, stored: file.gaps });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return ok({ ...file, gaps: [...reconciled.value] });
}

/**
 * The page kind's gaps: one per route whose own existence the signed-out probe could not establish.
 *
 * Unlike the method gaps these ARE closable, and by something this repository can do: a walk in the owner's
 * own Chrome opens the route with a session and either finds the page or does not. So each one names the
 * route rather than the class, and a walk closes them one at a time as it reaches them.
 *
 * @returns the page file with one gap reconciled per prefix-only route
 */
export function routeGapsOnto({ file, at }: { file: FigmaAtlasKindFile; at: string }): Result<FigmaAtlasKindFile> {
  const confirmed = new Set(figmaConfirmedRoutes().map((page) => page.route));
  const absent = new Set(figmaAbsentRoutes().map((page) => page.route));
  const unconfirmed = FIGMA_BROWSER_PAGES.filter((page) => !confirmed.has(page.route) && !absent.has(page.route));
  const observed: readonly FigmaAtlasGap[] = unconfirmed.map((page) =>
    openFigmaGap({
      at,
      condition: "browser-page-existence-unconfirmed",
      fields: [],
      kind: "page",
      reason:
        `an unauthenticated request to ${page.route} is refused by Figma's sign-in gate before its router ` +
        "resolves the leaf, and an invented sibling in the same position answers identically — so the " +
        "gated PREFIX is confirmed and this route is not. It is declared because the product plainly has " +
        `it and it holds ${page.holds}. A walk with a signed-in session closes this route's own gap`,
      scope: `route:${page.route}`,
      surfaces: ["browser"],
    }),
  );
  const rechecks: readonly FigmaGapRecheck[] = observed.map((gap) => ({
    condition: gap.condition,
    resolved: false,
    scope: gap.scope,
  }));
  const reconciled = reconcileFigmaGaps({ at, observed, rechecks, runFailed: false, stored: file.gaps });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return ok({ ...file, gaps: [...reconciled.value] });
}
