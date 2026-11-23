/**
 * The whole-forest restack planner — which of the operator's open pull requests move, in what order,
 * before anything is rebased and long before anything is pushed.
 *
 * ## Why a FOREST rather than a stack
 *
 * Owner ruling: a sync on the default branch auto-rebases ALL pull requests onto the latest base branch,
 * stacked ones onto their own latest base branches, and a separate submit step then pushes all of that up to the
 * remote. Two properties of that ruling are the whole design here, and neither is what
 * `./stackSyncCore.ts` plans:
 *
 * - **ALL pull requests, not the members of a native GitHub stack.** MEASURED:
 *   `github stack sync --dry-run` walked 227 registered pull requests in lachiejames/slopweaver and planned
 *   ZERO rebases, every one of them residue reading `registered but is not part of a native GitHub stack` —
 *   a pull request based directly on the trunk is not a native stack until something is pushed on top of it,
 *   so the verb whose job is "rebase my pull requests onto the fresh trunk" skipped every one. The same run
 *   in acme/acme-admin planned zero from 47. Reproduce both:
 *
 *   ```bash
 *   slopweaver github stack sync --dry-run   # in each repository
 *   ```
 *
 * - **A branch may carry more than one child.** Two pull requests based on the same head is an ordinary
 *   shape, and a planner that assumes a single chain either drops one of them or invents an order between
 *   them. So the unit is a tree, the collection of trees is a forest, and the ONE guarantee the ordering
 *   makes is that a parent is always planned before its children.
 *
 * ## Every base that is not another in-scope head is a root
 *
 * The trunk is not special-cased. A pull request based on the trunk, on a long-lived release branch, or on
 * somebody else's branch is a root either way, and a root is rebased onto its own base's fresh remote tip —
 * which is exactly "onto its latest base branch" for all three. Special-casing the trunk would have left the
 * release-branch shape with no rule at all.
 *
 * Nothing here touches Git or the network. `./restackForestFacts.ts` gathers the facts and
 * `./restackForestExecute.ts` performs the moves.
 */

/** One open pull request of the operator's, as the planner needs it — measured by the shell, never here. */
export interface RestackPullRequest {
  readonly number: number;
  readonly headRef: string;
  readonly baseRef: string;
  /** The pull request's live head SHA, from GitHub — the commit range's tip, never derived locally. */
  readonly headSha: string;
  /**
   * Whether the base branch's live tip is still a git ANCESTOR of this head — the sole staleness signal,
   * for the same reason `./stackSyncCore.ts` gives: it needs no theory about what GitHub's own `base` field
   * means. A node whose parent moves is replanned regardless of what this said.
   */
  readonly baseIsAncestorOfHead: boolean;
}

/**
 * Why one node is being restacked.
 *
 * @internal a field of {@link RestackNode}; no caller outside this verb names the type.
 */
export type RestackReason = "base-moved" | "propagated";

/** One pull request's place in its tree, and whether this plan moves it. */
export interface RestackNode {
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly baseBranch: string;
  readonly headSha: string;
  /** 0 for a root, one more than its parent's for every child. */
  readonly depth: number;
  /** Why it moves, or `undefined` when this plan leaves it exactly where it is. */
  readonly reason: RestackReason | undefined;
}

/**
 * One root and everything stacked above it, ordered so a parent always precedes its children.
 *
 * @internal a member of {@link RestackForest}; no caller outside this verb names the type.
 */
export interface RestackTree {
  readonly rootBranch: string;
  readonly nodes: readonly RestackNode[];
}

/** The whole plan: every tree of the operator's open pull requests, plus what could not be placed. */
export interface RestackForest {
  readonly trees: readonly RestackTree[];
  /** Every pull request left out of a tree, each naming why — a duplicate head, or a base cycle. */
  readonly residue: readonly string[];
}

