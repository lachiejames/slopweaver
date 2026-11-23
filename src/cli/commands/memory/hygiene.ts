/**
 * `slopweaver memory hygiene` and `memory grade` — the standing review of the auto-memory corpus and the
 * knowledge rows that PROPOSES and never deletes, and the one verb that records the owner's answer.
 *
 * The review is a standing pass that keeps on top of pruning, deduping, consolidating and removing stale memories,
 * checked against the current codebase. The worry that this is overkill
 * is answered by the SHAPE: there is no write path to a memory file anywhere in `src/memory/hygiene/`, which is
 * a stronger guarantee than a flag defaulting to off, because there is no code to enable.
 *
 * Everything that judges lives in `src/memory/hygiene`, and everything it reads is gathered by `./hygieneInputs.ts`.
 * This module resolves flags, writes the report and the ledger rows, and picks an exit code.
 *
 * ## `--repo` is required for the same reason `--dir` is
 *
 * Auto-memory is keyed to the repository, and CHECK 4 resolves every path, flag and verb a memory names against
 * a TREE. A scheduled run fires from whatever directory the recipe was in, so a derived or relative root would
 * have it measure referents against the wrong checkout and report a clean pass. There is no default.
 *
 * ## The two non-zero codes that are not faults, and why they are different
 *
 * `EXIT_DEFERRED` (4) is the corpus having changed inside the quiet period. Worktrees share one memory
 * directory, so another session can be mid-save; judging then would propose dropping a memory somebody is
 * writing. `automation run-due` and `automation claim` leave a 4 UNSTAMPED, so the row is still due at its next firing
 * — which is exactly right, because this run did nothing.
 *
 * `EXIT_EXPECTED_EMPTY` (3) is a corpus with nothing to propose. The run DID its work and there was none.
 *
 * **A truncating `MEMORY.md` is neither.** The doc asks this check to "refuse quietly rather than warn", and
 * what that rules out is a `logger.warn` nobody reads — so it is the card's FIRST item, ranked red by
 * `hygiene/compose.ts`, with the exact line the loader stops at and every memory below it named. It is not an
 * exit code: the pass reads leaf files off disk rather than through the loader, so a cut index costs a SESSION
 * its memories and costs this run nothing, and a 4 here would tell the scheduler the verb did nothing on a run
 * that wrote a full report.
 */

import { join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { renderHygieneReport } from "../../../memory/hygiene/compose.js";
import {
  foldHygieneLedger,
  HYGIENE_ANSWERS,
  type HygieneAnswer,
  type HygieneRow,
  readHygieneLedgerRows,
  recordHygieneRows,
} from "../../../memory/hygiene/ledger.js";
import { buildHygieneReport } from "../../../memory/hygiene/report.js";
import type { MemoryHygieneReport } from "../../../memory/hygiene/types.js";
import { millisSinceLastChange } from "../../../memory/store.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { QUIET_PERIOD_MS, requiredAbsolutePath, requiredDir, VERB_ARG_OFFSET } from "./args.js";
import { type MemoryVerbError, MemoryVerbErrors } from "./errors.js";
import { gatherHygieneInputs, type KnowledgeReader, readKnowledgeFromStore } from "./hygieneInputs.js";

const HYGIENE_USAGE =
  "usage: slopweaver memory hygiene --dir <path> --repo <path> [--also-repo <path>] [--json] [--now <iso>] [--home <path>]";
const GRADE_USAGE = "usage: slopweaver memory grade <id> <accepted|refused> --why <text> [--home <path>]";

/** The flags `memory hygiene` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const HYGIENE_FLAGS = {
  boolean: ["json"],
  string: ["also-repo", "dir", "home", "now", "repo"],
} as const satisfies FlagSpec;

/** The flags `memory grade` accepts. */
const GRADE_FLAGS = { boolean: [], string: ["home", "why"] } as const satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_HYGIENE_FLAG_NAMES: readonly string[] = [...HYGIENE_FLAGS.string, ...HYGIENE_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed, for the help-truth ratchet. */
export const MEMORY_GRADE_FLAG_NAMES: readonly string[] = [...GRADE_FLAGS.string, ...GRADE_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `memory hygiene` flags. Exported so the ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, asserted against by the help-truth ratchet
 */
export function parseMemoryHygieneArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: HYGIENE_FLAGS });
}

