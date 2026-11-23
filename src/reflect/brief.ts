/**
 * THE BRIEF — what the miner hands to the already-visible session that will reason about it.
 *
 * This is the `brief` half of the split slopweaver already uses three times over (`store read`/`store collect`,
 * `turn brief`/`answer`, `distil brief`/`answer`): **pure code gathers and ranks; the already-visible
 * session reasons; pure code validates and writes.** No model runs in the CLI, which is AGENTS.md rule 2,
 * and the daily pass runs in a session the owner can watch and interrupt.
 *
 * ## Rule 7 governs this like any other outbound surface
 *
 * Outcome above the fold, evidence and provenance below it, and the cap enforced by the form rather than by
 * review. {@link renderBriefLines} prints one line per surfaced finding and indents its evidence beneath;
 * {@link composeBrief} is what refuses a sixth finding, by construction, because it returns exactly what
 * `rankFindings` admitted.
 *
 * ## Two sections that are mandatory even when they are boring
 *
 * **Could-not-verify** is always printed. "No confirmable friction this window, nothing to propose" is a
 * good pass, not a wasted one, and silence is never evidence of correctness. Every collector's residue
 * lands here — an absent ledger, a line that did not decode, a substrate known to be poisoned.
 *
 * **The grade distribution per source** is always printed, zeros included. A collector whose findings the
 * owner keeps dropping becomes visibly a bad collector and gets turned off rather than argued about; that
 * is the alignment measure, and it is a number rather than a feeling. `slopweaver reflect grade` writes it
 * (`grades.ts`), and a surfaced finding the owner already graded prints that grade and what closed it beneath it.
 *
 * Pure: every input is passed in, including the timestamp. {@link mineSubstrates} is the one function here
 * that touches the filesystem, and only through the injected reader.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { absentAsEmpty, absentAsNumber } from "#lib/absent.js";
import type { Result } from "#lib/result.js";

import type { DoorFrictionEntry } from "../admit/doorLedgerPort.js";
import type { DoorStoreError } from "../admit/doorStoreErrors.js";
import { installedTreeRoot } from "../lib/pluginRoot.js";
import type { CoverageSource } from "../lib/rareTokens.js";
import { sessionLogPath } from "../sessions/sessionStore.js";
import { stateHomePaths } from "../stateHome.js";
import type { ReflectOwnerJudgement } from "./askedForMissingHeuristics.js";
import { collectDevGateFriction, collectPainPointFriction } from "./collect.js";
import { collectDoorHolds, collectFeedbackDrafts } from "./collectArtifacts.js";
import { collectAskedForMissing } from "./collectAskedForMissing.js";
import { collectPrProofFriction } from "./collectPrProof.js";
import { collectReviewClaimClasses } from "./collectReview.js";
import { collectRunJournalFriction } from "./collectRunJournal.js";
import { agreeing, countOf } from "./countPhrase.js";
import {
  crossReference,
  discoverMemoryDirs,
  readBoardCoverage,
  readMemoryCoverage,
  readRegisterCoverage,
} from "./crossRef.js";
import { type FrictionFinding, patternSentence, REFLECT_SOURCES, type ReflectSource } from "./finding.js";
import { gradeDistributionBySource, gradeHistoryLine, type SourceGrades } from "./grades.js";
import {
  PER_SOURCE_CAP,
  prepareCandidates,
  type RankedFinding,
  type RankedSelection,
  rankFindings,
  SURFACE_CAP,
} from "./rank.js";
import { REGISTER_RELATIVE_PATH } from "./registerDoc.js";
import type { SeenRow, SeenState } from "./seen.js";
import { type CollectorReading, createFsReader, type ReflectWindow, type SubstrateReader } from "./substrate.js";

/**
 * Where each substrate lives. Resolved once so a test can point every one of them at a fixture.
 *
 * @internal
 */