/** Pull requests indexed by head branch, and the residue for any head two of them claim. */
function indexByHead({ pullRequests }: { pullRequests: readonly RestackPullRequest[] }): {
  readonly byHead: ReadonlyMap<string, RestackPullRequest>;
  readonly ambiguous: ReadonlySet<string>;
  readonly residue: readonly string[];
} {
  const seen = new Map<string, RestackPullRequest[]>();
  for (const pullRequest of pullRequests) {
    const existing = seen.get(pullRequest.headRef);
    if (existing === undefined) {
      seen.set(pullRequest.headRef, [pullRequest]);
    } else {
      existing.push(pullRequest);
    }
  }
  const byHead = new Map<string, RestackPullRequest>();
  const ambiguous = new Set<string>();
  const residue: string[] = [];
  for (const [head, claimants] of seen) {
    if (claimants.length === 1) {
      byHead.set(head, claimants[0]!);
      continue;
    }
    ambiguous.add(head);
    const numbers = claimants
      .map((claimant) => `#${String(claimant.number)}`)
      .toSorted((a, b) => a.localeCompare(b))
      .join(", ");
    residue.push(`${numbers} all have head ${head} — cannot tell which one a child of it would follow`);
  }
  return { ambiguous, byHead, residue };
}

/**
 * The chain of head branches from one pull request down towards its root, or nothing when it rides a cycle.
 * Walks bases while each one names another in-scope head, capping at the number of pull requests in scope,
 * which is why a cycle is detected rather than looped over.
 */
function ancestryOf({
  byHead,
  pullRequest,
}: {
  byHead: ReadonlyMap<string, RestackPullRequest>;
  pullRequest: RestackPullRequest;
}): readonly string[] | undefined {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: RestackPullRequest | undefined = pullRequest;
  while (current !== undefined) {
    if (visited.has(current.headRef)) {
      return undefined;
    }
    visited.add(current.headRef);
    chain.push(current.headRef);
    current = byHead.get(current.baseRef);
  }
  return chain;
}

/** The children of one head, ordered by pull-request number so the plan is deterministic. */
function childrenOf({
  head,
  pullRequests,
  placeable,
}: {
  head: string;
  pullRequests: readonly RestackPullRequest[];
  placeable: ReadonlySet<number>;
}): readonly RestackPullRequest[] {
  return pullRequests
    .filter((pullRequest) => pullRequest.baseRef === head && placeable.has(pullRequest.number))
    .toSorted((a, b) => a.number - b.number);
}

/** One node, with its reason resolved against whether anything below it in this tree already moved. */
function nodeFor({
  depth,
  parentMoved,
  pullRequest,
}: {
  depth: number;
  parentMoved: boolean;
  pullRequest: RestackPullRequest;
}): RestackNode {
  const shared = {
    baseBranch: pullRequest.baseRef,
    branch: pullRequest.headRef,
    depth,
    headSha: pullRequest.headSha,
    pullRequestNumber: pullRequest.number,
  };
  if (parentMoved) {
    return { ...shared, reason: "propagated" };
  }
  if (!pullRequest.baseIsAncestorOfHead) {
    return { ...shared, reason: "base-moved" };
  }
  return { ...shared, reason: undefined };
}

/**
 * Walk one root's tree depth-first, emitting a parent before its children.
 *
 * Depth-first rather than breadth-first because a child is rebased onto its parent's NEW head: emitting the
 * whole of one branch of the tree before starting the next keeps every step's base already written by the
 * step before it, which is what lets the executor run the list straight through.
 */
function walkTree({
  depth,
  nodes,
  parentMoved,
  placeable,
  pullRequest,
  pullRequests,
}: {
  depth: number;
  nodes: RestackNode[];
  parentMoved: boolean;
  placeable: ReadonlySet<number>;
  pullRequest: RestackPullRequest;
  pullRequests: readonly RestackPullRequest[];
}): void {
  const node = nodeFor({ depth, parentMoved, pullRequest });
  nodes.push(node);
  for (const child of childrenOf({ head: pullRequest.headRef, placeable, pullRequests })) {
    walkTree({
      depth: depth + 1,
      nodes,
      parentMoved: node.reason !== undefined,
      placeable,
      pullRequest: child,
      pullRequests,
    });
  }
}

