/**
 * The self-improvement loop's own section on the Fleet Briefing — REPORT ONLY, and refused rather than trimmed.
 *
 * The loop's first version gets its own section on the fleet briefing for self-improvement opportunities, and
 * that is the whole of its output surface. It writes nothing — no board doc, no branch, no memory, no Slack post — and it
 * asks nothing: a pass that found nothing renders one quiet note and ends. The next rung (one unassigned board
 * doc per run) is designed and waiting in `~/.slopweaver/self-improvement-loop-research.md`, and is the owner's to
 * grant, never this file's to reach for.
 *
 * ## Why the ceiling is there
 *
 * Every autonomous-action class is ask-first because autonomous self-improvement sometimes did the right thing
 * and sometimes the wrong thing — an unattended wrong change silently
 * redefines what the bot is. The mechanism was a build subagent that freelanced twice on one precise fix,
 * once writing a test that DEFENDED the old behaviour, and both freelances passed a green gate. A gate checks
 * green, not intent, so the loop shows the owner what it found and the owner decides.
 *
 * ## The cap is a property of the form, not of whoever composes it
 *
 * AGENTS.md rule 7: shape is enforced by the schema, never by review. {@link renderSelfImprovementSection}
 * REFUSES a sixth finding, a headline over its word budget, a section over its above-the-fold budget, and
 * anything the briefing's own `sectionSchema` would refuse. It never truncates — a truncated finding lies
 * about its own size, and a silent cap reads as "that was everything". A refusal names what it would have
 * had to drop (`./briefingSectionErrors.ts`).
 *
 * ## What reaches the owner above the fold, and what does not
 *
 * Each note's headline carries four things, in order: the finding, whether it is still live, whether the
 * board already covers it, and its anchor — the finding id `slopweaver reflect grade` takes. Everything else
 * (where it was seen, the score arithmetic, what the memory and the register already say, the owner's earlier grade,
 * the evidence) is in the note's fold. The already-covered check is not decoration: a hand-run
 * measured already-done at 41% of all walk friction, five times the next category.
 *
 * A finding's fold is the QUOTED lane (`../outbound/briefing/types.ts`'s `BriefingQuotedNote`), because its
 * evidence lines are what a collector recorded rather than prose anybody here composed — and a collector's
 * line routinely ends in the `…` `./substrate.ts`'s `oneLine` leaves, which the composed lane refuses. The
 * headline is held to the composed rules either way.
 *
 * Pure: ranked findings in, one `BriefingSection` out. No filesystem, no clock — liveness comes from the
 * finding's own last sighting and the owner's closing grade. Putting the section on the page (a `briefing render`
 * projection, as `freshness` is, with its own fixed id) is the next step, not this module's.
 */

