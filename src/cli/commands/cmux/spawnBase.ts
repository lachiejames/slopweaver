/**
 * The base-freshness advisory `cmux spawn` prints before it opens anything, and the refusal
 * `--require-current-base` turns it into.
 *
 * ## What is actually at risk, stated precisely
 *
 * A brand-new worktree is NOT forked from the main checkout — `cmux/worktree.ts` fetches the remote and forks
 * from `FETCH_HEAD`, which is deliberate. So a stale main checkout cannot give a new branch a stale
 * base. What it CAN do is exactly what was measured: the doc's probes read the main checkout,
 * a bare `slopweaver` runs the main checkout's code, and a session reading only that tree answers from a
 * branch state that has since moved. That is the drift this advisory is about, and the extra line below says
 * so rather than letting a reader infer the stronger, false claim.
 *
 * The effectful half only: every rule it applies lives in `cmux/baseFreshness.ts`, pure and unit-tested.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { absentAsEmpty } from "#lib/absent.js";
import { type CheckoutFreshness, renderCheckoutFreshness } from "../../../checkouts/freshness.js";
import {
  type CheckoutInspectDeps,
  changedPathsBetween,
  inspectCheckout,
  productionInspectDeps,
} from "../../../checkouts/inspect.js";
import {
  assessSpawnBase,
  docReferencedPaths,
  type SpawnBaseAssessment,
  spawnBaseLines,
  spawnBaseRefusal,
} from "../../../cmux/baseFreshness.js";
import type { SpawnPlan } from "../../../cmux/plan.js";
import { pluginDirForSpawnTarget, slopweaverPluginInstalled, spawnLoadRouteRefusal } from "../../../cmux/pluginDir.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { logger } from "../../../lib/logger.js";

/**
 * One base-freshness verdict: the lines to print, and the refusal when the caller demanded a current base.
 *
 * @internal — the shape this module's own helpers pass around; `reportSpawnPreflight` is the public surface.
 */
export interface SpawnBaseVerdict {
  readonly lines: readonly string[];
  readonly refusal: string | undefined;
}

/** The note that keeps the advisory from overstating itself — a new branch is forked from the remote, not here. */
const FORK_NOTE =
  "  (a NEW worktree forks from the freshly-fetched remote, so this drift affects what the doc's probes and a " +
  "bare `slopweaver` read — not the branch about to be cut)";

/** The advisory for a main checkout whose drift could not be measured at all. */
function unmeasured({ repoRoot }: { repoRoot: string }): SpawnBaseVerdict {
  return {
    lines: [`base: could not measure whether ${repoRoot} is current with its upstream`],
    refusal: undefined,
  };
}

/** What the base line calls the checkout's HEAD: its branch, or — with none checked out — a detached HEAD. */
function checkedOutLabel({ freshness }: { freshness: CheckoutFreshness }): string {
  const branch = freshness.branch;
  if (branch === undefined) {
    return "detached HEAD";
  }
  return branch;
}

/**
 * Measure the doc's main checkout and turn it into the lines a spawn prints, plus any refusal.
 *
 * @internal — exported for its own unit tests and for {@link reportSpawnPreflight}, which is the one caller
 *   outside this module's tests; the effect half lives here so the measurement stays injectable.
 * @param plan the already-decided spawn plan, for the repository and whether a worktree already exists
 * @param doc the doc being spawned, for its `doneWhen:` probe paths
 * @param docText the doc's full markdown, for the paths its prose names
 * @param deps the git/stat read seams
 * @param requireCurrentBase whether the caller passed `--require-current-base`
 * @param nowMs the current wall-clock, for the checkout report's fetch-age line
 * @returns the lines to print and the refusal, if any
 */
export function spawnBaseVerdict({
  plan,
  doc,
  docText,
  deps,
  requireCurrentBase,
  nowMs,
}: {
  plan: SpawnPlan;
  doc: HandoverDoc;
  docText: string;
  deps: CheckoutInspectDeps;
  requireCurrentBase: boolean;
  nowMs: number;
}): SpawnBaseVerdict {
  // `current`: a spawn decision must be made against fresh refs, and has no use for the reference scan.
  const freshness = inspectCheckout({ config: { path: plan.repoRoot }, deps, depth: "current" });
  const report = renderCheckoutFreshness({ freshness, nowMs });
  const upstream = freshness.upstream;
  if (upstream === undefined || freshness.drift === undefined) {
    return { lines: [...report, ...unmeasured({ repoRoot: plan.repoRoot }).lines], refusal: undefined };
  }
  const changedPaths = absentAsEmpty({
    value: changedPathsBetween({ cwd: plan.repoRoot, deps, from: "HEAD", to: upstream }),
  });
  const assessment: SpawnBaseAssessment = assessSpawnBase({
    behind: freshness.drift.behind,
    changedPaths,
    docPaths: docReferencedPaths({ docText, probes: doc.doneWhen }),
  });
  const advisory = spawnBaseLines({
    assessment,
    branch: checkedOutLabel({ freshness }),
    requireCurrentBase,
    upstream,
  });
  return {
    lines: [...report, ...advisory, ...(assessment.behind > 0 && !plan.worktreeExists ? [FORK_NOTE] : [])],
    refusal: spawnBaseRefusal({ assessment, requireCurrentBase }),
  };
}

/**
 * Print the base-freshness advisory for the doc's own repository, and report whether the spawn must refuse —
 * on that base, or on having no route to Slopweaver at all.
 *
 * Both halves run BEFORE any worktree or workspace effect, for the same reason the Codex quota fast-fail
 * does: a spawn that is going to be refused should not first leave a directory and a cmux tab behind. The
 * load-route half is the only one whose answer lives outside this repository, and `cmux/pluginDir.ts`
 * carries the ruling that made the marketplace install the default.
 *
 * @param doc the handover doc being spawned against
 * @param docText its raw text, read for the paths it references
 * @param plan the resolved spawn plan
 * @param requireCurrentBase whether `--require-current-base` turns the advisory into a refusal
 * @returns the refusal reason, or undefined when the spawn may proceed
 */
export function reportSpawnPreflight({
  doc,
  docText,
  plan,
  requireCurrentBase,
}: {
  readonly doc: HandoverDoc;
  readonly docText: string;
  readonly plan: SpawnPlan;
  readonly requireCurrentBase: boolean;
}): string | undefined {
  const verdict = spawnBaseVerdict({
    deps: productionInspectDeps(),
    doc,
    docText,
    nowMs: Date.now(),
    plan,
    requireCurrentBase,
  });
  for (const line of verdict.lines) {
    logger.out({ line });
  }
  // A stale base is refused first; only a base that passes is then judged on its route to Slopweaver.
  if (verdict.refusal !== undefined) {
    return verdict.refusal;
  }
  return spawnLoadRouteRefusal({
    installed: slopweaverPluginInstalled({ claudeDir: join(homedir(), ".claude") }),
    pluginDir: pluginDirForSpawnTarget({ cwd: plan.cwd, repoRoot: plan.repoRoot }),
    repoRoot: plan.repoRoot,
  });
}
