/**
 * Gathering everything the briefing's freshness section needs off this machine — the effectful shell
 * around `briefing/freshness.ts`'s pure projection.
 *
 * Every input is LOCAL. The roster comes from the repository's own descriptors, the atlas clocks from each
 * atlas's published manifest, the corpus clocks from the local store's newest row per source (one open for
 * all of them — `store/newest.ts`), the registration from the definition store, and the outcomes from the
 * resync state directory. No provider is called, which is why a sweep can ask for this section on every
 * render without it becoming a thing that costs something.
 *
 * The atlas half deliberately goes through `atlas freshness`'s own sweep rather than re-judging windows
 * here. That verb is what the estate is measured by, and a second judge would be free to disagree with the
 * number the operator reads everywhere else — the drift this whole change exists to remove.
 */
import { type FreshnessObservation, type FreshnessProjection, projectFreshness } from "../../../briefing/freshness.js";
import { corpusFreshnessWindowMs } from "../../../corpus/freshnessPolicy.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { judgeRecipeTolerance } from "../../../live/automation/definitionTolerance.js";
import { recipeBoardOf } from "../../../live/automation/failureHoldStore.js";
import type { ResyncState } from "../../../live/resync/outcome.js";
import { readAllResyncState } from "../../../live/resync/outcomeStore.js";
import type { ResyncPolicy } from "../../../live/resync/policy.js";
import { rowRunsTarget } from "../../../live/resync/registrationPlan.js";
import { readResyncRoster } from "../../../live/resync/roster.js";
import { resyncRecipeId } from "../../../live/resync/target.js";
import { stateHomePaths } from "../../../stateHome.js";
import { readStoreNewest } from "../../../store/newest.js";
import { productionAtlasFreshnessDeps, sweepAtlasFreshness } from "../atlas/freshnessRun.js";

/** One row's stored cadence as an optional field, absent when nothing is stored for that id. */
function storedCadenceOf({
  recipeId,
  storedCadences,
}: {
  readonly recipeId: string;
  readonly storedCadences: ReadonlyMap<string, string>;
}): { readonly storedCadence?: string } {
  const stored = storedCadences.get(recipeId);
  return stored === undefined ? {} : { storedCadence: stored };
}

/**
 * Whether a stored cadence actually schedules anything.
 *
 * The same judge `automation due` uses. A cadence that will not parse is reported `unschedulable` and never
 * comes up due, so a row carrying one is as inert as no row at all — and the page must not count it.
 */
function cadenceSchedules({ cadence, nowIso }: { readonly cadence: string; readonly nowIso: string }): boolean {
  return judgeRecipeTolerance({ cadence, firingsSinceWatermark: 0, nowIso }).band !== "unschedulable";
}

/**
 * Which targets a stored row actually schedules, and which are only paused.
 *
 * A recipe id is a NAME. Two Codex passes, found the two ways trusting one lies: a DISABLED
 * row made a paused target read `current` although `live/automation/definitionDue.ts` answers `due: false` for
 * it forever, and a row named `resync-atlas-airtable` whose argv ran Clerk made Airtable read current on
 * the strength of its filename. So a target is scheduled only when a row exists that both carries its id
 * and RUNS it, and pausing is reported separately because it is deliberate rather than an oversight.
 *
 * @internal Exported for its unit test.
 * @param definitions every row the store holds
 * @param policies every target this build derives
 * @returns the ids a live row schedules, and the ids a row would schedule if somebody re-enabled it
 */
