/**
 * `slopweaver knowledge record` — write ONE lesson into the memories table.
 *
 * Every closed vocabulary is checked by `../../../knowledge/row.ts` rather than here, so a caller that is not
 * this CLI cannot skip the check. This module's own job is the argv edge: turn flags into the builder's
 * arguments, project the row through `../../../knowledge/lessonRecording.ts`, and turn a typed error into a
 * line a session can act on.
 *
 * ## Where the row goes, and what it does NOT carry
 *
 * The register is the `memories` table, and
 * the append-only file under `$SLOPWEAVER_HOME/knowledge/` is history — recoverable with
 * `knowledge import-lessons`, and never written by this tree again. This verb's contract is unchanged for every caller that
 * already exists: a domain, a claim, a verdict, a tier, a surface and evidence. It was never asked the
 * placement question `knowledge remember` asks, so `behaviour_change` and `retrieval_cue` are written NULL
 * unless the caller chose to supply `--behaviour-change` and `--retrieval-cue` — a NULL there is "nobody
 * answered", which is true, and a value invented here would be the one thing a register of paid-for
 * observations must never hold.
 *
 * ## The file is still appended, from outside this tree
 *
 * "Never written again" was true of this repository and false of this machine, and the difference cost a
 * run. `slopweaver` is a shell function that runs `$(git rev-parse --show-toplevel)/bin/slopweaver`, so the
 * CLI a session gets is the one in ITS OWN checkout — and a worktree whose HEAD predates the table cut-over still carries
 * `src/knowledge/store.ts`, whose `appendFileSync` writes the file and never touches the table. MEASURED:
 * seven of 89 worktrees predated the cut-over, and the `run` field on the file's last two lines named two
 * of them exactly. Nothing here can reach that code; what this verb can do is NOTICE the result, which is
 * `../../../knowledge/lessonsDrift.ts` and the extra line printed below. Rule 10 does the rest: a session
 * that is told an orphan exists simply runs the import.
 *
 * The connection is opened here and closed in a `finally`, the shape every store-backed verb under this
 * directory shares. An unreachable store is a non-zero exit carrying the reason: the settle gate reads what
 * this wrote, and a lesson that silently landed nowhere would let that gate refuse a run that had answered.
 */
import { randomUUID } from "node:crypto";

import type { InstallKnowledgeDomains } from "../../../knowledge/domainVocabulary.js";
import type { KnowledgeError } from "../../../knowledge/errors.js";
import { lessonRecording } from "../../../knowledge/lessonRecording.js";
import { countImportedRows, lessonsDriftLines } from "../../../knowledge/lessonsDrift.js";
import type { MemoryRecording } from "../../../knowledge/memory.js";
import { recordMemory } from "../../../knowledge/memoryRecordStore.js";
import { buildLessonRow } from "../../../knowledge/row.js";
import {
  LESSON_LEARNER_DEFAULT,
  LESSON_LEARNERS,
  LESSON_SURFACES,
  LESSON_TIERS,
  LESSON_VERDICTS,
  type LessonRow,
} from "../../../knowledge/types.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { connectStore, type StoreClient } from "../../../store/client.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { RECORD_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { parseKnowledgeRecordArgs } from "./flagSpecs.js";
import { installDomainsOrExit, type KnowledgeDomainDeps, productionKnowledgeDomainDeps } from "./installDomainsEdge.js";
import { redactRecordingForWrite } from "./redactionContext.js";

/** The run recorded when no `--run` was given. A real value on the row, never an absent field. */
const AD_HOC = "ad-hoc";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The recording the built lesson becomes: unchanged without `--redact`, redacted with it, or undefined once a
 * redaction failure has been printed — so nothing is written.
 *
 * @param home the `--home` override, when one was given
 * @param row the lesson built from the flags
 * @param values the parsed flags, read for the cue, the behaviour change and `--redact`
 * @returns the recording to write, or undefined on a printed redaction failure
 */
function recordingToWrite({
  home,
  row,
  values,
}: {
  home: string | undefined;
  row: LessonRow;
  values: Readonly<Record<string, unknown>>;
}): MemoryRecording | undefined {
  const recording = lessonRecording({
    behaviourChange: flag({ name: "behaviour-change", values }),
    importKey: null,
    learner: row.learner,
    lesson: row,
    recordingId: randomUUID(),
    retrievalCue: flag({ name: "retrieval-cue", values }),
  });
  if (values["redact"] !== true) {
    return recording;
  }
  return redactRecordingForWrite({ home, recording, verb: "knowledge record" });
}

/**
 * Run `knowledge record` over the production store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnowledgeRecord(argv: readonly string[]): Promise<number> {
  return runKnowledgeRecordWithDeps({ argv, deps: productionKnowledgeDomainDeps() });
}

/**
 * Run `knowledge record` over the dependencies it is handed.
 *
 * @param argv the full process argv
 * @param deps where the install's own domains are read
 * @returns the process exit code
 */
export async function runKnowledgeRecordWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: KnowledgeDomainDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RECORD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeRecordArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: RECORD_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = flag({ name: "home", values });
  const installDomains = await installDomainsOrExit({ domains: deps.domains, home, verb: "knowledge record" });
  if (typeof installDomains === "number") {
    return installDomains;
  }
  const built = rowFromFlags({ installDomains, values });
  if (typeof built === "number") {
    return built;
  }
  if (built.isErr()) {
    logger.error({ msg: `knowledge record: ${built.error.message}` });
    return EXIT_ERROR;
  }
  const row = built.value;
  const recording = recordingToWrite({ home, row, values });
  if (recording === undefined) {
    return EXIT_ERROR;
  }
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    logger.error({ msg: `knowledge record: ${opened.error.message}` });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    return await writeAndReport({ client, home, json: values["json"] === true, recording, row });
  } finally {
    await client.close();
  }
}

