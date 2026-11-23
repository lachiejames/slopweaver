/**
 * `slopweaver route evaluate` — validate and score a visible session's routing decisions against the frozen
 * eval cases. No model runs here (rule 2): the decisions file is a visible session's own already-composed
 * judgements, the same hand-off shape as `route profile-answer` validating an already-drafted profile.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { appendAll } from "../../../lib/arrays.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import {
  judgeRouting,
  parseRoutingDecision,
  type RoutingDecision,
  type RoutingJudgementInput,
} from "../../../live/turn/judgement.js";
import {
  type RoutingEvalBaseline,
  type RoutingEvalCase,
  type RoutingEvalSummary,
  scoreRoutingDecisions,
} from "../../../live/turn/judgementEval.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { type RouteCommandError, RouteCommandErrors, routeCommandErrorLines } from "./errors.js";

export const ROUTE_EVALUATE_USAGE =
  "usage: slopweaver route evaluate --cases <cases.json> --decisions <decisions.json> [--judged-by <text>] [--out <baseline.json>] --json";

export const ROUTE_EVALUATE_FLAG_NAMES = ["--cases", "--decisions", "--judged-by", "--out", "--json"] as const;

const VERB_ARG_OFFSET = 4;
const DEFAULT_JUDGED_BY = "unspecified";

interface EvaluateRequest {
  readonly casesPath: string;
  readonly decisionsPath: string;
  readonly judgedBy: string;
  readonly outPath?: string;
}

/**
 * Parse the evaluate argv tail without performing I/O.
 *
 * @param rest the argv tail after `route evaluate`
 * @returns parsed flags or their syntax errors
 */
export function parseRouteEvaluateArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: ["json"], string: ["cases", "decisions", "judged-by", "out"] } });
}

/** Turn parsed flags into the required request. */
function requestFromFlags({ values }: { values: Readonly<Record<string, string | boolean>> }): Result<EvaluateRequest> {
  const casesPath = values["cases"];
  const decisionsPath = values["decisions"];
  const judgedBy = values["judged-by"];
  const outPath = values["out"];
  const errors = [
    typeof casesPath !== "string" || casesPath.trim().length === 0 ? "--cases is required" : undefined,
    typeof decisionsPath !== "string" || decisionsPath.trim().length === 0 ? "--decisions is required" : undefined,
    values["json"] !== true ? "--json is required" : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  if (errors.length > 0 || typeof casesPath !== "string" || typeof decisionsPath !== "string") {
    return err(errors);
  }
  return ok({
    casesPath,
    decisionsPath,
    judgedBy: typeof judgedBy === "string" ? judgedBy : DEFAULT_JUDGED_BY,
    ...(typeof outPath === "string" ? { outPath } : {}),
  });
}

/** Read + JSON-decode a file, refusing with a labelled message on any failure. */
function readJson({ path, label }: { path: string; label: string }): Result<unknown, RouteCommandError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: `route.evaluate.read${label}`, path });
  if (read.isErr()) {
    return err(RouteCommandErrors.fileUnreadable({ detail: read.error.message, label, path }));
  }
  try {
    return ok(JSON.parse(read.value));
  } catch {
    return err(RouteCommandErrors.fileNotJson({ label, path }));
  }
}

/** Structurally check one decoded case entry has the fields `scoreRoutingDecisions` reads. Pure. */
function isWellShapedCase(value: unknown): value is RoutingEvalCase {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["description"] === "string" &&
    Array.isArray(value["tags"]) &&
    isRecord(value["input"]) &&
    isRecord(value["expected"])
  );
}

/** Validate the decoded cases file shape without trusting it beyond that. */
function readCases({ path }: { path: string }): Result<readonly RoutingEvalCase[], RouteCommandError> {
  const decoded = readJson({ label: "cases file", path });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const value = decoded.value;
  if (!isRecord(value) || !Array.isArray(value["cases"])) {
    return err(RouteCommandErrors.casesNotWrapped({ path }));
  }
  const malformed = value["cases"].filter((entry) => !isWellShapedCase(entry));
  if (malformed.length > 0) {
    return err(RouteCommandErrors.casesMalformed({ count: malformed.length, path }));
  }
  return ok(value["cases"] as readonly RoutingEvalCase[]);
}