export function schedulingState({
  definitions,
  policies,
  nowIso,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly policies: readonly ResyncPolicy[];
  readonly nowIso: string;
}): {
  readonly registered: readonly string[];
  readonly paused: readonly string[];
  readonly storedCadences: ReadonlyMap<string, string>;
} {
  const matching = policies.flatMap((policy) => {
    const row = definitions.find(
      (one) => one.recipeId === policy.recipeId && rowRunsTarget({ definition: one, policy }),
    );
    // A row whose cadence will not parse is judged `unschedulable` and `due: false` by
    // `live/automation/definitionTolerance.ts` forever, so it runs exactly as often as no row at all. Found by
    // a Codex pass, rendering "current" for a target whose stored cadence was "not-a-cron".
    if (row === undefined || !cadenceSchedules({ cadence: row.cadence, nowIso })) {
      return [];
    }
    return [row];
  });
  return {
    paused: matching.filter((definition) => !definition.enabled).map((one) => one.recipeId),
    registered: matching.filter((definition) => definition.enabled).map((one) => one.recipeId),
    // Every stored row's own cadence, including the ones that schedule nothing — the page reports what is
    // in force, and a row excluded above is exactly the one whose real cadence a reader most needs.
    storedCadences: new Map(definitions.map((definition) => [definition.recipeId, definition.cadence])),
  };
}

/**
 * Build the section from this machine's own state.
 *
 * @param home the state home to read
 * @param nowIso the instant ages are measured against
 * @returns the rows and the collapsed section
 */
export async function gatherFreshnessSection({
  home,
  nowIso,
}: {
  readonly home: string;
  readonly nowIso: string;
}): Promise<FreshnessProjection> {
  const roster = await readResyncRoster({ home });
  const { registered, paused, storedCadences } = scheduledOf({ home, nowIso, roster });
  const atlasPolicies = roster.policies.filter((policy) => policy.target.kind === "atlas");
  const sweep = await sweepAtlasFreshness({
    deps: productionAtlasFreshnessDeps(),
    home,
    platforms: atlasPolicies.flatMap((policy) => (policy.target.kind === "atlas" ? [policy.target.platform] : [])),
    windowMsOverride: undefined,
  });
  // The resync records are read AFTER the sweep, which can run long: a resync finishing mid-sweep is then judged
  // on its new success rather than on the record it replaced.
  const { states, corrupt } = recordedOutcomes({ home });
  const atlasObservations = sweep.verdicts.map((verdict): FreshnessObservation => {
    const recipeId = resyncRecipeId({ target: { kind: "atlas", platform: verdict.platform } });
    return {
      clock: verdict.updatedAt,
      late: verdict.behind,
      recipeId,
      ...storedCadenceOf({ recipeId, storedCadences }),
    };
  });

  const corpus = await corpusObservations({ home, nowIso, policies: roster.policies, states, storedCadences });

  return projectFreshness({
    nowIso,
    observations: [...atlasObservations, ...corpus],
    paused,
    policies: roster.policies,
    registered,
    states,
    unreadable: corrupt,
  });
}

/**
 * The CORPUS half alone: one row per corpus source, and the roster's own problems — never the atlas sweep.
 *
 * The console polls this every page (`automation freshness`), so it skips the one leg that walks every atlas's
 * published manifest. The rows come out of the same {@link projectFreshness} the briefing renders, so the
 * console and the briefing cannot disagree about whether a source is late.
 *
 * @param home the state home to read
 * @param nowIso the instant ages are measured against
 * @returns the corpus rows, and every target the roster could not build a policy for
 */
export async function gatherCorpusFreshness({
  home,
  nowIso,
}: {
  readonly home: string;
  readonly nowIso: string;
}): Promise<{ readonly projection: FreshnessProjection; readonly rosterProblems: readonly string[] }> {
  const roster = await readResyncRoster({ home });
  const { registered, paused, storedCadences } = scheduledOf({ home, nowIso, roster });
  const { states, corrupt } = recordedOutcomes({ home });
  const policies = roster.policies.filter((policy) => policy.target.kind === "corpus");
  const corpus = await corpusObservations({ home, nowIso, policies, states, storedCadences });
  const projection = projectFreshness({
    nowIso,
    observations: corpus,
    paused,
    policies,
    registered,
    states,
    unreadable: corrupt,
  });
  return { projection, rosterProblems: roster.problems };
}

