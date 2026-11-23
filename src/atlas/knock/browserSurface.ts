/**
 * Publishing what a dashboard walk saw into the `browser` channel of the `dashboard-route` kind.
 *
 * ## The walk fills a channel of an EXISTING kind rather than a kind of its own
 *
 * Every route already exists as a `dashboard-route` entity before a browser is ever driven — the
 * dashboard's own build manifest declares it, and `projection.ts` publishes it into the `api` channel. So a
 * walk is not discovering pages; it is answering, per already-declared route, whether the browser could
 * actually reach it and what the client asked for while it rendered.
 *
 * That is the two-surface design doing its job on one kind, and it is why the merge is channel-scoped
 * (`merge.ts`): a walk that reached only some declared pages must not blank every other route's declaration, and a
 * later regeneration of the route table must not erase the screenshots.
 *
 * ## What is stored, and what is deliberately not
 *
 * The browser detail carries the page title, whether it was redirected, and the first-party calls its
 * client made reduced to a method, a redacted wire path and the response's field NAMES. It does not carry a
 * field's value: a signed-in Knock dashboard can see every recipient of every notification the organisation
 * sends. `browserReduction.ts` is that redaction, committed so a reviewer can read it.
 *
 * The requested URL IS stored, in the source's `deepLink`, and that is the one place an account slug lands
 * — inside the generation under `$SLOPWEAVER_HOME`, which is state rather than repository. It is what
 * `docs/atlas-intent/05-browser-proof.md` asks for: the exact address a human opens to take the proof screenshot. Neither
 * this module nor the verb above it ever prints one.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { isPageHeld } from "../kit/pageWalk.js";

import type { KnockPageObservation } from "./browserWalk.js";
import { succeededKnockCoverageCell } from "./coverage.js";
import { openKnockGap, reconcileKnockGaps } from "./gaps.js";
import { knockEntityId } from "./identity.js";
import { mergeKnockChannel } from "./merge.js";
import {
  emptyKnockKindFile,
  initialKnockManifest,
  type KnockEntity,
  type KnockGap,
  type KnockKindFile,
  type KnockManifest,
  type KnockPageBrowserDetail,
} from "./model.js";
import { KNOCK_WALK_SURFACE } from "./projection.js";
import { type KnockAtlasPaths, publishKnockAtlas, readKnockAtlas, withKnockPublishLock } from "./store.js";

/** The kind a walk writes into. Every walked page is already one of these. */
const WALK_KIND = "dashboard-route";

/**
 * What publishing a walk did, in the terms the verb reports.
 * @internal
 */
export interface KnockWalkOutcome {
  readonly declared: number;
  readonly reached: number;
  readonly photographed: number;
  /** Distinct first-party operations the pages' own clients called, across every reached page. */
  readonly operationsObserved: number;
  /** How many of those no pinned document declares — the corroboration this walk exists to produce. */
  readonly undocumented: number;
  /** Whether the walk stopped early because the session was lost. */
  readonly sessionLost: boolean;
}

/** What a walk observed on one page, reduced to what may be stored. */
function browserDetail({ page }: { page: KnockPageObservation }): KnockPageBrowserDetail {
  return {
    observedCalls: page.calls.map((call) => ({
      api: call.api,
      host: call.host,
      method: call.method,
      responseFields: [...call.responseFields],
      statusCode: call.statusCode,
      wirePath: call.wirePath,
    })),
    redirected: page.redirected,
    title: page.title.length > 0 ? page.title : null,
    unreachableBecause: page.unreachableBecause,
  };
}

/**
 * Project one walk's pages onto the browser channel, one entity per declared route.
 *
 * A page the walk never attempted contributes nothing at all — not an entity claiming it looked and found
 * nothing. That is the same judgement `kit/read.ts` makes about a channel that has never looked, applied
 * one level up: after a lost session, the pages behind it are unobserved rather than unreachable.
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one entity per attempted page, carrying only its browser channel
 * @internal
 */
export function projectKnockWalk({
  pages,
  at,
}: {
  pages: readonly KnockPageObservation[];
  at: string;
}): readonly KnockEntity[] {
  return pages
    .filter((page) => page.attempted)
    .map((page) => ({
      channels: {
        api: null,
        browser: {
          channel: "browser" as const,
          detail: browserDetail({ page }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [...page.artifacts],
            channel: "browser" as const,
            // The walk OPENED this address, which is the one thing that earns `browser-discovered`.
            deepLink: page.requestedUrl,
            deepLinkStatus: "browser-discovered" as const,
            endpoint: page.surface,
            observedAt: page.observedAt,
          },
          state: "observed" as const,
        },
      },
      id: knockEntityId({ kind: WALK_KIND, providerId: page.surface }),
      kind: WALK_KIND,
      providerId: page.surface,
      scope: null,
    }));
}

/**
 * Every gap this walk detected: one per declared page it could not hold.
 *
 * Scoped to the route PATTERN rather than to the address, so the gap survives the account being renamed and
 * carries no private identifier. A page reached and not photographed is a gap too — an observation missing
 * its proof is incomplete rather than complete, which is the owner's read-after-screenshot ruling
 * (`kit/browserWalk.ts`).
 *
 * @param pages every declared page's observation
 * @param at this run's ISO timestamp
 * @returns one gap per page that is not fully held
 * @internal
 */
