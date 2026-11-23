/**
 * `slopweaver route profile-answer` — validate a visible session's drafted judgement/voice profile against
 * the pinned brief, and only then write it to the private profile file.
 */
import { readFileSync } from "node:fs";

import { routingBalanceLines, routingDecisionBalance } from "../../../judgement/miningBalance.js";
import { acceptJudgementMiningAnswer } from "../../../judgement/miningBrief.js";
import { readJudgementMiningBrief, writeJudgementMiningCache } from "../../../judgement/miningStore.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { writeJudgementProfile } from "../../../live/turn/judgementProfileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { type RouteCommandError, RouteCommandErrors, routeCommandErrorLines } from "./errors.js";

export const ROUTE_PROFILE_ANSWER_USAGE =
  "usage: slopweaver route profile-answer --answer <answer.json> [--home <dir>] --json";

export const ROUTE_PROFILE_ANSWER_FLAG_NAMES = ["--answer", "--home", "--json"] as const;

const VERB_ARG_OFFSET = 4;

interface ProfileAnswerRequest {
  readonly answerPath: string;
  readonly home?: string;
}

/**
 * Parse the profile-answer argv tail without performing I/O.
 *
 * @param rest the argv tail after `route profile-answer`
 * @returns parsed flags or their syntax errors
 */
export function parseRouteProfileAnswerArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: ["json"], string: ["answer", "home"] } });
}

/** Turn parsed flags into the required request. */
function requestFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<ProfileAnswerRequest> {
  const answerPath = values["answer"];
  const home = values["home"];
  const errors = [
    typeof answerPath !== "string" || answerPath.trim().length === 0 ? "--answer is required" : undefined,
    values["json"] !== true ? "--json is required" : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  if (errors.length > 0 || typeof answerPath !== "string") {
    return err(errors);
  }
  return ok({ answerPath, ...(typeof home === "string" ? { home } : {}) });
}

/** Read and JSON-decode the drafted answer file. */
function readAnswer({ path }: { path: string }): Result<unknown, RouteCommandError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "route.readProfileAnswer", path });
  if (read.isErr()) {
    return err(RouteCommandErrors.fileUnreadable({ detail: read.error.message, label: "answer", path }));
  }
  try {
    return ok(JSON.parse(read.value));
  } catch {
    return err(RouteCommandErrors.fileNotJson({ label: "answer", path }));
  }
}

/**
 * Run the profile-answer verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runRouteProfileAnswer(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROUTE_PROFILE_ANSWER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRouteProfileAnswerArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_PROFILE_ANSWER_USAGE });
    return EXIT_USAGE;
  }
  const request = requestFromFlags({ values: parsed.value.values });
  if (request.isErr()) {
    request.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_PROFILE_ANSWER_USAGE });
    return EXIT_USAGE;
  }
  const homeArg = request.value.home === undefined ? {} : { home: request.value.home };
  const brief = readJudgementMiningBrief(homeArg);
  if (brief === undefined) {
    logger.error({ msg: "no mining brief is pinned — run `slopweaver route profile-brief` first" });
    return EXIT_ERROR;
  }
  const answer = readAnswer({ path: request.value.answerPath });
  if (answer.isErr()) {
    routeCommandErrorLines({ error: answer.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const accepted = acceptJudgementMiningAnswer({ answer: answer.value, brief, nowIso: () => new Date().toISOString() });
  if (accepted.isErr()) {
    logger.error({ msg: accepted.error.message });
    return EXIT_ERROR;
  }
  writeJudgementProfile({ profile: accepted.value, ...homeArg });
  writeJudgementMiningCache({
    entry: {
      acceptedAt: accepted.value.provenance.minedAt,
      manifestHash: brief.manifestHash,
      promptFingerprint: brief.promptFingerprint,
    },
    ...homeArg,
  });
  logger.out({ line: `judgement profile accepted and written (mined ${accepted.value.provenance.minedAt})` });
  routingBalanceLines({ balance: routingDecisionBalance({ routing: accepted.value.routing }) }).forEach((line) => {
    logger.out({ line: `  routing ${line}` });
  });
  return EXIT_OK;
}

export const routeProfileAnswerCommand = defineCommand({ run: runRouteProfileAnswer });
