/**
 * The two projections of a report: the human lines this verb prints, and the digest FORM the Slack door
 * takes. Pure, so both are testable without a network call and neither can drift from the report silently.
 *
 * The card rides the existing `digest` artifact rather than a new one. That is not a shortcut: a digest is
 * already "N things needing triage, ranked, each with its evidence and one ask", which is exactly this card,
 * and its severity arrives as DATA — mapped from Linear's own priority — rather than inferred from words.
 */

import { DIGEST_LEAD_VISIBLE_MAX, DIGEST_LINE_VISIBLE_MAX } from "../outbound/artifact/digestFields.js";
import { TABLE_MAX_ROWS } from "../outbound/artifact/schema.js";
import type { Severity } from "../outbound/artifact/severity.js";
import type { CycleProposal, CycleReconcileReport } from "./types.js";

/** How many characters of a proposal's own prose survive into the card's below-fold paragraph. */
const SUBSTANCE_MAX = 600;

/** Linear's own priority, mapped to the card's severity. Data in, data out — nothing is read from a title. */
function severityOf({ proposal }: { proposal: CycleProposal }): Severity {
  if (proposal.priority === "Urgent") {
    return "red";
  }
  if (proposal.priority === "High") {
    return "orange";
  }
  return "green";
}

/** One proposal's below-fold paragraph: its evidence, then the words that resolve it. */
function substanceOf({ proposal }: { proposal: CycleProposal }): string {
  const facts = proposal.evidence.map((item) => item.fact).join(" ");
  const replies = `Reply ${proposal.oneWordReplies.map((word) => `\`${word}\``).join(", ")}.`;
  return `${facts} ${replies}`.slice(0, SUBSTANCE_MAX);
}

/** What the table's State column says about one proposal — the ask, in two or three words. */
function stateOf({ proposal }: { proposal: CycleProposal }): string {
  if (proposal.action === "close-with-comment") {
    return "propose close";
  }
  if (proposal.action === "trace") {
    return "needs a look";
  }
  return "draft ready";
}

/**
 * The digest form for one report, ready for `slopweaver slack post --as bot --form -`.
 *
 * Capped at {@link TABLE_MAX_ROWS} because every proposal lands in the derived table; the ones that do not
 * fit are named in the lead's count rather than silently dropped.
 *
 * @param report the assembled pass
 * @returns the form object, to be serialised by the caller
 */
export function reconcileForm({ report }: { report: CycleReconcileReport }): Record<string, unknown> {
  const shown = report.proposals.slice(0, TABLE_MAX_ROWS);
  return {
    items: shown.map((proposal) => ({
      count: proposal.daysSinceMoved,
      severity: severityOf({ proposal }),
      state: stateOf({ proposal }),
      substance: substanceOf({ proposal }),
      ticket: { id: proposal.subject, url: proposal.url },
      title: proposal.headline.slice(0, DIGEST_LINE_VISIBLE_MAX),
    })),
    kind: "digest",
    label: "Cycle and projects",
    lead: `Nothing is written until you answer.`.slice(0, DIGEST_LEAD_VISIBLE_MAX),
    window: "today",
  };
}

/**
 * The report as human lines for stderr.
 *
 * @param report the assembled pass
 * @returns the lines, in print order
 */
export function reconcileLines({ report }: { report: CycleReconcileReport }): readonly string[] {
  const lines: string[] = [
    `cycle reconcile for ${report.owner} at ${report.generatedAtIso}`,
    `  ${String(report.scan.teamsWithCurrentCycle)} team(s) with a live cycle · ${String(report.scan.openInCurrentCycle)} open item(s) assigned to you in it · ${String(report.scan.staleInCurrentCycle)} unmoved since it opened`,
    `  ${String(report.scan.liveProjectsLed)} live project(s) you lead`,
    "",
  ];
  if (report.proposals.length === 0) {
    lines.push("  nothing to propose — no stale item and no overdue project update");
  }
  for (const proposal of report.proposals) {
    lines.push(`  [${proposal.action}] ${proposal.headline}`);
    // The title, on its own line under the headline: the headline names the KEY and the reason, and a key
    // alone made the owner open every link on the first real card to find out what each row was about.
    if (proposal.title !== undefined) {
      lines.push(`      ${proposal.title}`);
    }
    for (const item of proposal.evidence) {
      lines.push(`      · ${item.fact}${item.url === undefined ? "" : ` — ${item.url}`}`);
    }
    lines.push(`      reply: ${proposal.oneWordReplies.join(" | ")}`);
  }
  if (report.couldNotSee.length > 0) {
    lines.push("", "  what this pass could not see:");
    for (const gap of report.couldNotSee) {
      lines.push(`      · ${gap}`);
    }
  }
  lines.push("", "  nothing was sent and nothing was closed in Linear or GitHub — this verb only ever proposes");
  return lines;
}
