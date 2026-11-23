/**
 * `supervisor tick open`'s seat for a stopped recipe set: the tick reads the set, and when no seat holds it the tick
 * itself registers ONE repair row and spawns it, the same tick — never a card asking the owner to (the
 * pure half and the whole why are `../../../supervisor/stoppedRecipeSeat.ts`).
 *
 * Every child is bounded and every outcome is an ACTION in the template the chair fills, so a failed spawn is a
 * `failed` action the close gate does not count as a seat. Nothing here aborts the open: a set it cannot read, or a
 * board it cannot read, leaves the board untouched and says so in the digest, and the close gate refuses the tick.
 *
 * One automatic attempt per episode. A doc of the episode already on disk that the board no longer lists is an
 * attempt that ENDED with the stop still standing; a second automatic spawn would loop the fleet over a repair that
 * has already failed once, so the open registers the next attempt and leaves its spawn to the chair, whom the close
 * gate then makes decide — spawn it, or hold it with a reason.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { Result } from "#lib/result.js";

import type { StoppedRepairSet } from "../../../monitor/types.js";
import type { DigestReading } from "../../../supervisor/digestRead.js";
import { type ChildOutcome, describeChildOutcome, exitCodeOf } from "../../../supervisor/scratch/childOutcome.js";
import {
  type EpisodeRows,
  episodeRowsOf,
  repairAsk,
  repairSlugBaseOf,
  repairSlugOf,
  stoppedSetOf,
} from "../../../supervisor/stoppedRecipeSeat.js";
import type { AuthoredAction } from "../../../supervisor/tickInput.js";
import { EXIT_DEFERRED } from "../../exitCodes.js";
import type { ScratchDeps } from "./scratchDeps.js";

/** A registration writes one doc and one journal line; the capture's per-reading budget covers it. */
const REGISTER_TIMEOUT_MS = 120_000;

/**
 * `cmux spawn` creates a worktree, opens a workspace and boots a session, so it gets the landing reading's budget
 * rather than a plain reading's (`../../../supervisor/scratch/tickCapture.ts` `LANDING_TIMEOUT_MS`).
 */
const STOPPED_REPAIR_SPAWN_TIMEOUT_MS = 300_000;

/** Why the row is the `self` workspace's: a stopped recipe is this instance's own automation. */
const WORKSPACE_BECAUSE = "a stopped recipe is this Slopweaver instance's own automation, repaired in its own checkout";

/** What the open did about the stopped set: the actions the template carries and the digest lines it prints. */
export interface StoppedSeatOutcome {
  readonly actions: readonly AuthoredAction[];
  readonly lines: readonly string[];
}

/** Everything one seat attempt needs beyond the set itself. */
interface SeatContext {
  readonly bin: string;
  readonly captureDir: string;
  readonly deps: ScratchDeps;
  /** `--home <dir>` when the open was given one, so the children write where the tick reads. */
  readonly homeArgv: readonly string[];
}

/** One child's outcome as an action outcome: only a clean exit is an act that happened. */
function outcomeOf({ child }: { child: ChildOutcome }): "completed" | "failed" {
  return exitCodeOf({ outcome: child }) === 0 ? "completed" : "failed";
}

/** The label every action on a repair row carries. */
function labelOf({ repair }: { repair: StoppedRepairSet }): string {
  return `repair the stopped ${repair.recipeIds.map((id) => JSON.stringify(id)).join(", ")}`;
}

/** Run one bounded child into a named pair of files beside the capture. */
async function runInto({
  context,
  argv,
  name,
  timeoutMs,
}: {
  context: SeatContext;
  argv: readonly string[];
  name: string;
  timeoutMs: number;
}): Promise<{ child: ChildOutcome; stdoutPath: string }> {
  const stdoutPath = join(context.captureDir, `${name}.out`);
  const child = await context.deps.runChild({
    argv: [...argv, ...context.homeArgv],
    bin: context.bin,
    stderrPath: join(context.captureDir, `${name}.err`),
    stdoutPath,
    timeoutMs,
  });
  return { child, stdoutPath };
}

/** Spawn one row and say how it went, as the action the close gate reads. */
async function spawnRow({
  context,
  repair,
  slug,
}: {
  context: SeatContext;
  repair: StoppedRepairSet;
  slug: string;
}): Promise<StoppedSeatOutcome> {
  const { child, stdoutPath } = await runInto({
    argv: ["cmux", "spawn", slug, "--model", "opus"],
    context,
    name: "seat-repair-spawn",
    timeoutMs: STOPPED_REPAIR_SPAWN_TIMEOUT_MS,
  });
  // A spawn the fleet-wide backoff deferred is NOT YET, never a failure: it journals no `dispatched`, so the row stays
  // unseated and the next tick's open spawns it again, while `held` still leaves the close gate wanting an answer now.
  const deferred = exitCodeOf({ outcome: child }) === EXIT_DEFERRED;
  const outcome = deferred ? "held" : outcomeOf({ child });
  const action: AuthoredAction = {
    actionId: `stopped-recipes-spawn-${slug}`,
    detail: `tick open seated the stopped set's repair: cmux spawn ${slug} --model opus (${describeChildOutcome({ outcome: child })})`,
    kind: "spawned",
    outcome,
    subject: { id: slug, kind: "handover", label: labelOf({ repair }) },
    witness: { kind: "artifact", ref: stdoutPath },
  };
  return { actions: [action], lines: [spawnLineOf({ child, outcome, slug })] };
}