export function knockWalkGaps({
  pages,
  at,
}: {
  pages: readonly KnockPageObservation[];
  at: string;
}): readonly KnockGap[] {
  return pages.flatMap((page): readonly KnockGap[] => {
    const because = notHeldBecause({ page });
    if (isPageHeld({ page }) || because === null) {
      return [];
    }
    return [
      openKnockGap({
        at,
        condition: "page-unreachable",
        fields: [],
        kind: WALK_KIND,
        reason: because,
        scope: page.surface,
        surfaces: ["browser"],
      }),
    ];
  });
}

/**
 * Why one page is not fully held: the reason it could not be reached when it states one, else the reason its
 * photograph is missing. `null` when neither is stated — both fields are nullable by design.
 *
 * @param page one declared page's observation
 * @returns the sentence its gap carries, or `null` when the page states no reason
 */
function notHeldBecause({ page }: { page: KnockPageObservation }): string | null {
  if (page.unreachableBecause === null) {
    return page.screenshotMissingBecause;
  }
  return page.unreachableBecause;
}

/**
 * Which of a walk's observed calls no pinned document declares.
 *
 * A wire path the reduction could not match against a declared template keeps its shape-redacted form, so
 * an undeclared operation is exactly a stored path carrying no `{brace}` the registry uses — see
 * `browserReduction.ts` on why matching is positional. Reported as a COUNT here and stored in full on each
 * page's own row, because the value of the number is that it is nonzero and the value of the list is that
 * somebody can read it.
 *
 * @param pages every declared page's observation
 * @returns how many distinct first-party operations were seen, and how many are undeclared
 * @internal
 */
export function knockCallCensus({ pages }: { pages: readonly KnockPageObservation[] }): {
  readonly observed: number;
  readonly undocumented: number;
} {
  const seen = new Set<string>();
  const undeclared = new Set<string>();
  for (const page of pages) {
    for (const call of page.calls) {
      const key = `${call.method} ${call.host}${call.wirePath}`;
      seen.add(key);
      if (call.api === null || !call.wirePath.startsWith("/v1/")) {
        undeclared.add(key);
      }
    }
  }
  return { observed: seen.size, undocumented: undeclared.size };
}

/**
 * What a walk counted, in the terms both the coverage cell and the outcome report.
 *
 * Computed once and passed down rather than derived twice: the cell's reason quotes the same numbers the
 * verb prints, and a coverage cell that disagreed with the line beside it would be the exact dishonesty
 * this atlas's coverage vocabulary exists to prevent.
 * @internal
 */
export interface KnockWalkTally {
  readonly declared: number;
  readonly photographed: number;
  readonly reached: number;
  readonly observed: number;
  readonly undocumented: number;
}

/**
 * Count what a walk did.
 *
 * `reached` requires `attempted` as well as an empty `unreachableBecause`, because a page the walk never
 * got to carries neither — after a lost session, an unattempted page is unobserved rather than reached.
 *
 * @param pages every declared page's observation
 * @returns the five counts
 * @internal
 */
export function knockWalkTally({ pages }: { pages: readonly KnockPageObservation[] }): KnockWalkTally {
  const census = knockCallCensus({ pages });
  return {
    declared: pages.length,
    observed: census.observed,
    photographed: pages.filter((page) => page.artifacts.length > 0).length,
    reached: pages.filter((page) => page.attempted && page.unreachableBecause === null).length,
    undocumented: census.undocumented,
  };
}

/**
 * The kind file this walk publishes: the merged entities, the reconciled gaps, and ONE browser cell.
 *
 * The stored file is spread rather than rebuilt, so the `platform`, `kind` and `schemaVersion` a rebuild
 * could forget come through untouched — a forgotten one would be refused at publication rather than here.
 *
 * @param stored the kind file as the generation holds it
 * @param entities this run's merged entity list
 * @param gaps this run's reconciled gap list
 * @param tally what the walk counted
 * @param at this run's ISO timestamp
 * @returns the next file
 */
function nextWalkFile({
  stored,
  entities,
  gaps,
  tally,
  at,
}: {
  stored: KnockKindFile;
  entities: readonly KnockEntity[];
  gaps: readonly KnockGap[];
  tally: KnockWalkTally;
  at: string;
}): KnockKindFile {
  const complete = tally.reached === tally.declared && tally.photographed === tally.reached;
  return {
    ...stored,
    coverage: [
      ...stored.coverage.filter((cell) => cell.channel !== "browser"),
      succeededKnockCoverageCell({
        artifacts: [],
        at,
        channel: "browser",
        reason:
          `${String(tally.reached)} of ${String(tally.declared)} declared dashboard page(s) reached, ` +
          `${String(tally.photographed)} photographed, ${String(tally.observed)} distinct first-party ` +
          `operation(s) observed`,
        role: "authoritative",
        scope: WALK_KIND,
        state: complete ? "synced" : "deferred",
        surface: KNOCK_WALK_SURFACE,
      }),
    ],
    entities: [...entities],
    gaps: [...gaps],
    updatedAt: at,
  };
}

