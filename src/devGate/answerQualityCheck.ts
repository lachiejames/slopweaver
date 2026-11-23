/**
 * The gate's fourth check: does the answer-quality scorer still hold its own ordering properties?
 *
 * ## What it grades, and why it is here rather than anywhere else
 *
 * `src/eval/answerQuality/` grades what an answer SAID — the claims it asserts, the what-it-does-not-prove
 * caveats it carries, the claims it credits to a named source, and the certainty it invents. The three
 * dimensions are right, so the substance scorer gates the eval lane BESIDE the retrieval one.
 * `../devGate/handoffCheck.ts` is that retrieval one — the evidence accounting that replaced the retired recall@12 — so this sits
 * next to it in the same composed gate rather than in the advisory promptfoo lane, which nothing runs.
 *
 * What runs is the SELFTEST, not a grading pass: five ordering properties per case, including the two no
 * token-overlap scorer can pass. A grading pass needs candidate answers, which only exist when somebody is
 * evaluating something; the properties are a claim the instrument makes about ITSELF, and that claim is
 * exactly what a gate is for.
 *
 * ## Two lanes, and a green that never conflates them
 *
 * - **fixture** — `eval/answer-quality.fixture.json`, committed and synthetic. Always runs. This is the
 *   half CI can reproduce.
 * - **private** — `$SLOPWEAVER_HOME/eval/answer-quality-cases.json`, the ten real rubrics, never committed
 *   because their goldens name real people and carry sensitive context. Runs only on a machine holding it.
 *
 * CI's home is a fresh `$RUNNER_TEMP/slopweaver-home` (`.github/workflows/pr-body-gate.yml`), so the private
 * lane is ABSENT there on every run. An absent lane is a fact, never a pass and never a failure — and the
 * summary says so in the same sentence as the pass, because a green that reads identically whether ten real
 * rubrics passed or zero were present is the silent-failure class this repository is built to refuse.
 *
 * ## No string out of a cases file reaches this module's output, and that is a TYPE rather than a habit
 *
 * A `PropertyOutcome`'s `detail` quotes the golden, and so does its `property` on a degradation: `degrade.ts`
 * builds `certainty-invented: "<the phrase, verbatim>"` and `<kind>: <the expectation's label>`, which
 * `selftest.ts` renders into `degrades-down · <that label>`. So both fields carry the thing that must not
 * travel. {@link redactOutcomes} converts every outcome to a {@link RedactedOutcome} at the boundary —
 * the case's POSITION in its file, the property KIND, the state — and {@link answerQualityVerdict} consumes
 * nothing else. Printing a golden fragment from here is a type error rather than something review has to
 * catch.
 *
 * **The case ID is redacted too, and the reason is the whole point of doing this by type.** An id reads as
 * safe metadata, and this module's first draft copied it straight through on the strength of the ten real
 * ones all being `case-NN`. `caseSchema.ts` constrains an id to a non-empty string and nothing else, so a
 * later `case-jane-doe-referral-delay` would have travelled to stdout and the ledger with nothing able to
 * stop it. The r1 review pass on this change found that; a position cannot carry anything.
 *
 * Both lanes are redacted, not just the private one: one shape flowing through means there is no per-lane
 * branch to get wrong. The fixture's full detail is one command away and the failure summary names it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnswerQualityCase } from "../eval/answerQuality/caseSchema.js";
import { loadAnswerQualityCases } from "../eval/answerQuality/caseSchema.js";
import type { PropertyOutcome } from "../eval/answerQuality/selftest.js";
import { runSelftest } from "../eval/answerQuality/selftest.js";
import { stateHomePaths } from "../stateHome.js";

/** The committed synthetic fixture, resolved from this module rather than from `cwd`. */
const FIXTURE_URL = new URL("../../eval/answer-quality.fixture.json", import.meta.url);

/** How the private cases file is NAMED in output — the symbolic form, never a resolved absolute path. */
export const PRIVATE_CASES_LABEL = "$SLOPWEAVER_HOME/eval/answer-quality-cases.json";

/** The committed fixture's path as output names it. */
export const FIXTURE_CASES_LABEL = "eval/answer-quality.fixture.json";

/** The separator `selftest.ts` puts between a property's KIND and the variant label that names a golden. */
const PROPERTY_KIND_SEPARATOR = " · ";

