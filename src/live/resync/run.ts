/**
 * Running one target's reviewed steps and recording what actually happened.
 *
 * ## The steps come from the repository, never from the row
 *
 * A definition file names `automation resync --atlas trelica` and nothing more. What that executes is resolved
 * HERE, out of `./policy.ts`'s roster, which is derived from the atlas's own descriptor and is reviewed,
 * tested and in the repository. The definition directory is ungated — `live/automation/definitionStore.ts`
 * says so in its own header — so a row free to name arbitrary argv would put the choice of what runs in a
 * file nothing reads. A row may choose WHICH target and never what happens to it.
 *
 * ## Every step runs in this process
 *
 * Through `cli/main.ts`'s dispatcher, exactly as `live/automation/verbRun.ts` runs a row's verb, and for the
 * same reasons: a spawn would need a resolved binary, would put strings on a command line, and would leave
 * the run outside this process's door, ledger and logging. No model is launched. Rule 2 holds by
 * construction rather than by discipline.
 *
 * A compound target stops at its first failing step. `atlas clerk sync && atlas clerk walk` means what it
 * says: walking a tenant whose sync just failed photographs a stale estate and reports it as fresh.
 */
import { EXIT_DEFERRED } from "../../cli/exitCodes.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { ok, type Result } from "../../lib/result.js";
import type { ResyncDemandRecord } from "./demand.js";
import {
  judgeResyncAttempt,
  nextResyncState,
  type ResyncAttempt,
  type ResyncBlocker,
  type ResyncState,
} from "./outcome.js";
import type { ResyncPolicy } from "./policy.js";
import { resyncStepLine } from "./steps.js";

/** The injected edges, so a run is testable without a CLI or a clock. */
export interface ResyncRunDeps {
  readonly now: () => string;
  /** Runs one verb's whole process argv and answers its exit code — `cli/main.ts` in production. */
  readonly runVerb: (argv: readonly string[]) => Promise<number>;
  /** Reads the target's clock, so a test can hand one in rather than lay out a home or open a store. */
  readonly readClock: () => Promise<string | null>;
  /**
   * The instant a succeeded attempt's target is current AS OF, when the target certifies one itself — ChatGPT's
   * export, whose `sync` records it (`corpus/chatgpt/exportAsOf.ts`). `null` for every target whose success is
   * current as of the moment it finished. Read only after the steps succeeded; an error fails the attempt, since a
   * success that cannot say how current it is would stamp the freshness clock with the wrong instant.
   */
  readonly readAsOf: () => Result<string | null>;
  /**
   * Every browser leg that stopped part way since the last call, forgetting them — `browser/walkStops.ts` in
   * production. A step's exit code cannot carry this: a walk verb that lost its session still exits 0.
   */
  readonly takeWalkStops: () => readonly string[];
  /**
   * Every relay drop a step RECOVERED from since the last call, forgetting them — `browser/walkStops.ts`'s
   * `takeRelayRecoveries` in production.
   *
   * Reported and never judged, which is the whole distinction from {@link ResyncRunDeps.takeWalkStops}. A
   * recovered drop means the relay went, was rebuilt and the page was re-addressed, so the walk reached its
   * own end and the attempt is as good as one that never dropped; pushing it onto `problems` would fail an
   * attempt that actually succeeded. What it is instead is the only way a relay degrading underneath a
   * fleet of passing walks is visible at all.
   */
  readonly takeRelayRecoveries: () => readonly string[];
  /**
   * Every origin whose sign-in page a step reached since the last call, forgetting them —
   * `browser/signInWalls.ts` in production. Neither the exit code nor the last three stderr lines the slot keeps
   * reliably carries it, and it is the one failure the owner clears personally, so it is recorded on the attempt.
   */
  readonly takeSignInWalls: () => readonly string[];
  /**
   * Every walk since the last call that never started because another live process held the relay, forgetting
   * them — `browser/walkStops.ts#takeWalkCollisions` in production. The stop itself still reaches
   * {@link ResyncRunDeps.takeWalkStops}; this says the stop was contention rather than the recipe.
   */
  readonly takeWalkCollisions: () => readonly string[];
  readonly writeOut: (line: string) => void;
}

/** One finished run: what to persist, and the exit code the verb should answer with. */
export interface ResyncRunResult {
  readonly attempt: ResyncAttempt;
  readonly state: ResyncState;
}

/**
 * Run one target's steps and judge the result.
 *
 * @param policy the target's reviewed schedule, carrying the steps to run
 * @param home the state home every step is pointed at, so a scheduled pass and a test cannot diverge
 * @param previous what was remembered about this target before now
 * @param blocker what a human must clear, when the caller already knows; `null` leaves any standing one
 * @param demand the person's mention a demand-gated atlas walks for (`./demand.ts`), carried onto the attempt;
 *   absent for an ungated target
 * @param deps the injected edges
 * @returns the attempt and the state to persist
 */
