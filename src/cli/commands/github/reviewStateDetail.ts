/**
 * `slopweaver github review-state --detail` — the granular block, one pull request at a time.
 *
 * The table this sits beside is seven verdicts on one line, built to be read across forty pull requests at
 * once. This is the other half of the same verb, and it exists because a verdict is what a heuristic reads,
 * while the owner decides on what a HUMAN reads: whether CodeRabbit approved, whether unresolved comments
 * remain and from whom, what they say, and whether CI is failing, on a required check, and which one.
 *
 * Rule 7 is why this is a `--detail` flag rather than a wider table: concise by default, everything else
 * behind something the reader chooses to open. `--number` implies it, because a reader who named one pull
 * request has already chosen.
 *
 * Pure — every line is composed from data `./reviewStateRun.ts` already read.
 */

import type { FailingCheckDetail, ThreadDetail, ThreadDisposition } from "../../../review/prStateDetail.js";
import type { ConflictState, PrReviewState } from "../../../review/reviewState.js";

/**
 * How each disposition is labelled in the block.
 *
 * `answered-open` reads "we answered, still open" rather than naming push-back or agreement, because the
 * state cannot tell those apart and the excerpt printed beneath it can — see `../../../review/prStateDetail.ts`.
 */
const DISPOSITION_LABEL: Readonly<Record<ThreadDisposition, string>> = {
  "answered-open": "we answered, still open",
  "awaiting-us": "AWAITING US",
  "ours-open": "our own walkthrough note",
  resolved: "resolved",
  "reviewer-replied": "REVIEWER REPLIED, still open",
};

/** The threads a reader is being asked to act on — everything except resolved and the author's own notes. */
function outstanding({ threads }: { threads: readonly ThreadDetail[] }): readonly ThreadDetail[] {
  return threads.filter((thread) => thread.disposition !== "resolved" && thread.disposition !== "ours-open");
}

/**
 * The "are there unresolved comments, and from whom" answer, as one line.
 *
 * Says `no` only when the read could see every thread. Truncation is reported instead, for the reason the
 * fleet seam already documents: a capped thread read can only ever LOSE an unresolved one, so it produces a
 * false clean and never a false dirty.
 *
 * @param state the assembled state for one pull request
 * @returns one line naming the count and who is waiting
 */
export function unresolvedLine({ state }: { state: PrReviewState }): string {
  const open = outstanding({ threads: state.threads });
  if (open.length === 0) {
    return "unresolved comments: no";
  }
  const who = state.waitingOn.map((tally) => `${tally.login} (${String(tally.open)})`).join(", ");
  const ours = state.threads.filter((thread) => thread.disposition === "ours-open").length;
  const oursClause = ours === 0 ? "" : `; ${String(ours)} more are our own self-review notes, not a reviewer's`;
  return `unresolved comments: YES — ${String(open.length)} open${who === "" ? "" : ` from ${who}`}${oursClause}`;
}

/**
 * Who is requesting changes right now — CodeRabbit and every human whose latest opinion still asks for them.
 *
 * The verbs say what has changes requested: the CodeRabbit line above
 * answers for the bot alone, and a human's standing CHANGES_REQUESTED was otherwise visible only as a
 * `github landing` escalation. Printed on every block, `none` included, so an absent line never has to be
 * read as "nobody".
 *
 * @param state the assembled state for one pull request
 * @returns one line naming each requester, with the day a human's review landed
 */
export function changesRequestedLine({ state }: { state: PrReviewState }): string {
  const botAsks = state.codeRabbit === "changes-requested" || state.codeRabbit === "stuck";
  const bot = botAsks ? ["coderabbitai"] : [];
  const humans = state.standingChangesRequested.map((review) => `${review.login} (${review.atIso.slice(0, 10)})`);
  const requesters = [...bot, ...humans];
  return `changes requested by: ${requesters.length === 0 ? "none" : requesters.join(", ")}`;
}

/**
 * One thread's two lines: where it is, and what it says.
 *
 * The last comment is printed only when it is not the opener, so a thread nobody has answered costs one line
 * rather than the same sentence twice.
 *
 * @param thread the thread detail
 * @returns its lines, in print order
 */
export function threadLines({ thread }: { thread: ThreadDetail }): readonly string[] {
  const where = thread.line === 0 ? thread.path : `${thread.path}:${String(thread.line)}`;
  const outdated = thread.isOutdated ? " [outdated]" : "";
  const head = `  · ${where}${outdated} — ${thread.openedByLogin}, ${DISPOSITION_LABEL[thread.disposition]}`;
  const lines = [head];
  if (thread.openerLine !== "") {
    lines.push(`      "${thread.openerLine}"`);
  }
  const answered = thread.commentCount > 1 && thread.lastCommentLogin !== thread.openedByLogin;
  if (answered && thread.lastCommentLine !== "") {
    lines.push(`      ↳ ${thread.lastCommentLogin}: "${thread.lastCommentLine}"`);
  }
  return lines;
}

/**
 * How one check's required-ness reads on its line.
 *
 * Three words for three states, never two: `required unknown` is what an unread base protection earns, and
 * collapsing it into `advisory` would tell a reader a red is safe to send on when nothing checked.
 *
 * @param required whether the base requires this context, or `undefined` when that could not be read
 * @returns the word for the line
 */
function requirementWord({ required }: { required: boolean | undefined }): string {
  if (required === undefined) {
    return "required unknown";
  }
  return required ? "REQUIRED" : "advisory";
}

/**
 * The CI answer: which checks are not passing, and whether the base branch requires each.
 *
 * A check whose required-ness could not be read prints `required unknown` rather than being silently
 * demoted to advisory — the whole reason `RequiredContextGate` carries an `unreadable` arm.
 *
 * @param failing every non-passing check
 * @returns one line per check
 */