/**
 * One property outcome carrying NO STRING read out of the cases file — the only shape a summary ever sees.
 *
 * There is no `detail`, no full `property` and no case ID, by construction. The first two carry an
 * expectation's label and an invented-certainty phrase verbatim. The third looks innocent and is not: an id
 * is free text the rubric's author chose (`caseSchema.ts` constrains it to a non-empty string and nothing
 * else), so a future `case-jane-doe-referral-delay` would travel straight to stdout and the ledger. The r1
 * review pass on this change found exactly that. A case is named by its 1-based POSITION in its own file
 * instead, which is enough to find it and cannot carry anything.
 *
 * `propertyKind` is the one remaining string, and it is a literal from `selftest.ts` rather than anything
 * read from a file.
 */
export interface RedactedOutcome {
  readonly caseOrdinal: number;
  readonly propertyKind: string;
  readonly state: PropertyOutcome["state"];
}

/**
 * Which rubric file a lane read.
 *
 * @internal — the field type of {@link LaneReport}; nothing outside this file names it.
 */
export type AnswerQualityLane = "fixture" | "private";

/**
 * Whether a lane ran, was not there, or could not be read.
 *
 * @internal — the field type of {@link LaneReport}; nothing outside this file names it.
 */
export type LaneState = "ran" | "absent" | "unreadable";

/** What one lane did — its cases, its redacted outcomes, and a note when it did not run. */
export interface LaneReport {
  readonly lane: AnswerQualityLane;
  readonly state: LaneState;
  readonly label: string;
  readonly caseCount: number;
  readonly outcomes: readonly RedactedOutcome[];
  readonly note: string;
}

/**
 * Strip every string read out of the cases file off a selftest run.
 *
 * `degrades-down · certainty-invented · k1` becomes `degrades-down`; the four properties carrying no
 * separator are unchanged. Each outcome's case id becomes that case's 1-based position in `cases`, so the
 * only text that survives is a literal `selftest.ts` authored.
 *
 * The property name reaching here is already free of the golden's words — `selftest.ts` builds it from a
 * closed kind and a synthetic expectation id — so this split keeps the printable name SHORT rather than
 * removing a leak. The case id is the field this function is still load-bearing for.
 *
 * @param outcomes one selftest run, in case order
 * @param cases the same run's cases, in file order — what a position is counted against
 * @returns the same run, reduced to what may be printed anywhere
 */
export function redactOutcomes({
  outcomes,
  cases,
}: {
  outcomes: readonly PropertyOutcome[];
  cases: readonly AnswerQualityCase[];
}): readonly RedactedOutcome[] {
  const ordinals = new Map(cases.map((answerCase, index) => [answerCase.id, index + 1]));
  return outcomes.map((outcome) => ({
    caseOrdinal: ordinals.get(outcome.caseId)!,
    propertyKind: outcome.property.split(PROPERTY_KIND_SEPARATOR)[0]!,
    state: outcome.state,
  }));
}

/**
 * Render one lane's contribution to the summary line.
 *
 * A lane that did not run says which lane and why, rather than being omitted — an omitted lane reads as a
 * lane that passed.
 *
 * @param report the lane's outcome
 * @returns one clause, to be joined with the other lane's
 */
export function laneClause({ report }: { report: LaneReport }): string {
  if (report.state !== "ran") {
    return `${report.lane} lane NOT RUN — ${report.note}`;
  }
  const failed = report.outcomes.filter((outcome) => outcome.state === "fail");
  const cases = `${String(report.caseCount)} case(s)`;
  const properties = `${String(report.outcomes.length)} propert${report.outcomes.length === 1 ? "y" : "ies"}`;
  if (failed.length === 0) {
    return `${report.lane} ${cases}, ${properties}, all held`;
  }
  const named = failed.map((outcome) => `case #${String(outcome.caseOrdinal)} ${outcome.propertyKind}`).join(", ");
  return `${report.lane} ${cases}, ${properties}, ${String(failed.length)} FAILED: ${named}`;
}

/**
 * Compose both lanes into the check's verdict. Pure — every input is already redacted.
 *
 * An `absent` lane passes and says so; an `unreadable` one fails, because a file that is there and cannot
 * be parsed is a defect rather than a machine that simply does not hold it.
 *
 * @param reports both lanes, fixture first
 * @returns the pass/fail and the one-line summary the gate prints and logs
 */
