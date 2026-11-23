/**
 * The close-this rules. Pure, and deliberately mechanical rather than a judgement call — that is the whole
 * argument for shipping this half first.
 *
 * Every rule below was derived from a measurement on the real home, over the owner's 68 open
 * items in the cycle then current. Reproduce the population with a streaming scan of
 * `~/.slopweaver/corpus/bronze/linear/*.jsonl` keyed on the owner's Linear id, joined to the current cycle by
 * `./currentCycle.ts`:
 *
 * - 30 of the 68 had not moved since the cycle opened. 24 of those carried a pull request.
 * - Reading all 25 attached pull requests live: 4 tickets had a MERGED pull request and were still open, and
 *   20 had every attached pull request CLOSED and unmerged.
 * - ELEVEN of those 20 were closed inside one 32-second window — a bulk
 *   pull-request cleanup that touched no ticket, so eleven tickets read "In Review" for 23 days on the
 *   strength of a batch operation.
 *
 * That last number is why the two classes are separated rather than merged. A merged pull request is proof
 * the work happened, so the proposal is a close. A closed-unmerged one proves only that somebody closed a
 * pull request, which is a reason to go and LOOK — never a reason to close a ticket.
 */

import type { CycleIssue } from "./issue.js";
import { type ReleaseInstants, type ReleaseVerdict, releaseVerdict, reposOfAttachments } from "./releases.js";
import type { CycleProposal, ProposalEvidence } from "./types.js";

/** How a pull request ended, as the corpus's own `attrs.state` reports it. */
export type PullRequestState = "MERGED" | "CLOSED" | "OPEN";

/**
 * Workflow states whose Linear state TYPE is not `completed` but which mean the work is over.
 *
 * @internal — the vocabulary {@link closeThisProposals} and {@link staleCandidates} share; no caller
 * outside this module names it.
 *
 * Not inferred from the words and not open to extension by guessing: measured on the real workspace with
 * `LC_ALL=C jq -r 'select(.kind=="issue")|.raw.state|[.name,.type]|@tsv'
 * ~/.slopweaver/corpus/bronze/linear/*.jsonl | sort -u`, which is also how the name below was found. Five of
 * the owner's own open current-cycle items sat in `Merged`, so a filter trusting the type alone counts them
 * as live work. Read a workspace's real vocabulary with `slopweaver linear states` before adding to this.
 *
 * A `Merged` ticket is NOT proposed the moment it lands. The job that moves
 * Merged to Done in Linear runs around release time, so a ticket that has not yet seen a release is that
 * job's work rather than the owner's. {@link ./releases.releaseVerdict} gates it and carries the measurement.
 *
 * `Duplicate` USED to be on this list and was removed. The two are not the same
 * kind of thing: a `Merged` ticket still needs a move to a completed state, so proposing one is right, while
 * a `Duplicate` is already where it belongs and the owner explicitly refused to mark one done, because the underlying ticket is not done. Proposing a close on it therefore offered
 * an action the owner had already ruled out, on a row that could never leave the list. It is settled by {@link isOpen} instead.
 */
export const TERMINAL_STATE_NAMES: readonly string[] = ["Merged"];

/**
 * What one close pass produced, including what it deliberately did not show.
 *
 * `heldForRelease` is stated rather than dropped because a row that vanishes with no account of itself is
 * the silent-degrade failure this repository has already paid for once, in `audit run` reporting an empty
 * corpus for a read that had refused.
 *
 * @internal — the shape {@link closeThisProposals} returns.
 */
export interface CloseThisOutcome {
  readonly proposals: readonly CycleProposal[];
  /** Merged tickets held back because their repository has not shipped since they merged. */
  readonly heldForRelease: number;
}

/** A GitHub pull-request URL. An attachment that is not one (a document, a dashboard) is not a work trail. */
const PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

/** The one-word replies each proposal kind accepts. Stated as data so the card and the reader agree. */
const REPLIES: Readonly<Record<"close" | "update", readonly string[]>> = {
  close: ["close", "keep", "later"],
  update: ["post", "edit", "later"],
};

