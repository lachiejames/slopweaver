/**
 * One pull request's landing facts as ONE line — what `github landing` prints by default, and what its
 * `--json` document carries per row as `facts`.
 *
 * The shape is a reader's answer, not thirty rows that each say ready-to-merge false: which checks are green or
 * failing, which check failed, who approved and whether the code owners did, and no text dump. So every clause
 * here is a FACT the row already carries, named rather than folded into a verdict, and nothing here is a second
 * derivation of one.
 *
 * MEASURED: the two-line-per-row table printed 34.1 KB for 47 pull requests with no approver named on any of
 * them. Reproduce the one-line size with
 * `slopweaver github landing --author @me | wc -c`.
 *
 * Pure: a row in, a string out.
 */

import type { LandingRow } from "../../../review/landing.js";
import type { CodeRabbitVerdict } from "../../../review/reviewState.js";

/** The longest title a fact line carries before it is shortened with a visible ellipsis. */
const FACT_TITLE_CHARS = 60;

/** How many code owners in one state, or thread holders, a fact line names before it counts the rest. */
const NAMED_CHECKS = 3;

/** The longest dispatch reason a fact line carries; `--pr <n>` prints it whole. */
const WHY_CHARS = 110;

/** The one-word CodeRabbit cell, upper-cased where a reader must not skim past it. */
export const RABBIT_CELL: Readonly<Record<CodeRabbitVerdict, string>> = {
  "changes-requested": "CHANGES",
  green: "green",
  none: "none",
  pending: "pending",
  stale: "STALE",
  stuck: "STUCK",
  unknown: "unknown",
};

/**
 * Shorten a title to at most `maxChars`, marking the cut with an ellipsis so a reader never takes a
 * truncated title for the whole one.
 *
 * @param title the title as GitHub holds it
 * @param maxChars the most characters the result may carry, the ellipsis included
 * @returns the title, whole or visibly shortened
 */
export function compactTitle({ title, maxChars }: { title: string; maxChars: number }): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** At most {@link NAMED_CHECKS} names, then how many more there were. */
function namedList({ names }: { names: readonly string[] }): string {
  const shown = names.slice(0, NAMED_CHECKS).join(", ");
  const more = names.length - NAMED_CHECKS;
  return more > 0 ? `${shown} +${String(more)} more` : shown;
}

/**
 * The CI clause, in the words the row's own classification supports.
 *
 * An advisory-only red never reads "CI green": the rollup is red, so the clause says the required set is
 * clear and names what is red beside it. A red whose requirement could not be read says so rather than
 * guessing which way it falls (`../../../review/landingCiFailure.ts`). A required or unclassified failing
 * check is named, never counted, since it may block; an advisory red is capped at three with a visible `+N more`.
 * Only a check GitHub reported FAILED is called red: one still running or queued is named apart, as pending.
 */
function ciClause({ row }: { row: LandingRow }): string {
  const truncated = row.checksTruncated ? " (check list truncated)" : "";
  if (row.ci !== "red") {
    return `CI ${row.ci}${truncated}`;
  }
  const failing = checkNames({ row, failed: true });
  const pending = pendingList({ row });
  const requirement = row.ciFailure.kind === "red" ? row.ciFailure.required : undefined;
  if (requirement === true) {
    const beside =
      besideList({ label: "advisory red", names: failing.advisory, capped: true }) +
      besideList({ capped: false, label: "requirement unknown", names: failing.unclassified });
    return `CI red, REQUIRED${requiredHead({ names: failing.required, row })}${beside}${pending}${truncated}`;
  }
  if (requirement === false) {
    return `required CI clear; advisory red${colonList({ capped: true, names: failing.advisory })}${pending}${truncated}`;
  }
  const names = [...failing.required, ...failing.advisory, ...failing.unclassified];
  return `CI red, requirement unknown${colonList({ capped: false, names })}${pending}${truncated}`;
}

/**
 * What follows `REQUIRED`: the required checks that failed, else that a required one is still pending, else that a
 * required context never ran (`../../../review/landingCiFailure.ts`; the act's detail beside it names which).
 */
function requiredHead({ names, row }: { names: readonly string[]; row: LandingRow }): string {
  if (names.length > 0) {
    return `: ${names.join(", ")}`;
  }
  return checkNames({ failed: false, row }).required.length > 0 ? " check pending" : " context never ran";
}

/** `; pending: …` for checks still running or queued — a required or unclassified one in full, an advisory one capped. */
function pendingList({ row }: { row: LandingRow }): string {
  const pending = checkNames({ failed: false, row });
  return (
    besideList({ capped: false, label: "pending", names: [...pending.required, ...pending.unclassified] }) +
    besideList({ capped: true, label: "advisory pending", names: pending.advisory })
  );
}

