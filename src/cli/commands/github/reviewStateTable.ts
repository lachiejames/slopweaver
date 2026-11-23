/**
 * The `github review-state` TABLE — every cell, the header, the row and the whole document.
 *
 * Split out of `./reviewStateReport.ts` to stay under the 300-code-line cap. The seam is the
 * one that file already had down its middle: above it a `PrLiveState` becomes a `PrReviewState`, below it a
 * `PrReviewState` becomes text. Nothing here reads a provider or decides a verdict.
 */

import { clearanceExpression } from "../../../review/codeownerTeams.js";
import { describeOwner, type ReviewRoster } from "../../../review/reviewRoster.js";
import type { AskRecommendation, PrReviewState } from "../../../review/reviewState.js";
import type { SlackCoverage } from "../../../review/slackEvidenceTypes.js";

/** The one-word CI cell. */
const CI_CELL: Readonly<Record<PrReviewState["ci"], string>> = {
  green: "green",
  none: "none",
  red: "RED",
  running: "running",
};

/** The one-word CodeRabbit cell. */
const RABBIT_CELL: Readonly<Record<PrReviewState["codeRabbit"], string>> = {
  "changes-requested": "CHANGES",
  green: "green",
  none: "none",
  pending: "pending",
  stale: "STALE",
  stuck: "STUCK",
  unknown: "unknown",
};

/**
 * The ACTION cell's text — every recommendation prints its own name, except `conflicting`, which is shouted
 * so it stands out of a column of review answers, and `stacked`, which says in the cell that it is never an ask.
 */
const ACTION_CELL: Readonly<Record<AskRecommendation, string>> = {
  "already-asked": "already-asked",
  blocked: "blocked",
  bump: "bump",
  conflicting: "CONFLICTING",
  "self-merges": "self-merges",
  "send-ask": "send-ask",
  stacked: "stacked, no ask",
  "still-draft": "still-draft",
  unknown: "unknown",
};

/** Pad a cell to a fixed width so the table lines up in a terminal without a formatting library. */
function pad({ text, width }: { text: string; width: number }): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

/**
 * The owners cell: what CODEOWNERS still OWES, rather than who was ever named.
 *
 * Printing the satisfiable owner tokens would make this the cell that reads as
 * ready when it is not — a token on the row is a fact about the FILES, and a reader takes it for a fact
 * about the pull request. So the cell leads with the count of rules still owed out of the rules
 * invoked, and names only the owners that could clear them.
 *
 * The owners are joined by their CONNECTIVE rather than by a space, because a space-joined `@org/a @org/b` is the same text whether either team will do or both must review,
 * and those are different days of chasing. `AND` separates rules, `OR` separates owners inside one — see
 * `../../../review/codeownerTeams.ts`.
 *
 * @param state the assembled answer
 * @returns the owed count and the owners joined by their connective, the approved count when nothing is
 *   owed, or an em dash when the changed paths invoke no rule at all
 */
export function approverCell({ state }: { state: PrReviewState }): string {
  const { verdict, owed, rules } = state.codeowners;
  if (verdict === "none") {
    return "—";
  }
  if (verdict === "satisfied") {
    return `${String(rules.length)}/${String(rules.length)} rules approved`;
  }
  const expression = clearanceExpression({ owed });
  const label = verdict === "unknown" ? "unproven" : "OWED";
  const who = expression === "" ? "self only, so nobody can" : expression;
  return `${String(owed.length)}/${String(rules.length)} ${label}: ${who}`;
}

/** The header the table prints above its rows. */
export const REVIEW_STATE_HEADER =
  `${pad({ text: "PR", width: 8 })} ${pad({ text: "CI", width: 8 })} ${pad({ text: "RABBIT", width: 8 })} ` +
  `${pad({ text: "DRAFT", width: 6 })} ${pad({ text: "SLACK", width: 8 })} ${pad({ text: "ASKED", width: 8 })} ` +
  `${pad({ text: "ACTION", width: 22 })} OWNERS / TITLE`;

/**
 * One pull request as a single table line.
 *
 * @param state the assembled answer
 * @returns the row
 */
export function reviewStateRow({ state }: { state: PrReviewState }): string {
  const draft = state.undrafted ? "no" : "YES";
  return (
    `${pad({ text: `#${String(state.number)}`, width: 8 })} ` +
    `${pad({ text: CI_CELL[state.ci], width: 8 })} ` +
    `${pad({ text: RABBIT_CELL[state.codeRabbit], width: 8 })} ` +
    `${pad({ text: draft, width: 6 })} ` +
    `${pad({ text: state.slack.mentioned, width: 8 })} ` +
    `${pad({ text: state.slack.asked, width: 8 })} ` +
    `${pad({ text: ACTION_CELL[state.recommendation], width: 22 })} ` +
    `${approverCell({ state })} · ${state.title}`
  );
}

/**
 * How many of each recommendation the run produced — the summary line under the table.
 *
 * @param states every assembled answer
 * @returns one `name count` pair per recommendation seen, alphabetical, separated by a middle dot
 */
export function recommendationTally({ states }: { states: readonly PrReviewState[] }): string {
  const counts = new Map<string, number>();
  for (const state of states) {
    const seen = counts.get(state.recommendation);
    counts.set(state.recommendation, seen === undefined ? 1 : seen + 1);
  }
  return [...counts.entries()]
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ${String(count)}`)
    .join(" · ");
}

/**
 * The whole machine-readable document, with the joins resolved so a consumer never re-reads the roster.
 *
 * @param states every assembled answer
 * @param coverage how far each Slack leg reached
 * @param roster the login → Slack id join, for naming an owner
 * @param residue everything the run itself could not see
 * @returns the document to serialise
 */
export function reviewStateDocument({
  states,
  coverage,
  roster,
  residue,
}: {
  states: readonly PrReviewState[];
  coverage: SlackCoverage;
  roster: ReviewRoster;
  residue: readonly string[];
}): Readonly<Record<string, unknown>> {
  return {
    coverage,
    pullRequests: states.map((state) => ({
      ...state,
      requiredApprovers: state.requiredApprovers.map((approver) => ({
        ...approver,
        ...describeOwner({ roster, token: approver.token }),
      })),
    })),
    residue,
    tally: recommendationTally({ states }),
  };
}
