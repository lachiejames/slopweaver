/**
 * The LIVE `api` pass: ask THIS organisation what it holds, and publish the answer onto the `api` channel.
 *
 * ## What changes about this atlas, in one sentence
 *
 * Before this pass, every kind's `api` coverage cell said "no call has been made to this organisation for
 * this kind" and its `api-never-called` gap was open by construction. `sync.ts`'s own header states the
 * mistake that made it worth saying so loudly: **reading a compiled operation as a capability**. This pass
 * is what turns the declaration into an observation — and the first thing it establishes, per kind, is
 * whether this organisation answers at all.
 *
 * ## It publishes onto the SAME entities the compiled catalogue made — and, for three kinds, BESIDE them
 *
 * An operation entity is what `catalogue.ts` fixes the contract for: the live pass "fills the SAME entity's
 * `api` slot with what this organisation returned". So the id is `datadogEntityId({ kind, providerId:
 * row.name })`, unchanged, and `mergeDatadogChannel({ channel: "api" })` replaces only that one channel. An
 * operation the compiled catalogue has held for a month and the API first answered this morning is a fact
 * this atlas can state, because the two channels carry their own `firstSeenAt`.
 *
 * The three kinds `estateAcquisition.ts` names additionally publish THIS ORGANISATION'S OWN RECORDS as
 * entities of their own, exploded out of the list operation's answer this pass already has in hand — a
 * monitor, a dashboard, a notebook. Those carry an `api` channel and NO compiled one, because a monitor is
 * not a registry row, and that absence is how a reader tells the two apart. Before this, the estate sat
 * inside one operation entity's `detail` and nothing addressed it: `atlas datadog read --kind monitor`
 * answered "29 matching STORED entities" and every one was an SDK operation, measured twice in dogfood.
 * Both groups go onto the channel in ONE merge, because `mergeDatadogChannel` stales
 * every stored entity it does not see on the channel it is refreshing.
 *
 * ## Four remainders, each enumerated rather than omitted
 *
 * This pass reaches the 329 entity operations that take no path parameter. What it does NOT reach is
 * stated, per kind, as a coverage cell and a gap:
 *
 * - **97 of those 329 page**, and this pass keeps their first page. `apiCall.ts`'s header carries why it
 *   does not guess a cursor's location; the gap NAMES the parameter a walk must send.
 * - **An answer admitted against the specification's names alone** — an operation no census had measured
 *   answering — had its keys checked and every value left unread (`responseBoundary.ts`'s `spec-names-only`).
 * - **325 entity operations take an identifier**, and the fan-out that would supply one does not exist.
 *   Sixteen kinds have no other kind of operation at all, so for those this pass makes no call whatsoever —
 *   and their cell says that rather than reporting an empty organisation.
 * - **90 shape-index operations** are a different act (`apiAcquisition.ts` says why) and are deferred whole.
 *
 * Each remainder is computed once — the deferred sets in `apiAcquisition.ts`, the first-page and names-only
 * counts in `apiCoverage.ts`'s tally — and read from there by both the cell and the gap, because two independent
 * derivations of one number is how a report begins disagreeing with itself.
 *
 * ## Nothing here can make the `api` surface claim `filled`
 *
 * `surfaceFill.ts` derives that from the manifest against an exact invariant, and this pass cannot satisfy
 * it while four remainders stand. That is deliberate: `descriptor.ts`'s header names the sibling atlas
 * that graded its browser surface synced on pages-walked > 0 while canon recorded it reached one of nine
 * destinations, and calls "reported N, reached one" the failure this atlas refuses to repeat.
 *
 * ## Where each stage lives
 *
 * This module is the entry point and the manifest. The pass itself is four modules, and the import graph
 * between them runs one way: `./syncApiTypes.ts` is the leaf, `./syncApiEntities.ts` and
 * `./syncApiGaps.ts` each stand on it and on nothing else of the pass, `./syncApiPass.ts` stands on both,
 * and this module stands on the pass. Neither the projection nor the gap reasoning can reach back into the
 * stage that drives them.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { withKindStatus } from "../kit/manifestClock.js";
import {
  DATADOG_API_ADMITTED,
  DATADOG_API_FANOUT_DEFERRED,
  DATADOG_API_SHAPE_INDEX_DEFERRED,
} from "./apiAcquisition.js";
import { callDatadogApiOperation } from "./apiCall.js";
import type { DatadogManifest } from "./documents.js";
import type { DatadogKind } from "./model.js";
import { publishDatadogAtlas, readDatadogAtlas } from "./store.js";
import { runDatadogApiPass } from "./syncApiPass.js";
import type { DatadogApiKindOutcome, DatadogApiPassDeps, DatadogApiSyncOutcome } from "./syncApiTypes.js";

/**
 * Stamp each kind's API attempt onto the manifest.
 *
 * ## The manifest records PUBLICATION; the coverage cell records ACQUISITION
 *
 * That split is forced by `kit/manifestClock.ts`, and it is the right one anyway. Its invariant is that a
 * kind file this publish rewrites with a SUCCESSFUL status must carry the same instant in both clocks —
 * `updatedAt` on the file and `lastSuccessAt` on the status beside it — because a reader who found them
 * disagreeing could not tell which was the lie. Its own header records the measurement: a manifest five
 * days behind the newest file it vouched for, with every schema test passing.
 *
 * So `lastSuccessAt` here means "this kind's file was last published successfully", which a live pass that
 * asked nothing still does — it rewrote the file, with a fresh `api` cell saying it asked nothing. What it
 * does NOT mean is "this organisation answered", and nothing reads it that way: `surfaceFill.ts`'s
 * `datadogApiFill` deliberately judges the `api` surface off the stored CELL instead, precisely because one
 * per-kind timestamp cannot speak for three channels.
 *
 * A kind whose every admitted operation failed is the one case stamped `failed`, which is both true and
 * what takes it out of the clock comparison — `manifestClockDefects` gates on the attempt having succeeded,
 * because a failed kind honestly carries two different clocks.
 *
 * @param manifest the manifest as published, which this stamps onto rather than replaces
 * @param kinds one row per kind this pass rewrote a file for
 * @param at this run's ISO timestamp
 * @returns the manifest to publish
 */
