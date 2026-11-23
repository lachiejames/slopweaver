/**
 * `plans connect`, `plans connect-cancel`, `plans connections` and the internal `plans connect-worker` — the verbs
 * behind the Settings modal's Connect button. The behaviour is `plans/connectCodex.ts` and `plans/connectCodexWorker.ts`,
 * the production effects `connectDeps.ts`; this file parses flags, wires those effects and prints.
 *
 * Every printed document is ONE JSON line under `--json`, the shape the console's act and live routes read; without
 * it, one plain line a person can read. No output here is ever a command for the owner to run.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { slopweaverHome } from "../../../homeDir.js";
import { cancelPlanConnection, readPlanConnections, startCodexConnect } from "../../../plans/connectCodex.js";
import { runCodexConnectWorker } from "../../../plans/connectCodexWorker.js";
import { isConnectionId, type PlanConnection } from "../../../plans/connection.js";
import { PlanConnectionErrors } from "../../../plans/connectionErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";

import { productionCodexConnectDeps } from "./connectDeps.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { PLANS_SPECS, plansUsage } from "./plansUsage.js";

/** The home a verb acts on: `--home` when passed, else the ambient one, said at the call rather than by `??`. */
function homeOf({ parsed }: { parsed: ParsedFlags }): string {
  const given = parsed.values["home"];
  if (typeof given === "string") {
    return given;
  }
  return slopweaverHome();
}

/** One attempt as a person reads it. */
function connectionLine({ connection }: { connection: PlanConnection }): string {
  const failure = connection.failure === undefined ? "" : ` (${connection.failure})`;
  const detail = connection.detail === undefined ? "" : `: ${connection.detail}`;
  return `plans: ${connection.host} sign-in ${connection.id} is ${connection.phase}${failure}${detail}`;
}

/** Parse one verb's flags, printing the refusal and usage on a bad line. */
function parsedOrUsage({ rest, verb }: { rest: readonly string[]; verb: string }): Result<ParsedFlags, number> {
  const parsed = parseFlags({ args: rest, spec: PLANS_SPECS[verb]! });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: plansUsage({ verb }) });
    return err(EXIT_USAGE);
  }
  return ok(parsed.value);
}

/** The `--id` a verb was handed, checked well-formed, or the usage exit. */
function idOrUsage({ parsed, verb }: { parsed: ParsedFlags; verb: string }): Result<string, number> {
  const id = parsed.values["id"];
  if (typeof id !== "string" || !isConnectionId({ id })) {
    logger.error({ msg: "plans: --id must name a sign-in attempt (8 to 64 lowercase letters, digits and hyphens)" });
    logger.error({ msg: plansUsage({ verb }) });
    return err(EXIT_USAGE);
  }
  return ok(id);
}

/** Print one attempt, or the failure, and answer the exit code. */
function printed({
  json,
  result,
}: {
  json: boolean;
  result: Result<PlanConnection, { readonly code: string; readonly message: string }>;
}): number {
  if (result.isErr()) {
    if (json) {
      logger.out({ line: JSON.stringify({ error: { code: result.error.code, message: result.error.message } }) });
    }
    logger.error({ msg: `plans: ${result.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({
    line: json ? JSON.stringify({ connection: result.value }) : connectionLine({ connection: result.value }),
  });
  return EXIT_OK;
}

/** `plans connect --provider codex`. */
async function runConnect(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: plansUsage({ verb: "connect" }) });
    return EXIT_OK;
  }
  const parsed = parsedOrUsage({ rest, verb: "connect" });
  if (parsed.isErr()) {
    return parsed.error;
  }
  const json = parsed.value.values["json"] === true;
  const host = parsed.value.values["provider"];
  if (host !== "codex" && host !== "claude") {
    logger.error({ msg: "plans: --provider must be claude or codex" });
    logger.error({ msg: plansUsage({ verb: "connect" }) });
    return EXIT_USAGE;
  }
  if (host === "claude") {
    return printed({ json, result: err(PlanConnectionErrors.unsupported({ host })) });
  }
  const home = homeOf({ parsed: parsed.value });
  return printed({ json, result: await startCodexConnect({ deps: productionCodexConnectDeps({ home }), home }) });
}

/** `plans connect-cancel --id <id>`. */
function runConnectCancel(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: plansUsage({ verb: "connect-cancel" }) });
    return EXIT_OK;
  }
  const parsed = parsedOrUsage({ rest, verb: "connect-cancel" });
  if (parsed.isErr()) {
    return parsed.error;
  }
  const id = idOrUsage({ parsed: parsed.value, verb: "connect-cancel" });
  if (id.isErr()) {
    return id.error;
  }
  const json = parsed.value.values["json"] === true;
  const home = homeOf({ parsed: parsed.value });
  return printed({ json, result: cancelPlanConnection({ home, id: id.value, nowMs: Date.now() }) });
}

/** `plans connections`. */
function runConnections(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: plansUsage({ verb: "connections" }) });
    return EXIT_OK;
  }
  const parsed = parsedOrUsage({ rest, verb: "connections" });
  if (parsed.isErr()) {
    return parsed.error;
  }
  const read = readPlanConnections({ home: homeOf({ parsed: parsed.value }), nowMs: Date.now() });
  if (read.isErr()) {
    logger.error({ msg: `plans: ${read.error.message}` });
    return EXIT_ERROR;
  }
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify({ connections: read.value }) });
    return EXIT_OK;
  }
  const attempts = Object.values(read.value);
  if (attempts.length === 0) {
    logger.out({ line: "plans: no plan sign-in has been started from the console" });
  }
  attempts.forEach((connection) => {
    logger.out({ line: connectionLine({ connection }) });
  });
  return EXIT_OK;
}

/** `plans connect-worker --id <id>` — launched by `plans connect`, never by hand. */
async function runConnectWorker(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: plansUsage({ verb: "connect-worker" }) });
    return EXIT_OK;
  }
  const parsed = parsedOrUsage({ rest, verb: "connect-worker" });
  if (parsed.isErr()) {
    return parsed.error;
  }
  const id = idOrUsage({ parsed: parsed.value, verb: "connect-worker" });
  if (id.isErr()) {
    return id.error;
  }
  const home = homeOf({ parsed: parsed.value });
  const result = await runCodexConnectWorker({ deps: productionCodexConnectDeps({ home }), home, id: id.value });
  const code = printed({ json: false, result });
  if (result.isErr()) {
    return code;
  }
  return workerExitCode({ connection: result.value });
}

/**
 * The exit a worker ends on once its final record is written: a sign-in that ended `failed` is a failed run even
 * though recording it succeeded (a `CLI_MISSING` attempt exited 0). Cancelled is the owner's own act.
 *
 * @param connection the record the worker ended on
 * @returns `EXIT_ERROR` for a failed attempt, else `EXIT_OK`
 */
export function workerExitCode({ connection }: { connection: PlanConnection }): number {
  if (connection.phase === "failed") {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/** `slopweaver plans connect`. */
export const plansConnectCommand = defineCommand({ run: runConnect });

/** `slopweaver plans connect-cancel`. */
export const plansConnectCancelCommand = defineCommand({ run: runConnectCancel });

/** `slopweaver plans connections`. */
export const plansConnectionsCommand = defineCommand({ run: runConnections });

/** `slopweaver plans connect-worker`. */
export const plansConnectWorkerCommand = defineCommand({ run: runConnectWorker });