export interface ReflectPaths {
  readonly runsDir: string;
  readonly reviewsDir: string;
  readonly devGateLedger: string;
  readonly painPointsLedger: string;
  readonly feedbackDraftsDir: string;
  readonly prsDir: string;
  /** The hand-appended `what`/`error`/`didInstead` incident ledger. See `collectAskedForMissing`'s header. */
  readonly loopBreakageLedger: string;
  /** The supervisor's own session ledger, read for `noted` events that report an asked-for capability missing. */
  readonly sessionLogPath: string;
  /** Tier 2: the board, asked only whether a finding is already covered. Never a source of findings. */
  readonly handoverDir: string;
  /** Tier 2: every memory corpus, asked only whether a finding is already known. */
  readonly memoryDirs: readonly string[];
  /**
   * Tier 2: the committed recurring-failure register, asked only whether a finding was already REFUTED.
   *
   * Always named, never optional — `runningCheckoutRoot` answers the raw `cwd` when the process is not
   * standing in a checkout at all (a marketplace plugin mirror carries no `.git`), and a register path that
   * names no file reads as absent through `readRegisterCoverage`'s own `undefined` arm. The miner then
   * reports one fewer annotation rather than failing, exactly as an unreadable memory corpus does.
   */
  readonly registerPath: string;
}

/**
 * Resolve every substrate path off the state home, plus the one that is not under it.
 *
 * `~/.claude/feedback/drafts` belongs to the Claude Code harness rather than to slopweaver, so it is
 * resolved separately and is overridable for the same reason every other path here is: a test must never
 * read the operator's real drafts.
 *
 * @param home the state home (defaults to the resolved home)
 * @param claudeHome the harness's own home (defaults to `~/.claude`)
 * @returns every path the miner reads
 */
export function reflectPaths({
  home,
  claudeHome,
  reader,
}: {
  home?: string;
  claudeHome?: string;
  reader?: SubstrateReader;
} = {}): ReflectPaths {
  const paths = stateHomePaths(home !== undefined ? { home } : {});
  const harness = claudeHome ?? join(homedir(), ".claude");
  const seam = reader ?? createFsReader();
  return {
    devGateLedger: join(paths.ledgers, "dev-gate.jsonl"),
    feedbackDraftsDir: join(harness, "feedback", "drafts"),
    handoverDir: paths.handovers,
    loopBreakageLedger: join(paths.ledgers, "loop-breakage.jsonl"),
    memoryDirs: discoverMemoryDirs({ projectsDir: join(harness, "projects"), reader: seam }),
    painPointsLedger: join(paths.ledgers, "pain-points.jsonl"),
    prsDir: join(paths.ledgers, "github-prs"),
    registerPath: join(installedTreeRoot({ importMetaUrl: import.meta.url }), REGISTER_RELATIVE_PATH),
    reviewsDir: join(paths.root, "live", "slack", "reviews"),
    runsDir: paths.runs,
    sessionLogPath: sessionLogPath(home !== undefined ? { home } : {}),
  };
}

/**
 * Run every Tier 1 collector over the window.
 *
 * Order is {@link REFLECT_SOURCES} order, which is the order a brief prints them, so a reader comparing two
 * runs is comparing the same list. A collector that throws is a defect rather than a residue line — every
 * one of them is written to return an empty reading for an absent substrate instead.
 *
 * @param paths where each file substrate lives
 * @param ownerJudgement the owner's active directives, read from the store by the verb, or why they could not be
 * @param reader the filesystem seam
 * @param window the run's bounds
 * @param doorFriction the door's holds and overrides in the window, read from the store by the caller
 * @returns one reading per source
 */
export function mineSubstrates({
  paths,
  ownerJudgement,
  reader,
  window,
  doorFriction,
}: {
  paths: ReflectPaths;
  ownerJudgement: ReflectOwnerJudgement;
  reader: SubstrateReader;
  window: ReflectWindow;
  doorFriction: Result<readonly DoorFrictionEntry[], DoorStoreError>;
}): readonly CollectorReading[] {
  return [
    collectRunJournalFriction({ reader, runsDir: paths.runsDir, window }),
    collectReviewClaimClasses({ reader, reviewsDir: paths.reviewsDir, window }),
    collectDevGateFriction({ ledgerPath: paths.devGateLedger, reader, window }),
    collectPainPointFriction({ ledgerPath: paths.painPointsLedger, reader, window }),
    collectFeedbackDrafts({ draftsDir: paths.feedbackDraftsDir, reader, window }),
    collectPrProofFriction({ prsDir: paths.prsDir, reader, window }),
    collectDoorHolds({ friction: doorFriction, window }),
    collectAskedForMissing({
      feedbackDraftsDir: paths.feedbackDraftsDir,
      loopBreakageLedger: paths.loopBreakageLedger,
      ownerJudgement,
      reader,
      runsDir: paths.runsDir,
      sessionLogPath: paths.sessionLogPath,
      window,
    }),
  ];
}