/** Validate the decoded decisions file shape: a plain object mapping case id to a schema-valid decision. */
function readDecisions({ path }: { path: string }): Result<ReadonlyMap<string, RoutingDecision>, RouteCommandError> {
  const decoded = readJson({ label: "decisions file", path });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const value = decoded.value;
  if (!isRecord(value)) {
    return err(RouteCommandErrors.decisionsNotObject({ path }));
  }
  const decisions = new Map<string, RoutingDecision>();
  const errors: string[] = [];
  for (const [caseId, raw] of Object.entries(value)) {
    const parsed = parseRoutingDecision({ value: raw });
    if (parsed.isOk()) {
      decisions.set(caseId, parsed.value);
    } else {
      appendAll({ from: parsed.error.map((problem) => `${caseId}: ${problem}`), into: errors });
    }
  }
  return errors.length > 0 ? err(RouteCommandErrors.decisionsInvalid({ path, reasons: errors })) : ok(decisions);
}

/**
 * Validate every supplied decision against its own case's input, then score the validated set against the
 * expected outcomes. A decision that fails validation (e.g. names a hallucinated capability) is dropped
 * before scoring — {@link scoreRoutingDecisions} already scores a missing decision as wrong on every axis
 * the case actually asserts, so a validation failure and a missing decision read identically to the score.
 *
 * @param cases the frozen eval cases
 * @param decisions the visible session's already-composed decision per case id
 * @returns the scored summary, plus every per-case validation refusal
 */
export function validateAndScore({
  cases,
  decisions,
}: {
  cases: readonly RoutingEvalCase[];
  decisions: ReadonlyMap<string, RoutingDecision>;
}): { readonly summary: RoutingEvalSummary; readonly validationErrors: readonly string[] } {
  const validationErrors: string[] = [];
  const validated = new Map<string, RoutingDecision>();
  for (const routingCase of cases) {
    const raw = decisions.get(routingCase.id);
    if (raw === undefined) {
      continue;
    }
    const input: RoutingJudgementInput = routingCase.input;
    const result = judgeRouting({ context: input, judgement: () => raw });
    if (result.isOk()) {
      validated.set(routingCase.id, result.value);
    } else {
      appendAll({ from: result.error.map((problem) => `${routingCase.id}: ${problem}`), into: validationErrors });
    }
  }
  return { summary: scoreRoutingDecisions({ cases, decisions: validated }), validationErrors };
}

/**
 * Run the evaluate verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runRouteEvaluate(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROUTE_EVALUATE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRouteEvaluateArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_EVALUATE_USAGE });
    return EXIT_USAGE;
  }
  const request = requestFromFlags({ values: parsed.value.values });
  if (request.isErr()) {
    request.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_EVALUATE_USAGE });
    return EXIT_USAGE;
  }
  const cases = readCases({ path: request.value.casesPath });
  if (cases.isErr()) {
    routeCommandErrorLines({ error: cases.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const decisions = readDecisions({ path: request.value.decisionsPath });
  if (decisions.isErr()) {
    routeCommandErrorLines({ error: decisions.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const { summary, validationErrors } = validateAndScore({ cases: cases.value, decisions: decisions.value });
  validationErrors.forEach((problem) => {
    logger.error({ msg: `refused: ${problem}` });
  });
  const baseline: RoutingEvalBaseline = {
    judgedBy: request.value.judgedBy,
    producedAt: new Date().toISOString(),
    summary,
  };
  if (request.value.outPath !== undefined) {
    writeFileSync(request.value.outPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  }
  logger.out({ line: JSON.stringify(baseline, null, 2) });
  return EXIT_OK;
}

export const routeEvaluateCommand = defineCommand({ run: runRouteEvaluate });
