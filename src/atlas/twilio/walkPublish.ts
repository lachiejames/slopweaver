/**
 * Turn one console walk into `page` and `method` rows on the BROWSER channel, and publish them.
 *
 * ## Why this is separate from `walk.ts`
 *
 * `walk.ts` drives a browser and is impure by nature. Everything below is a pure fold plus one publish, so
 * the projection — what a signed-out walk records, how an observed operation becomes a row, which gaps a
 * short walk raises — is provable against a fixture rather than against a live console.
 *
 * ## What the browser channel is worth, and what it is not
 *
 * `authoritative` for the navigation surface: which pages exist and what each settles on is a fact only the
 * console can state. Never more than `discovery` for the operations it observes — seeing the first-party
 * client call something establishes that it EXISTS and says nothing about what a token may ask for.
 * `docs/atlas-intent/04-corroboration.md` is explicit that a browser-only method is a lead rather than a capability.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { browserObservationView } from "../kit/channelEntity.js";
import { paramNamesOf, pathShapeOf } from "../kit/consoleFold.js";
import { publishWalkedGeneration, walkedKindStatuses } from "../kit/frontierWalk.js";
import { foldObservedOperations } from "../kit/observedOperations.js";
import { TWILIO_BROWSER_PAGES } from "./browserPages.js";
import { twilioEntityId } from "./identity.js";
import { mergeTwilioChannel } from "./merge.js";
import {
  emptyTwilioKindFile,
  initialTwilioManifest,
  type TwilioAtlasEntity,
  type TwilioAtlasKindFile,
  type TwilioAtlasManifest,
  type TwilioMethodBrowserDetail,
} from "./model.js";
import { publishTwilioAtlas, readTwilioAtlas, type TwilioAtlasPaths, withTwilioPublishLock } from "./store.js";
import { TWILIO_BROWSER_UNBLOCKED_BY } from "./sync.js";
import type { ObservedConsoleCall, TwilioWalkResult } from "./walk.js";
import { projectTwilioPages, walkedPageFile } from "./walkPages.js";
import { classifyTwilioSegment, TWILIO_TELEMETRY_PARAM, twilioResponseFieldPaths } from "./webReduction.js";

/**
 * What publishing one walk did.
 *
 * @internal
 */
export interface TwilioWalkOutcome {
  readonly declaredRoutes: number;
  readonly discoveredRoutes: number;
  readonly landed: number;
  readonly methodRows: number;
  readonly photographed: number;
  readonly region: string;
  readonly signedOut: boolean;
  readonly written: readonly string[];
}

/** The provider key an observed call folds on — method plus redacted path shape. */
function callKey({ call }: { call: ObservedConsoleCall }): string {
  return `${call.method} ${pathShapeOf({ classify: classifyTwilioSegment, url: call.url }) ?? call.url}`;
}

/** The origin an observed call went to, so a console-only host is visible as one. */
function callHost({ call }: { call: ObservedConsoleCall }): string {
  try {
    return new URL(call.url).origin;
  } catch {
    return "unknown";
  }
}

/**
 * Project every operation the console called into a `method` entity on the browser channel.
 *
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation the console's own client called
 */