/**
 * Read the Tier 2 sources: the board, and every memory corpus.
 *
 * Separate from {@link mineSubstrates} because these are not substrates. Neither can produce a finding; they
 * only move one already found. Keeping them in a different function is what stops a later change from
 * quietly making the board a source, which `docs/workstreams.md` and the board's own hygiene gate both
 * depend on not happening.
 *
 * @param paths where the board and the memory corpora live
 * @param reader the filesystem seam
 * @returns the coverage and knowledge sources, ready for `crossReference`
 */
export function readCoverage({ paths, reader }: { paths: ReflectPaths; reader: SubstrateReader }): {
  readonly board: readonly CoverageSource[];
  readonly memory: readonly CoverageSource[];
  readonly refuted: readonly CoverageSource[];
} {
  return {
    board: readBoardCoverage({ handoverDir: paths.handoverDir, reader }),
    memory: paths.memoryDirs.flatMap((memoryDir) => readMemoryCoverage({ memoryDir, reader })),
    refuted: readRegisterCoverage({ registerPath: paths.registerPath, reader }),
  };
}

/**
 * How many backlog entries a brief prints. The rest stay in the ledger, ranked, for the next run.
 *
 * @internal
 */
export const BACKLOG_PREVIEW = 5;

/**
 * One run's whole output: what to show, what to record, and what could not be established.
 *
 * @internal
 */
export interface ReflectBrief {
  readonly window: ReflectWindow;
  readonly tsIso: string;
  /** At most {@link SURFACE_CAP}, in rank order. */
  readonly surfaced: readonly RankedFinding[];
  /** The ranked remainder, so the next run prefers its top over inventing anew. */
  readonly backlog: readonly RankedFinding[];
  /** How many candidates a terminal `drop` removed before ranking. */
  readonly suppressed: number;
  /** How many backlog candidates were held because they state no measured consequence (`RankedSelection`). */
  readonly heldUnmeasured: number;
  /** Every collector's residue, plus what the cap itself held back. Never empty. */
  readonly couldNotVerify: readonly string[];
  /** The alignment measure, per source, zeros included. */
  readonly grades: readonly SourceGrades[];
  /** One row per source, for the heartbeat and for the brief's own provenance line. */
  readonly sources: readonly { readonly source: ReflectSource; readonly findings: number; readonly rowsRead: number }[];
  /** The rows to append to the seen ledger — one sighting per candidate, surfaced or backlogged. */
  readonly seenRows: readonly SeenRow[];
}

/**
 * The mandatory could-not-verify section: what nothing established, plus what the cap itself held back.
 *
 * Never empty. A run that surfaced nothing says so in its own words, because "no confirmable friction this
 * window, nothing to propose" is a good pass and silence is never evidence of correctness.
 *
 * @param readings what the collectors returned, each carrying its own residue
 * @param selection what ranking decided, so a source held back by its share is named
 * @returns the lines, in order
 */
function couldNotVerify({
  readings,
  selection,
}: {
  readings: readonly CollectorReading[];
  selection: RankedSelection;
}): readonly string[] {
  // A pass whose candidates were all held is not quiet: it found friction and could not measure its cost.
  const quiet = selection.surfaced.length === 0 && selection.backlog.length === 0;
  return [
    ...(quiet ? ["no confirmable friction this window, nothing to propose — a good pass, not a wasted one"] : []),
    ...(selection.heldUnmeasured > 0
      ? [
          `${countOf({ count: selection.heldUnmeasured, many: "candidate findings", one: "candidate finding" })} could not state a measured cost to you or the fleet, so ${agreeing({ count: selection.heldUnmeasured, many: "they were", one: "it was" })} held in the backlog rather than put in front of you to grade`,
        ]
      : []),
    ...readings.flatMap((reading) => reading.residue),
    ...selection.heldBySource.map(
      (row) =>
        `${row.source} had ${countOf({ count: row.held, many: "more findings", one: "more finding" })} than its share of the cap allows, so ${agreeing({ count: row.held, many: "they are", one: "it is" })} in the backlog rather than dropped`,
    ),
  ];
}

