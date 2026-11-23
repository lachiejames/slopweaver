/**
 * `atlas datadog reset` — archive the whole current atlas, then install a fresh, empty generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is Datadog's own is
 * only the shape of an EMPTY generation — one file per kind, so the freshly installed one is complete
 * rather than partial. The archive lands under `$SLOPWEAVER_HOME/atlas/_superseded/datadog/`.
 *
 * It is also the remedy `store.ts`'s `DATADOG_SUPERSEDE_REMEDY` names when a generation on disk carries a
 * schema version this build no longer writes, which is why the verb has to exist for the store's own error
 * message to be true.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { type DatadogKindFile, emptyDatadogManifest } from "./documents.js";
import { DATADOG_KINDS, type DatadogKind } from "./model.js";
import { datadogAtlasPaths, datadogStoreSpec } from "./store.js";
import { emptyDatadogKindFile } from "./sync.js";

/**
 * What a reset did.
 * @internal
 */
export type DatadogResetOutcome = AtlasResetOutcome;

/** An empty file for every kind, so the freshly installed generation is complete rather than partial. */
function emptyDatadogFiles({ at }: { at: string }): Readonly<Record<DatadogKind, DatadogKindFile>> {
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive DATADOG_KINDS, so the
  // narrower kind-keyed type is sound. Same convention as `microsoft365/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(DATADOG_KINDS.map((kind) => [kind, emptyDatadogKindFile({ at, kind })])) as Record<
    DatadogKind,
    DatadogKindFile
  >;
}

/**
 * Archive the current atlas and install a fresh, empty generation in its place.
 *
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @param home the resolved `$SLOPWEAVER_HOME`; omitted takes the ambient one
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetDatadogAtlas({ at, home }: { at: string; home?: string }): Result<DatadogResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyDatadogFiles({ at }),
    emptyManifest: emptyDatadogManifest({ updatedAt: at }),
    paths: datadogAtlasPaths(home === undefined ? {} : { home }),
    spec: datadogStoreSpec(),
  });
}