/** The digest line for one repair spawn's outcome. */
function spawnLineOf({
  child,
  outcome,
  slug,
}: {
  child: ChildOutcome;
  outcome: "completed" | "held" | "failed";
  slug: string;
}): string {
  switch (outcome) {
    case "completed":
      return `stopped recipes: seated ${slug} on opus`;
    case "held":
      return `stopped recipes: the spawn backoff deferred ${slug} (exit 4), so the next tick spawns it again — or hold it before close`;
    case "failed":
      return `stopped recipes: spawning ${slug} ${describeChildOutcome({ outcome: child })} — seat it or hold it before close`;
  }
}

/** The `handover register` argv for one p0 repair row in the `self` workspace, cut from `repo`. */
function registerArgv({
  repair,
  repo,
  slug,
}: {
  repair: StoppedRepairSet;
  repo: string;
  slug: string;
}): readonly string[] {
  return [
    "handover",
    "register",
    "--ask",
    repairAsk({ recipeIds: repair.recipeIds, slug }),
    "--dispatch",
    "--keep-lines",
    "--slug",
    slug,
    "--priority",
    "p0",
    "--workspace",
    "self",
    "--workspace-because",
    WORKSPACE_BECAUSE,
    "--repo",
    repo,
  ];
}

/** Register the episode's next attempt; spawn it unless an earlier attempt already ran its course. */
async function registerAttempt({
  context,
  repair,
  repo,
  slug,
  spawn,
}: {
  context: SeatContext;
  repair: StoppedRepairSet;
  repo: string;
  slug: string;
  spawn: boolean;
}): Promise<StoppedSeatOutcome> {
  const { child, stdoutPath } = await runInto({
    argv: registerArgv({ repair, repo, slug }),
    context,
    name: "seat-repair-register",
    timeoutMs: REGISTER_TIMEOUT_MS,
  });
  const outcome = outcomeOf({ child });
  const registered: AuthoredAction = {
    actionId: `stopped-recipes-register-${slug}`,
    detail: `tick open registered the stopped set's repair row ${slug} (${describeChildOutcome({ outcome: child })})`,
    kind: "state-amended",
    outcome,
    subject: { id: slug, kind: "handover", label: labelOf({ repair }) },
    witness: { kind: "artifact", ref: stdoutPath },
  };
  if (outcome === "failed") {
    return {
      actions: [registered],
      lines: [
        `stopped recipes: registering ${slug} ${describeChildOutcome({ outcome: child })}, so nothing was seated`,
      ],
    };
  }
  if (!spawn) {
    return {
      actions: [registered],
      lines: [
        `stopped recipes: an earlier repair of this stop ended with it still standing, so ${slug} is registered and NOT ` +
          "spawned — spawn it or hold it with a reason before close",
      ],
    };
  }
  const spawned = await spawnRow({ context, repair, slug });
  return { actions: [registered, ...spawned.actions], lines: spawned.lines };
}

/** Whether any file in `dir` passes `matches`, a missing directory holding none. */
function anyIn({ dir, matches }: { dir: string; matches: (name: string) => boolean }): boolean {
  return existsSync(dir) && readdirSync(dir).some(matches);
}

/**
 * Whether this episode was already attempted: a doc of it other than `except`'s under the board directory the
 * children write into, ANY doc of it in `archive/`, where a closed attempt's doc moves and the live board scan no
 * longer looks — or ANY run journal of it, `except`'s own included. `cmux spawn` journals `dispatched` only once the
 * workspace opened, so a journal is an attempt whose seat ran, never one that failed to start.
 *
 * The scan is by FILENAME. What it does not close: an archived doc renamed away from its slug (measured, with its repro,
 * at `../handover/registerWrite.ts` `archivedClaimant`), which only a hand rename produces. An attempt that RAN under such a doc is still caught,
 * because its journal is keyed by slug and nothing moves it; one never spawned is missed, and reading every archived
 * doc's front matter each tick would close that.
 */
function earlierAttemptOnDisk({
  handoverDir,
  runsDir,
  episodeKey,
  except,
}: {
  handoverDir: string;
  runsDir: string;
  episodeKey: string;
  except: string | undefined;
}): boolean {
  const base = `${repairSlugBaseOf({ episodeKey })}-`;
  const own = except === undefined ? undefined : `${except}.md`;
  return (
    anyIn({ dir: handoverDir, matches: (name) => name.startsWith(base) && name.endsWith(".md") && name !== own }) ||
    anyIn({ dir: join(handoverDir, "archive"), matches: (name) => name.startsWith(base) && name.endsWith(".md") }) ||
    anyIn({ dir: runsDir, matches: (name) => name.startsWith(base) && name.endsWith(".jsonl") })
  );
}