/**
 * Write the recording and print what happened, on an already-open connection.
 *
 * Split out of {@link runKnowledgeRecord} so the argv edge and the store edge each stay inside the
 * function-length cap; the caller keeps ownership of the connection and closes it in its own `finally`.
 *
 * @param client the open connection
 * @param home the `--home` override, when one was given
 * @param json print the stored row as one JSON document instead of prose — and, because that document is a
 *   contract, without the drift advisory
 * @param recording the projected recording to insert
 * @param row the lesson the recording was built from, which carries the words printed back
 * @returns the process exit code
 */
async function writeAndReport({
  client,
  home,
  json,
  recording,
  row,
}: {
  client: StoreClient;
  home: string | undefined;
  json: boolean;
  recording: MemoryRecording;
  row: LessonRow;
}): Promise<number> {
  const written = await recordMemory({ client, row: recording });
  if (written.isErr()) {
    logger.error({ msg: `knowledge record: ${written.error.message}` });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: JSON.stringify(written.value) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `knowledge record: ${written.value.id} recorded — ${written.value.domain} · tier ${String(row.tier)} · ${row.verdict}` +
      ` · ${row.learner === "owner" ? "the owner's" : "the fleet's"}`,
  });
  logger.out({ line: `  recording ${written.value.recordingId} in the memories table, on run ${written.value.run}` });
  (
    await lessonsDriftLines({ countImported: ({ excluding }) => countImportedRows({ client, excluding }), home })
  ).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * Turn parsed flags into a row, or into the exit code a usage failure prints for itself.
 *
 * Returns a NUMBER for an argv-shaped failure (a missing required flag, a value outside a closed vocabulary)
 * because those are the caller's own usage errors and print their own guidance; a `Result` for anything the
 * builder rejected, so a domain error keeps its typed `code` for the caller to report.
 *
 * @param values the parsed flag values
 * @param installDomains this install's own domains, which `--domain` is checked against
 * @returns the built row, the builder's typed error, or a usage exit code already printed
 */
function rowFromFlags({
  installDomains,
  values,
}: {
  installDomains: InstallKnowledgeDomains;
  values: Readonly<Record<string, unknown>>;
}): Result<LessonRow, KnowledgeError> | number {
  const domain = flag({ name: "domain", values });
  const claim = flag({ name: "claim", values });
  const evidence = flag({ name: "evidence", values });
  if (domain === undefined || claim === undefined || evidence === undefined) {
    logger.error({ msg: "knowledge record: --domain, --claim and --evidence are all required" });
    logger.error({ msg: RECORD_USAGE });
    return EXIT_USAGE;
  }
  const verdict = LESSON_VERDICTS.find((entry) => entry === flag({ name: "verdict", values }));
  const surface = LESSON_SURFACES.find((entry) => entry === flag({ name: "surface", values }));
  const tier = LESSON_TIERS.find((entry) => String(entry) === flag({ name: "tier", values }));
  // Checked one at a time rather than through a single helper, because TypeScript narrows on the `undefined`
  // comparison and would not narrow through a helper's boolean — and the builder below wants three exact types.
  if (verdict === undefined) {
    return vocabularyRefusal({ allowed: LESSON_VERDICTS.join(", "), flag: "--verdict" });
  }
  if (tier === undefined) {
    return vocabularyRefusal({ allowed: LESSON_TIERS.map((entry) => String(entry)).join(", "), flag: "--tier" });
  }
  if (surface === undefined) {
    return vocabularyRefusal({ allowed: LESSON_SURFACES.join(", "), flag: "--surface" });
  }
  // An ABSENT `--learner` is the fleet, which is what almost every caller is; a PRESENT one outside the
  // vocabulary is refused rather than falling back to that default, because silently recording a row on the
  // fleet's side when the caller asked for the owner's is exactly the mis-attribution the field exists to end.
  const learnerFlag = flag({ name: "learner", values });
  const learner = learnerFlag === undefined ? LESSON_LEARNER_DEFAULT : LESSON_LEARNERS.find((e) => e === learnerFlag);
  if (learner === undefined) {
    return vocabularyRefusal({ allowed: LESSON_LEARNERS.join(", "), flag: "--learner" });
  }
  // `if` rather than `??` or a ternary: `no-silent-fallback` refuses both, and this is the absent case named
  // out loud — a caller who passed no --run is recording an ad-hoc lesson rather than one on a board row.
  let run = AD_HOC;
  const runFlag = flag({ name: "run", values });
  if (runFlag !== undefined) {
    run = runFlag;
  }
  return buildLessonRow({
    caveat: flag({ name: "caveat", values }),
    claim,
    domain,
    evidence,
    installDomains,
    learner,
    recordedAtIso: new Date().toISOString(),
    repro: flag({ name: "repro", values }),
    run,
    supersedes: flag({ name: "supersedes", values }),
    surface,
    tier,
    verdict,
  });
}

/**
 * Print the refusal for a missing or unrecognised closed-vocabulary flag, and return the usage exit code.
 *
 * The whole vocabulary is printed rather than only the rejected value, because the reader is choosing from a
 * closed list they may never have seen, and "invalid verdict" without the list is a second command to find out.
 *
 * @param flag the `--`-prefixed flag that did not resolve
 * @param allowed every accepted value, already joined for printing
 * @returns the usage exit code, so the caller can `return` this directly
 */
function vocabularyRefusal({ flag: name, allowed }: { flag: string; allowed: string }): number {
  logger.error({ msg: `knowledge record: ${name} must be one of ${allowed}` });
  logger.error({ msg: RECORD_USAGE });
  return EXIT_USAGE;
}

export const knowledgeRecordCommand = defineCommand({ run: runKnowledgeRecord });
