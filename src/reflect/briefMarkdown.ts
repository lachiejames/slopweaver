/**
 * The dated self-improvement report, rendered from a composed brief.
 *
 * ## Why this file exists at all, stated rather than assumed
 *
 * Five of these reports were written, `morning/self-improvement-YYYY-MM-DD.md` on consecutive days, and
 * then the recipe row that produced them left `$SLOPWEAVER_HOME/live/recipe/definitions/` and nothing said
 * so for seventeen days. When the row was revived the obvious move looked like
 * restoring it — and there was nothing to restore. **No renderer for this markdown has ever existed in this
 * repository.** A seated session read `reflect brief`'s CLI lines and wrote the prose by hand, which is why
 * `git grep 'Self-improvement mining'` matched nothing on the day the row came back.
 *
 * So this is a RE-IMPLEMENTATION, and deliberately a narrower one. Every line below is a projection of
 * {@link ReflectBrief}: the miner already ranks, cross-references and caps, and the report is that result
 * written down. Nothing here judges, summarises or infers, because a model writing the daily report is the
 * shape this design moved away from — a row selects a procedure this repository ships, and can never
 * describe its own.
 *
 * ## The report is a file, not an outbound message
 *
 * It lands under `$home/morning` and is read by `./frictionReviewGap.ts`, which dates it from the FILENAME.
 * That is the whole contract between the producer and its gauge, and it is why the writer and the gauge
 * take their date from one helper rather than two — see `../cli/commands/reflect/briefRun.ts`.
 *
 * Pure: a brief in, lines out. The write is the verb's.
 */
import type { ReflectBrief } from "./brief.js";
import { agreeing, countOf } from "./countPhrase.js";
import { patternSentence } from "./finding.js";
import type { RankedFinding } from "./rank.js";

/** What a `- board:` or `- memory:` line says when the cross-reference found nothing. */
const NOTHING_RECORDED = "nothing recorded";

/**
 * One cross-reference line, naming what already covers a finding.
 *
 * The empty case is written out rather than omitted. A missing line reads as a renderer that forgot; a line
 * saying nothing is recorded is the finding's own evidence that the knowledge is not there yet — which is
 * the distinction `./finding.ts`'s `knownBy` exists to draw.
 *
 * @param label the lane being reported, `board` or `memory`
 * @param slugs what that lane's cross-reference matched
 * @returns the line
 */
function crossRefLine({ label, slugs }: { label: string; slugs: readonly string[] }): string {
  if (slugs.length === 0) {
    return `- ${label}: ${NOTHING_RECORDED}`;
  }
  return `- ${label}: ${slugs.toSorted((left, right) => left.localeCompare(right)).join(", ")}`;
}

/** The bullet prefix every evidence line carries, which `./frictionReviewPage.ts` folds a run of behind a count. */
export const EVIDENCE_BULLET_PREFIX = "evidence: ";

/** The bullet prefix a finding's id line carries, which `./frictionReviewPage.ts` reads as "this list is a finding's". */
export const FINDING_ID_BULLET_PREFIX = "finding id: ";

/** What the evidence bullet says when the collector recorded nothing, written out so absence never reads as a bug. */
export const NO_EVIDENCE_RECORDED = "none recorded";

/**
 * The bullet naming a finding's id and the one verb that takes it.
 *
 * The id is `candidate.id`, the very string `slopweaver reflect grade <finding-id>` looks up in the seen
 * ledger (`./grades.ts`'s `planGrade`), so the owner reading this report can grade a finding without
 * fetching the id from `reflect brief` first. Before this line the report carried no id at all, which is
 * why 125 sightings went ungraded.
 *
 * The id is written bare inside a single-backtick code span, which is safe because the only producer of a
 * candidate's id is `./finding.ts`'s `findingId`, which emits twelve lowercase hex characters (pinned by
 * `briefMarkdown.test.ts`), so it can never carry a backtick.
 *
 * @param candidate the ranked finding
 * @returns the bullet
 */
function idLine({ candidate }: { candidate: RankedFinding }): string {
  const { id } = candidate;
  return `- ${FINDING_ID_BULLET_PREFIX}\`${id}\` (grade it: \`slopweaver reflect grade ${id} keep|adjust|drop\`)`;
}

/**
 * The bullets carrying a finding's evidence: one per line a collector recorded (bounded to a handful at the
 * source, `./substrate.ts`'s `EVIDENCE_LINES`), or one written-out bullet when it recorded none.
 *
 * @param evidence the collector's evidence lines
 * @returns the bullets, never empty
 */
function evidenceLines({ evidence }: { evidence: readonly string[] }): readonly string[] {
  // A blank line is no evidence: it would render as an empty bullet that reads as a recorded, empty fact.
  const recorded = evidence.filter((line) => line.trim() !== "");
  if (recorded.length === 0) {
    return [`- ${EVIDENCE_BULLET_PREFIX}${NO_EVIDENCE_RECORDED}`];
  }
  return recorded.map((line) => `- ${EVIDENCE_BULLET_PREFIX}${line}`);
}

/** The bullet prefix of the rank arithmetic, which `./frictionReviewPage.ts` folds with the cross-references. */
export const ORDERING_BULLET_PREFIX = "fleet ordering, not a grade: ";

/** What a finding's "what happened" paragraph opens with, beneath its consequence and its pattern. */
const WHAT_HAPPENED = "What happened: ";