/**
 * The stopped set and its episode's rows when the open may act on them, or the digest lines saying why it may not: a
 * reading it cannot use, no set, a live seat already holding it, or a fleet it could not observe.
 */
function unseatedEpisodeOf({
  stopped,
  reconcile,
}: {
  stopped: DigestReading | undefined;
  reconcile: DigestReading | undefined;
}): { kind: "seatable"; repair: StoppedRepairSet; rows: EpisodeRows } | { kind: "settled"; lines: readonly string[] } {
  if (stopped?.kind !== "json") {
    return { kind: "settled", lines: ["stopped recipes: nothing seated — the recipe-stopped reading printed no JSON"] };
  }
  const set = stoppedSetOf({ document: stopped.value });
  if (set.kind === "clear") {
    return { kind: "settled", lines: [] };
  }
  if (set.kind === "unreadable") {
    return { kind: "settled", lines: [`stopped recipes: nothing seated — ${set.why}`] };
  }
  if (reconcile?.kind !== "json") {
    return { kind: "settled", lines: ["stopped recipes: nothing seated — the reconcile reading did not complete"] };
  }
  const rows = episodeRowsOf({ episodeKey: set.repair.episodeKey, reconciliation: reconcile.value });
  if (rows.kind === "unreadable") {
    return { kind: "settled", lines: [`stopped recipes: nothing seated — ${rows.why}`] };
  }
  const [seated] = rows.value.seated;
  if (seated !== undefined) {
    return { kind: "settled", lines: [`stopped recipes: ${seated} already has a seat`] };
  }
  // With cmux unread, no placement is a live seat, so a seat on the episode cannot be ruled out: nothing is written.
  if (!rows.value.fleetObserved) {
    return {
      kind: "settled",
      lines: ["stopped recipes: nothing seated — with cmux unread, a seat on this stop cannot be ruled out"],
    };
  }
  return { kind: "seatable", repair: set.repair, rows: rows.value };
}

/**
 * Seat the stopped set this tick read, or say why it did not.
 *
 * @param stopped the tick's `recipe-stopped` reading, digested
 * @param reconcile the tick's `reconcile` reading, digested — which repair rows are already on the board
 * @param tickId the tick's ledger id, which names a new attempt's row
 * @param handoverDir the board directory, where an earlier attempt's doc would be
 * @param runsDir the run journals, where a dispatched attempt's `dispatched` line would be
 * @param captureDir the tick's directory, where each child's output is kept as the action's witness
 * @param bin the `slopweaver` binary the children launch from
 * @param home the `--home` the open was given, passed on to every child
 * @param checkout the declared main checkout a new row's seat is cut from, asked only when one is registered
 * @param deps the scratch seams — the child launcher
 * @returns the actions the chair's template carries, and the digest lines
 */
export async function seatStoppedRecipes({
  stopped,
  reconcile,
  tickId,
  handoverDir,
  runsDir,
  captureDir,
  bin,
  home,
  checkout,
  deps,
}: {
  stopped: DigestReading | undefined;
  reconcile: DigestReading | undefined;
  tickId: string;
  handoverDir: string;
  runsDir: string;
  captureDir: string;
  bin: string;
  home: string | undefined;
  checkout: () => Result<string>;
  deps: ScratchDeps;
}): Promise<StoppedSeatOutcome> {
  const episode = unseatedEpisodeOf({ reconcile, stopped });
  if (episode.kind === "settled") {
    return { actions: [], lines: episode.lines };
  }
  const { repair, rows } = episode;
  const context: SeatContext = { bin, captureDir, deps, homeArgv: home === undefined ? [] : ["--home", home] };
  const [unseated] = rows.unseated;
  if (unseated !== undefined) {
    // A row registered unspawned because an earlier attempt ended stays the chair's to spawn on every later tick too,
    // and so does one whose own seat already ran and ended.
    if (earlierAttemptOnDisk({ episodeKey: repair.episodeKey, except: unseated, handoverDir, runsDir })) {
      return {
        actions: [],
        lines: [
          `stopped recipes: an earlier repair of this stop ended with it still standing, so ${unseated} is NOT ` +
            "spawned — spawn it or hold it with a reason before close",
        ],
      };
    }
    return spawnRow({ context, repair, slug: unseated });
  }
  // Resolved BEFORE the row is written, as `vulnerability-fix topup` learned: a row naming no checkout is refused by `cmux spawn`.
  const repo = checkout();
  if (repo.isErr()) {
    return {
      actions: [],
      lines: [`stopped recipes: nothing seated — no checkout to cut the seat from: ${repo.error.join("; ")}`],
    };
  }
  return registerAttempt({
    context,
    repair,
    repo: repo.value,
    slug: repairSlugOf({ episodeKey: repair.episodeKey, tickId }),
    spawn: !earlierAttemptOnDisk({ episodeKey: repair.episodeKey, except: undefined, handoverDir, runsDir }),
  });
}
