/**
 * What became of every CodeRabbit finding on a set of pull requests — the pure half of
 * `slopweaver github coderabbit-yield`. It exists to compare the findings the
 * fleet acts on with those it self-resolves without acting, to gauge whether CodeRabbit finds high-value or
 * low-value things.
 *
 * ## The outcome ladder, and what each rung may claim
 *
 * Each CodeRabbit-opened thread falls to exactly ONE outcome, first match down the ladder. No rung claims a
 * fix was or was not made — GitHub publishes no field that says a change was CAUSED by a finding — so each
 * names the observable signal instead:
 *
 * 1. `reported-addressed` — CodeRabbit's own addressed marker (`./coderabbitYieldEvidence.ts`).
 * 2. `reply-cites-commit` — no marker, but a reply from someone else names a commit, the fleet's fix
 *    convention.
 * 3. `unknown` — neither, and the thread's comments were not all read, so absence proves nothing.
 * 4. `outdated-only` — neither, but GitHub marks the thread outdated: the lines moved after it, for a reason
 *    this read cannot name.
 * 5. `resolved-no-evidence` — resolved with no signal of a change: the "self-resolved without acting" the
 *    ask names, split by whether anyone replied and by who resolved it.
 * 6. `open-no-evidence` — still open with no signal of a change.
 */

import {
  addressMarkers,
  type CoderabbitFindingType,
  type CoderabbitSeverity,
  findingHeader,
  findingTitle,
  isCoderabbit,
  replyCommitCitation,
  reviewBodyCounts,
  type YieldComment,
} from "./coderabbitYieldEvidence.js";

/** The ladder's rungs, in order. */
export const YIELD_OUTCOMES = [
  "reported-addressed",
  "reply-cites-commit",
  "unknown",
  "outdated-only",
  "resolved-no-evidence",
  "open-no-evidence",
] as const;

/**
 * One rung of the outcome ladder.
 *
 * @internal
 */
export type YieldOutcome = (typeof YIELD_OUTCOMES)[number];

/**
 * Who resolved a thread, relative to the pull request's author. Only `author` is SELF-resolved.
 *
 * @internal
 */
export type YieldResolver = "author" | "other" | "unknown" | "unresolved";

/**
 * Whether anyone but CodeRabbit replied after the opener. `unknown` when the read cannot tell.
 *
 * @internal
 */
export type YieldReplyState = "replied" | "silent" | "unknown";

/** One pull request's identity, as the audit reads it. */
export interface YieldPr {
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly authorLogin: string | null;
  readonly state: string;
  readonly createdAtIso: string;
}

/** One review thread, its comments opener-first. */
export interface YieldThread {
  readonly id: string;
  readonly path: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly resolvedByLogin: string | null;
  readonly comments: readonly YieldComment[];
  /** False when the thread had more comments than were read — an absent marker then proves nothing. */
  readonly commentsComplete: boolean;
}

/** One pull request's threads and CodeRabbit's review bodies. */
export interface YieldPrFacts {
  readonly pr: YieldPr;
  readonly threads: readonly YieldThread[];
  readonly coderabbitReviewBodies: readonly string[];
}

/** One classified CodeRabbit finding. */
export interface YieldFinding {
  readonly repo: string;
  readonly prNumber: number;
  readonly prState: string;
  readonly url: string;
  readonly path: string;
  readonly severity: CoderabbitSeverity;
  readonly findingType: CoderabbitFindingType;
  readonly category: string;
  readonly outcome: YieldOutcome;
  readonly markerKinds: readonly string[];
  readonly citedCommit: string | null;
  readonly resolver: YieldResolver;
  /** Who resolved the thread, as GitHub names them; null while it is open or when GitHub does not say. */
  readonly resolvedByLogin: string | null;
  /** The bold one-line summary CodeRabbit leads a finding with, or "" when it has none. */
  readonly title: string;
  readonly replyState: YieldReplyState;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
}

/**
 * Counts per outcome, every rung present.
 *
 * @internal
 */
export type YieldCounts = Readonly<Record<YieldOutcome, number>>;

/** One grouped row of a cross-tab. */
export interface YieldGroup {
  readonly key: string;
  readonly total: number;
  readonly counts: YieldCounts;
}