export function datadogApiManifest({
  manifest,
  kinds,
  at,
}: {
  manifest: DatadogManifest;
  kinds: readonly DatadogApiKindOutcome[];
  at: string;
}): DatadogManifest {
  // `withKindStatus` rather than a spread of our own: `manifestClock.ts` records the generation that read
  // five days stale because three atlases each kept a private copy of exactly this shape, and the kit's
  // version cannot set the top-level clock at all — `publishAtlas` derives it from the files it writes.
  let next = manifest;
  for (const one of kinds) {
    next = withKindStatus({
      kind: one.kind,
      manifest: next,
      status: apiKindStatus({ at, held: next.kinds[one.kind], one }),
    });
  }
  return next;
}

/** One kind's status after a live pass. Split out so `datadogApiManifest` is the loop and nothing else. */
function apiKindStatus({
  at,
  held,
  one,
}: {
  at: string;
  held: DatadogManifest["kinds"][DatadogKind];
  one: DatadogApiKindOutcome;
}): DatadogManifest["kinds"][DatadogKind] {
  const everythingFailed = one.attempted > 0 && one.answered === 0;
  const reasons =
    one.failed === 0
      ? []
      : [`${String(one.failed)} of ${String(one.attempted)} admitted API operation(s) did not answer`];
  return {
    ...held,
    lastAttempt: { at, outcome: everythingFailed ? "failed" : "ok", reasons },
    lastSuccessAt: everythingFailed ? held.lastSuccessAt : at,
  };
}

/**
 * The registry census this pass reports, so a caller can print it without importing the registry.
 *
 * @returns how many operations the pass may issue, and the two remainders it cannot
 */
export function datadogApiCensus(): {
  readonly admitted: number;
  readonly fanoutDeferred: number;
  readonly shapeIndexDeferred: number;
} {
  return {
    admitted: DATADOG_API_ADMITTED.length,
    fanoutDeferred: DATADOG_API_FANOUT_DEFERRED.length,
    shapeIndexDeferred: DATADOG_API_SHAPE_INDEX_DEFERRED.length,
  };
}

/**
 * Issue one admitted operation through a bound transport — the production `call` seam.
 *
 * A one-line adapter so `runDatadogApiPass` never sees a transport and every test can hand it a plain
 * function instead of a fake HTTP client.
 *
 * @param transport the bound raw-text transport
 * @returns the seam `DatadogApiPassDeps.call` expects
 */
export function datadogApiCaller({
  transport,
}: {
  transport: Parameters<typeof callDatadogApiOperation>[0]["transport"];
}): DatadogApiPassDeps["call"] {
  return ({ row }) => callDatadogApiOperation({ row, transport });
}

/**
 * The live pass end to end: read the generation, ask this organisation, publish onto the `api` channel.
 *
 * It REFUSES rather than publishing when no compiled generation exists, because this pass merges onto the
 * entities that one made. Publishing without it would write an atlas holding only what answered today,
 * which reads as "Datadog has no such endpoint" for every operation this organisation happens not to serve
 * — the exact falsehood `exclusions.ts` inventories excluded rows to avoid.
 *
 * @param deps the transport, the clock, the scope and the progress sink
 * @param knownSecrets credential values this process holds, refused verbatim by the publish gate
 * @param home the resolved `$SLOPWEAVER_HOME`; omitted takes the ambient one
 * @returns what the pass did and what it wrote, or every reason it could not publish
 */
export async function syncDatadogApi({
  deps,
  knownSecrets = [],
  home,
}: {
  deps: DatadogApiPassDeps;
  knownSecrets?: readonly string[];
  home?: string;
}): Promise<Result<DatadogApiSyncOutcome>> {
  const snapshot = readDatadogAtlas(home === undefined ? {} : { home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { manifest } = snapshot.value;
  if (manifest === null) {
    return err([
      "no Datadog generation has been published, so there is nothing for a live pass to merge onto. Run `slopweaver atlas datadog sync` first: it publishes the compiled catalogue offline, with no credential, and this pass fills the `api` channel of the entities it makes",
    ]);
  }
  const passed = await runDatadogApiPass({ deps, stored: snapshot.value.files });
  if (passed.isErr()) {
    return err(passed.error);
  }
  const published = publishDatadogAtlas({
    derivedFrom: manifest,
    files: passed.value.files,
    ...(home === undefined ? {} : { home }),
    knownSecrets,
    manifest: datadogApiManifest({ at: deps.at, kinds: passed.value.outcome.kinds, manifest }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ ...passed.value.outcome, written: published.value });
}