/**
 * Parse `memory grade` flags. Exported so the ratchet probes the real parser.
 *
 * Positionals are ALLOWED because the id and the answer word are positional — `parseFlags` defaults to
 * refusing them, and with that default every `memory grade <id> accepted` in the world failed as
 * `unexpected argument: <id>` before `gradeAnswer` ever read one.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, asserted against by the help-truth ratchet
 */
export function parseMemoryGradeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: GRADE_FLAGS });
}

/** Everything `hygiene` needs off its argv. */
interface HygieneSettings {
  readonly dir: string;
  /** `--repo` first, then `--also-repo` when given: a referent ANY of them holds resolves. */
  readonly repos: readonly string[];
  readonly json: boolean;
  readonly nowIso: string;
  readonly home: string | undefined;
}

/** `--also-repo`, when given: absolute like `--repo`, and absent by design otherwise. */
function alsoRepo({ parsed }: { parsed: ParsedFlags }): Result<readonly string[], MemoryVerbError> {
  if (parsed.values["also-repo"] === undefined) {
    return ok([]);
  }
  return requiredAbsolutePath({ key: "also-repo", parsed }).map((path) => [path]);
}

/**
 * Resolve every `hygiene` setting, or EVERY rejection — so a caller who got two flags wrong is told about both.
 *
 * `--now` defaults to the wall clock here and is injected everywhere below it, so every pure function in
 * `src/memory/hygiene` stays clock-free and a replay can pin the instant.
 */
function hygieneSettings({ parsed }: { parsed: ParsedFlags }): Result<HygieneSettings> {
  const dir = requiredDir({ parsed });
  const repo = requiredAbsolutePath({ key: "repo", parsed, why: "the tree every referent is resolved against" });
  const also = alsoRepo({ parsed });
  if (dir.isErr() || repo.isErr() || also.isErr()) {
    const problems = [dir, repo, also].flatMap((resolved) => (resolved.isErr() ? [resolved.error.message] : []));
    return err(problems);
  }
  const now = parsed.values["now"];
  const home = parsed.values["home"];
  return ok({
    dir: dir.value,
    home: typeof home === "string" ? home : undefined,
    json: parsed.values["json"] === true,
    nowIso: typeof now === "string" ? now : new Date().toISOString(),
    repos: [repo.value, ...also.value],
  });
}

/** Whether the corpus is settled enough to judge, or the typed reason it is not. */
function corpusSettled({ dir, nowMs }: { dir: string; nowMs: number }): Result<null, MemoryVerbError> {
  const age = millisSinceLastChange({ dir, now: nowMs });
  // An unreadable directory, or one with no timestamp to read, is not evidence of a concurrent write. Deferring
  // on the absence of a measurement would make a scheduled pass silently never run at all.
  if (age.isErr() || age.value === null) {
    return ok(null);
  }
  const millisSinceChange = age.value;
  if (millisSinceChange < QUIET_PERIOD_MS) {
    return err(MemoryVerbErrors.corpusTooFresh({ millisSinceChange, quietPeriodMs: QUIET_PERIOD_MS }));
  }
  return ok(null);
}

/** Where this run's evidence goes: `$home/morning/memory-hygiene-YYYY-MM-DD.md`. */
function reportPath({ home, nowIso }: { home: string | undefined; nowIso: string }): string {
  const day = nowIso.slice(0, "YYYY-MM-DD".length);
  return join(stateHomePaths(home === undefined ? {} : { home }).morning, `memory-hygiene-${day}.md`);
}

/** Write the run's evidence, or say why it could not be written. */
function writeReport({ report, home }: { report: MemoryHygieneReport; home: string | undefined }): Result<string> {
  const path = reportPath({ home, nowIso: report.nowIso });
  const written = safeFs({
    execute: (): string => {
      writeFileAtomic({ contents: renderHygieneReport({ report }), path });
      return path;
    },
    operation: "write the memory hygiene report",
    path,
  });
  return written.isOk() ? ok(written.value) : err([written.error.message]);
}