/**
 * Whether an issue is still live work by Linear's own state type.
 *
 * `duplicate` is a state type of its own in this workspace, beside `completed` and `canceled` — confirmed
 * with `slopweaver linear states` across four teams, every one of which reports the pair `Duplicate` /
 * `duplicate`. It means the work is over and the ticket is already in the right place, so it is settled
 * HERE rather than proposed as a close: there is no further move to offer, and the owner ruled against the
 * only one anybody could suggest.
 */
function isOpen({ issue }: { issue: CycleIssue }): boolean {
  return issue.stateType !== "completed" && issue.stateType !== "canceled" && issue.stateType !== "duplicate";
}

/** Whole days between two instants, floored at zero so a clock skew never reports a negative age. */
function daysBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number {
  const millis = Date.parse(toIso) - Date.parse(fromIso);
  return Math.max(0, Math.round(millis / 86_400_000));
}

/** The proposal for a ticket sitting in a state that means done while its type says otherwise. */
function terminalStateProposal({
  issue,
  nowIso,
  verdict,
}: {
  issue: CycleIssue;
  nowIso: string;
  verdict: ReleaseVerdict;
}): CycleProposal {
  const shipped =
    verdict === "shipped-since"
      ? "a release has shipped since it merged, so the job that moves Merged to Done has already run past it"
      : "no release history is published for its repository, so a release cannot be what it is waiting for";
  return {
    action: "close-with-comment",
    daysSinceMoved: daysBetween({ fromIso: issue.updatedAt, toIso: nowIso }),
    evidence: [
      {
        fact: `its workflow state is "${issue.stateName}", which means the work is over, but Linear's own state type is "${issue.stateType}" so every filter still counts it as live work; ${shipped}`,
        url: issue.url,
      },
    ],
    headline: `${issue.identifier} sits in "${issue.stateName}" and is still counted as open work.`,
    movedAtIso: issue.updatedAt,
    oneWordReplies: REPLIES.close,
    priority: issue.priority,
    subject: issue.identifier,
    title: issue.title,
    url: issue.url,
  };
}

/** The proposal for a ticket whose attached pull request merged while the ticket stayed open. */
function mergedWorkProposal({
  issue,
  merged,
  nowIso,
}: {
  issue: CycleIssue;
  merged: readonly string[];
  nowIso: string;
}): CycleProposal {
  const evidence: ProposalEvidence[] = merged.map((url) => ({
    fact: "the pull request attached to this ticket is merged, so the work it asks for has shipped",
    url,
  }));
  evidence.push({
    fact: `the ticket has not moved for ${String(daysBetween({ fromIso: issue.updatedAt, toIso: nowIso }))} days`,
    url: issue.url,
  });
  return {
    action: "close-with-comment",
    daysSinceMoved: daysBetween({ fromIso: issue.updatedAt, toIso: nowIso }),
    evidence,
    headline: `${issue.identifier} has a merged pull request and is still open.`,
    movedAtIso: issue.updatedAt,
    oneWordReplies: REPLIES.close,
    priority: issue.priority,
    subject: issue.identifier,
    title: issue.title,
    url: issue.url,
  };
}

/** The proposal for a ticket whose every attached pull request was closed without merging. */
function abandonedWorkProposal({
  issue,
  closed,
  nowIso,
}: {
  issue: CycleIssue;
  closed: readonly string[];
  nowIso: string;
}): CycleProposal {
  const evidence: ProposalEvidence[] = closed.map((url) => ({
    fact: "this pull request was closed without merging, so it is not evidence the work happened, only that somebody closed it",
    url,
  }));
  evidence.push({
    fact: `the ticket has read "${issue.stateName}" for ${String(daysBetween({ fromIso: issue.updatedAt, toIso: nowIso }))} days on the strength of that`,
    url: issue.url,
  });
  return {
    action: "trace",
    daysSinceMoved: daysBetween({ fromIso: issue.updatedAt, toIso: nowIso }),
    evidence,
    headline: `${issue.identifier} needs a look: every pull request on it was closed without merging.`,
    movedAtIso: issue.updatedAt,
    oneWordReplies: REPLIES.close,
    priority: issue.priority,
    subject: issue.identifier,
    title: issue.title,
    url: issue.url,
  };
}