export async function runResync({
  policy,
  home,
  previous,
  blocker,
  demand,
  deps,
}: {
  readonly policy: ResyncPolicy;
  readonly home: string;
  readonly previous: ResyncState | null;
  readonly blocker: ResyncBlocker | null;
  readonly demand?: ResyncDemandRecord | undefined;
  readonly deps: ResyncRunDeps;
}): Promise<ResyncRunResult> {
  const startedAtIso = deps.now();
  const beforeClock = await deps.readClock();
  const problems: string[] = [];
  const { exitCode, walkStops, signInWall, relayCollision, stepDeferred } = await runSteps({
    deps,
    home,
    problems,
    policy,
  });
  const afterClock = await deps.readClock();
  const judged = judgeResyncAttempt({
    afterClock,
    beforeClock,
    exitCode,
    recipeId: policy.recipeId,
    target: policy.target,
    walkStops,
  });
  if (judged.isErr()) {
    problems.push(judged.error.message);
  }
  const asOf = judged.isOk() ? deps.readAsOf() : ok(null);
  if (asOf.isErr()) {
    problems.push(...asOf.error);
  }
  const asOfIso = asOf.isOk() ? asOf.value : null;

  const attempt: ResyncAttempt = {
    afterClock,
    beforeClock,
    exitCode,
    finishedAtIso: deps.now(),
    outcome: judged.isOk() && asOf.isOk() ? "succeeded" : "failed",
    ...(asOfIso === null ? {} : { asOfIso }),
    problems,
    recipeId: policy.recipeId,
    startedAtIso,
    ...(signInWall === undefined ? {} : { signInWall }),
    ...(relayCollision === undefined ? {} : { relayCollision }),
    ...(stepDeferred === undefined ? {} : { stepDeferred }),
    ...(demand === undefined ? {} : { demand }),
  };
  return { attempt, state: nextResyncState({ attempt, blocker, previous }) };
}

/**
 * Run the target's steps in order, stopping at the first that failed OR whose browser walk stopped part way.
 *
 * A stop is drained per step rather than once at the end so the problem line names the step that lost the
 * browser — and drained BEFORE the first step too, because a stop this process left behind earlier (a
 * `browser shot`, a previous target's walk) is not this attempt's.
 *
 * A sign-in wall is a stop of its own kind: the pages behind it went unread exactly as they do behind a dropped
 * relay, so it fails the attempt the same way — and it is ALSO answered as its origin, because unlike a dropped
 * relay it is one the owner clears by signing in.
 *
 * A collision is the third: the walk lost the relay to another live walk before reading a page, so the step's
 * stop is noted as usual and the attempt ALSO carries the collision, which is what lets the verb give the slot
 * back for the next pass instead of failing it (`./outcome.ts#resyncExitCode`).
 *
 * A step that exits `EXIT_DEFERRED` is the fourth, and the same give-back: it ran and declined to act yet, so
 * the attempt carries that step's line and the next pass runs it unchanged.
 */
async function runSteps({
  policy,
  home,
  problems,
  deps,
}: {
  readonly policy: ResyncPolicy;
  readonly home: string;
  readonly problems: string[];
  readonly deps: ResyncRunDeps;
}): Promise<{
  exitCode: number;
  walkStops: readonly string[];
  signInWall: string | undefined;
  relayCollision: string | undefined;
  stepDeferred: string | undefined;
}> {
  const walkStops: string[] = [];
  let exitCode = 0;
  deps.takeWalkStops();
  deps.takeRelayRecoveries();
  deps.takeSignInWalls();
  deps.takeWalkCollisions();
  for (const step of policy.steps) {
    const line = resyncStepLine({ step });
    deps.writeOut(`  ${line}`);
    exitCode = await runOneStep({ argv: [...step.argv, "--home", home], deps, problems, step: line });
    const drained = drainStep({ deps, exitCode, line, problems, walkStops });
    // A compound target stops here too: the next step would build on a surface this one never finished. The
    // wall and the collision are only ever this stopping step's — one a step got past is not why the run ended.
    if (exitCode !== 0 || drained.stopped) {
      const stepDeferred = exitCode === EXIT_DEFERRED ? line : undefined;
      return { exitCode, relayCollision: drained.collision, signInWall: drained.wall, stepDeferred, walkStops };
    }
  }
  return { exitCode, relayCollision: undefined, signInWall: undefined, stepDeferred: undefined, walkStops };
}

/**
 * Drain every process-scoped register after one step, writing what each holds onto the attempt's problems and
 * walk stops, and answer whether the step's walk stopped and what wall or collision it met.
 */
function drainStep({
  deps,
  exitCode,
  line,
  problems,
  walkStops,
}: {
  readonly deps: ResyncRunDeps;
  readonly exitCode: number;
  readonly line: string;
  readonly problems: string[];
  readonly walkStops: string[];
}): { stopped: boolean; wall: string | undefined; collision: string | undefined } {
  // Reported, never pushed onto `problems` — see `ResyncRunDeps.takeRelayRecoveries`.
  for (const reason of deps.takeRelayRecoveries()) {
    deps.writeOut(`    relay rebuilt mid-walk and the page was re-addressed: ${reason}`);
  }
  const stopped = deps.takeWalkStops();
  for (const reason of stopped) {
    problems.push(`\`${line}\` exited ${String(exitCode)}, and its browser walk stopped part way: ${reason}`);
  }
  walkStops.push(...stopped);
  const walls = deps.takeSignInWalls();
  for (const origin of walls) {
    const reached = `\`${line}\` reached ${origin}'s sign-in page instead of the page it asked for`;
    problems.push(`${reached} — the owner signs in there in their work Chrome`);
    walkStops.push(reached);
  }
  const [wall] = walls;
  const [collision] = deps.takeWalkCollisions();
  return { collision, stopped: stopped.length > 0 || wall !== undefined, wall };
}

/** One step's exit code, with a throw turned into a non-zero rather than allowed to sink the pass. */
async function runOneStep({
  argv,
  step,
  problems,
  deps,
}: {
  readonly argv: readonly string[];
  readonly step: string;
  readonly problems: string[];
  readonly deps: ResyncRunDeps;
}): Promise<number> {
  try {
    const code = await deps.runVerb(["node", "slopweaver", ...argv]);
    if (code !== 0) {
      problems.push(`\`${step}\` exited ${String(code)}`);
    }
    return code;
  } catch (cause) {
    problems.push(`\`${step}\` threw: ${errorMessage({ error: cause })}`);
    return 1;
  }
}