/**
 * Plan the whole restack, from the operator's open pull requests and one staleness fact each.
 *
 * @param pullRequests every open pull request in scope, in any order
 * @returns one tree per root, each ordered parent-before-child, plus the residue for anything unplaceable
 */
export function planRestackForest({ pullRequests }: { pullRequests: readonly RestackPullRequest[] }): RestackForest {
  const indexed = indexByHead({ pullRequests });
  const residue = [...indexed.residue];
  const placeable = new Set<number>();
  const roots: RestackPullRequest[] = [];
  for (const pullRequest of pullRequests) {
    if (indexed.ambiguous.has(pullRequest.headRef)) {
      continue;
    }
    const ancestry = ancestryOf({ byHead: indexed.byHead, pullRequest });
    if (ancestry === undefined) {
      residue.push(
        `#${String(pullRequest.number)} (${pullRequest.headRef}) is based on a pull request that is ` +
          `based back on it — refusing to restack a cycle`,
      );
      continue;
    }
    placeable.add(pullRequest.number);
    const parent = indexed.byHead.get(pullRequest.baseRef);
    if (parent === undefined || indexed.ambiguous.has(parent.headRef)) {
      roots.push(pullRequest);
    }
  }
  const trees: RestackTree[] = [];
  for (const root of roots.toSorted((a, b) => a.number - b.number)) {
    const nodes: RestackNode[] = [];
    walkTree({ depth: 0, nodes, parentMoved: false, placeable, pullRequest: root, pullRequests });
    trees.push({ nodes, rootBranch: root.headRef });
  }
  return { residue, trees };
}

/**
 * Every node one plan would actually move, in order, across every tree.
 *
 * @param forest the planned forest
 * @returns the moving nodes, parents before children
 */
export function restackSteps({ forest }: { forest: RestackForest }): readonly RestackNode[] {
  return forest.trees.flatMap((tree) => tree.nodes.filter((node) => node.reason !== undefined));
}

/**
 * The commit one node's range is replayed ONTO: its base's new tip when this run already moved that base,
 * else the base's tip as the run first measured it. A base the run did not move is the ordinary case for
 * every root, never a missing value.
 *
 * @param baseBranch the node's own base branch
 * @param moved every branch this run has replayed so far, to its new tip
 * @param preRunBaseTip the base's tip as it stood before this run moved anything
 * @returns the commit to replay onto
 */
export function replayBaseSha({
  baseBranch,
  moved,
  preRunBaseTip,
}: {
  baseBranch: string;
  moved: ReadonlyMap<string, string>;
  preRunBaseTip: string;
}): string {
  const movedTip = moved.get(baseBranch);
  if (movedTip === undefined) {
    return preRunBaseTip;
  }
  return movedTip;
}

/**
 * The lines a report prints for one planned forest, before any rebase and before any push.
 *
 * @param forest the planned forest
 * @returns the report lines, in order
 */
export function restackForestReportLines({ forest }: { forest: RestackForest }): readonly string[] {
  const lines: string[] = [];
  for (const tree of forest.trees) {
    const moving = tree.nodes.filter((node) => node.reason !== undefined);
    if (moving.length === 0) {
      continue;
    }
    lines.push(`tree rooted at ${tree.rootBranch}: ${String(moving.length)} of ${String(tree.nodes.length)} moving`);
    for (const node of moving) {
      // `moving` is filtered to nodes whose reason is set, two lines above: an unset one never reaches here.
      lines.push(
        `  would restack ${node.branch} (PR #${String(node.pullRequestNumber)}) onto ${node.baseBranch} — ` +
          `${node.reason!}`,
      );
    }
  }
  if (lines.length === 0) {
    lines.push("nothing to restack: every open pull request of yours is already on its latest base.");
  }
  for (const reason of forest.residue) {
    lines.push(`residue: ${reason}`);
  }
  return lines;
}