/**
 * The proposal for a stale ticket whose attached pull requests the corpus has never seen.
 *
 * A SEPARATE class from "nothing attached", and the separation is the whole point. Measured on the real
 * home: of the 25 pull requests attached to the owner's 30 stale current-cycle tickets, only
 * 15 were in GitHub bronze — the other 10 predate the ingest window. Folding those into "no pull request
 * attached" made the card state something false about ten tickets, four of which are in fact straight
 * closes. An unresolvable reference is a gap in what was looked at, never an absence in the world.
 */
function unresolvedTrailProposal({
  issue,
  unresolved,
  nowIso,
}: {
  issue: CycleIssue;
  unresolved: readonly string[];
  nowIso: string;
}): CycleProposal {
  const days = daysBetween({ fromIso: issue.updatedAt, toIso: nowIso });
  const evidence: ProposalEvidence[] = unresolved.map((url) => ({
    fact: "this pull request is attached to the ticket but is not in the local corpus, so how it ended is UNKNOWN here rather than absent. Re-read it live with `slopweaver github read <url>`, or pass `--verify`",
    url,
  }));
  evidence.push({ fact: `the ticket has read "${issue.stateName}" for ${String(days)} days`, url: issue.url });
  return {
    action: "trace",
    daysSinceMoved: days,
    evidence,
    headline: `${issue.identifier} has a pull request this corpus cannot see the state of.`,
    movedAtIso: issue.updatedAt,
    oneWordReplies: REPLIES.close,
    priority: issue.priority,
    subject: issue.identifier,
    title: issue.title,
    url: issue.url,
  };
}

/** The proposal for a stale ticket carrying nothing to trace it by. */
function noTrailProposal({ issue, nowIso }: { issue: CycleIssue; nowIso: string }): CycleProposal {
  const days = daysBetween({ fromIso: issue.updatedAt, toIso: nowIso });
  return {
    action: "trace",
    daysSinceMoved: days,
    evidence: [
      {
        fact: `nothing is attached to it and it has not moved for ${String(days)} days, so where it came from is the only way to know whether it is still real`,
        url: issue.url,
      },
    ],
    headline: `${issue.identifier} has not moved for ${String(days)} days and has no pull request attached.`,
    movedAtIso: issue.updatedAt,
    oneWordReplies: REPLIES.close,
    priority: issue.priority,
    subject: issue.identifier,
    title: issue.title,
    url: issue.url,
  };
}

/**
 * The issues a pass will actually judge on pull-request state: open, in a current cycle, not already in a
 * terminal-in-practice state, and unmoved since the cycle opened.
 *
 * Exported because the live `--verify` leg must read EXACTLY these tickets' attachments and no others. The
 * first draft handed it every issue ever assigned to the owner — 407 of them, 400 with unresolvable
 * attachments — and its bound was spent on tickets the card would never mention.
 *
 * @param issues the owner's issues, one row each
 * @param currentCycleIds the cycles spanning now, by id
 * @param cycleStartsAt the instant the current cycle opened
 * @returns the issues whose pull-request state decides what the card says
 */
export function staleCandidates({
  issues,
  currentCycleIds,
  cycleStartsAt,
}: {
  issues: readonly CycleIssue[];
  currentCycleIds: ReadonlySet<string>;
  cycleStartsAt: string;
}): readonly CycleIssue[] {
  return issues.filter(
    (issue) =>
      issue.cycleId !== undefined &&
      currentCycleIds.has(issue.cycleId) &&
      isOpen({ issue }) &&
      !TERMINAL_STATE_NAMES.includes(issue.stateName) &&
      issue.updatedAt < cycleStartsAt,
  );
}

