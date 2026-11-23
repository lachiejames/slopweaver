/**
 * Turn one app walk into `page` and `method` rows on the BROWSER channel, and publish them.
 *
 * ## Why this is separate from `walk.ts`
 *
 * `walk.ts` drives a browser and is impure by nature. Everything below is a pure fold plus one publish, so
 * the projection — what a signed-out walk records, how an observed operation becomes a row, which gaps a
 * short walk raises, and what a withheld body leaves behind — is provable against a fixture rather than
 * against a live app.
 *
 * ## What the browser channel is worth, and what it is not
 *
 * `authoritative` for the navigation surface: which pages exist and what each settles on is a fact only the
 * app can state. Never more than `discovery` for the operations it observes — seeing the first-party client
 * call something establishes that it EXISTS and says nothing about what a token may ask for.
 * `docs/atlas-intent/04-corroboration.md` is explicit that a browser-only method is a lead rather than a capability.
 *
 * ## The withheld rows are the ones to read this file for
 *
 * `webReduction.ts` decides, per observed call, whether this atlas may describe the response at all. A call
 * it refuses still gets a full row — its method, its path shape, its host, its call count, the pages it
 * fired on — with an EMPTY `responseFields` and a stored sentence in `fieldsWithheldBecause` saying why.
 * That pairing is the whole design: the atlas records that Hex has a way to fetch a cell's output, on which
 * page it happens and how often, and holds nothing whatever about the rows that came back.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { browserObservationView } from "../kit/channelEntity.js";
import { paramNamesOf, pathShapeOf } from "../kit/consoleFold.js";
import { publishWalkedGeneration, walkedKindStatuses } from "../kit/frontierWalk.js";
import { foldObservedOperations } from "../kit/observedOperations.js";

import { hexDeclaredPages } from "./browserPages.js";
import { hexEntityId } from "./identity.js";
import { mergeHexChannel } from "./merge.js";
import {
  emptyHexKindFile,
  type HexAtlasEntity,
  type HexAtlasKindFile,
  type HexAtlasManifest,
  type HexMethodBrowserDetail,
  initialHexManifest,
} from "./model.js";
import { hexGraphqlProviderId } from "./projection.js";
import { type HexAtlasPaths, publishHexAtlas, readHexAtlas, withHexPublishLock } from "./store.js";
import { HEX_BROWSER_UNBLOCKED_BY } from "./sync.js";
import type { HexWalkResult, ObservedHexCall } from "./walk.js";
import { projectHexPages, walkedPageFile } from "./walkPages.js";
import {
  classifyHexSegment,
  HEX_TELEMETRY_PARAM,
  hexGraphqlOperationName,
  hexResponseFieldPaths,
  isHexResultBearing,
} from "./webReduction.js";

/**
 * What publishing one walk did.
 *
 * @internal
 */
export interface HexWalkOutcome {
  readonly declaredRoutes: number;
  readonly discoveredRoutes: number;
  readonly landed: number;
  readonly methodRows: number;
  readonly photographed: number;
  readonly signedOut: boolean;
  /** Observed operations whose response body this atlas refused to describe at all. */
  readonly withheldRows: number;
  readonly written: readonly string[];
}

/**
 * The provider key an observed call folds on.
 *
 * A GraphQL call folds on its operation NAME rather than on its path, and that is what makes this channel
 * corroborable against the compiled client bundle at all: every GraphQL call in the app goes to the same
 * `/graphql` path, so a path-shaped key would fold forty-eight distinct operations into one row and destroy
 * the comparison `report.ts` exists to make.
 *
 * @param call one observed first-party call
 * @returns `GRAPHQL <name>` for a GraphQL call, else `<METHOD> <path shape>`
 */
export function callKey({ call }: { call: ObservedHexCall }): string {
  const operation = hexGraphqlOperationName({ url: call.url });
  if (operation !== null) {
    return hexGraphqlProviderId({ name: operation });
  }
  return `${call.method} ${pathShapeOf({ classify: classifyHexSegment, url: call.url }) ?? call.url}`;
}

/** The origin an observed call went to, so a client-only host is visible as one. */
function callHost({ call }: { call: ObservedHexCall }): string {
  try {
    return new URL(call.url).origin;
  } catch {
    return "unknown";
  }
}

/**
 * Every query parameter NAME each observed endpoint was sent, widened across the pages that called it.
 *
 * Folded here rather than through `foldObservedOperations`'s `fieldsOf`, which widens RESPONSE fields:
 * mixing the two would put a query parameter name into the response shape map, which is a different claim
 * about the endpoint.
 *
 * @param pages each page's observed calls
 * @returns the names per provider key, sorted
 */
