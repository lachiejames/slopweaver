/**
 * `slopweaver worktree mirror-prune` — plan, and with `--apply` free, the plugin mirrors of removed worktrees.
 *
 * The criterion, the measurement and what a removal touches are `worktree/pluginMirrors.ts`'s. This file reads
 * the world — the declared checkouts, the live registers, which keys still exist — and hands it over. The live
 * registers are the rail `worktree prune` keeps: unreadable live state refuses `--apply` outright, because a
 * session standing in a tree is indistinguishable from a cold one without them. The hourly `worktree prune
 * --apply` runs the same pass (`./pruneApplyPass.ts`), which is what keeps the mirror from growing back.
 */
import { existsSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { worktreePathKey } from "../../../worktree/location.js";
import {
  defaultPluginsData,
  findMirrorRoots,
  freeMirrorRoot,
  type MirrorRoot,
  type MirrorVerdict,
  mirrorByRootDirs,
  mirrorVerdict,
  rereadMirrorRoot,
  worktreeHomesOf,
} from "../../../worktree/pluginMirrors.js";
import { freeKib } from "../../../worktree/pruneApply.js";
import { worktreePruneFloorGb } from "../../../worktree/pruneFloor.js";
import { DEFAULT_APPLY_BUDGET, parseApplyBudget } from "../../../worktree/pruneOptions.js";
import { machinePacer, type Pacer } from "../../../worktree/prunePacing.js";
import { diskPressureFrom } from "../../../worktree/prunePressure.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWorktreeArgs, stringFlag, VERB_ARG_OFFSET, worktreeUsage } from "./core.js";
import { applyRefusal, heldReason, type LiveState, readLiveState } from "./pruneLiveState.js";

/** Free one mirror root, answering whether every slot is gone — `freeMirrorRoot` in production. */
type FreeRoot = (input: { root: MirrorRoot; timeoutMs: number }) => boolean;

/** What one pass over every mirror root found and did. */
export interface MirrorPass {
  /** Roots judged removable. */
  readonly removable: number;
  /** Slots those roots held — about 100 MB each. */
  readonly removableSlots: number;
  /** Roots whose every slot is now gone; zero on a plan. */
  readonly freed: number;
  /** Roots kept, by the reason that kept them. */
  readonly kept: ReadonlyMap<string, number>;
  /** Removable roots the budget did not reach. */
  readonly unreached: number;
}

/**
 * Plan and, when `apply`, free every removable mirror root on this machine until the deadline.
 *
 * @param checkouts the declared main checkouts
 * @param live the live registers, read once before the pass
 * @param apply whether to free, or only to count
 * @param deadlineMs the epoch instant no further root is started after
 * @param pluginsData `~/.claude/plugins/data`, or a fixture standing in for it
 * @param paused why no further root may be freed right now, given how many this pass already started, or null —
 *   the prune's own cap and load gate in production, so a test does not depend on how busy its machine is
 * @param freeRoot the one-root deletion, `freeMirrorRoot` in production — a throw from it is that root's alone
 * @param now the epoch millisecond a lock is aged at and `deadlineMs` is read against; the wall clock unless a test
 *   passes a fixed one
 * @returns the pass's tally
 */
export function pruneMirrors({
  checkouts,
  live,
  apply,
  deadlineMs,
  pluginsData,
  paused,
  freeRoot,
  now = Date.now,
}: {
  checkouts: readonly string[];
  live: LiveState;
  apply: boolean;
  deadlineMs: number;
  pluginsData: string;
  paused: (input: { done: number }) => string | null;
  freeRoot: FreeRoot;
  now?: () => number;
}): MirrorPass {
  const worktreeHomes = worktreeHomesOf({ checkouts });
  const roots = mirrorByRootDirs({ pluginsData }).flatMap((byRoot) => findMirrorRoots({ byRoot }));
  const kept = new Map<string, number>();
  const judge = ({ root }: { root: MirrorRoot }): MirrorVerdict =>
    mirrorVerdict({
      // A mirror is keyed by a directory, so only a path hold applies to it.
      held: heldReason({ live, path: root.key }),
      // Either spelling: a root keyed through the `worktrees` alias names a live tree even once the alias is gone.
      keyExists: existsSync(root.key) || existsSync(worktreePathKey({ path: root.key })),
      // Read at each judgement, so the re-judge before a free ages a freshly re-read lock against a fresh clock.
      nowMs: now(),
      root,
      worktreeHomes,
    });
  const removable: MirrorRoot[] = [];
  for (const root of roots) {
    const verdict = judge({ root });
    if (verdict.kind === "remove") {
      removable.push(root);
    } else {
      countKept({ kept, reason: verdict.reason });
    }
  }
  const freeing = apply
    ? freeRemovable({ deadlineMs, freeRoot, judge, kept, now, paused, removable })
    : { freed: 0, reached: 0 };
  return {
    freed: freeing.freed,
    kept,
    removable: removable.length,
    removableSlots: removable.reduce((sum, root) => sum + root.slots.length, 0),
    unreached: apply ? removable.length - freeing.reached : 0,
  };
}

/** Count one kept root under the reason that kept it. */
function countKept({ kept, reason }: { kept: Map<string, number>; reason: string }): void {
  const counted = kept.get(reason);
  kept.set(reason, counted === undefined ? 1 : counted + 1);
}

/**
 * Free the removable roots until the deadline, judging each one AGAIN right before its free: a pass may reach its
 * last root most of an hour after the walk, and a worktree re-created in that time must keep its fresh mirror.
 *
 * A root whose free THROWS is kept under a reason carrying the error, and the pass goes on to the next root: one
 * root's odd shape, or a race no path check closes, once ended the whole hourly `worktree prune --apply` and the
 * store held the row. Only the free is caught — a throw from the re-judge is a policy defect.
 */
function freeRemovable({
  removable,
  judge,
  kept,
  deadlineMs,
  now,
  paused,
  freeRoot,
}: {
  removable: readonly MirrorRoot[];
  judge: (root: { root: MirrorRoot }) => MirrorVerdict;
  kept: Map<string, number>;
  deadlineMs: number;
  now: () => number;
  paused: (input: { done: number }) => string | null;
  freeRoot: FreeRoot;
}): { freed: number; reached: number } {
  let freed = 0;
  let reached = 0;
  for (const root of removable) {
    const remaining = deadlineMs - now();
    // The same cap and load gate as every other prune delete, read before each root: the rest is left unreached.
    if (remaining <= 0 || paused({ done: reached }) !== null) {
      break;
    }
    reached += 1;
    const reread = rereadMirrorRoot({ root });
    const verdict = judge({ root: reread });
    if (verdict.kind === "keep") {
      countKept({ kept, reason: verdict.reason });
      continue;
    }
    try {
      if (freeRoot({ root: reread, timeoutMs: remaining })) {
        freed += 1;
      }
    } catch (error: unknown) {
      countKept({ kept, reason: `freeing its mirror threw — ${errorMessage({ error })}` });
    }
  }
  return { freed, reached };
}

/**
 * One pass as the lines it prints.
 *
 * @param pass what the pass found and did
 * @param apply whether it freed or only planned
 * @param freedKib how far free space rose across an apply, or `null` when unread or a plan
 * @returns the lines, the outcome first
 */
export function renderMirrorPass({
  pass,
  apply,
  freedKib,
}: {
  pass: MirrorPass;
  apply: boolean;
  freedKib: number | null;
}): readonly string[] {
  const head = apply
    ? `plugin mirrors: freed ${String(pass.freed)} of ${String(pass.removable)} removed worktree(s)' mirrors (${String(pass.removableSlots)} slot(s))`
    : `plugin mirrors: ${String(pass.removable)} removed worktree(s) still hold ${String(pass.removableSlots)} mirror slot(s) — pass --apply to free them`;
  const lines = [head];
  if (apply && freedKib !== null) {
    lines.push(
      `  free space rose ${(freedKib / 1_000_000).toFixed(1)} GB (anything else writing to the disk moves this too)`,
    );
  }
  if (pass.unreached > 0) {
    lines.push(
      `  ${String(pass.unreached)} not reached inside the budget or under the load hold — the next pass finishes them`,
    );
  }
  [...pass.kept.entries()]
    .toSorted(([, a], [, b]) => b - a)
    .forEach(([reason, count]) => lines.push(`  kept ${String(count)}: ${reason}`));
  return lines;
}

/**
 * Plan or apply one mirror pass for this home's declared checkouts, printing what it did.
 *
 * @param apply whether to free
 * @param budgetMs how long freeing may take
 * @param live the live registers, already read
 * @param json whether to print one JSON document instead of lines
 * @param pace the caller's pressure-aware pacer, whose gate is read before each root
 * @returns the tally, or `null` when no main checkout is declared
 */
export function runMirrorPass({
  apply,
  budgetMs,
  live,
  json,
  pace,
}: {
  apply: boolean;
  budgetMs: number;
  live: LiveState;
  json: boolean;
  pace: Pacer;
}): MirrorPass | null {
  const checkouts = mainCheckoutsFromProfile({ home: slopweaverHome() }).map((config) => config.path);
  const first = checkouts[0];
  if (first === undefined) {
    return null;
  }
  const before = apply ? freeKib({ path: first }) : null;
  const pass = pruneMirrors({
    apply,
    checkouts,
    deadlineMs: Date.now() + budgetMs,
    freeRoot: freeMirrorRoot,
    live,
    // No pause between roots: the pass runs synchronously inside the apply's budget. Under disk pressure it lifts
    // the cap and load gate exactly as the removals do, because a gone root is unique bytes — 14,508 files and
    // 0.126 GB, every one single-link (`find <root> -type f -ls`) — where a trash batch is hardlinks.
    // fseventsd still stops it between roots and governs every slot's delete from inside.
    paused: pace.stopReason,
    pluginsData: defaultPluginsData(),
  });
  const after = apply ? freeKib({ path: first }) : null;
  let freedKib: number | null = null;
  if (before !== null && after !== null) {
    freedKib = after - before;
  }
  if (json) {
    logger.out({ line: JSON.stringify({ ...pass, freedKib, kept: Object.fromEntries(pass.kept) }) });
  } else {
    for (const line of renderMirrorPass({ apply, freedKib, pass })) {
      logger.out({ line });
    }
  }
  return pass;
}

/**
 * `worktree mirror-prune` — plan, and with `--apply` free, the plugin mirrors whose worktree is gone.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero on a usage error, no declared checkout, or unreadable live state under
 *   `--apply`, which is `EXIT_DEFERRED` when cmux only did not answer in time
 */
export async function runWorktreeMirrorPrune(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: worktreeUsage({ verb: "mirror-prune" }) });
    return EXIT_OK;
  }
  const parsed = parseWorktreeArgs({ rest, verb: "mirror-prune" });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: worktreeUsage({ verb: "mirror-prune" }) });
    return EXIT_USAGE;
  }
  let budgetText = DEFAULT_APPLY_BUDGET;
  const passed = stringFlag({ name: "budget", parsed: parsed.value });
  if (passed !== undefined) {
    budgetText = passed;
  }
  const budget = parseApplyBudget({ value: budgetText });
  if (budget.isErr()) {
    for (const error of budget.error) {
      logger.error({ msg: error });
    }
    return EXIT_USAGE;
  }
  const apply = parsed.value.values["apply"] === true;
  const live = await readLiveState();
  // The same decision `worktree prune --apply` takes, so the two verbs' exits cannot drift apart.
  const refused = applyRefusal({ apply, live, verb: "worktree mirror-prune" });
  if (refused !== null) {
    logger.error({ msg: refused.line });
    return refused.exitCode;
  }
  const home = slopweaverHome();
  // Free disk against the prune floor, read afresh each time, exactly as `worktree prune --apply` paces.
  const pace = machinePacer({
    diskPressureNow: () =>
      diskPressureFrom({
        availableKib: freeKib({ path: home }),
        floorGb: worktreePruneFloorGb(),
      }),
  });
  const pass = runMirrorPass({
    apply,
    budgetMs: budget.value,
    json: parsed.value.values["json"] === true,
    live,
    pace,
  });
  if (pass === null) {
    logger.error({
      msg: "worktree mirror-prune: no main checkouts declared — add a `mainCheckouts` array to $SLOPWEAVER_HOME/profile.json",
    });
    return EXIT_USAGE;
  }
  return EXIT_OK;
}

export const worktreeMirrorPruneCommand = defineCommand({ run: runWorktreeMirrorPrune });