export function projectTwilioObservedMethods({
  walk,
  at,
}: {
  walk: TwilioWalkResult;
  at: string;
}): readonly TwilioAtlasEntity[] {
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
  const folded = foldObservedOperations<ObservedConsoleCall>({
    fieldsOf: ({ call }) => twilioResponseFieldPaths({ body: call.body }),
    keyOf: callKey,
    pages,
  });
  const parametersByKey = foldParameterNames({ pages });
  return [...folded.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([providerId, observed]) => {
      const detail: TwilioMethodBrowserDetail = {
        callCount: observed.callCount,
        host: callHost({ call: observed.call }),
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
 * Every query parameter NAME each observed endpoint was sent, widened across the pages that called it.
 *
 * Folded here rather than smuggled through `foldObservedOperations`'s `fieldsOf`, which widens RESPONSE
 * fields: mixing the two would put a query parameter name into the response shape map, which is a
 * different claim about the endpoint.
 *
 * @param pages each page's observed calls
 * @returns the names per provider key, sorted
 *
 * @internal
 */
function foldParameterNames({
  pages,
}: {
  pages: readonly { readonly calls: readonly ObservedConsoleCall[] }[];
}): ReadonlyMap<string, readonly string[]> {
  const byKey = Map.groupBy(
    pages.flatMap((page) => page.calls),
    (call) => callKey({ call }),
  );
  return new Map(
    [...byKey.entries()].map(([key, calls]) => [
      key,
      [
        ...new Set(calls.flatMap((call) => paramNamesOf({ telemetryParam: TWILIO_TELEMETRY_PARAM, url: call.url }))),
      ].toSorted(),
    ]),
  );
}

/** One observed operation as a method entity carrying only the browser channel. */
function observedMethodEntity({
  providerId,
  detail,
  deepLink,
  at,
}: {
  providerId: string;
  detail: TwilioMethodBrowserDetail;
  deepLink: string;
  at: string;
}): TwilioAtlasEntity {
  return {
    channels: {
      api: null,
      browser: browserObservationView({ artifacts: [], at, deepLink, detail, endpoint: providerId }),
    },
    id: twilioEntityId({ kind: "method", providerId }),
    kind: "method",
    providerId,
  };
}

/**
 * Publish one walk onto the `page` and `method` kinds' browser channel.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk observed
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishTwilioWalk({
  paths,
  walk,
  at,
}: {
  paths: TwilioAtlasPaths;
  walk: TwilioWalkResult;
  at: string;
}): Result<TwilioWalkOutcome> {
  return withTwilioPublishLock({ nowIso: at, paths, publish: () => publishUnderLock({ at, paths, walk }) });
}

/** The critical section: read the generation, merge the browser channel onto it, and publish. */
function publishUnderLock({
  paths,
  walk,
  at,
}: {
  paths: TwilioAtlasPaths;
  walk: TwilioWalkResult;
  at: string;
}): Result<TwilioWalkOutcome> {
  const snapshot = readTwilioAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const storedPages = snapshot.value.files.page ?? emptyTwilioKindFile({ kind: "page", updatedAt: at });
  const storedMethods = snapshot.value.files.method ?? emptyTwilioKindFile({ kind: "method", updatedAt: at });
  const published = publishWalkedGeneration<
    TwilioAtlasEntity,
    Parameters<typeof publishTwilioAtlas>[0]["files"],
    Parameters<typeof publishTwilioAtlas>[0]["manifest"]
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
    publish: ({ files, manifest }) =>
      publishTwilioAtlas({ derivedFrom: snapshot.value.manifest, files, manifest, paths }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    declaredRoutes: TWILIO_BROWSER_PAGES.length,
    discoveredRoutes: walk.pages.filter((page) => page.discoveredFrom !== null).length,
    landed: walk.pages.filter((page) => page.outcome === "landed").length,
    methodRows: published.value.methodCount,
    photographed: walk.artifactsWritten,
    region: walk.region,
    signedOut: walk.signedOut,
    written: published.value.written,
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
  storedPages: TwilioAtlasKindFile;
  storedMethods: TwilioAtlasKindFile;
  walk: TwilioWalkResult;
  at: string;
}): Result<{ methods: readonly TwilioAtlasEntity[]; pages: readonly TwilioAtlasEntity[] }> {
  const pages = mergeTwilioChannel({
    at,
    channel: "browser",
    observed: projectTwilioPages({ at, walk }),
    stored: storedPages.entities,
  });
  if (pages.isErr()) {
    return err(pages.error);
  }
  const methods = mergeTwilioChannel({
    at,
    channel: "browser",
    observed: projectTwilioObservedMethods({ at, walk }),
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
  manifest: TwilioAtlasManifest | null;
  pageCount: number;
  methodCount: number;
  signedOut: boolean;
  at: string;
}): TwilioAtlasManifest {
  const base = manifest ?? initialTwilioManifest({ updatedAt: at });
  const stamped = walkedKindStatuses({
    at,
    heldMethodSuccess: base.kinds.method.lastSuccessAt,
    heldPageSuccess: base.kinds.page.lastSuccessAt,
    methodCount,
    pageCount,
    signedOut,
    signedOutReason: TWILIO_BROWSER_UNBLOCKED_BY,
  });
  const kinds = { ...base.kinds, method: { ...base.kinds.method, ...stamped.method }, page: stamped.page };
  return { ...base, kinds, updatedAt: at };
}