/** The whole aggregate. */
export interface YieldReport {
  readonly prsRead: number;
  readonly prsWithFindings: number;
  readonly findings: readonly YieldFinding[];
  readonly totals: YieldCounts;
  readonly byRepo: readonly (YieldGroup & { readonly prs: number; readonly prsWithFindings: number })[];
  readonly bySeverity: readonly YieldGroup[];
  readonly byType: readonly YieldGroup[];
  readonly byCategory: readonly YieldGroup[];
  readonly byPrState: readonly YieldGroup[];
  readonly selfResolved: {
    readonly replied: number;
    readonly silent: number;
    readonly replyUnknown: number;
    readonly byAuthor: number;
    readonly byOther: number;
    readonly byUnknown: number;
  };
  readonly markers: { readonly commit: number; readonly confirmed: number };
  readonly reviewBodies: { readonly reviews: number; readonly nitpicks: number; readonly outsideDiff: number };
}

/** Who resolved the thread, relative to the pull request's author. */
function resolverOf({ pr, thread }: { pr: YieldPr; thread: YieldThread }): YieldResolver {
  if (!thread.isResolved) {
    return "unresolved";
  }
  if (thread.resolvedByLogin === null || pr.authorLogin === null) {
    return "unknown";
  }
  return thread.resolvedByLogin.toLowerCase() === pr.authorLogin.toLowerCase() ? "author" : "other";
}

/** Whether anyone but CodeRabbit replied after the opener. */
function replyStateOf({ thread }: { thread: YieldThread }): YieldReplyState {
  const replies = thread.comments.slice(1);
  if (replies.some((comment) => comment.authorLogin !== null && !isCoderabbit({ login: comment.authorLogin }))) {
    return "replied";
  }
  const unattributed = replies.some((comment) => comment.authorLogin === null);
  return unattributed || !thread.commentsComplete ? "unknown" : "silent";
}

/** The first rung of the ladder the evidence reaches. */
function outcomeOf({
  thread,
  markerCount,
  citedCommit,
}: {
  thread: YieldThread;
  markerCount: number;
  citedCommit: string | null;
}): YieldOutcome {
  if (markerCount > 0) {
    return "reported-addressed";
  }
  if (citedCommit !== null) {
    return "reply-cites-commit";
  }
  if (!thread.commentsComplete) {
    return "unknown";
  }
  if (thread.isOutdated) {
    return "outdated-only";
  }
  return thread.isResolved ? "resolved-no-evidence" : "open-no-evidence";
}

/**
 * Classify one review thread, or skip it when CodeRabbit did not open it.
 *
 * @param pr the pull request the thread sits on
 * @param thread the thread, comments opener-first
 * @returns the finding, or undefined for a thread somebody else opened
 */
export function classifyCoderabbitThread({
  pr,
  thread,
}: {
  pr: YieldPr;
  thread: YieldThread;
}): YieldFinding | undefined {
  const opener = thread.comments[0];
  if (opener === undefined || !isCoderabbit({ login: opener.authorLogin })) {
    return undefined;
  }
  const markers = thread.comments.flatMap((comment) => addressMarkers({ comment }));
  const cited = thread.comments
    .slice(1)
    .map((comment) => replyCommitCitation({ comment }))
    .find((token) => token !== undefined);
  let citedCommit: string | null = null;
  if (cited !== undefined) {
    citedCommit = cited;
  }
  const header = findingHeader({ body: opener.body });
  return {
    category: header.category,
    citedCommit,
    findingType: header.findingType,
    isOutdated: thread.isOutdated,
    isResolved: thread.isResolved,
    markerKinds: [...new Set(markers.map((marker) => marker.kind))],
    outcome: outcomeOf({ citedCommit, markerCount: markers.length, thread }),
    path: thread.path,
    prNumber: pr.number,
    prState: pr.state,
    replyState: replyStateOf({ thread }),
    repo: pr.repo,
    resolvedByLogin: thread.resolvedByLogin,
    resolver: resolverOf({ pr, thread }),
    severity: header.severity,
    title: findingTitle({ body: opener.body }),
    url: opener.url,
  };
}

/** A zeroed count for every rung. */
function emptyCounts(): Record<YieldOutcome, number> {
  return {
    "open-no-evidence": 0,
    "outdated-only": 0,
    "reply-cites-commit": 0,
    "reported-addressed": 0,
    "resolved-no-evidence": 0,
    unknown: 0,
  };
}

