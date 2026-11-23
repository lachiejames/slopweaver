/**
 * Parse the Falcon console's own published navigation document into the walk's route list.
 *
 * ## Why this is the denominator, and why that matters
 *
 * A crawl cannot prove its own completeness: it finds what it finds, and "we visited everything we found"
 * is a claim about the crawler rather than about the console. Falcon publishes
 * `/content/sitemap-v2/index.json`, which declares every page the console has — measured at 606
 * internal hrefs across 79 modules — so the walk gets a denominator it did not choose for itself. A route
 * declared here and never visited is a GAP the atlas can name; a route the crawler never noticed is not.
 *
 * ## Declared is not the same as reachable, and neither is the same as openable
 *
 * Three distinct facts, and conflating them is how a walk reports coverage it never earned. A page declared
 * here may 404, may redirect, or may be gated behind a feature flag or a permission the signed-in account lacks —
 * every declaration carries its own `featureFlags` and `permissions`, which is why they are kept. So a 404
 * or a redirect is a completed attempt against a real declaration, recorded as a gap, and never a failure
 * of the walk itself.
 *
 * ## Gates are INHERITED, which is why this walks with context rather than per-node
 *
 * The console declares `appName` and `checks` on a SECTION and lists its pages as `links` beneath it, so a
 * link's real gate is its own `checks` plus every ancestor's. Reading only the node that carries the `href`
 * loses the section's flags entirely and reports a gated page as ungated — which then reads as an
 * unexplained 404 during the walk instead of a page the signed-in account was never going to open.
 *
 * The vendor's own module names and permission strings are CONTENT: they belong in the generation under the
 * private state home and must never reach a committed fixture or a test name.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";

/** One page the console declares, canonicalised, with the gates the console says apply to it. */
export interface FalconRouteDeclaration {
  /** Same-origin path plus sorted query, no fragment. The stable identity of a console page. */
  readonly href: string;
  /** The console app that owns the page, as the sitemap spells it; `null` when it declares none. */
  readonly appName: string | null;
  /** Feature flags the console requires for this page, sorted. */
  readonly featureFlags: readonly string[];
  /** Permission strings the console requires for this page, sorted. */
  readonly permissions: readonly string[];
}

/**
 * The whole parsed document: every declared internal route, plus what was dropped and why.
 *
 * @internal
 */
export interface FalconSitemap {
  readonly routes: readonly FalconRouteDeclaration[];
  /** Hrefs declared more than once, collapsed to one route — a gap, not a silent drop. */
  readonly duplicateHrefs: readonly string[];
  /** Count of declarations pointing off-origin, which the walk does not visit. */
  readonly externalCount: number;
  /**
   * Count of declarations that are TEMPLATES the console substitutes at run time — `{env.…}`, `{i18n.…}`.
   *
   * Dropped rather than walked, and counted rather than dropped silently. MEASURED: the first
   * three routes in sort order were `{env.IDEAS_PORTAL_URL}` and two `{i18n.…}` legal-notice links, all of
   * which resolve OFF this origin. Visiting one spends a page visit to reach a 404 and then records a gap
   * against a page that does not exist, which is a coverage table lying in the expensive direction.
   */
  readonly templatedCount: number;
}

/**
 * Parse a URL, or `null` when it is not one — so a caller branches on a value rather than on a throw.
 *
 * @param value the candidate URL
 * @param base an optional base for a relative reference
 * @returns the parsed URL, or `null`
 */
function parseUrl({ value, base }: { value: string; base?: string }): URL | null {
  try {
    return base === undefined ? new URL(value) : new URL(value, base);
  } catch {
    return null;
  }
}

/** Is this an object we can read properties from? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** What a node inherits from the sections above it while the document is walked. */
interface InheritedGates {
  readonly appName: string | null;
  readonly featureFlags: readonly string[];
  readonly permissions: readonly string[];
}

/** Sorted, de-duplicated strings from an unknown array; anything non-string is dropped. */
function stringSet({ value }: { value: unknown }): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const kept = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return [...new Set(kept)].toSorted();
}

/**
 * Canonicalise a declared href: same-origin path plus sorted query, fragment removed.
 *
 * A fragment is a position on a page rather than a different page, and two declarations differing only by
 * query order are the same destination. Both would otherwise inflate the denominator with duplicates that
 * the walk would then dutifully visit twice.
 *
 * @param href the raw href as declared
 * @param origin the console origin every route must belong to
 * @returns the canonical path, or `null` when the href is off-origin or unparseable
 */