/** One issue's proposal, or `undefined` when nothing about it needs the owner. */
function proposalFor({
  issue,
  cycleStartsAt,
  nowIso,
  pullRequestStates,
  releases,
}: {
  issue: CycleIssue;
  cycleStartsAt: string;
  nowIso: string;
  pullRequestStates: ReadonlyMap<string, PullRequestState>;
  releases: ReleaseInstants;
}): CycleProposal | undefined {
  if (!isOpen({ issue })) {
    return undefined;
  }
  if (TERMINAL_STATE_NAMES.includes(issue.stateName)) {
    // The job moving Merged to Done runs around release time, so a ticket that
    // has not yet seen a release is a job's work rather than the owner's. See ./releases.ts for the measurement.
    const verdict = releaseVerdict({
      releases,
      repos: reposOfAttachments({ urls: issue.attachmentUrls }),
      sinceIso: issue.updatedAt,
    });
    if (verdict === "none-since") {
      return undefined;
    }
    return terminalStateProposal({ issue, nowIso, verdict });
  }
  if (issue.updatedAt >= cycleStartsAt) {
    return undefined;
  }
  const attached = issue.attachmentUrls.filter((url) => PULL_REQUEST_URL.test(url));
  const known = attached.filter((url) => pullRequestStates.has(url));
  const unresolved = attached.filter((url) => !pullRequestStates.has(url));
  const merged = known.filter((url) => pullRequestStates.get(url) === "MERGED");
  const open = known.filter((url) => pullRequestStates.get(url) === "OPEN");
  if (merged.length > 0) {
    return mergedWorkProposal({ issue, merged, nowIso });
  }
  if (open.length > 0) {
    return undefined;
  }
  if (unresolved.length > 0) {
    return unresolvedTrailProposal({ issue, nowIso, unresolved });
  }
  if (known.length > 0) {
    return abandonedWorkProposal({ closed: known, issue, nowIso });
  }
  return noTrailProposal({ issue, nowIso });
}

/**
 * Every close-this proposal for one owner's open items in the current cycle.
 *
 * A ticket whose attached pull request is still OPEN yields nothing: the work is genuinely in flight, and
 * proposing anything about it is the "already-done" friction class in reverse.
 *
 * @param issues the owner's issues, already reduced to one row each
 * @param currentCycleIds the cycles spanning now, by id
 * @param cycleStartsAt the instant the current cycle opened — the staleness boundary
 * @param pullRequestStates how each attached pull request ended, keyed by its URL
 * @returns the proposals, oldest-first, so the reader meets the worst deviation at the top
 */
export function closeThisProposals({
  issues,
  currentCycleIds,
  cycleStartsAt,
  nowIso,
  pullRequestStates,
  releases,
}: {
  issues: readonly CycleIssue[];
  currentCycleIds: ReadonlySet<string>;
  cycleStartsAt: string;
  nowIso: string;
  pullRequestStates: ReadonlyMap<string, PullRequestState>;
  releases: ReleaseInstants;
}): CloseThisOutcome {
  const proposals: CycleProposal[] = [];
  let heldForRelease = 0;
  for (const issue of issues) {
    if (issue.cycleId === undefined || !currentCycleIds.has(issue.cycleId)) {
      continue;
    }
    if (heldForRelease0({ issue, releases })) {
      heldForRelease += 1;
      continue;
    }
    const proposal = proposalFor({ cycleStartsAt, issue, nowIso, pullRequestStates, releases });
    if (proposal !== undefined) {
      proposals.push(proposal);
    }
  }
  return { heldForRelease, proposals: proposals.toSorted((a, b) => b.daysSinceMoved - a.daysSinceMoved) };
}

/**
 * Whether this ticket is one the release rule holds back, asked in the ONE place that decides it.
 *
 * Split out so the count the report states and the rows the card shows come from the same predicate.
 * Counting them separately would be two opinions about one rule, which is how a "held back N" line starts
 * disagreeing with the list beneath it.
 */
function heldForRelease0({ issue, releases }: { issue: CycleIssue; releases: ReleaseInstants }): boolean {
  if (!TERMINAL_STATE_NAMES.includes(issue.stateName) || !isOpen({ issue })) {
    return false;
  }
  return (
    releaseVerdict({
      releases,
      repos: reposOfAttachments({ urls: issue.attachmentUrls }),
      sinceIso: issue.updatedAt,
    }) === "none-since"
  );
}
