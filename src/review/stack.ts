/**
 * Where each of the owner's open pull requests sits in a stack, read off the fleet's own base and head branches.
 *
 * ## The rule this module encodes
 *
 * A pull request in a stack is not asked about until it targets the default branch: the ranked list must
 * never ask the owner to undraft the sixth pull request of a native stack and name a reviewer for it. Nothing
 * in a stack gets a review ask until the bottom pull request lands, one at a time, bump after a business day
 * of silence. So the test is mechanical and it is the BASE BRANCH alone: a pull request
 * whose base is not the repository's default branch is stacked, never an ask, and the pull request at the
 * bottom of its chain carries the stack's only ask.
 *
 * ## Why the chain is read from the fleet and not from GitHub's stack endpoints
 *
 * The fleet read already carries every link — each pull request's `baseRefName` and `headRefName` — and a
 * pull request whose base is a sibling's head is stacked on that sibling whether or not anybody registered a
 * native stack for it. Asking `GET /repos/{owner}/{repo}/stacks/{n}` would need a stack number the fleet does
 * not carry, one request per stack, and would miss a stack that was never registered. The chain is the same
 * either way; this reads it from what is already in hand.
 *
 * A chain that does not reach the default branch — its lowest link targets a branch none of the owner's open pull
 * requests is FROM — is still stacked, and says so: the position counts from the lowest link this read can
 * see, and `grounded` is false so a consumer never claims a bottom it did not find.
 *
 * Pure — no I/O, no clock.
 */

import { pushInto } from "#lib/collections.js";

/** The five fields a chain is read from, so the live layer's own type is assignable without being imported. */
export interface StackLink {
  readonly repoSlug: string;
  readonly number: number;
  readonly baseRefName: string;
  readonly headRefName: string;
  /** The repository's default branch, or the empty string when the read could not name one. */
  readonly defaultBranch: string;
}

/** One pull request's place in a stack of the owner's own open pull requests. */
export interface StackPlace {
  /** The branch the pull request targets. */
  readonly baseRefName: string;
  /** The repository's default branch, or the empty string when the read could not name one. */
  readonly defaultBranch: string;
  /**
   * Whether the pull request targets something other than the default branch — the owner's test, verbatim.
   *
   * False when the default branch could not be read: a read that cannot name the branch cannot claim the
   * pull request is off it, and calling every pull request stacked on a blank would withhold every ask.
   */
  readonly stacked: boolean;
  /** 1 for the lowest link this read can see; n for a pull request n links up the chain. */
  readonly position: number;
  /** How many of the owner's open pull requests the chain holds, lowest to highest, through this one. */
  readonly size: number;
  /** Lowest to highest, the number of every pull request in the chain, this one included. */
  readonly chain: readonly number[];
  /** Whether the chain's lowest link targets the default branch, so its bottom is really the bottom. */
  readonly grounded: boolean;
}

/**
 * The key one pull request's place is filed under.
 *
 * @param repoSlug the `owner/name` the pull request lives in
 * @param number the pull request number
 * @returns `owner/name#number`
 */
export function stackKey({ repoSlug, number }: { repoSlug: string; number: number }): string {
  return `${repoSlug}#${String(number)}`;
}

/**
 * The place of a pull request read on its own, with no fleet to find its siblings in.
 *
 * Position one of a chain of one, stacked exactly when its base is not the default branch. What
 * {@link stackPlaces} would answer for a fleet of one.
 *
 * @param pr the pull request's branch facts
 * @returns its place, alone
 */
export function soloPlace({ pr }: { pr: StackLink }): StackPlace {
  const stacked = pr.defaultBranch !== "" && pr.baseRefName !== pr.defaultBranch;
  return {
    baseRefName: pr.baseRefName,
    chain: [pr.number],
    defaultBranch: pr.defaultBranch,
    grounded: pr.baseRefName === pr.defaultBranch,
    position: 1,
    size: 1,
    stacked,
  };
}

/** Follow `next` from `start` until it yields nothing or a link already seen, returning the links in order. */
function walk({
  start,
  next,
}: {
  start: StackLink;
  next: (link: StackLink) => StackLink | undefined;
}): readonly StackLink[] {
  const seen = new Set<string>([stackKey(start)]);
  const path: StackLink[] = [];
  let cursor = next(start);
  while (cursor !== undefined && !seen.has(stackKey(cursor))) {
    seen.add(stackKey(cursor));
    path.push(cursor);
    cursor = next(cursor);
  }
  return path;
}

/** The place of one link, given the maps its repository's siblings were indexed into. */
function placeOf({
  link,
  byHead,
  byBase,
}: {
  link: StackLink;
  byHead: ReadonlyMap<string, StackLink>;
  byBase: ReadonlyMap<string, StackLink>;
}): StackPlace {
  const isDefault = ({ base }: { base: string }): boolean => base === link.defaultBranch;
  const below = walk({
    next: (cursor) => (isDefault({ base: cursor.baseRefName }) ? undefined : byHead.get(cursor.baseRefName)),
    start: link,
  });
  const above = walk({ next: (cursor) => byBase.get(cursor.headRefName), start: link });
  const [lowest = link] = below.slice(-1);
  const chain = [...below.toReversed(), link, ...above].map((entry) => entry.number);
  return {
    baseRefName: link.baseRefName,
    chain,
    defaultBranch: link.defaultBranch,
    grounded: isDefault({ base: lowest.baseRefName }),
    position: below.length + 1,
    size: chain.length,
    stacked: link.defaultBranch !== "" && !isDefault({ base: link.baseRefName }),
  };
}

/** The two indexes one repository's chains are followed through: which link is FROM a branch, and which targets it. */
function indexRepo({ links }: { links: readonly StackLink[] }): {
  readonly byHead: ReadonlyMap<string, StackLink>;
  readonly byBase: ReadonlyMap<string, StackLink>;
} {
  const byHead = new Map<string, StackLink>();
  const byBase = new Map<string, StackLink>();
  for (const link of links) {
    if (link.headRefName !== "" && !byHead.has(link.headRefName)) {
      byHead.set(link.headRefName, link);
    }
    if (link.baseRefName !== "" && !byBase.has(link.baseRefName)) {
      byBase.set(link.baseRefName, link);
    }
  }
  return { byBase, byHead };
}

/**
 * Place every pull request in the fleet in its stack.
 *
 * Chains never cross repositories. Two open pull requests FROM the same branch in one repository is a shape
 * GitHub allows but this read does not follow; the first one seen owns the head, and a chain through the
 * other stops there rather than guessing. The same holds for two pull requests targeting one non-default
 * branch: the first seen is the one counted above it.
 *
 * @param pullRequests every open pull request the fleet read carried, in any order
 * @returns each pull request's place, keyed by {@link stackKey}
 */
export function stackPlaces({ pullRequests }: { pullRequests: readonly StackLink[] }): ReadonlyMap<string, StackPlace> {
  const byRepo = new Map<string, StackLink[]>();
  for (const link of pullRequests) {
    pushInto({ buckets: byRepo, key: link.repoSlug, value: link });
  }
  const places = new Map<string, StackPlace>();
  for (const links of byRepo.values()) {
    const { byHead, byBase } = indexRepo({ links });
    for (const link of links) {
      places.set(stackKey(link), placeOf({ byBase, byHead, link }));
    }
  }
  return places;
}
