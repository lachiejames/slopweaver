/**
 * Publish the whole API channel — the published document's operations, the unauthenticated noun census and
 * the shipped client's own operation names — plus the honest `not-configured` cells for the two entity
 * kinds no token can fill yet.
 *
 * ## Three evidence bodies, one channel, and no network call but one
 *
 * Only the OpenAPI document is fetched. The census and the client bundle are COMMITTED measurements
 * (`apiProbe.ts`, `generated/clientSurface.ts`), each with its own regeneration tool and its own `--verify`
 * mode, so an ordinary sync republishes them without re-measuring. That is deliberate rather than lazy: a
 * sync that re-probed 75 nouns and re-fetched 193 bundles every time would make the cheapest verb in the
 * atlas the most expensive one, and would put a different number in the store on every run for reasons
 * nobody reviewed.
 *
 * ## What a synced cell here does and does NOT claim
 *
 * It says what Hex publishes to the anonymous internet was read in full. It says nothing about what this
 * workspace holds, which features it is entitled to, or whether any credential exists to call one of these
 * operations. `model.ts`'s `api-anonymous-published` visibility scope is that ceiling, and the `project` and
 * `resource` cells are where this atlas admits it has not reached the entities it declares.
 *
 * ## The permanent gap this atlas raises about itself
 *
 * `result-data-withheld` is raised on every sync and is never closed, because it is not a shortfall — it is
 * the owner's rule stated where a reader of coverage meets it. An atlas whose gap list went
 * quiet about a body it can name and will never hold would be leaving the reader to infer the policy from
 * an absence, which is exactly the silence `docs/atlas-intent/settled-decisions.md`'s honesty properties exist to refuse.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { publishCompiledGeneration } from "../kit/compiledPublish.js";

import { HEX_PROBE_CENSUS } from "./apiProbe.js";
import { HEX_CLIENT_SURFACE } from "./generated/clientSurface.js";
import { HEX_SPEC_PINS } from "./generated/specLock.js";
import type { HexSpecTransport } from "./specFetch.js";
import { type HexAtlasPaths, publishHexAtlas, readHexAtlas, withHexPublishLock } from "./store.js";
import { compiledFiles, syncedFiles, syncManifest } from "./sync.js";
import { type CompiledCatalogue, compileHexCatalogue, dispositionCount } from "./syncCatalogue.js";

/**
 * What compiling the API channel did.
 *
 * @internal
 */
export interface HexSyncOutcome {
  readonly apiCount: number;
  /** GraphQL operations the shipped client declares. */
  readonly graphqlCount: number;
  readonly methodCount: number;
  /** Nouns the unauthenticated census found mounted. */
  readonly mountedNouns: number;
  readonly operationCount: number;
  /** Operations mapped in full and never called for their body — the no-customer-data ruling, counted. */
  readonly withheldCount: number;
  /** Operations whose records are declared as a shape rather than stored one row each. */
  readonly shapeIndexedCount: number;
  readonly specsCompiled: number;
  readonly specsDeclared: number;
  /** Documents served at their pinned address whose bytes are not the reviewed ones. */
  readonly specsDrifted: readonly string[];
  readonly specsFailed: readonly string[];
  readonly written: readonly string[];
}

/** The critical section: read the generation, merge the API channel onto it, and publish. */
function publishCompiledSurface({
  paths,
  at,
  catalogue,
}: {
  paths: HexAtlasPaths;
  at: string;
  catalogue: CompiledCatalogue;
}): Result<HexSyncOutcome> {
  const snapshot = readHexAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const published = publishCompiledGeneration({
    compile: ({ snapshot: held }) => compiledFiles({ at, catalogue, snapshot: held }),
    filesFor: ({ compiled, snapshot: held }) => syncedFiles({ at, compiled, stored: held.files }),
    manifestFor: ({ compiled, snapshot: held }) =>
      syncManifest({
        apiCount: compiled.api.entities.length,
        at,
        manifest: held.manifest,
        methodCount: compiled.method.entities.length,
      }),
    publish: ({ files, manifest }) => publishHexAtlas({ derivedFrom: snapshot.value.manifest, files, manifest, paths }),
    snapshot: snapshot.value,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  const compiled = published.value.compiled;
  return ok({
    apiCount: compiled.api.entities.length,
    graphqlCount: HEX_CLIENT_SURFACE.graphqlOperations.length,
    methodCount: compiled.method.entities.length,
    mountedNouns: HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401").length,
    operationCount: catalogue.operationCount,
    shapeIndexedCount: dispositionCount({ disposition: "shape-index", file: compiled.method }),
    specsCompiled: catalogue.surfaces.length,
    specsDeclared: HEX_SPEC_PINS.length,
    specsDrifted: catalogue.drifts.map((drift) => drift.specId).toSorted(),
    specsFailed: catalogue.failures.map((failure) => failure.specId).toSorted(),
    withheldCount: dispositionCount({ disposition: "withheld", file: compiled.method }),
    written: published.value.written,
  });
}

/**
 * Compile the anonymous evidence and publish it onto the `api` and `method` kinds' `api` channel.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param transport how one document's bytes are obtained; a test supplies a deterministic fake
 * @returns what was published, or every reason it could not be
 */
export async function syncHexApiSurface({
  paths,
  at,
  transport,
}: {
  paths: HexAtlasPaths;
  at: string;
  transport: HexSpecTransport;
}): Promise<Result<HexSyncOutcome>> {
  const compiled = await compileHexCatalogue({ pins: HEX_SPEC_PINS, transport });
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withHexPublishLock`.
  return withHexPublishLock({
    nowIso: at,
    paths,
    publish: () => publishCompiledSurface({ at, catalogue: compiled, paths }),
  });
}
