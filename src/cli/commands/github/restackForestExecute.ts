/**
 * `slopweaver github stack restack`'s moving half: replay every planned branch locally, adopt the operator's
 * own branch onto its replayed commits where that is safe, and print what happened. It writes nothing to the
 * remote.
 *
 * Split out of `./restackForestRun.ts` when that shell crossed the file-size cap. `./restackForestFacts.ts`
 * measures what this replays, and `./restackForestCore.ts` plans it.
 */
import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import {
  adoptRestackedBranch,
  forkPointOf,
  type RestackOutcome,
  type RestackTarget,
  restackOneBranch,
  restackStagingRef,
} from "./restackExec.js";
import { type RestackForest, type RestackNode, replayBaseSha } from "./restackForestCore.js";
import type { StackVerbDeps } from "./stackVerbDeps.js";

/**
 * What executing the plan produced, per branch, plus the trees a conflict stopped.
 *
 * @internal the shape this verb's executor returns to its own printer and tests.
 */
export interface RestackRunReport {
  readonly outcomes: readonly RestackOutcome[];
  readonly blocked: readonly string[];
  readonly adopted: readonly string[];
  readonly notAdopted: readonly string[];
}

/** What one node's replay needs, or the reason this tree stops here. */
function targetFor({
  baseTips,
  deps,
  generationId,
  moved,
  node,
  repoRoot,
}: {
  baseTips: ReadonlyMap<string, string>;
  deps: StackVerbDeps;
  generationId: string;
  moved: ReadonlyMap<string, string>;
  node: RestackNode;
  repoRoot: string;
}): GithubVerbResult<RestackTarget> {
  const label = `${node.branch} (PR #${String(node.pullRequestNumber)})`;
  const preRunBaseTip = baseTips.get(node.baseBranch);
  if (preRunBaseTip === undefined) {
    return err(GithubVerbErrors.baseTipUnmeasured({ label }));
  }
  // The fork point is measured against the base's tip as it stood BEFORE this run moved anything, which is
  // exactly what the branch is currently replayed from — for a root and for a child alike, so neither needs
  // its own rule and neither needs git's fork-point heuristic.
  const oldBaseSha = forkPointOf({ baseTip: preRunBaseTip, git: deps.git, headSha: node.headSha, repoRoot });
  if (oldBaseSha === undefined) {
    return err(GithubVerbErrors.noMergeBase({ baseBranch: node.baseBranch, label }));
  }
  return ok({
    branch: node.branch,
    generationId,
    headSha: node.headSha,
    newBaseSha: replayBaseSha({ baseBranch: node.baseBranch, moved, preRunBaseTip }),
    oldBaseSha,
  });
}

/** Execute one tree's moving nodes in order, stopping the tree at the first that does not replay. */
function executeTree({
  baseTips,
  deps,
  generationId,
  moved,
  nodes,
  report,
  repoRoot,
}: {
  baseTips: ReadonlyMap<string, string>;
  deps: StackVerbDeps;
  generationId: string;
  moved: Map<string, string>;
  nodes: readonly RestackNode[];
  report: { outcomes: RestackOutcome[]; blocked: string[]; adopted: string[]; notAdopted: string[] };
  repoRoot: string;
}): void {
  for (const node of nodes) {
    if (node.reason === undefined) {
      continue;
    }
    const target = targetFor({ baseTips, deps, generationId, moved, node, repoRoot });
    if (target.isErr()) {
      report.blocked.push(target.error.message);
      return;
    }
    const outcome = restackOneBranch({ deps: deps.git, repoRoot, target: target.value });
    report.outcomes.push(outcome);
    if (outcome.kind !== "restacked") {
      const how = outcome.kind === "conflict" ? "conflicted" : "failed";
      report.blocked.push(`everything above ${node.branch} in this tree is unmoved: its own replay ${how}`);
      return;
    }
    moved.set(node.branch, outcome.toSha);
    recordAdoption({ deps, generationId, node, report, repoRoot, toSha: outcome.toSha });
  }
}

/** Move the operator's own branch onto its replayed commits where that is safe, and record which way it went. */
function recordAdoption({
  deps,
  generationId,
  node,
  report,
  repoRoot,
  toSha,
}: {
  deps: StackVerbDeps;
  generationId: string;
  node: RestackNode;
  report: { adopted: string[]; notAdopted: string[] };
  repoRoot: string;
  toSha: string;
}): void {
  const adopted = adoptRestackedBranch({
    branch: node.branch,
    deps: deps.git,
    expectedSha: node.headSha,
    repoRoot,
    stagedRef: restackStagingRef({ branch: node.branch, generationId }),
    toSha,
  });
  if (adopted.isOk()) {
    report.adopted.push(node.branch);
    return;
  }
  report.notAdopted.push(adopted.error.message);
}

/**
 * Replay every moving node of every tree, locally.
 *
 * @internal driven by this verb's own shell; a caller wanting a restack runs the verb.
 * @param forest the plan to execute
 * @param generationId the id every staged ref this run writes is namespaced by
 * @returns one outcome per attempted branch, the trees a failure stopped, and which branches were adopted
 */
export function executeRestackForest({
  baseTips,
  deps,
  forest,
  generationId,
  repoRoot,
}: {
  baseTips: ReadonlyMap<string, string>;
  deps: StackVerbDeps;
  forest: RestackForest;
  generationId: string;
  repoRoot: string;
}): RestackRunReport {
  const report = {
    adopted: [] as string[],
    blocked: [] as string[],
    notAdopted: [] as string[],
    outcomes: [] as RestackOutcome[],
  };
  const moved = new Map<string, string>();
  for (const tree of forest.trees) {
    executeTree({ baseTips, deps, generationId, moved, nodes: tree.nodes, report, repoRoot });
  }
  return report;
}

/**
 * The lines a completed restack prints, after every replay.
 *
 * @param report what the execution produced
 * @returns the report lines, in order
 */
export function restackRunReportLines({ report }: { report: RestackRunReport }): readonly string[] {
  const lines: string[] = [];
  for (const outcome of report.outcomes) {
    if (outcome.kind === "restacked") {
      lines.push(`restacked ${outcome.branch}: ${outcome.fromSha} -> ${outcome.toSha}`);
      continue;
    }
    lines.push(`${outcome.kind}: ${outcome.branch} — ${outcome.reason}`);
  }
  for (const branch of report.adopted) {
    lines.push(`  moved local ${branch} onto its restacked commits`);
  }
  for (const reason of report.notAdopted) {
    lines.push(`  ${reason}`);
  }
  for (const reason of report.blocked) {
    lines.push(`blocked: ${reason}`);
  }
  return lines;
}
