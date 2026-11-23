/**
 * The Slack atlas's coverage arithmetic: the cells a generation publishes, the walk's tally against the declared
 * surface map, and a kind's status after a successful run. Pure, and shared by `./atlasSync.ts`'s walked
 * assembly and `./atlasApiSync.ts`'s API-only one.
 */
import { SLACK_ATLAS_VISIBILITY_SCOPE, type SlackAtlasKindStatus, type SlackCoverageCell } from "./atlasModel.js";
import type { DrivenPage } from "./atlasProjection.js";
import { SLACK_CORPUS_HOLDER, SLACK_SURFACE_PAGES, surfacePageKey } from "./surfacePages.js";

/**
 * One coverage cell, spelled out so its callers cannot drift apart.
 *
 * @returns the cell
 *
 * @internal — shared with `./atlasApiSync.ts`, the API-only assembly.
 */
export function coverageCell({
  channel,
  scope,
  state,
  reason,
  at,
  failed,
}: {
  channel: "api" | "browser";
  scope: string;
  state: SlackCoverageCell["state"];
  reason: string;
  at: string;
  failed: boolean;
}): SlackCoverageCell {
  return {
    artifacts: [],
    channel,
    lastSuccessAt: failed ? null : at,
    latestAttemptFailed: failed,
    reason,
    role: "authoritative",
    scope,
    state,
    surface: channel,
    unblockedBy: null,
    visibilityScope: SLACK_ATLAS_VISIBILITY_SCOPE,
  };
}

/**
 * The browser surface's own coverage cell, shared by both kinds because both were filled by one walk.
 *
 * ## The denominator is DECLARED, and the numerator counts PHOTOGRAPHS as well as arrivals
 *
 * The old cell divided by what the walk attempted, which cannot report a page nobody thought to visit —
 * the exact invisibility the declared surface map exists to remove. It is now judged against
 * {@link SLACK_SURFACE_PAGES}, minus the rows no walk may address at all, so "<reached> of <declared>" is a claim about
 * Slack rather than about whoever wrote the walk list.
 *
 * `synced` additionally requires every page whose declared policy is `required` to have been photographed,
 * matching `kit/walkSurface.ts`'s bar. The owner asked for the settings pages by name; a run that landed on
 * every one of them and returned no picture has not done what it said it did.
 *
 * @param walked the pages this run stood on, with their screenshots already attached
 * @param at this run's ISO timestamp
 * @returns the cell
 */
export function browserCoverage({ walked, at }: { walked: readonly DrivenPage[]; at: string }): SlackCoverageCell {
  const tally = walkTally({ walked });
  const complete = tally.reached === tally.declared && tally.shotsOwed === 0;
  let state: SlackCoverageCell["state"] = "deferred";
  if (tally.reached === 0) {
    state = "unreadable";
  } else if (complete) {
    state = "synced";
  }
  return coverageCell({
    at,
    channel: "browser",
    failed: tally.reached === 0,
    reason:
      `${String(tally.reached)} of ${String(tally.declared)} addressable declared page(s) reached, ` +
      `${String(tally.photographed)} photographed, ${String(tally.shotsOwed)} required picture(s) still owed; ` +
      `${String(tally.unaddressable)} further declared page(s) have no address a walk may open`,
    scope: "declared-surface-map",
    state,
  });
}

/** What one walk came to, judged against the declared surface map. */
interface WalkTally {
  /** Declared pages a walk is allowed to address at all. */
  readonly declared: number;
  /** Declared pages this run stood on. */
  readonly reached: number;
  /** Pages this run holds a picture of. */
  readonly photographed: number;
  /** Declared pages whose policy is `required` and which this run holds no picture of. */
  readonly shotsOwed: number;
  /** Declared pages no walk may address — a write, or a pane with no URL. */
  readonly unaddressable: number;
}

/**
 * Count what one walk came to against the declared map.
 *
 * @param walked the pages this run stood on, with their screenshots already attached
 * @returns the four-way accounting
 *
 * @internal — exported for its own unit test; `browserCoverage` is the only caller.
 */
export function walkTally({ walked }: { walked: readonly DrivenPage[] }): WalkTally {
  const addressable = SLACK_SURFACE_PAGES.filter((page) => page.notNavigableBecause === null);
  const reachedKeys = new Set(walked.map((page) => page.path));
  const shotKeys = new Set(walked.filter((page) => page.screenshot !== null).map((page) => page.path));
  return {
    declared: addressable.length,
    photographed: shotKeys.size,
    reached: addressable.filter((page) => reachedKeys.has(surfacePageKey({ page }))).length,
    shotsOwed: addressable.filter((page) => page.screenshot === "required" && !shotKeys.has(surfacePageKey({ page })))
      .length,
    unaddressable: SLACK_SURFACE_PAGES.length - addressable.length,
  };
}

/**
 * The coverage cell that says what this atlas deliberately does NOT hold, and who holds it instead.
 *
 * Owner ruling (`docs/atlas-intent/06-holdings.md`): the Slack atlas holds the surface map and not the
 * entities, because the corpus already holds Slack's channels, people, usergroups and messages — and Today,
 * Home and Files have their existence recorded here with their contents _"in the corpus instead of the
 * Atlas."_ Without a cell for it, that reads as an atlas which simply never looked.
 *
 * `held-elsewhere` is deliberately not usable coverage (`kit/contract.ts`), so this cell cannot make a sync
 * exit 0 on its own, and it NAMES its holder because a state that cannot say where is an unfalsifiable claim.
 *
 * @param at this run's ISO timestamp
 * @returns the cell
 */
export function contentsHeldElsewhere({ at }: { at: string }): SlackCoverageCell {
  const held = SLACK_SURFACE_PAGES.filter((page) => page.contentsHeldBy !== null);
  return coverageCell({
    at,
    channel: "browser",
    failed: false,
    reason:
      `${String(held.length)} declared page(s) have their EXISTENCE here and their CONTENTS in ` +
      `${SLACK_CORPUS_HOLDER} — this atlas holds Slack's surface map, never its channels, people, ` +
      "usergroups or messages (docs/atlas-intent/06-holdings.md)",
    scope: "page-contents",
    state: "held-elsewhere",
  });
}

/**
 * One kind's manifest status after a successful run.
 *
 * `digest` and `entityCount` are left at their empty values on purpose: `kit/store.ts` stamps both from the
 * bytes it actually writes, so filling them here would be a second, guessable source for a number whose
 * whole point is to be measured at the write.
 *
 * @param at this run's ISO timestamp
 * @returns the status
 */
export function syncedStatus({ at }: { at: string }): SlackAtlasKindStatus {
  return { digest: null, entityCount: 0, lastAttempt: { at, outcome: "ok", reasons: [] }, lastSuccessAt: at };
}