/**
 * The row's not-passing check names that GitHub reported failed (`failed`) or still running or queued (otherwise),
 * split by whether each is required, advisory, or of an unread requirement.
 */
function checkNames({ row, failed }: { row: LandingRow; failed: boolean }): {
  required: readonly string[];
  advisory: readonly string[];
  unclassified: readonly string[];
} {
  const named = ({ required }: { required: boolean | undefined }): readonly string[] =>
    row.failingChecks
      .filter((check) => (check.state === "failed") === failed && check.required === required)
      .map((check) => check.name);
  return {
    advisory: named({ required: false }),
    required: named({ required: true }),
    unclassified: named({ required: undefined }),
  };
}

/** `: a, b` — every name of a blocker list, a non-blocker one capped like {@link namedList} — or nothing when empty. */
function colonList({ names, capped }: { names: readonly string[]; capped: boolean }): string {
  return names.length > 0 ? `: ${listed({ capped, names })}` : "";
}

/** `; label: a, b`, capped as {@link colonList} is — or nothing when there are none. */
function besideList({ label, names, capped }: { label: string; names: readonly string[]; capped: boolean }): string {
  return names.length > 0 ? `; ${label}: ${listed({ capped, names })}` : "";
}

/** Every name, or — for a non-blocker list, an advisory red — the first three and a visible `+N more`. */
function listed({ names, capped }: { names: readonly string[]; capped: boolean }): string {
  return capped ? namedList({ names }) : names.join(", ");
}

/**
 * Who approved, by login and capped like any non-blocker list, or `none` — and that the review list was cut, when it
 * was, since an approver may be past it.
 */
function approvedClause({ row }: { row: LandingRow }): string {
  const cut = row.reviewsTruncated ? " (review list truncated)" : "";
  return row.approvedBy.length > 0 ? `approved: ${namedList({ names: row.approvedBy })}${cut}` : `approved: none${cut}`;
}

/**
 * Why the code-owner list may be missing an owner: a cut review-request list can hide a pending one, and a cut
 * review list an approved team owner (`../../../review/githubCodeowners.ts`). Empty when both were read whole.
 *
 * @param row the broken-down pull request
 * @returns the bracketed note, or `""`
 */
export function ownersCutNote({ row }: { row: LandingRow }): string {
  const cut = [
    ...(row.githubCodeowners.requestsTruncated ? ["request list"] : []),
    ...(row.reviewsTruncated ? ["review list"] : []),
  ];
  return cut.length === 0 ? "" : ` (${cut.join(" and ")} truncated)`;
}

/**
 * GitHub's own code owners for the paths touched, split by whether each has approved, each list capped. A list it
 * was derived from that was cut may hide an owner, so it then never reads `none named` and always says so.
 */
function ownersClause({ row }: { row: LandingRow }): string {
  const { owners } = row.githubCodeowners;
  const cut = ownersCutNote({ row });
  if (owners.length === 0) {
    return cut === "" ? "owners: none named" : `owners: unknown${cut}`;
  }
  const approved = owners.filter((owner) => owner.state === "approved").map((owner) => owner.token);
  const pending = owners.filter((owner) => owner.state === "pending").map((owner) => owner.token);
  const parts = [
    ...(approved.length > 0 ? [`approved ${namedList({ names: approved })}`] : []),
    ...(pending.length > 0 ? [`pending ${namedList({ names: pending })}`] : []),
  ];
  return `owners ${parts.join("; ")}${cut}`;
}

/** Whether Slack carries an ask, and whether a chase on it is due. */
function askClause({ row }: { row: LandingRow }): string {
  if (row.bump.kind === "due") {
    return `asked: ${row.slack.asked}, chase DUE`;
  }
  // An unknown chase on an ask that exists is a blocker the dispatch may wait on, so it is said; with no ask,
  // or an unknown one, `asked:` already carries it.
  if (row.bump.kind === "unknown" && row.slack.asked === "yes") {
    return `asked: ${row.slack.asked}, chase unknown`;
  }
  return `asked: ${row.slack.asked}`;
}

/**
 * Threads somebody is waiting on US to answer, and who, when there are any. A cut thread list may hide one waiting
 * on us, so it is said even when none was seen, as a lower bound.
 */
function threadsClause({ row }: { row: LandingRow }): readonly string[] {
  const awaiting = row.conversations.humans.awaitingUs + row.conversations.codeRabbit.awaitingUs;
  if (awaiting === 0 && !row.threadsTruncated) {
    return [];
  }
  const count = row.threadsTruncated ? `${String(awaiting)}+` : String(awaiting);
  const who = row.openThreads.map((tally) => `${tally.login} (${String(tally.open)})`);
  // Every holder in full, never capped: each reviewer waiting on us is a blocker the why cell would name.
  const named = who.length > 0 ? `: ${who.join(", ")}` : "";
  const cut = row.threadsTruncated ? " (thread list truncated)" : "";
  return [`${count} thread(s) awaiting us${named}${cut}`];
}