/**
 * Run `memory hygiene`.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns 0 with proposals, 3 with nothing to propose, 4 when the corpus is mid-save, 2 on a bad flag, 1 on an I/O fault or an unread memories table
 */
export async function runMemoryHygiene(argv: readonly string[]): Promise<number> {
  return runMemoryHygieneWith({ argv, readKnowledge: readKnowledgeFromStore });
}

/**
 * Run `memory hygiene` with the knowledge reader injected.
 *
 * An unread memories table is judged AROUND rather than stopped on: the auto-memory half is still true, so
 * the report and the ledger rows are written, the report's residue opens with why the rows were not read —
 * and the run then exits `1`. A `0` or `3` would have the scheduler stamp the week as covered with the
 * knowledge half never judged; a `1` is a `failed` slot with its detail recorded and a retry floor
 * (`live/automation/slotAttempt.ts`). Not `4`: nothing is in progress.
 *
 * @param argv the full process argv
 * @param readKnowledge how the memories table is read; a plain fake in the unit lane
 * @returns the exit code {@link runMemoryHygiene} documents
 */
export async function runMemoryHygieneWith({
  argv,
  readKnowledge,
}: {
  argv: readonly string[];
  readKnowledge: KnowledgeReader;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HYGIENE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMemoryHygieneArgs({ rest });
  const settings = parsed.isOk() ? hygieneSettings({ parsed: parsed.value }) : err(parsed.error);
  if (settings.isErr()) {
    settings.error.forEach((problem) => {
      logger.error({ msg: `memory hygiene: ${problem}` });
    });
    logger.error({ msg: HYGIENE_USAGE });
    return EXIT_USAGE;
  }
  const { dir, repos, json, nowIso, home } = settings.value;
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(nowMs)) {
    logger.error({ msg: `memory hygiene: --now must be an ISO instant, got \`${nowIso}\`` });
    logger.error({ msg: HYGIENE_USAGE });
    return EXIT_USAGE;
  }
  const settled = corpusSettled({ dir, nowMs });
  if (settled.isErr()) {
    logger.error({ msg: `memory hygiene: ${settled.error.message}` });
    return EXIT_DEFERRED;
  }
  const knowledge = await readKnowledge({ home });
  const gathered = await gatherHygieneInputs({ dir, home, knowledge, nowIso, nowMs, repos });
  if (gathered.isErr()) {
    reportProblems({ problems: gathered.error });
    return EXIT_ERROR;
  }
  const run = buildHygieneReport({ inputs: gathered.value });
  const written = writeReport({ home, report: run.report });
  if (written.isErr()) {
    reportProblems({ problems: written.error });
    return EXIT_ERROR;
  }
  const recorded = recordProposals({ home, report: run.report });
  if (recorded.isErr()) {
    reportProblems({ problems: recorded.error });
    return EXIT_ERROR;
  }
  emitHygieneRun({ json, report: run.report });
  logger.error({ msg: `memory hygiene: evidence written to ${written.value}` });
  if (knowledge.isErr()) {
    logger.error({ msg: `memory hygiene: the knowledge rows were NOT read — ${knowledge.error}` });
    return EXIT_ERROR;
  }
  return run.report.proposals.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** Print every problem under the verb's own name, which three failure paths each want. */
function reportProblems({ problems }: { problems: readonly string[] }): void {
  problems.forEach((problem) => {
    logger.error({ msg: `memory hygiene: ${problem}` });
  });
}

/**
 * Append one `proposed` row per proposal, so recurrence advances and a refusal stays terminal.
 *
 * @param report the run, whose `nowIso` stamps every row rather than a second clock read
 * @returns how many rows were appended, or why nothing was
 */
function recordProposals({ home, report }: { home: string | undefined; report: MemoryHygieneReport }): Result<number> {
  const rows: readonly HygieneRow[] = report.proposals.map((proposal) => ({
    check: proposal.check,
    disposition: "proposed",
    id: proposal.id,
    recommendation: proposal.recommendation,
    subject: proposal.subject,
    tsIso: report.nowIso,
  }));
  return recordHygieneRows(home === undefined ? { rows } : { home, rows });
}

/** Write the run to stdout, as the `--json` document or as the same markdown the morning report holds. */
function emitHygieneRun({ json, report }: { json: boolean; report: MemoryHygieneReport }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "memory hygiene report", value: report }) });
    return;
  }
  renderHygieneReport({ report })
    .split("\n")
    .forEach((line) => {
      logger.out({ line });
    });
}