export function failingCheckLines({ failing }: { failing: readonly FailingCheckDetail[] }): readonly string[] {
  return failing.map((check) => {
    const requirement = requirementWord({ required: check.required });
    return `  · ${check.name} — ${check.state}, ${requirement}${check.url === undefined ? "" : ` — ${check.url}`}`;
  });
}

/**
 * The mergeability cell — three words, because GitHub gives three answers.
 *
 * `mergeable` is never printed for everything that is not `CONFLICTING`, because that makes GitHub's
 * lazily-computed `UNKNOWN` read as a clean merge. It answers `UNKNOWN` on the FIRST read of a pull request
 * and merely starts the job — MEASURED, 16 of the owner's 31 open pull requests on the first read of
 * a session and none on a later one. Reproduce by running
 * `slopweaver github review-state --repo acme/acme-admin --author <login> --json` twice and tallying
 * `[.pullRequests[].conflict.mergeable]` from each.
 *
 * @param conflict question 8's answer
 * @returns the cell
 */
function mergeabilityCell({ conflict }: { conflict: ConflictState }): string {
  if (conflict.mergeable === "CONFLICTING") {
    return "CONFLICTING";
  }
  return conflict.mergeable === "MERGEABLE" ? "mergeable" : "mergeability UNCOMPUTED";
}

/**
 * The whole granular block for one pull request, in the order the owner asks their questions.
 *
 * @param state the assembled state for one pull request
 * @returns every line of the block, without a trailing blank
 */
export function reviewStateDetailBlock({ state }: { state: PrReviewState }): readonly string[] {
  const open = outstanding({ threads: state.threads });
  const lines: string[] = [
    `${state.repoSlug}#${String(state.number)} — ${state.title}`,
    `  ${state.url}`,
    `  ${state.undrafted ? "ready for review" : "DRAFT"} · base ${state.baseRefName} · ${mergeabilityCell({ conflict: state.conflict })} · action ${state.recommendation}`,
    "",
    `CodeRabbit approved: ${state.codeRabbit === "green" ? "yes" : `no — ${state.codeRabbit}`} (${state.codeRabbitDetail})`,
    changesRequestedLine({ state }),
    unresolvedLine({ state }),
  ];
  for (const thread of open) {
    lines.push(...threadLines({ thread }));
  }
  if (open.length > 0 && !state.threadBodiesRead) {
    lines.push("      (comment text not read on this run — add --detail, or name one pull request with --number)");
  }
  lines.push("");
  lines.push(`CI: ${state.ci} — ${state.ciDetail}`);
  lines.push(...failingCheckLines({ failing: state.failingChecks }));
  lines.push(`  ${requiredContextsLine({ state })}`);
  lines.push("");
  lines.push(githubCodeownersLine({ state }));
  lines.push(codeownerTeamsLine({ state }));
  const ownersWhy =
    state.codeowners.verdict === "satisfied" ? "every CODEOWNERS rule it invokes is approved" : state.codeowners.why;
  lines.push(`codeowners: ${ownersWhy}`);
  lines.push(`slack: asked ${state.slack.asked} · bump ${state.bump.kind}`);
  return lines;
}

/**
 * The line naming who GITHUB says the code owners are — printed FIRST of the three codeowner lines, and on
 * every block, because it is the only one of them that is not reverse-engineered from the file.
 *
 * It reads from the authoritative source, so it leads, and the two
 * derived lines below it keep the questions GitHub's API does not answer — which rules are still owed, and
 * whether the teams are an AND or an OR.
 *
 * @param state the assembled state for one pull request
 * @returns one line, always
 */
export function githubCodeownersLine({ state }: { state: PrReviewState }): string {
  return `github codeowners: ${state.githubCodeowners.sentence}`;
}

/**
 * The line naming which CODEOWNERS teams the review depends on, and whether that is an AND or an OR.
 *
 * Printed FIRST of the two codeowner lines and on every block, satisfied ones included. The owner asked for
 * this because GitHub's own interface makes working out the owning teams painful —
 * so a block that showed it only when something was owed would still leave the owner opening the file to find
 * out whether the answer they got was the whole answer.
 *
 * @param state the assembled state for one pull request
 * @returns one line, always
 */
export function codeownerTeamsLine({ state }: { state: PrReviewState }): string {
  return `codeowner teams: ${state.codeowners.teams.sentence}`;
}

/**
 * The line naming what the base branch requires — printed on every block, never only a failing one.
 *
 * A reader who only sees the required set when it is violated cannot tell "this run checked and the gate is
 * satisfied" from "this run never looked", which is the same reason `requiredContextClause` prints it
 * unconditionally on the merge path.
 *
 * @param state the assembled state for one pull request
 * @returns one line, always
 */
export function requiredContextsLine({ state }: { state: PrReviewState }): string {
  const gate = state.requiredContexts;
  if (gate.kind === "unreadable") {
    return `required contexts UNREAD (${gate.reason}) — an advisory red cannot be told from a blocking one here`;
  }
  if (gate.required.length === 0) {
    return `${gate.branch} requires no status-check contexts, so every red above is advisory`;
  }
  const missing =
    gate.missing.length === 0 ? "" : ` · ${String(gate.missing.length)} REQUIRED NEVER RAN: ${gate.missing.join(", ")}`;
  const unproven =
    gate.unproven.length === 0
      ? ""
      : ` · ${String(gate.unproven.length)} REQUIRED UNPROVEN (truncated read): ${gate.unproven.join(", ")}`;
  return `${gate.branch} requires ${gate.required.join(", ")}${missing}${unproven}`;
}