/** Count findings per outcome. */
function countOutcomes({ findings }: { findings: readonly YieldFinding[] }): YieldCounts {
  const counts = emptyCounts();
  for (const finding of findings) {
    counts[finding.outcome] += 1;
  }
  return counts;
}

/** Group findings by one key, largest group first, then by key for a stable order. */
function groupBy({
  findings,
  keyOf,
}: {
  findings: readonly YieldFinding[];
  keyOf: (finding: YieldFinding) => string;
}): readonly YieldGroup[] {
  const groups = new Map<string, YieldFinding[]>();
  for (const finding of findings) {
    const key = keyOf(finding);
    const members = groups.get(key);
    if (members === undefined) {
      groups.set(key, [finding]);
    } else {
      members.push(finding);
    }
  }
  return [...groups.entries()]
    .map(([key, members]) => ({ counts: countOutcomes({ findings: members }), key, total: members.length }))
    .toSorted((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** How many distinct pull requests the findings sit on. */
function distinctPrs({ findings }: { findings: readonly YieldFinding[] }): number {
  return new Set(findings.map((finding) => `${finding.repo}#${String(finding.prNumber)}`)).size;
}

/**
 * Aggregate every pull request's threads and review bodies into the report.
 *
 * @param prs every pull request read, including those CodeRabbit never commented on
 * @param repos the repositories selected, so a repository with no findings still has a row
 * @returns the classified findings and every cross-tab the page shows
 */
export function coderabbitYieldReport({
  prs,
  repos,
}: {
  prs: readonly YieldPrFacts[];
  repos: readonly string[];
}): YieldReport {
  const findings = prs.flatMap((facts) =>
    facts.threads
      .map((thread) => classifyCoderabbitThread({ pr: facts.pr, thread }))
      .filter((finding): finding is YieldFinding => finding !== undefined),
  );
  const selfResolvedRows = findings.filter((finding) => finding.outcome === "resolved-no-evidence");
  const bodies = prs.flatMap((facts) => facts.coderabbitReviewBodies.map((body) => reviewBodyCounts({ body })));
  // GitHub slugs are case-insensitive, and nameWithOwner comes back in its own casing, not the one typed.
  const sameRepo = ({ left, right }: { left: string; right: string }): boolean =>
    left.toLowerCase() === right.toLowerCase();
  const byRepo = repos.map((repo) => {
    const members = findings.filter((finding) => sameRepo({ left: finding.repo, right: repo }));
    return {
      counts: countOutcomes({ findings: members }),
      key: repo,
      prs: prs.filter((facts) => sameRepo({ left: facts.pr.repo, right: repo })).length,
      prsWithFindings: distinctPrs({ findings: members }),
      total: members.length,
    };
  });
  return {
    byCategory: groupBy({ findings, keyOf: (finding) => finding.category }),
    byPrState: groupBy({ findings, keyOf: (finding) => finding.prState }),
    byRepo,
    bySeverity: groupBy({ findings, keyOf: (finding) => finding.severity }),
    byType: groupBy({ findings, keyOf: (finding) => finding.findingType }),
    findings,
    markers: {
      commit: findings.filter((finding) => finding.markerKinds.includes("commit-marker")).length,
      confirmed: findings.filter((finding) => finding.markerKinds.includes("confirmed-marker")).length,
    },
    prsRead: prs.length,
    prsWithFindings: distinctPrs({ findings }),
    reviewBodies: {
      nitpicks: bodies.reduce((sum, counts) => sum + Number(counts.nitpicks), 0),
      outsideDiff: bodies.reduce((sum, counts) => sum + Number(counts.outsideDiff), 0),
      reviews: bodies.length,
    },
    selfResolved: {
      byAuthor: selfResolvedRows.filter((finding) => finding.resolver === "author").length,
      byOther: selfResolvedRows.filter((finding) => finding.resolver === "other").length,
      byUnknown: selfResolvedRows.filter((finding) => finding.resolver === "unknown").length,
      replied: selfResolvedRows.filter((finding) => finding.replyState === "replied").length,
      replyUnknown: selfResolvedRows.filter((finding) => finding.replyState === "unknown").length,
      silent: selfResolvedRows.filter((finding) => finding.replyState === "silent").length,
    },
    totals: countOutcomes({ findings }),
  };
}
