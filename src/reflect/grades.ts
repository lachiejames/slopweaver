/**
 * The self-improvement loop's WRITER for its own grades, and the alignment measure read back from them.
 *
 * Measured on one machine's own ledger: `ledgers/reflect/seen.jsonl` held 2,158 rows — 1,999
 * backlogged, 159 surfaced, and zero keep, adjust or drop — while `reflect brief` printed findings "surfaced
 * 16 times before". The fold already made a drop terminal and the brief already printed a per-source grade
 * line; nothing wrote a grade. Repro:
 *
 * ```bash
 * jq -r .disposition "$SLOPWEAVER_HOME/ledgers/reflect/seen.jsonl" | sort | uniq -c
 * ```
 *
 * A grade is ONE word against a finding id, with an optional why and an optional `closedBy`. Three things
 * this file refuses to become, each from board row self-improve-6-grades:
 *
 * - **a required justification** — one word is the feature, and a mandatory reason stops grades arriving;
 * - **one averaged score** — {@link gradeDistributionBySource} stays per source, because a single number hides
 *   which collector is the bad one;
 * - **an edit to the finding** — a grade is about the loop's judgement, so it never touches the underlying
 *   work, and a `drop` never quietly closes a real problem.
 */
import { err, ok, type Result } from "../lib/result.js";
import { REFLECT_SOURCES, type ReflectSource } from "./finding.js";
import {
  foldSeenLedger,
  parseSeenRows,
  readSeenText,
  recordSeen,
  type SeenGrade,
  type SeenRow,
  type SeenState,
} from "./seen.js";

/** One source's grade tally. */
export interface SourceGrades {
  readonly source: ReflectSource;
  readonly keep: number;
  readonly adjust: number;
  readonly drop: number;
}

/**
 * Tally the owner's grades per source — the alignment measure, printed at the top of every brief.
 *
 * Counts findings rather than rows: a finding graded twice counts once, under its latest grade. A collector
 * whose findings the owner keeps dropping becomes visibly a bad collector and gets turned off rather than argued
 * about, which is the whole reason this is a number and not a feeling.
 *
 * @param states the folded ledger
 * @returns one row per source, in {@link REFLECT_SOURCES} order, zeros included
 */
export function gradeDistributionBySource({
  states,
}: {
  states: ReadonlyMap<string, SeenState>;
}): readonly SourceGrades[] {
  return REFLECT_SOURCES.map((source) => {
    const graded = [...states.values()].filter((state) => state.source === source);
    return {
      adjust: graded.filter((state) => state.grade === "adjust").length,
      drop: graded.filter((state) => state.grade === "drop").length,
      keep: graded.filter((state) => state.grade === "keep").length,
      source,
    };
  });
}

/** What one grade is, before it is written. */
export interface GradeInput {
  /** The finding's id, exactly as `reflect brief` prints it. */
  readonly id: string;
  readonly grade: SeenGrade;
  /** The owner's reason, when they gave one. */
  readonly why?: string;
  /** What closed the underlying problem, when something did. */
  readonly closedBy?: string;
  /** When the grade is written. Injected, never read from a clock in here. */
  readonly tsIso: string;
}

/** A planned grade: the row to append, and what the fold will still say once it lands. */
export interface GradePlan {
  readonly row: SeenRow;
  /**
   * The finding was dropped before this grade. A drop is terminal, so a `keep` or `adjust` is recorded as
   * the owner's latest word and still does not revive it — the verb says so rather than implying it did.
   */
  readonly stillDropped: boolean;
  /** How many times the miner had surfaced it before this grade — the count the grade finally answers. */
  readonly priorSurfacings: number;
}

/**
 * Plan one grade against the folded ledger. Pure.
 *
 * The row copies `source`, `classKey` and `locus` from the fold, so a grade names the same finding the brief
 * printed without the caller restating it, and `occurrences` is zero because a grade is not a sighting.
 *
 * @param states the folded seen ledger
 * @param input the grade to plan
 * @returns the plan, or why no finding by that id exists to grade
 */
export function planGrade({
  states,
  input,
}: {
  states: ReadonlyMap<string, SeenState>;
  input: GradeInput;
}): Result<GradePlan> {
  const state = states.get(input.id);
  if (state === undefined) {
    return err([
      `reflect grade: no finding ${input.id} in the seen ledger — take the id from \`slopweaver reflect brief\`, which prints each one in [brackets]`,
    ]);
  }
  return ok({
    priorSurfacings: state.surfacedCount,
    row: {
      classKey: state.classKey,
      disposition: input.grade,
      id: state.id,
      locus: state.locus,
      occurrences: 0,
      source: state.source,
      tsIso: input.tsIso,
      ...(input.why !== undefined ? { why: input.why } : {}),
      ...(input.closedBy !== undefined ? { closedBy: input.closedBy } : {}),
    },
    stillDropped: state.dropped && input.grade !== "drop",
  });
}

/**
 * Record one grade: read the seen ledger, fold it, plan the row, append it. The effectful edge over
 * {@link planGrade}, and the one writer of a grade anywhere in this tree.
 *
 * @param input the grade to record
 * @param home the state home (defaults to the resolved home)
 * @returns the plan that was written, or every reason nothing was
 */
export function recordGrade({ input, home }: { input: GradeInput; home?: string }): Result<GradePlan> {
  const scope = home !== undefined ? { home } : {};
  const states = foldSeenLedger({ rows: parseSeenRows({ text: readSeenText(scope) }) });
  const plan = planGrade({ input, states });
  if (plan.isErr()) {
    return err(plan.error);
  }
  const written = recordSeen({ ...scope, rows: [plan.value.row] });
  return written.isErr() ? err(written.error) : ok(plan.value);
}

/**
 * The line a brief prints under a candidate that already carries the owner's word, so the next run reads its own
 * history instead of re-measuring it. Pure.
 *
 * A candidate that was closed and then found again says `SEEN AGAIN since`, because a sighting after the
 * closing grade is a regression, not a repeat.
 *
 * @param grade the finding's latest grade
 * @param closedBy what the closing grade named
 * @param closedAtIso when that closing grade was written
 * @param lastSightingIso the instant of this run's own sighting
 * @returns the indented line, or `undefined` when the finding has never been graded
 */
export function gradeHistoryLine({
  grade,
  closedBy,
  closedAtIso,
  lastSightingIso,
}: {
  grade: SeenGrade | undefined;
  closedBy: string | undefined;
  closedAtIso: string | undefined;
  lastSightingIso: string;
}): string | undefined {
  if (grade === undefined && closedBy === undefined) {
    return undefined;
  }
  const graded = grade === undefined ? "not graded" : `graded ${grade}`;
  if (closedBy === undefined || closedAtIso === undefined) {
    return `     history: ${graded}`;
  }
  const regressed = lastSightingIso > closedAtIso ? " — SEEN AGAIN since, read it as a regression" : "";
  return `     history: ${graded}; closed by ${closedBy} at ${closedAtIso}${regressed}`;
}