/**
 * The ledger row for one ranked finding. Pure — the timestamp is passed in, never read from a clock.
 *
 * Module-level rather than a closure inside `composeBrief` so that function stays under the size cap and so
 * this shape is testable on its own.
 *
 * @param candidate the ranked finding the row is about
 * @param disposition whether it reached the owner's five or stayed in the backlog
 * @param tsIso when the row was written
 * @returns the row to append to the seen ledger
 */
function seenRowFor({
  candidate,
  disposition,
  tsIso,
}: {
  candidate: RankedFinding;
  disposition: SeenRow["disposition"];
  tsIso: string;
}): SeenRow {
  return {
    classKey: candidate.finding.classKey,
    disposition,
    id: candidate.id,
    locus: candidate.finding.locus,
    occurrences: candidate.finding.occurrences,
    source: candidate.finding.source,
    tsIso,
  };
}

/**
 * Turn readings and remembered state into one run's brief.
 *
 * Pure: `tsIso` is injected rather than read from a clock, so two runs over the same fixtures produce
 * byte-identical output and a brief is replayable.
 *
 * @param readings what the collectors returned
 * @param states the folded seen-ledger
 * @param window the run's bounds
 * @param tsIso the instant to stamp every recorded sighting with
 * @param coverage the Tier 2 board and memory sources; absent means the cross-reference was not run
 * @param cap the most findings that may reach the owner
 * @param perSourceCap the most any one collector may contribute
 * @returns the brief, including the ledger rows the run should append
 */
export function composeBrief({
  readings,
  states,
  window,
  tsIso,
  coverage,
  cap = SURFACE_CAP,
  perSourceCap = PER_SOURCE_CAP,
}: {
  readings: readonly CollectorReading[];
  states: ReadonlyMap<string, SeenState>;
  window: ReflectWindow;
  tsIso: string;
  coverage?: {
    readonly board: readonly CoverageSource[];
    readonly memory: readonly CoverageSource[];
    readonly refuted?: readonly CoverageSource[];
  };
  cap?: number;
  perSourceCap?: number;
}): ReflectBrief {
  const findings = crossReference({
    board: absentAsEmpty({ value: coverage?.board }),
    findings: readings.flatMap((reading) => reading.findings),
    memory: absentAsEmpty({ value: coverage?.memory }),
    refuted: absentAsEmpty({ value: coverage?.refuted }),
  });
  const candidates = prepareCandidates({ findings, states, tsIso });
  const selection = rankFindings({ candidates, cap, perSourceCap });
  return {
    backlog: selection.backlog,
    couldNotVerify: couldNotVerify({ readings, selection }),
    grades: gradeDistributionBySource({ states }),
    heldUnmeasured: selection.heldUnmeasured,
    seenRows: [
      ...selection.surfaced.map((candidate) => seenRowFor({ candidate, disposition: "surfaced", tsIso })),
      ...selection.backlog.map((candidate) => seenRowFor({ candidate, disposition: "backlogged", tsIso })),
    ],
    sources: REFLECT_SOURCES.map((source) => {
      const reading = readings.find((one) => one.source === source);
      return {
        findings: absentAsNumber({ value: reading?.findings.length, whenAbsent: 0 }),
        rowsRead: absentAsNumber({ value: reading?.rowsRead, whenAbsent: 0 }),
        source,
      };
    }),
    suppressed: findings.length - candidates.length,
    surfaced: selection.surfaced,
    tsIso,
    window,
  };
}

/**
 * How many cross-reference names a brief prints before it says "and N more". Rule 7: never a wall.
 *
 * @internal
 */
export const CROSS_REF_NAMES = 3;

/** A bounded, comma-joined name list. An unbounded one is a wall, and a wall is a message nobody reads. */
function nameList({ names }: { names: readonly string[] }): string {
  const shown = names.slice(0, CROSS_REF_NAMES).join(", ");
  return names.length <= CROSS_REF_NAMES ? shown : `${shown} and ${String(names.length - CROSS_REF_NAMES)} more`;
}

/** The grade distribution as one line, per the design's "handover-amend: 6 keep, 1 drop" shape. */
function gradeLine({ grades }: { grades: readonly SourceGrades[] }): string {
  return grades
    .map((row) => `${row.source}: ${String(row.keep)} keep, ${String(row.adjust)} adjust, ${String(row.drop)} drop`)
    .join("; ");
}