export function canonicaliseFalconHref({ href, origin }: { href: string; origin: string }): string | null {
  const parsed = parseUrl({ base: origin, value: href });
  const base = parseUrl({ value: origin });
  if (parsed === null || base === null || parsed.origin !== base.origin) {
    return null;
  }
  const params = [...parsed.searchParams.entries()].toSorted(([a], [b]) => compareStrings({ a, b }));
  const query = params.map(([key, value]) => `${key}=${value}`).join("&");
  return query.length > 0 ? `${parsed.pathname}?${query}` : parsed.pathname;
}

/** Stable string ordering, hoisted so every sort in this module uses the same comparator. */
function compareStrings({ a, b }: { a: string; b: string }): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * The gates in force at one node: its own, added to everything its ancestors declared.
 *
 * @param node the sitemap node being visited
 * @param inherited what the sections above it already require
 * @returns the accumulated context to hand to this node's children
 */
function gatesAt({ node, inherited }: { node: Record<string, unknown>; inherited: InheritedGates }): InheritedGates {
  const checks = isRecord(node["checks"]) ? node["checks"] : {};
  const permissionsValue = checks["permissions"];
  return {
    appName: typeof node["appName"] === "string" ? node["appName"] : inherited.appName,
    featureFlags: [...inherited.featureFlags, ...stringSet({ value: checks["featureFlags"] })],
    permissions: [...inherited.permissions, ...(isRecord(permissionsValue) ? Object.keys(permissionsValue) : [])],
  };
}

/**
 * An href the console fills in at run time rather than a path — `{env.X}`, `{i18n.t-….y}`, percent-encoded.
 *
 * Matched on the braces alone, in either spelling, because what makes it unwalkable is that the literal
 * string is not a URL: whatever the substitution is for, this atlas cannot perform it.
 */
const TEMPLATED_HREF = /\{|%7B/iu;

/** What one walk of the document accumulated. */
interface WalkState {
  readonly byHref: Map<string, FalconRouteDeclaration>;
  readonly duplicates: Set<string>;
  externalCount: number;
  templatedCount: number;
  sawHref: boolean;
}

/** Record one node's `href`, if it has one, against the gates in force at it. */
function recordHref({
  rawHref,
  context,
  origin,
  state,
}: {
  rawHref: string;
  context: InheritedGates;
  origin: string;
  state: WalkState;
}): void {
  state.sawHref = true;
  if (TEMPLATED_HREF.test(rawHref)) {
    state.templatedCount += 1;
    return;
  }
  const href = canonicaliseFalconHref({ href: rawHref, origin });
  if (href === null) {
    state.externalCount += 1;
    return;
  }
  if (state.byHref.has(href)) {
    state.duplicates.add(href);
    return;
  }
  state.byHref.set(href, {
    appName: context.appName,
    featureFlags: [...new Set(context.featureFlags)].toSorted(),
    href,
    permissions: [...new Set(context.permissions)].toSorted(),
  });
}

/** Walk one node and everything beneath it, threading the gates its ancestors declared. */
function walkNode({
  node,
  inherited,
  origin,
  state,
}: {
  node: unknown;
  inherited: InheritedGates;
  origin: string;
  state: WalkState;
}): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      walkNode({ inherited, node: child, origin, state });
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const context = gatesAt({ inherited, node });
  const rawHref = node["href"];
  if (typeof rawHref === "string" && rawHref.length > 0) {
    recordHref({ context, origin, rawHref, state });
  }
  for (const child of Object.values(node)) {
    walkNode({ inherited: context, node: child, origin, state });
  }
}

/**
 * Parse the console's sitemap document into canonical routes.
 *
 * Walks the document structurally rather than assuming its nesting, because the shape is the vendor's and
 * is not versioned for us: any object carrying a string `href` is a declaration, wherever it sits. Refuses
 * rather than returning an empty list, so a document that changed shape is a loud failure instead of a walk
 * that quietly visits nothing and reports full coverage.
 *
 * @param json the parsed document, straight from the console
 * @param origin the console origin, used to reject off-origin declarations
 * @returns the canonical routes and what was dropped, or the reasons the document was unusable
 */
export function parseFalconSitemap({ json, origin }: { json: unknown; origin: string }): Result<FalconSitemap> {
  if (parseUrl({ value: origin }) === null) {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.sitemapOriginInvalid({ origin }) }));
  }
  const state: WalkState = {
    byHref: new Map<string, FalconRouteDeclaration>(),
    duplicates: new Set<string>(),
    externalCount: 0,
    sawHref: false,
    templatedCount: 0,
  };
  walkNode({ inherited: { appName: null, featureFlags: [], permissions: [] }, node: json, origin, state });
  if (!state.sawHref) {
    return err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.sitemapWithoutHref() }));
  }
  return ok({
    duplicateHrefs: [...state.duplicates].toSorted(),
    externalCount: state.externalCount,
    templatedCount: state.templatedCount,
    routes: [...state.byHref.values()].toSorted((a, b) => compareStrings({ a: a.href, b: b.href })),
  });
}