/**
 * One surfaced finding, as its own section.
 *
 * A heading that read a bare score ("handover amend — 6.0") left the owner unable to tell whose friction it measured,
 * the agent's or theirs. So the heading is
 * the finding's measured CONSEQUENCE, the next line says one-off or systemic with its counts, and what
 * happened comes after both. The rank arithmetic is labelled as the fleet's ordering — never a grade, never a
 * score out of ten — and sits with the cross-references, which the page folds. Only a finding with a
 * consequence surfaces (`./rank.ts`), so the heading never lacks one.
 *
 * @param candidate the ranked finding to render
 * @returns the section's lines, blank-separated as markdown wants them
 */
function findingSection({ candidate }: { candidate: RankedFinding }): readonly string[] {
  const { finding } = candidate;
  return [
    `### ${finding.consequence!}`,
    "",
    patternSentence({ daysSeen: candidate.daysSeen, occurrences: finding.occurrences }),
    "",
    `${WHAT_HAPPENED}${finding.summary}`,
    "",
    idLine({ candidate }),
    `- ${ORDERING_BULLET_PREFIX}${candidate.score.toFixed(1)} = impact ${String(finding.impact)} ` +
      `(${String(candidate.baseImpact)} before recurrence) x safety ${String(finding.safety)} / cost ${String(finding.cost)}, ` +
      `from ${finding.source} at ${finding.locus}; surfaced ${countOf({ count: candidate.priorSurfacings, many: "times", one: "time" })} before`,
    crossRefLine({ label: "board", slugs: finding.coveredBy }),
    crossRefLine({ label: "memory", slugs: finding.knownBy }),
    ...evidenceLines({ evidence: finding.evidence }),
    "",
  ];
}

/**
 * The closing paragraph, which is about the report's LIMIT rather than its contents.
 *
 * It is a constant because it is the same sentence every day and it is load-bearing: the report is evidence
 * a session starts from, not a plan, and every one of the five hand-written reports ended by saying so.
 */
const CLOSING = [
  "Reconciling these against the handover board — which docs are stale, which overlap, which diverged —",
  "is the dispatched session's job, not this file's. This is the evidence it starts from.",
] as const;

/**
 * The rubric a grade is against, printed on every report, because a grade with no rubric
 * leaves the owner no criteria to go off. Each line says what the grade DOES, exactly as
 * `./grades.ts` and `./rank.ts` behave: keep and adjust stay rankable, drop is terminal, and no grade fixes or
 * closes the underlying thing.
 */
const GRADE_RUBRIC = [
  "## How to grade",
  "",
  "Each finding opens on what it measurably cost you or the fleet, then says whether it is a one-off or systemic.",
  "",
  "- keep — that cost is worth the fleet fixing; it stays on the list until a fix closes it",
  "- adjust — the problem is real but the cost or the framing here is wrong; say which, and it stays on the list",
  "- drop — an acceptable cost, or noise; it is never shown to you again (the underlying thing is not fixed)",
  "",
  "The fleet ordering under each finding is how the miner sorted them, not a grade and not a score out of ten.",
  "",
] as const;

/**
 * Render one day's self-improvement report.
 *
 * @param brief the composed brief this report is a projection of
 * @param date the report's own day, `YYYY-MM-DD`, which must be the day its filename carries
 * @returns the report's lines, ready to join with newlines
 */
export function renderBriefMarkdown({ brief, date }: { brief: ReflectBrief; date: string }): readonly string[] {
  const candidates = brief.surfaced.length + brief.backlog.length;
  const lines: string[] = [
    `# Self-improvement mining, ${date}`,
    "",
    `${String(brief.surfaced.length)} surfaced of ${countOf({ count: candidates, many: "candidate classes", one: "candidate class" })}; ` +
      `${String(brief.backlog.length)} in the backlog; ${String(brief.suppressed)} dropped by a terminal grade.`,
    "",
    `Window ${brief.window.fromIso} .. ${brief.window.toIso}, read ` +
      `${brief.sources.map((source) => `${source.source} ${String(source.rowsRead)}`).join(", ")}.`,
    "",
    ...GRADE_RUBRIC,
  ];

  if (brief.surfaced.length === 0 && brief.heldUnmeasured > 0) {
    lines.push(
      "## Surfaced",
      "",
      `Nothing to grade: ${countOf({ count: brief.heldUnmeasured, many: "findings", one: "finding" })} could not state a measured cost to you or the fleet, so ${agreeing({ count: brief.heldUnmeasured, many: "they were", one: "it was" })} held.`,
      "",
    );
  } else if (brief.surfaced.length === 0) {
    lines.push("## Surfaced", "", "Nothing this window. A quiet pass is a good pass.", "");
  } else {
    lines.push("## Surfaced", "");
    for (const candidate of brief.surfaced) {
      lines.push(...findingSection({ candidate }));
    }
  }

  lines.push("## What this run could not see", "");
  for (const residue of brief.couldNotVerify) {
    lines.push(`- ${residue}`);
  }
  lines.push("", ...CLOSING, "");
  return lines;
}

/**
 * The filename one day's report is written under — the shape `./frictionReviewGap.ts` parses back.
 *
 * @param date the report's day, `YYYY-MM-DD`
 * @returns the bare filename, with no directory
 */
export function briefReportFilename({ date }: { date: string }): string {
  return `self-improvement-${date}.md`;
}