/**
 * Run `memory grade`.
 *
 * @param argv the full process argv (verb tail starts at {@link VERB_ARG_OFFSET})
 * @returns 0 when the answer was recorded, 2 on a bad argument, 1 when the ledger could not be written
 */
export function runMemoryGrade(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: GRADE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseMemoryGradeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: `memory grade: ${problem}` });
    });
    logger.error({ msg: GRADE_USAGE });
    return EXIT_USAGE;
  }
  const answer = gradeAnswer({ parsed: parsed.value });
  if (answer.isErr()) {
    logger.error({ msg: `memory grade: ${answer.error.message}` });
    logger.error({ msg: GRADE_USAGE });
    return EXIT_USAGE;
  }
  const home = parsed.value.values["home"];
  const homeArgs = typeof home === "string" ? { home } : {};
  const states = foldHygieneLedger({ rows: readHygieneLedgerRows(homeArgs) });
  const state = states.get(answer.value.id);
  if (state === undefined) {
    logger.error({ msg: `memory grade: ${MemoryVerbErrors.proposalNotFound({ id: answer.value.id }).message}` });
    return EXIT_USAGE;
  }
  const row: HygieneRow = {
    check: state.check,
    disposition: answer.value.answer,
    id: state.id,
    recommendation: state.recommendation,
    subject: state.subject,
    tsIso: new Date().toISOString(),
    why: answer.value.why,
  };
  const recorded = recordHygieneRows({ ...homeArgs, rows: [row] });
  if (recorded.isErr()) {
    recorded.error.forEach((problem) => {
      logger.error({ msg: `memory grade: ${problem}` });
    });
    return EXIT_ERROR;
  }
  logger.out({ line: `${state.id} ${answer.value.answer} — ${state.subject}` });
  return EXIT_OK;
}

/**
 * The id, the answer word and the reason, read off one argv.
 *
 * `--why` is REQUIRED rather than optional, which is the one judgement in this function. An `accepted` row's
 * why is what the owner wants done — the card asks for it in both of its example commands — and a `refused` row's is
 * the only record of why a memory stands, on a disposition that is terminal and never proposed again. A row
 * carrying neither is a vote with no content, and the next run cannot act on it.
 */
function gradeAnswer({
  parsed,
}: {
  parsed: ParsedFlags;
}): Result<{ id: string; answer: HygieneAnswer; why: string }, MemoryVerbError> {
  const [id, word] = parsed.positionals;
  if (id === undefined) {
    return err(MemoryVerbErrors.missingArgument({ argument: "id" }));
  }
  if (word === undefined) {
    return err(MemoryVerbErrors.missingArgument({ argument: "accepted|refused" }));
  }
  const answer = HYGIENE_ANSWERS.find((known) => known === word);
  if (answer === undefined) {
    return err(MemoryVerbErrors.unknownAnswer({ allowed: HYGIENE_ANSWERS, value: word }));
  }
  const why = parsed.values["why"];
  if (typeof why !== "string" || why.trim() === "") {
    return err(
      MemoryVerbErrors.missingFlag({
        flag: "--why",
        why: "an answer with no reason is a vote the next run cannot act on",
      }),
    );
  }
  return ok({ answer, id, why });
}

export const memoryHygieneCommand = defineCommand({ run: runMemoryHygiene });

export const memoryGradeCommand = defineCommand({ run: runMemoryGrade });