/**
 * The Tier 2 annotations for one finding: what already covers it, what already refuted it, and what already
 * knows it. Pure, and extracted from {@link renderBriefLines} so all three read as one list rather than as
 * three branches in the middle of a loop.
 *
 * Order is deliberate — covered, refuted, known — so the two DEMOTIONS sit together and the single PROMOTION
 * reads last, which is the order the impact arithmetic applies them in.
 *
 * @param finding the finding to annotate
 * @returns zero to three indented lines, in that fixed order
 */
function crossRefLines({ finding }: { finding: FrictionFinding }): readonly string[] {
  const annotations: string[] = [];
  if (finding.coveredBy.length > 0) {
    annotations.push(`     already on the board: ${nameList({ names: finding.coveredBy })} (impact demoted)`);
  }
  if (finding.refutedBy.length > 0) {
    annotations.push(
      `     the register already REFUTED this — read the reason before re-proposing: ${nameList({ names: finding.refutedBy })} (impact demoted)`,
    );
  }
  if (finding.knownBy.length > 0) {
    annotations.push(
      `     a memory already says this and it happened anyway: ${nameList({ names: finding.knownBy })} (impact promoted)`,
    );
  }
  return annotations;
}

/**
 * Render a brief as terminal lines: outcome above the fold, evidence indented beneath it.
 *
 * @param brief the run's brief
 * @returns the lines to print, in order
 */
export function renderBriefLines({ brief }: { brief: ReflectBrief }): readonly string[] {
  const lines = [
    `reflect brief: ${String(brief.surfaced.length)} surfaced of ${countOf({ count: brief.surfaced.length + brief.backlog.length, many: "candidates", one: "candidate" })}, ${String(brief.backlog.length)} in the backlog`,
    `  window: ${brief.window.fromIso} .. ${brief.window.toIso}`,
    `  grades: ${gradeLine({ grades: brief.grades })}`,
    `  read:   ${brief.sources.map((source) => `${source.source} ${String(source.rowsRead)}`).join(", ")}`,
  ];
  for (const [index, candidate] of brief.surfaced.entries()) {
    lines.push(
      // Only a finding with a consequence surfaces (`rankFindings`), so this is an invariant, not a fallback.
      `${String(index + 1)}. [${candidate.id}] ${candidate.finding.consequence!}`,
      `     ${patternSentence({ daysSeen: candidate.daysSeen, occurrences: candidate.finding.occurrences })}`,
      `     what happened: ${candidate.finding.summary}`,
      `     fleet ordering, not a grade: ${candidate.score.toFixed(2)} = impact ${String(candidate.finding.impact)} (${String(candidate.baseImpact)} before recurrence) x safety ${String(candidate.finding.safety)} / cost ${String(candidate.finding.cost)}; ${String(candidate.finding.occurrences)} this window, seen on ${countOf({ count: candidate.daysSeen, many: "days", one: "day" })}, surfaced ${countOf({ count: candidate.priorSurfacings, many: "times", one: "time" })} before`,
      `     where: ${candidate.finding.locus} (${candidate.finding.source})`,
    );
    const history = gradeHistoryLine({
      closedAtIso: candidate.closedAtIso,
      closedBy: candidate.closedBy,
      grade: candidate.grade,
      lastSightingIso: brief.tsIso,
    });
    if (history !== undefined) {
      lines.push(history);
    }
    lines.push(...crossRefLines({ finding: candidate.finding }));
    for (const line of candidate.finding.evidence) {
      lines.push(`       - ${line}`);
    }
  }
  lines.push("  COULD NOT VERIFY:");
  for (const line of brief.couldNotVerify) {
    lines.push(`    - ${line}`);
  }
  if (brief.backlog.length > 0) {
    lines.push(
      `  BACKLOG (top ${String(Math.min(BACKLOG_PREVIEW, brief.backlog.length))} of ${String(brief.backlog.length)}):`,
    );
    for (const candidate of brief.backlog.slice(0, BACKLOG_PREVIEW)) {
      lines.push(`    - [${candidate.id}] ${candidate.finding.summary}`);
    }
  }
  return lines;
}