/**
 * Whether the rest of the line already says what the full table's why cell would: `press` has no blocker, a
 * `spawn-ci` whose REQUIRED failing check the CI clause names is that clause, and threads held by named people are
 * `held by` plus the threads clause — the exact two cases `whyCell` (`./landingReport.ts`) itself replaces.
 * Every other act carries that cell's sentence, the act's own detail: a CodeRabbit objection, a conflict's paths,
 * a required context that never ran, what a team owes.
 */
function explainedByAClause({ row }: { row: LandingRow }): boolean {
  if (row.action === "press") {
    return true;
  }
  if (row.action === "spawn-ci") {
    return row.failingChecks.some((check) => check.required === true);
  }
  return row.action === "answer-threads" && row.blockedOn.length > 0;
}

/**
 * The board row already on this pull request, when there is one — a live one is a hold the register respects,
 * so the line names it rather than inviting a duplicate spawn.
 */
function boardClause({ row }: { row: LandingRow }): readonly string[] {
  return row.boardRow.kind === "row" ? [`board: ${row.boardRow.slug} ${row.boardRow.status}`] : [];
}

/**
 * The QUEUE cell.
 *
 * `DROPPED` is the one that has to be loud: a pull request this machine pressed which GitHub no longer has
 * an entry for looked identical to one nobody ever pressed until this register existed. The cell says what
 * was OBSERVED, never why — the queue may have dropped it, or somebody may have dequeued it by hand.
 *
 * @param row the broken-down pull request
 * @returns the cell
 */
export function queueCell({ row }: { row: LandingRow }): string {
  switch (row.queue.kind) {
    case "queued":
      return `#${String(row.queue.position)} ${row.queue.state.toLowerCase()}`;
    case "pressed-not-queued":
      return "DROPPED";
    case "no-queue":
      return "no queue";
    case "unread":
      return "unread";
    case "not-queued":
      return "—";
  }
}

/** Where the pull request stands in the merge queue, when that is anything but simply not queued. */
function queueClause({ row }: { row: LandingRow }): readonly string[] {
  return row.queue.kind === "not-queued" ? [] : [`queue: ${queueCell({ row })}`];
}

/** Which people or teams are holding the row, when the act names any — every one, never capped or counted. */
function heldByClause({ row }: { row: LandingRow }): readonly string[] {
  return row.blockedOn.length > 0 ? [`held by ${row.blockedOn.join(", ")}`] : [];
}

/**
 * The verdict the supervisor acts on, then the act, then its reasons: a non-act decision's or the owner's verdict's own
 * why, and — whenever no other clause explains the act — the blocker sentence the full table's why cell prints,
 * so a verdict another signal decided never hides the act's own blocker. The dispatch's instruction to a spawned
 * seat is `--pr` and `--full`'s, never this line's.
 */
function dispatchClause({ row }: { row: LandingRow }): string {
  const reasons: string[] = [];
  let label: string;
  if (row.dispatch.kind !== "act") {
    label = row.dispatch.kind;
    // An unanswered landing test's dispatch reason is generic; the act's own detail below names WHICH test it was.
    if (row.action !== "unknown") {
      reasons.push(row.dispatch.why);
    }
  } else if (row.dispatch.verdict === "needs-owner-judgment") {
    label = "NEEDS-OWNER-JUDGMENT";
    reasons.push(row.dispatch.why);
  } else {
    label = row.dispatch.verdict;
  }
  if (!explainedByAClause({ row }) && !reasons.includes(row.actionDetail)) {
    reasons.push(row.actionDetail);
  }
  const shown = reasons.map((reason) => compactTitle({ maxChars: WHY_CHARS, title: reason }));
  return shown.length === 0 ? `${label}/${row.action}` : `${label}/${row.action} (${shown.join("; ")})`;
}

/**
 * One pull request's landing facts as one line.
 *
 * @param row the broken-down pull request
 * @returns `owner/name#n verdict/act · CI … · rabbit … · approved: … · owners … · asked: … · "title"`
 */
export function landingFacts({ row }: { row: LandingRow }): string {
  const clauses = [
    `${row.repoSlug}#${String(row.number)} ${dispatchClause({ row })}`,
    ...heldByClause({ row }),
    ...boardClause({ row }),
    ...queueClause({ row }),
    ciClause({ row }),
    `rabbit ${RABBIT_CELL[row.codeRabbit]}`,
    approvedClause({ row }),
    ownersClause({ row }),
    ...threadsClause({ row }),
    askClause({ row }),
    `"${compactTitle({ maxChars: FACT_TITLE_CHARS, title: row.title })}"`,
  ];
  return clauses.join(" · ");
}