export function answerQualityVerdict({ reports }: { reports: readonly LaneReport[] }): {
  readonly ok: boolean;
  readonly summary: string;
} {
  const broken = reports.some(
    (report) => report.state === "unreadable" || report.outcomes.some((outcome) => outcome.state === "fail"),
  );
  const clauses = reports.map((report) => laneClause({ report })).join("; ");
  if (!broken) {
    return { ok: true, summary: clauses };
  }
  return {
    ok: false,
    summary: `${clauses} — re-run \`slopweaver dev answer-quality --cases <path> --selftest\` on a machine holding the cases to read why`,
  };
}

/**
 * Run the selftest over one rubric file.
 *
 * @param lane which file this is, which decides what an absent file means
 * @param label how the file is named in output
 * @param raw the file's contents, or undefined when it is not there
 * @param errno the syscall code that stopped a read of a file that IS there
 * @returns the lane's report — never throws, and never carries a string out of the cases file
 */
function laneReport({
  lane,
  label,
  raw,
  errno,
}: {
  lane: AnswerQualityLane;
  label: string;
  raw: string | undefined;
  errno: string | undefined;
}): LaneReport {
  if (errno !== undefined) {
    return {
      caseCount: 0,
      label,
      lane,
      note: `${label} could not be read (${errno})`,
      outcomes: [],
      state: "unreadable",
    };
  }
  if (raw === undefined) {
    // An absent PRIVATE file is the ordinary state of every machine that is not the owner's, CI included.
    // An absent FIXTURE is a broken checkout: that file is committed, so its absence is never a fact about
    // this machine and must not pass.
    if (lane === "private") {
      return { caseCount: 0, label, lane, note: `no cases file at ${label}`, outcomes: [], state: "absent" };
    }
    return { caseCount: 0, label, lane, note: `${label} is committed and missing`, outcomes: [], state: "unreadable" };
  }
  const cases = loadAnswerQualityCases({ label, raw });
  if (cases.isErr()) {
    // The COUNT rather than the messages: a schema error names the case and what it was carrying, and the
    // private file's cases carry sensitive context. The verb prints them in full on the machine that holds it.
    const note = `${String(cases.error.length)} load error(s) in ${label}`;
    return { caseCount: 0, label, lane, note, outcomes: [], state: "unreadable" };
  }
  return {
    caseCount: cases.value.length,
    label,
    lane,
    note: "",
    outcomes: redactOutcomes({ cases: cases.value, outcomes: runSelftest({ cases: cases.value }) }),
    state: "ran",
  };
}

/**
 * Read a cases file, separating "not there" from "there and unreadable".
 *
 * The r1 review pass on this change caught the fold those two used to share: a cases file the machine HOLDS
 * and cannot read reported `private lane NOT RUN` and PASSED, which is the one outcome this check's
 * two-lane shape exists to make impossible. The errno code is the syscall's own (`EACCES`, `EISDIR`) and
 * carries nothing out of the file.
 *
 * @param path the file to read
 * @returns its contents, its absence, or the errno that stopped the read
 */
function readCasesFile({ path }: { path: string }): {
  readonly raw: string | undefined;
  readonly errno: string | undefined;
} {
  try {
    return { errno: undefined, raw: readFileSync(path, "utf8") };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown error";
    if (code === "ENOENT") {
      return { errno: undefined, raw: undefined };
    }
    return { errno: code, raw: undefined };
  }
}

/**
 * Run both lanes and compose the gate's `answer-quality` result. The effectful shell — two file reads.
 *
 * @param home the state home whose `eval/answer-quality-cases.json` holds the real rubrics
 * @returns the pass/fail and one-line summary, both lanes named
 */
export function answerQualityResult({ home }: { home?: string } = {}): {
  readonly ok: boolean;
  readonly summary: string;
} {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  const reports = [
    laneReport({
      label: FIXTURE_CASES_LABEL,
      lane: "fixture",
      ...readCasesFile({ path: fileURLToPath(FIXTURE_URL) }),
    }),
    laneReport({
      label: PRIVATE_CASES_LABEL,
      lane: "private",
      ...readCasesFile({ path: paths.answerQualityCasesJson }),
    }),
  ];
  return answerQualityVerdict({ reports });
}