function foldParameterNames({
  pages,
}: {
  pages: readonly { readonly calls: readonly ObservedHexCall[] }[];
}): ReadonlyMap<string, readonly string[]> {
  const byKey = Map.groupBy(
    pages.flatMap((page) => page.calls),
    (call) => callKey({ call }),
  );
  return new Map(
    [...byKey.entries()].map(([key, calls]) => [
      key,
      [
        ...new Set(calls.flatMap((call) => paramNamesOf({ telemetryParam: HEX_TELEMETRY_PARAM, url: call.url }))),
      ].toSorted(),
    ]),
  );
}

/**
 * Why one operation's response is never described, or `null` when none of its calls carried a result set —
 * {@link foldWithholdings} holds a reason only for the operations that earned one.
 */
function withheldBecause({
  withheld,
  providerId,
}: {
  withheld: ReadonlyMap<string, string>;
  providerId: string;
}): string | null {
  const reason = withheld.get(providerId);
  if (reason === undefined) {
    return null;
  }
  return reason;
}

/**
 * Why one observed operation's response is never described, widened across the calls that reached it.
 *
 * An operation withheld on ANY observed call is withheld on the row, and that asymmetry is deliberate: the
 * decision is about what may be stored, so one call carrying a result set is enough to settle it for the
 * whole row. The alternative — describing an operation from its innocent calls — would put a result set's
 * shape in the store the first time the same endpoint answered differently.
 *
 * @param pages each page's observed calls
 * @returns the reason per provider key, for the keys that carry one
 */
function foldWithholdings({
  pages,
}: {
  pages: readonly { readonly calls: readonly ObservedHexCall[] }[];
}): ReadonlyMap<string, string> {
  const held = new Map<string, string>();
  for (const page of pages) {
    for (const call of page.calls) {
      const reason = isHexResultBearing({ url: call.url });
      if (reason !== null) {
        held.set(callKey({ call }), reason);
      }
    }
  }
  return held;
}

/** One observed operation as a method entity carrying only the browser channel. */
function observedMethodEntity({
  providerId,
  detail,
  deepLink,
  at,
}: {
  providerId: string;
  detail: HexMethodBrowserDetail;
  deepLink: string;
  at: string;
}): HexAtlasEntity {
  return {
    channels: {
      api: null,
      browser: browserObservationView({ artifacts: [], at, deepLink, detail, endpoint: providerId }),
    },
    id: hexEntityId({ kind: "method", providerId }),
    kind: "method",
    providerId,
  };
}

/**
 * Project every operation the app called into a `method` entity on the browser channel.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation the app's own client called
 */
export function projectHexObservedMethods({
  walk,
  at,
}: {
  walk: HexWalkResult;
  at: string;
}): readonly HexAtlasEntity[] {
  // A page the browser never settled on made no call to fold, so it is dropped rather than contributing an
  // empty `finalUrl` — the kit uses that field as the reproduction link, and an empty one is a link that
  // says nothing while looking like one.
  const pages = walk.pages
    .filter((page): page is typeof page & { finalUrl: string } => page.finalUrl !== null)
    .map((page) => ({
      calls: walk.calls.filter((call) => call.onPage === page.route),
      finalUrl: page.finalUrl,
      surface: page.route,
    }));
  const withheld = foldWithholdings({ pages });
  const folded = foldObservedOperations<ObservedHexCall>({
    // The refusal is applied HERE, at the point the field names would enter the fold, rather than filtered
    // out afterwards: a reduction that ran and was then discarded would still have built the paths in
    // memory from a live result set, and the property worth having is that it is never computed at all.
    fieldsOf: ({ call }) =>
      isHexResultBearing({ url: call.url }) === null ? hexResponseFieldPaths({ body: call.body }) : [],
    keyOf: callKey,
    pages,
  });
  const parametersByKey = foldParameterNames({ pages });
  return [...folded.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([providerId, observed]) => {
      const detail: HexMethodBrowserDetail = {
        callCount: observed.callCount,
        fieldsWithheldBecause: withheldBecause({ providerId, withheld }),
        host: callHost({ call: observed.call }),
        operationName: hexGraphqlOperationName({ url: observed.call.url }),
        // Both folds key the same pages' calls with `callKey`, so every operation folded has an entry here.
        parameters: [...parametersByKey.get(providerId)!],
        responseFields: [...observed.responseFields],
        seenOnPages: [...observed.seenOn],
        statusCode: observed.call.statusCode,
      };
      return observedMethodEntity({ at, deepLink: observed.deepLink, detail, providerId });
    });
}