import type { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";

import { wordCount } from "../briefing/text.js";
import { sectionSchema } from "../outbound/briefing/sectionSchema.js";
import type {
  BriefingBlock,
  BriefingComposedNote,
  BriefingContent,
  BriefingFold,
  BriefingInline,
  BriefingQuotedNote,
  BriefingSection,
} from "../outbound/briefing/types.js";
import { quotedNoteSchema, textOfContent } from "../outbound/briefing/vocabulary.js";
import {
  type NoteRefusal,
  type SelfImprovementSectionError,
  SelfImprovementSectionErrors,
} from "./briefingSectionErrors.js";
import { type RankedFinding, SURFACE_CAP } from "./rank.js";

/**
 * The most findings the section may carry: the miner's own surface cap, so the page and `reflect brief` can
 * never disagree about how many reached the owner. A sixth is REFUSED, never dropped.
 */
export const SELF_IMPROVEMENT_MAX_FINDINGS = SURFACE_CAP;

/**
 * The longest collector summary this section was sized against, in words.
 *
 * MEASURED over every candidate a seven-day `reflect brief` ranked on this machine, surfaced and
 * backlogged alike (169 of them): median 13, longest 31. Collectors bound a summary by characters through
 * `./substrate.ts`'s `oneLine`, not by words, so this is what those widths produce rather than a promise.
 * Reproduce:
 *
 * ```bash
 * slopweaver reflect brief --from 7d --dry-run --json | sed '$d' \
 *   | jq '[(.surfaced + .backlog)[].finding.summary | split(" ") | map(select(length > 0)) | length] | max'
 * ```
 */
const MEASURED_SUMMARY_MAX_WORDS = 31;

/**
 * The most words the three status clauses — liveness, coverage, anchor — plus their separator add to a summary.
 *
 * Twenty, for the longest composition: `— came back after a fix, last seen <day>; the board may already cover
 * it: <n> docs match; anchor <id>`. The unit test renders that composition and pins this number, so a wording
 * change that grows a clause fails there rather than quietly eating the summary's share.
 */
export const SELF_IMPROVEMENT_STATUS_MAX_WORDS = 20;

/**
 * The longest one finding's headline may run, in words — the finding, its liveness, its coverage, its anchor.
 *
 * Deliberately NOT the 30-word one-breath cap `../briefing/caps.ts`'s `YOUR_LIST_HEADLINE_MAX_WORDS` uses:
 * the summary is a collector's, and those alone reach past thirty, so that cap would refuse the section on an
 * ordinary day. This refuses nothing a real run produced and refuses a collector that grows past it.
 */
export const SELF_IMPROVEMENT_HEADLINE_MAX_WORDS = MEASURED_SUMMARY_MAX_WORDS + SELF_IMPROVEMENT_STATUS_MAX_WORDS;

/**
 * The most words the whole section may put above the fold: its summary and every headline, together.
 *
 * Deliberately TIGHTER than five headlines at their individual cap (255). A per-row cap alone passes five rows
 * each just inside it, which is the case `../briefing/caps.ts`'s `CARD_ABOVE_FOLD_MAX_WORDS` exists to catch
 * on a card; this is that backstop for this section. MEASURED on the same day: the real five-finding section
 * rendered from a 24-hour run came to 183 words and from a seven-day run to 181, so 200 passes both and
 * refuses five near-cap rows.
 */
export const SELF_IMPROVEMENT_ABOVE_FOLD_MAX = 200;

/**
 * How many names a cross-reference lane lists inline before it moves ALL of them into a nested fold.
 *
 * One cross-reference matched 118 docs, so an inline list would be a wall — and cutting it to three plus "and
 * N more" would be the truncation this section refuses. Past this many, the paragraph gives the count and a
 * nested fold holds every name.
 */
const NAMES_INLINE = 3;

/** What a lane in the fold says when it matched nothing, written out so a missing line never reads as a bug. */
const NOTHING_RECORDED = "nothing recorded";

/**
 * Whether a finding is still happening, derived from its own last sighting and the owner's closing grade — never typed.
 *
 * `regressed` is a sighting AFTER the grade that closed it, read as the regression it is, exactly as
 * `./grades.ts`'s `gradeHistoryLine` reads it. `closed` is the other order: the owner closed it at or after the last
 * time the window saw it, so it has not been seen since. The ledger's fold (`./seen.ts`) sets `closedBy` and
 * `closedAtIso` together, so one without the other is read as never closed.
 */
export type FindingLiveness =
  | { readonly kind: "live" }
  | { readonly kind: "closed"; readonly closedBy: string; readonly closedAtIso: string }
  | { readonly kind: "regressed"; readonly closedBy: string; readonly closedAtIso: string };

/**
 * Derive one finding's liveness from what the ledger already holds.
 *
 * @param candidate the ranked finding, carrying its closing grade when the owner gave one
 * @returns `live` when nothing closed it, otherwise which side of the closing grade the last sighting fell
 */
export function livenessOf({ candidate }: { candidate: RankedFinding }): FindingLiveness {
  const { closedBy, closedAtIso } = candidate;
  if (closedBy === undefined || closedAtIso === undefined) {
    return { kind: "live" };
  }
  if (candidate.finding.lastSeenIso > closedAtIso) {
    return { closedAtIso, closedBy, kind: "regressed" };
  }
  return { closedAtIso, closedBy, kind: "closed" };
}

/**
 * The liveness clause a headline carries, in plain words.
 *
 * @param liveness the derived liveness
 * @param lastSeenIso the finding's latest sighting in the window
 * @returns the clause
 */
function livenessClause({ liveness, lastSeenIso }: { liveness: FindingLiveness; lastSeenIso: string }): string {
  const day = lastSeenIso.slice(0, 10);
  switch (liveness.kind) {
    case "live": {
      return `still happening, last seen ${day}`;
    }
    case "regressed": {
      return `came back after a fix, last seen ${day}`;
    }
    case "closed": {
      return `fixed, not seen since ${day}`;
    }
    default: {
      const unreachable: never = liveness;
      return unreachable;
    }
  }
}

/**
 * The coverage runs a headline carries: whether the board may already plan this.
 *
 * "May", because the cross-reference (`./crossRef.ts`) is rare-token overlap, not a judgement. One match is
 * named, since it is probably the doc. Several are COUNTED and named only in the fold: MEASURED:
 * the five findings a seven-day run surfaced matched 51, 25, 4, 13 and 2 docs, and whichever of fifty sorts
 * first is an arbitrary name that reads as the answer.
 *
 * @param coveredBy the board slugs the cross-reference matched, in any order
 * @returns the runs, never empty
 */
function coverageRuns({ coveredBy }: { coveredBy: readonly string[] }): readonly BriefingInline[] {
  const [only] = coveredBy;
  if (only === undefined) {
    return [{ kind: "text", text: "not on the board yet" }];
  }
  if (coveredBy.length === 1) {
    return [
      { kind: "text", text: "the board may already cover it: " },
      { kind: "code", text: only },
    ];
  }
  return [{ kind: "text", text: `the board may already cover it: ${String(coveredBy.length)} docs match` }];
}

/**
 * One finding's headline: the finding, still live or not, covered or not, its anchor.
 *
 * The summary and the liveness clause share one run on purpose: a collector's summary may end in the `…` its
 * width bound left, and the briefing refuses a run that ENDS in one. The anchor is the finding id, which is
 * what `slopweaver reflect grade <id>` takes — checkable in one command, and stable across runs.
 *
 * @internal
 * @param candidate the ranked finding
 * @returns the headline's runs
 */
export function findingHeadline({ candidate }: { candidate: RankedFinding }): BriefingContent {
  const { finding } = candidate;
  const liveness = livenessClause({ lastSeenIso: finding.lastSeenIso, liveness: livenessOf({ candidate }) });
  return [
    { kind: "text", text: `${finding.summary} — ${liveness}; ` },
    ...coverageRuns({ coveredBy: finding.coveredBy }),
    { kind: "text", text: "; anchor " },
    { kind: "code", text: candidate.id },
  ];
}

/** One cross-reference lane: what it is called inline, what its nested fold is called, and what it matched. */
interface CrossRefLane {
  readonly label: string;
  readonly noun: string;
  readonly names: readonly string[];
}

/**
 * A lane as the paragraph states it: every name when there are few, the count when there are many.
 *
 * @param lane the lane
 * @returns the clause
 */
function laneClause({ lane }: { lane: CrossRefLane }): string {
  if (lane.names.length === 0) {
    return `${lane.label}: ${NOTHING_RECORDED}.`;
  }
  if (lane.names.length <= NAMES_INLINE) {
    return `${lane.label}: ${lane.names.join(", ")}.`;
  }
  return `${lane.label}: ${String(lane.names.length)} ${lane.noun}, every one listed below.`;
}

/**
 * The nested fold holding EVERY name of a lane too long to list inline, in the cross-reference's own order.
 *
 * @param lane the lane
 * @returns one fold block, or nothing when the lane fits inline
 */
function laneFold({ lane }: { lane: CrossRefLane }): readonly BriefingBlock[] {
  if (lane.names.length <= NAMES_INLINE) {
    return [];
  }
  return [
    {
      fold: {
        blocks: [
          {
            items: lane.names.map((name): BriefingContent => [{ kind: "code", text: name }]),
            kind: "list",
            ordered: false,
          },
        ],
        summary: `All ${String(lane.names.length)} ${lane.noun}`,
      },
      kind: "fold",
    },
  ];
}

/** One paragraph block of a single text run. */
function para({ text }: { text: string }): BriefingBlock {
  return { content: [{ kind: "text", text }], kind: "para" };
}

/**
 * The provenance paragraph: where it was seen, how often, how it scored, and the owner's history with it.
 *
 * @param candidate the ranked finding
 * @returns one paragraph block
 */
function provenanceBlock({ candidate }: { candidate: RankedFinding }): BriefingBlock {
  const { finding, closedBy, closedAtIso } = candidate;
  const graded = candidate.grade === undefined ? "Not graded yet" : `Graded ${candidate.grade}`;
  // Printed from the candidate, not from its liveness: a closing field arriving without its partner reads as
  // live above the fold, and the fold still shows whatever half was recorded.
  const closedByClause = closedBy === undefined ? "" : ` by ${closedBy}`;
  const closedAtClause = closedAtIso === undefined ? "" : ` at ${closedAtIso}`;
  const closed = closedByClause === "" && closedAtClause === "" ? "" : `; closed${closedByClause}${closedAtClause}`;
  // Two places read easily; a score they do not represent exactly (4/3 from cost 3) carries its full value too.
  const rounded = candidate.score.toFixed(2);
  const score = Number(rounded) === candidate.score ? rounded : `${rounded} (exactly ${String(candidate.score)})`;
  return para({
    text:
      `Seen at ${finding.locus} by the ${finding.source} reader, ${String(finding.occurrences)} time(s) this ` +
      `window (first ${finding.firstSeenIso}, last ${finding.lastSeenIso}) and on ${String(candidate.daysSeen)} ` +
      `day(s) in all, shown ${String(candidate.priorSurfacings)} time(s) before, as class ${finding.classKey}. Score ${score} is impact ${String(finding.impact)} ` +
      `(${String(candidate.baseImpact)} before recurrence) times safety ${String(finding.safety)} over cost ` +
      `${String(finding.cost)}. ${graded}${closed}.`,
  });
}

/**
 * The three cross-reference lanes of one finding, in the order the paragraph states them.
 *
 * Names keep the cross-reference's own order (`./crossRef.ts`), which is never re-sorted here: the section
 * shows what it was given.
 *
 * @param candidate the ranked finding
 * @returns the board, register and memory lanes
 */
function crossRefLanes({ candidate }: { candidate: RankedFinding }): readonly CrossRefLane[] {
  const { coveredBy, knownBy, refutedBy } = candidate.finding;
  return [
    { label: "On the board", names: coveredBy, noun: "board docs match" },
    { label: "Already refuted in the register", names: refutedBy, noun: "register entries refuted it" },
    { label: "Already in a memory, and it happened anyway", names: knownBy, noun: "memories say it" },
  ];
}

/**
 * What the board, the memory and the register already say about it — every lane written out, empty or not,
 * and every name it matched somewhere in the fold.
 *
 * @param candidate the ranked finding
 * @returns the paragraph, then one nested fold per lane too long to list inline
 */
function crossRefBlocks({ candidate }: { candidate: RankedFinding }): readonly BriefingBlock[] {
  const lanes = crossRefLanes({ candidate });
  return [
    para({ text: lanes.map((lane) => laneClause({ lane })).join(" ") }),
    ...lanes.flatMap((lane) => laneFold({ lane })),
  ];
}

/**
 * The collector's own evidence lines, as a real list — one explicit item when it recorded none.
 *
 * @param evidence the collector's lines
 * @returns one list block
 */
function evidenceBlock({ evidence }: { evidence: readonly string[] }): BriefingBlock {
  const lines = evidence.length === 0 ? ["no evidence lines were recorded"] : evidence;
  return { items: lines.map((text): BriefingContent => [{ kind: "text", text }]), kind: "list", ordered: false };
}

/**
 * One finding's fold: provenance, the evidence, the cross-reference, and a nested fold per long lane.
 *
 * The evidence sits before the cross-reference so the nested folds come last. A quoted fold carries no block
 * cap (`../outbound/briefing/vocabulary.ts`'s `quotedFoldSchema`), and the most this ever builds is six.
 *
 * @param candidate the ranked finding
 * @returns the fold
 */
function findingFold({ candidate }: { candidate: RankedFinding }): BriefingFold {
  return {
    blocks: [
      provenanceBlock({ candidate }),
      evidenceBlock({ evidence: candidate.finding.evidence }),
      ...crossRefBlocks({ candidate }),
    ],
    summary: "Where it was seen, how it scored, the evidence, and what already covers it",
  };
}

/** The one note a quiet pass carries — the section still says it looked, and asks nothing. */
const QUIET_NOTE: BriefingComposedNote = {
  headline: [{ kind: "text", text: "Nothing found this window — a quiet pass, and nothing to answer." }],
};

/**
 * The section's summary line: how many opportunities it shows and how many more the ranking held back.
 *
 * @param shown how many findings the section carries
 * @param notShown how many ranked findings sit in the backlog below the cap
 * @returns the line
 */
function sectionSummary({ shown, notShown }: { shown: number; notShown: number }): string {
  const held = notShown === 0 ? "" : `, ${String(notShown)} more held back`;
  return `Self-improvement opportunities: ${String(shown)} this window${held}; nothing was changed`;
}

/**
 * A schema refusal as `where: path: reason` lines, so the refusal names what it would have had to drop.
 *
 * @param error the schema's own error
 * @param id the finding id the refusal is about, or `section` for the whole
 * @returns one line per issue
 */
function schemaIssues({ error, id }: { error: z.ZodError; id: string }): readonly string[] {
  return error.issues.map((issue) => `${id}: ${issue.path.join(".")}: ${issue.message}`);
}

/**
 * The words a section puts above the fold: its summary and every note's headline. Folds count nothing.
 *
 * @param section the rendered section
 * @returns the word count the budget is measured against
 */
export function selfImprovementAboveFoldWords({ section }: { section: BriefingSection }): number {
  return section.notes.reduce(
    (total, note) => total + wordCount({ text: textOfContent({ content: note.headline }) }),
    wordCount({ text: section.summary }),
  );
}

/**
 * Every refusal one finding's note earns on its own, before the section is assembled: a headline over its cap,
 * and a note its quoted-lane schema refuses. Both are checked, so a note failing twice is named twice.
 *
 * @param id the finding the note renders, so the refusal can name it
 * @param note the note as rendered
 * @returns every refusal, empty when the note is fit
 */
function noteRefusals({ id, note }: { id: string; note: BriefingQuotedNote }): readonly NoteRefusal[] {
  const refusals: NoteRefusal[] = [];
  const words = wordCount({ text: textOfContent({ content: note.headline }) });
  if (words > SELF_IMPROVEMENT_HEADLINE_MAX_WORDS) {
    refusals.push(
      SelfImprovementSectionErrors.headlineOverBudget({ cap: SELF_IMPROVEMENT_HEADLINE_MAX_WORDS, id, words }),
    );
  }
  // Checked against its own arm first: the section schema's note UNION reports only "Invalid input", which would
  // name neither the finding nor the rule it broke.
  const admitted = quotedNoteSchema.safeParse(note);
  if (!admitted.success) {
    refusals.push(
      SelfImprovementSectionErrors.sectionSchemaRefused({ issues: schemaIssues({ error: admitted.error, id }) }),
    );
  }
  return refusals;
}

/**
 * Render the self-improvement section from the findings a reflect pass surfaced.
 *
 * Refuses, never trims, and in this order: a sixth finding; then EVERY note unfit on its own, a headline over
 * {@link SELF_IMPROVEMENT_HEADLINE_MAX_WORDS} or a note its quoted-lane schema refuses, all named in one
 * refusal; a section over {@link SELF_IMPROVEMENT_ABOVE_FOLD_MAX}; anything
 * the briefing's `sectionSchema` refuses. An empty input is a good pass, not an error — it renders one quiet
 * note.
 *
 * @param findings the surfaced findings, in rank order — `ReflectBrief.surfaced`
 * @param notShown how many ranked findings the cap held back — `ReflectBrief.backlog.length`
 * @returns the section, or the refusal naming what it would have had to drop
 */
export function renderSelfImprovementSection({
  findings,
  notShown,
}: {
  findings: readonly RankedFinding[];
  notShown: number;
}): Result<BriefingSection, SelfImprovementSectionError> {
  if (findings.length > SELF_IMPROVEMENT_MAX_FINDINGS) {
    return err(
      SelfImprovementSectionErrors.tooManyFindings({
        cap: SELF_IMPROVEMENT_MAX_FINDINGS,
        overflowIds: findings.slice(SELF_IMPROVEMENT_MAX_FINDINGS).map((candidate) => candidate.id),
      }),
    );
  }
  const notes = findings.map((candidate): BriefingQuotedNote => ({
    detail: findingFold({ candidate }),
    headline: findingHeadline({ candidate }),
    lane: "quoted",
  }));
  const refusals = notes.flatMap((note, index) => noteRefusals({ id: findings[index]!.id, note }));
  if (refusals.length > 0) return err(SelfImprovementSectionErrors.notesRefused({ refusals }));
  const section: BriefingSection = {
    notes: notes.length === 0 ? [QUIET_NOTE] : notes,
    summary: sectionSummary({ notShown, shown: findings.length }),
  };
  const aboveFold = selfImprovementAboveFoldWords({ section });
  if (aboveFold > SELF_IMPROVEMENT_ABOVE_FOLD_MAX) {
    return err(
      SelfImprovementSectionErrors.aboveFoldOverBudget({
        cap: SELF_IMPROVEMENT_ABOVE_FOLD_MAX,
        headlines: findings.map((candidate) => ({
          id: candidate.id,
          words: wordCount({ text: textOfContent({ content: findingHeadline({ candidate }) }) }),
        })),
        words: aboveFold,
      }),
    );
  }
  const parsed = sectionSchema.safeParse(section);
  if (!parsed.success) {
    return err(
      SelfImprovementSectionErrors.sectionSchemaRefused({
        issues: schemaIssues({ error: parsed.error, id: "section" }),
      }),
    );
  }
  return ok(section);
}