/** What the store schedules for the roster's targets, read from the recipe definitions on disk. */
function scheduledOf({
  home,
  nowIso,
  roster,
}: {
  readonly home: string;
  readonly nowIso: string;
  readonly roster: Awaited<ReturnType<typeof readResyncRoster>>;
}): ReturnType<typeof schedulingState> {
  const definitions = loadRecipeDefinitions({
    board: recipeBoardOf({ home }),
    directory: stateHomePaths({ home }).live.recipe.definitionsDir,
  }).definitions;
  return schedulingState({ definitions, nowIso, policies: roster.policies });
}

/** Each target's recorded resync outcome, and every record that could not be believed. */
function recordedOutcomes({ home }: { readonly home: string }): ReturnType<typeof readAllResyncState> {
  return readAllResyncState({ stateDir: stateHomePaths({ home }).live.recipe.resyncStateDir });
}

/**
 * One observation per corpus source: its clock from the store, its lateness from the last recorded success.
 *
 * Split out of {@link gatherFreshnessSection} because it owns the one effect the atlas half does not — a
 * single store open covering every source — and folding that into the shell put two different I/O shapes in
 * one body.
 *
 * @param home the state home the store selection is read under
 * @param nowIso the instant lateness is measured against
 * @param policies the whole roster; the atlas rows are skipped here
 * @param states what each target's last attempt recorded
 * @param storedCadences the cadence each registered row actually carries
 * @returns one observation per corpus policy, in roster order
 */
async function corpusObservations({
  home,
  nowIso,
  policies,
  states,
  storedCadences,
}: {
  readonly home: string;
  readonly nowIso: string;
  readonly policies: readonly ResyncPolicy[];
  readonly states: ReadonlyMap<string, ResyncState>;
  readonly storedCadences: ReadonlyMap<string, string>;
}): Promise<readonly FreshnessObservation[]> {
  const sources = policies.flatMap((policy) =>
    policy.target.kind === "corpus" && policy.target.source !== "gold" ? [policy.target.source] : [],
  );
  // ONE store open for every corpus clock, rather than one per source through `readResyncClock`.
  const storeClocks = await readStoreNewest({ home, sources });
  return policies.flatMap((policy): readonly FreshnessObservation[] => {
    if (policy.target.kind !== "corpus") {
      return [];
    }
    // A corpus source is judged on when it last SUCCEEDED, never on its clock alone — a quiet source's newest
    // stored row says nothing about its last fetch (`live/resync/outcome.ts`).
    const state = states.get(policy.recipeId);
    const lastSuccess = state === undefined ? null : state.lastSuccessAtIso;
    const storeClock = policy.target.source === "gold" ? undefined : storeClocks.get(policy.target.source);
    const clock = storeClock === undefined ? null : storeClock;
    return [
      {
        clock,
        clockLagsWindow: clockLagsWindow({ clock, nowIso, source: policy.target.source }),
        late: isCorpusLate({ lastSuccess, nowIso, source: policy.target.source }),
        recipeId: policy.recipeId,
        ...storedCadenceOf({ recipeId: policy.recipeId, storedCadences }),
      },
    ];
  });
}

/**
 * Whether a corpus source's own CLOCK lags its declared window.
 *
 * Not lateness — see `briefing/freshness.ts`'s header. It is the condition under which a row reading
 * `current` is resting on its resync's exit code alone, which the page then says out loud rather than
 * reassuring the reader.
 */
function clockLagsWindow({
  clock,
  nowIso,
  source,
}: {
  readonly clock: string | null;
  readonly nowIso: string;
  readonly source: Parameters<typeof corpusFreshnessWindowMs>[0]["source"];
}): boolean {
  if (clock === null) {
    return true;
  }
  const then = Date.parse(clock);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) {
    return true;
  }
  return now - then > corpusFreshnessWindowMs({ source });
}

/** Whether a corpus source's last recorded success is older than its own declared window. */
function isCorpusLate({
  lastSuccess,
  nowIso,
  source,
}: {
  readonly lastSuccess: string | null;
  readonly nowIso: string;
  readonly source: Parameters<typeof corpusFreshnessWindowMs>[0]["source"];
}): boolean {
  if (lastSuccess === null) {
    return true;
  }
  const then = Date.parse(lastSuccess);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) {
    return true;
  }
  return now - then > corpusFreshnessWindowMs({ source });
}