/**
 * The manifest to publish, stamping this kind with what the walk wrote.
 *
 * A walk that lost its session records the ATTEMPT as failed and carries the previous `lastSuccessAt`
 * forward rather than claiming this run as one — the same reason the merge does not stale what it never
 * looked at.
 *
 * @param manifest the manifest the caller's snapshot carried, or `null` when it read no generation
 * @param file the kind file about to be written
 * @param sessionLost whether the walk stopped early
 * @param at this run's ISO timestamp
 * @returns the manifest to publish
 */
function nextWalkManifest({
  manifest,
  file,
  sessionLost,
  at,
}: {
  manifest: KnockManifest | null;
  file: KnockKindFile;
  sessionLost: boolean;
  at: string;
}): KnockManifest {
  const base = manifest ?? initialKnockManifest({ updatedAt: at });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      [WALK_KIND]: {
        digest: base.kinds[WALK_KIND].digest,
        entityCount: file.entities.length,
        lastAttempt: { at, outcome: sessionLost ? "failed" : "ok", reasons: [] },
        lastSuccessAt: sessionLost ? base.kinds[WALK_KIND].lastSuccessAt : at,
      },
    },
    updatedAt: at,
  };
}

/**
 * Fold one walk's observations and gaps onto the stored kind file.
 *
 * Split out of {@link publishKnockWalk} because it is the whole fallible middle: two merges, either of
 * which can refuse, over inputs the caller has already read. Keeping it here leaves the command reading as
 * its own control flow — read, fold, guard, publish — rather than carrying two nested error checks inline.
 *
 * @param stored the kind file as the generation holds it
 * @param pages every declared page's observation
 * @param sessionLost whether the walk stopped early because the session was lost
 * @param at this run's ISO timestamp
 * @returns the next kind file, or the first reason it cannot be built
 */
function foldWalkOntoStored({
  stored,
  pages,
  sessionLost,
  at,
}: {
  stored: KnockKindFile;
  pages: readonly KnockPageObservation[];
  sessionLost: boolean;
  at: string;
}): Result<KnockKindFile> {
  const merged = mergeKnockChannel({
    at,
    channel: "browser",
    observed: projectKnockWalk({ at, pages }),
    // A walk that lost its session never LOOKED at the pages behind the wall, so it may not stale what an
    // earlier walk saw — `merge.ts` carries the measurement that made this a parameter.
    staleAbsent: !sessionLost,
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileKnockGaps({
    at,
    observed: knockWalkGaps({ at, pages }),
    rechecks: pages.map((page) => ({
      condition: "page-unreachable",
      resolved: isPageHeld({ page }),
      scope: page.surface,
    })),
    runFailed: sessionLost,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok(nextWalkFile({ at, entities: merged.value, gaps: gaps.value, stored, tally: knockWalkTally({ pages }) }));
}

/**
 * Publish what a walk saw.
 *
 * The whole read-then-publish runs under the publish lock and behind a compare-and-swap, so a sync running
 * at the same time cannot have its `api` rows silently discarded — `store.ts` carries why atomicity alone
 * would not be enough.
 *
 * @param paths the resolved atlas paths
 * @param pages every declared page's observation
 * @param sessionLost whether the walk stopped early because the session was lost
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing was
 */
export function publishKnockWalk({
  paths,
  pages,
  sessionLost,
  at,
}: {
  paths: KnockAtlasPaths;
  pages: readonly KnockPageObservation[];
  sessionLost: boolean;
  at: string;
}): Result<KnockWalkOutcome> {
  return withKnockPublishLock({
    nowIso: at,
    paths,
    publish: (): Result<KnockWalkOutcome> => {
      const snapshot = readKnockAtlas({ paths });
      if (snapshot.isErr()) {
        return err(snapshot.error);
      }
      const { files, manifest } = snapshot.value;
      const stored = files[WALK_KIND] ?? emptyKnockKindFile({ kind: WALK_KIND, updatedAt: at });
      const folded = foldWalkOntoStored({ at, pages, sessionLost, stored });
      if (folded.isErr()) {
        return err(folded.error);
      }
      const file = folded.value;
      const tally = knockWalkTally({ pages });
      const written = publishKnockAtlas({
        derivedFrom: manifest,
        files: { [WALK_KIND]: file },
        manifest: nextWalkManifest({ at, file, manifest, sessionLost }),
        paths,
      });
      if (written.isErr()) {
        return err(written.error);
      }
      // Spelled out rather than spread: `KnockWalkTally` carries `observed` and the outcome names the same
      // number `operationsObserved`, so a spread would put a stray key in the `--json` report.
      return ok({
        declared: tally.declared,
        operationsObserved: tally.observed,
        photographed: tally.photographed,
        reached: tally.reached,
        sessionLost,
        undocumented: tally.undocumented,
      });
    },
  });
}
