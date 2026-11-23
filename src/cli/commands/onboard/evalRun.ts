/**
 * `slopweaver onboard eval` — the effectful shell: read a run artifact a fresh evaluating session wrote,
 * score it into a friction report, diff it against the previous run, record it, and optionally file the
 * worst findings as new board docs.
 *
 * This verb composes NOTHING an LLM should judge — see `../../../onboardEval/runArtifact.ts`'s header for
 * why the judgement itself has to happen in the evaluating session and arrives here only as data.
 */
import { readFileSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { diffReports, renderDeltaMarkdown } from "../../../onboardEval/delta.js";
import { findingDocMarkdown, findingDocSlug, selectTopFindings } from "../../../onboardEval/findings.js";
import { buildFrictionReport, renderFrictionReportMarkdown } from "../../../onboardEval/frictionReport.js";
import {
  appendReportEntry,
  defaultEvalHome,
  mostRecentReport,
  readReportHistory,
  writeFindingDoc,
} from "../../../onboardEval/historyStore.js";
import { ONBOARD_EVAL_RUN_SCHEMA, parseOnboardEvalRun } from "../../../onboardEval/runArtifact.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { onboardErrorLines } from "./errors.js";
import { mainCheckoutRoot, type OnboardEvalOptions, onboardEvalOptions, parseOnboardEvalArgs } from "./evalCore.js";
import { ONBOARD_EVAL_USAGE } from "./usage.js";

const VERB_ARG_OFFSET = 4;

/** File the top N findings as board docs, logging each path written. Returns the number actually filed. */
function fileFindings({
  findings,
  runId,
  evalHome,
  count,
  repo,
}: {
  findings: ReturnType<typeof buildFrictionReport>["findings"];
  runId: string;
  evalHome: string;
  count: number;
  repo: string;
}): number {
  const selected = selectTopFindings({ count, findings });
  let filed = 0;
  selected.forEach((finding, index) => {
    const slug = findingDocSlug({ finding, index, runId });
    const markdown = findingDocMarkdown({ finding, index, repo, runId });
    const written = writeFindingDoc({ evalHome, markdown, slug });
    if (written.isErr()) {
      logger.error({ msg: `onboard eval: could not file ${slug}: ${written.error.message}` });
      return;
    }
    filed += 1;
    logger.out({ line: `filed: ${written.value}` });
  });
  return filed;
}

/** Where report history lives: `--eval-home` when given, else the install's default eval home. */
function evalHomeOf({ options }: { options: OnboardEvalOptions }): string {
  if (options.evalHome === undefined) {
    return defaultEvalHome();
  }
  return options.evalHome;
}

/** The repository finding docs are filed against: `--repo` when given, else the main checkout of the cwd. */
function findingRepoOf({ options }: { options: OnboardEvalOptions }): string {
  if (options.repo === undefined) {
    return mainCheckoutRoot({ cwd: process.cwd() });
  }
  return options.repo;
}

/** Run the whole score-and-report pipeline once options are known. */
function runReport({ options }: { options: OnboardEvalOptions }): number {
  const runPath = options.runPath;
  if (runPath === undefined) {
    logger.error({ msg: "onboard eval: --run is required" });
    return EXIT_USAGE;
  }
  const file = safeFs({
    execute: () => readFileSync(runPath, "utf8"),
    operation: "onboardEval.readRunFile",
    path: runPath,
  });
  if (file.isErr()) {
    logger.error({ msg: `onboard eval: could not read ${runPath}: ${file.error.message}` });
    return EXIT_ERROR;
  }
  const parsed = parseOnboardEvalRun({ raw: file.value });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: `onboard eval: ${error}` });
    }
    return EXIT_ERROR;
  }
  const report = buildFrictionReport({ run: parsed.value });
  const evalHome = evalHomeOf({ options });
  const history = readReportHistory({ evalHome });
  if (history.isErr()) {
    logger.error({ msg: `onboard eval: could not read report history: ${history.error.message}` });
    return EXIT_ERROR;
  }
  const previous = mostRecentReport({ history: history.value });
  const delta = diffReports({ current: report, previous });
  const recorded = appendReportEntry({ entry: { recordedAt: new Date().toISOString(), report }, evalHome });
  if (recorded.isErr()) {
    logger.error({ msg: `onboard eval: could not record this report: ${recorded.error.message}` });
    return EXIT_ERROR;
  }
  if (options.json) {
    logger.out({ line: JSON.stringify({ delta, report }) });
  } else {
    for (const line of [...renderFrictionReportMarkdown({ report }), "", ...renderDeltaMarkdown({ delta })]) {
      logger.out({ line });
    }
  }
  if (options.fileFindings > 0) {
    const repo = findingRepoOf({ options });
    const filed = fileFindings({
      count: options.fileFindings,
      evalHome,
      findings: report.findings,
      repo,
      runId: report.runId,
    });
    logger.out({ line: `${filed} finding doc(s) filed under ${evalHome}` });
  }
  return EXIT_OK;
}

/**
 * Run the eval verb over the full process argv.
 *
 * @param argv the full process argument vector
 * @returns the process exit code
 */
export function runOnboardEval(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ONBOARD_EVAL_USAGE });
    return EXIT_OK;
  }
  const parsedFlags = parseOnboardEvalArgs({ rest });
  if (parsedFlags.isErr()) {
    for (const error of [...parsedFlags.error, ONBOARD_EVAL_USAGE]) {
      logger.error({ msg: error });
    }
    return EXIT_USAGE;
  }
  const options = onboardEvalOptions({ parsed: parsedFlags.value });
  if (options.isErr()) {
    for (const error of [...onboardErrorLines({ error: options.error }), ONBOARD_EVAL_USAGE]) {
      logger.error({ msg: error });
    }
    return EXIT_USAGE;
  }
  if (options.value.schema) {
    logger.out({ line: ONBOARD_EVAL_RUN_SCHEMA });
    return EXIT_OK;
  }
  return runReport({ options: options.value });
}

export const onboardEvalCommand = defineCommand({ run: runOnboardEval });