/**
 * Merge this walk's browser-channel rows onto both kinds it writes.
 *
 * Both merges in one place because they fail the same way and a caller has nothing to do differently for
 * either: a duplicate provider id in one is as fatal as in the other.
 *
 * @param storedPages the page kind as the store holds it
 * @param storedMethods the method kind as the store holds it
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns both merged entity lists, or the reason this run cannot be merged
 */
function mergeWalkedKinds({
  storedPages,
  storedMethods,
  walk,
  at,
}: {
  storedPages: HexAtlasKindFile;
  storedMethods: HexAtlasKindFile;
  walk: HexWalkResult;
  at: string;
}): Result<{ methods: readonly HexAtlasEntity[]; pages: readonly HexAtlasEntity[] }> {
  const pages = mergeHexChannel({
    at,
    channel: "browser",
    observed: projectHexPages({ at, walk }),
    stored: storedPages.entities,
  });
  if (pages.isErr()) {
    return err(pages.error);
  }
  const methods = mergeHexChannel({
    at,
    channel: "browser",
    observed: projectHexObservedMethods({ at, walk }),
    stored: storedMethods.entities,
  });
  if (methods.isErr()) {
    return err(methods.error);
  }
  return ok({ methods: methods.value, pages: pages.value });
}

/**
 * Stamp the two kinds a walk wrote.
 *
 * A signed-out walk records an ATTEMPT and no success on the page kind: it ran, and it reached nothing, and
 * those are different from each other and from never having run.
 */
function walkManifest({
  manifest,
  pageCount,
  methodCount,
  signedOut,
  at,
}: {
  manifest: HexAtlasManifest | null;
  pageCount: number;
  methodCount: number;
  signedOut: boolean;
  at: string;
}): HexAtlasManifest {
  const base = manifest ?? initialHexManifest({ updatedAt: at });
  const stamped = walkedKindStatuses({
    at,
    heldMethodSuccess: base.kinds.method.lastSuccessAt,
    heldPageSuccess: base.kinds.page.lastSuccessAt,
    methodCount,
    pageCount,
    signedOut,
    signedOutReason: HEX_BROWSER_UNBLOCKED_BY,
  });
  const kinds = { ...base.kinds, method: { ...base.kinds.method, ...stamped.method }, page: stamped.page };
  return { ...base, kinds, updatedAt: at };
}

/** The critical section: read the generation, merge the browser channel onto it, and publish. */
function publishUnderLock({
  paths,
  walk,
  at,
}: {
  paths: HexAtlasPaths;
  walk: HexWalkResult;
  at: string;
}): Result<HexWalkOutcome> {
  const snapshot = readHexAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const storedPages = snapshot.value.files.page ?? emptyHexKindFile({ kind: "page", updatedAt: at });
  const storedMethods = snapshot.value.files.method ?? emptyHexKindFile({ kind: "method", updatedAt: at });
  const published = publishWalkedGeneration<
    HexAtlasEntity,
    Parameters<typeof publishHexAtlas>[0]["files"],
    Parameters<typeof publishHexAtlas>[0]["manifest"]
  >({
    filesFor: ({ methods, pages }) => ({
      // A signed-out walk contributed nothing to the method kind, so its clock stays the spec leg's: stamping
      // `at` would pair an ok attempt at `at` with a success held at the compile instant, which
      // kit/manifestClock.ts refuses as two clocks.
      method: { ...storedMethods, entities: [...methods], updatedAt: walk.signedOut ? storedMethods.updatedAt : at },
      page: walkedPageFile({ at, entities: pages, stored: storedPages, walk }),
    }),
    manifestFor: ({ methodCount, pageCount }) =>
      walkManifest({ at, manifest: snapshot.value.manifest, methodCount, pageCount, signedOut: walk.signedOut }),
    merge: () => mergeWalkedKinds({ at, storedMethods, storedPages, walk }),
    publish: ({ files, manifest }) => publishHexAtlas({ derivedFrom: snapshot.value.manifest, files, manifest, paths }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    declaredRoutes: hexDeclaredPages().length,
    discoveredRoutes: walk.pages.filter((page) => page.discoveredFrom !== null).length,
    landed: walk.pages.filter((page) => page.outcome === "landed").length,
    methodRows: published.value.methodCount,
    photographed: walk.artifactsWritten,
    signedOut: walk.signedOut,
    withheldRows: [...foldWithholdings({ pages: [{ calls: walk.calls }] }).keys()].length,
    written: published.value.written,
  });
}

/**
 * Publish one walk onto the `page` and `method` kinds' browser channel.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishHexWalk({
  paths,
  walk,
  at,
}: {
  paths: HexAtlasPaths;
  walk: HexWalkResult;
  at: string;
}): Result<HexWalkOutcome> {
  return withHexPublishLock({ nowIso: at, paths, publish: () => publishUnderLock({ at, paths, walk }) });
}
