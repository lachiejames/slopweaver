/**
 * Reading one target's own clock, before and after an attempt — the evidence `./outcome.ts` judges on.
 *
 * The two halves read DIFFERENT things and neither is interchangeable with the other. An atlas's clock is
 * the `updatedAt` on its published manifest, which is the same value `atlas freshness` judges the whole
 * estate against — read through the one function both share (`atlas/kit/generationClock.ts`) rather than a second copy, so a resync and the
 * sweep reporting it can never disagree about what an atlas's generation is.
 *
 * A corpus source's clock is the STORE's newest row for it — `max(occurred_at)` in the Supabase store
 * (`store/newest.ts`) — and not its bronze watermark, which it used to be. The watermark moves the moment
 * `refresh` writes a window file, whether or not anything ever ingests that file into Postgres, so a clock
 * read off it said "fresh" about a store nobody had touched: MEASURED, `resync-corpus-linear`
 * recorded an advanced `afterClock` while the store's newest linear row stayed hours behind it. The store's newest row
 * is what a reader actually answers from, so it is the number this records. A store that is unselected or
 * unreachable reads `null`, the same as one holding no rows for the source, and `./outcome.ts` fails a
 * zero-exit attempt over either.
 */
import { generationClock } from "../../atlas/kit/generationClock.js";
import { atlasPathsFor } from "../../atlas/platformPaths.js";
import { readCertifiedAsOf } from "../../corpus/chatgpt/exportAsOf.js";
import { readLiveAsOf } from "../../corpus/chatgpt/liveAsOf.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { readStoreNewest } from "../../store/newest.js";
import type { ResyncTarget } from "./target.js";

/** The three reads a clock is made of, owned here so a test can drive each branch without a store or a home. */
export interface ResyncClockDeps {
  /** The store's newest row per corpus source. */
  readonly readStoreNewest: typeof readStoreNewest;
  /** Where an atlas platform publishes, or `null` for a platform no registration names. */
  readonly atlasPathsFor: typeof atlasPathsFor;
  /** The `updatedAt` on a published atlas manifest. */
  readonly generationClock: typeof generationClock;
}

const productionResyncClockDeps: ResyncClockDeps = { atlasPathsFor, generationClock, readStoreNewest };

/**
 * One target's clock right now.
 *
 * @param target the atlas or corpus source
 * @param home the state home to read, so a test can point at its own sandbox
 * @param deps the store, atlas-path and manifest reads; omitted takes the real ones
 * @returns the clock, or `null` when the target has never published one
 */
export async function readResyncClock({
  target,
  home,
  deps = productionResyncClockDeps,
}: {
  readonly target: ResyncTarget;
  readonly home: string;
  readonly deps?: ResyncClockDeps;
}): Promise<string | null> {
  if (target.kind === "corpus") {
    if (target.source === "gold") {
      // Synthesised at query time from distilled markdown and never stored, so it has no row to date — and
      // no refresh either: `corpusResyncInputs` never schedules it, so this branch is the type's, not a path.
      return null;
    }
    const clocks = await deps.readStoreNewest({ home, sources: [target.source] });
    // `readStoreNewest` keys every source it was asked for before it reads anything, so an absent key is a
    // broken invariant, never an empty store — an empty or unreachable store is a PRESENT key holding `null`.
    if (!clocks.has(target.source)) {
      throw new Error(`readStoreNewest answered no entry for the requested source "${target.source}"`);
    }
    return clocks.get(target.source)!;
  }
  const paths = deps.atlasPathsFor({ home, platform: target.platform });
  if (paths === null) {
    return null;
  }
  return deps.generationClock({ manifestPath: paths.manifest });
}

/**
 * The instant a target that certifies its own currency says its succeeded attempt is current as of — ChatGPT, whose
 * `live-sync` records the instant its listing began (`corpus/chatgpt/liveAsOf.ts`) and whose export `sync` records the
 * export's own date (`corpus/chatgpt/exportAsOf.ts`). Every other target is current as of the moment its attempt
 * finished, and answers `null`.
 *
 * ChatGPT is current as of the LATER of the two records. Once the live copy has certified an instant, the pass is the
 * live sync, so an export record that no longer dates the newest export (a newer one taken in by hand, never yet
 * synced) leaves the live instant standing rather than failing a pass that never read the export. With no live
 * record, the export's alone decides, exactly as before.
 *
 * Read after the steps succeeded, so a missing or mismatched record is a defect of THAT pass, never a target with no
 * history: it fails the attempt rather than letting the finish time stand in for an instant nobody certified.
 *
 * @param target the atlas or corpus source
 * @param home the state home to read
 * @returns the certified instant, `null` for a target that certifies none, or why the record cannot be believed
 */
export function readResyncAsOf({
  target,
  home,
}: {
  readonly target: ResyncTarget;
  readonly home: string;
}): Result<string | null> {
  if (target.kind !== "corpus" || target.source !== "chatgpt") {
    return ok(null);
  }
  const paths = stateHomePaths({ home }).corpus;
  const live = readLiveAsOf({ root: paths.chatgptLive });
  if (live.isErr()) {
    return err([live.error.message]);
  }
  const exported = readCertifiedAsOf({ root: paths.chatgptExports });
  if (live.value === undefined) {
    return exported.isOk() ? ok(exported.value) : err([exported.error.message]);
  }
  if (exported.isErr()) {
    return ok(live.value);
  }
  return ok(laterIso({ left: live.value, right: exported.value }));
}

/** The later of two instants, compared as instants rather than as strings. */
function laterIso({ left, right }: { left: string; right: string }): string {
  return Date.parse(right) > Date.parse(left) ? right : left;
}
