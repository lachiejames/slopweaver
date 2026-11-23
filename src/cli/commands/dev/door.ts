/**
 * `slopweaver dev door` — a window onto the admit pathway. `--simulate warn|pass|hold` runs a stub request
 * through the door with a built-in stub gate so you can SEE the warn-first + override + hold behaviour
 * end-to-end (and it records to the door ledger); `--raw "<cmd>"` runs a command through the raw-tool
 * classifier so you can see the default-deny + escape. This is how the PR2 proof exercises the door before
 * any capability is wired.
 *
 * `--refusals` is the READ half, and it answers a different question from the other two: what did we try to
 * send and get STOPPED on, before the door recorded anything at all. See `../../../admit/doorRefusalRead.ts`.
 */

import { admitDoor } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { doorRefusalLines } from "../../../admit/doorRefusal.js";
import { preDoorRefusalCoverageLines, preDoorRefusalLines } from "../../../admit/doorRefusalRead.js";
import { classifyRawCommand } from "../../../admit/rawTools.js";
import type { DoorGate, DoorRequest } from "../../../admit/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseFlags } from "../../parseFlags.js";

const USAGE =
  'usage: slopweaver dev door (--simulate warn|pass|hold | --raw "<command>" | --refusals [--limit <n>]) [--home <dir>]';

/** How many refusal rows `--refusals` prints when the caller names no limit. */
const DEFAULT_REFUSAL_LIMIT = 20;

/** The built-in demo gate: emits a warn/hold finding driven by the simulated request, else passes. */
const stubGate: DoorGate = (request) => {
  const mode = request.artifact["simulate"];
  if (mode === "warn") {
    return [
      {
        code: "stub.warn",
        correction: "this is a demonstration warning; re-issue with the override token to let it through",
        override: "stub.warn:v1",
        severity: "warn",
        summary: "stub gate flagged this action (demo warning)",
      },
    ];
  }
  if (mode === "hold") {
    return [
      {
        code: "stub.hold",
        correction: "a hold is the invariant core — not waivable by the per-action override token",
        severity: "hold",
        summary: "stub gate held this action as irreversible harm (demo hold)",
      },
    ];
  }
  return [];
};

/** The stub request a simulated decision is made over; with no `--home` its meta names none (`null`). */
function demoRequest({ mode, home }: { mode: string; home: string | undefined }): DoorRequest {
  const action = { kind: "verb", noun: "stub", verb: "demo" } as const;
  const meta = { createsWorkItem: false, effect: "external-write", requiresApproval: false } as const;
  if (home === undefined) {
    return { action, artifact: { simulate: mode }, meta: { ...meta, home: null } };
  }
  return { action, artifact: { simulate: mode }, meta: { ...meta, home } };
}

/** Print + record a simulated door decision; a store that cannot record it is an error, and nothing is printed as decided. */
async function simulate({
  mode,
  home,
  ledger,
}: {
  mode: string;
  home: string | undefined;
  ledger: DoorLedgerPort;
}): Promise<number> {
  const request = demoRequest({ home, mode });
  const decision = admitDoor({ env: process.env, gates: [stubGate], request });
  const recorded = await ledger.appendDecision({
    decision,
    doorRequest: request,
    home: resolveHome({ named: home }),
    runId: `door-demo-${mode}`,
    tsIso: new Date().toISOString(),
  });
  if (recorded.isErr()) {
    logger.error({ msg: `door: ${recorded.error.message}` });
    return EXIT_ERROR;
  }

  if (decision.status === "pass") {
    logger.out({ line: "door decision: PASS" });
  } else {
    // The renderer's first line names the status, so no verdict header is printed beside it.
    for (const line of doorRefusalLines({ command: `slopweaver dev door --simulate ${mode}`, decision })) {
      logger.out({ line });
    }
  }
  for (const finding of decision.overridden) {
    // Deliberately does NOT name the mechanism. A warn is waived by the override token OR
    // by a live journalled grant, and the decision carries no field saying which — asserting the token here
    // printed a false explanation for every grant-waived finding.
    logger.out({ line: `  [overridden] ${finding.code} — waived, and recorded` });
  }
  return EXIT_OK;
}

/**
 * Print the newest pre-door refusals — the sends a gate stopped before the door ever recorded a decision.
 *
 * This is the half of the door ledger that answers "what did we TRY to send and get stopped on". Before the
 * refusal row existed, that question cost a code read: MEASURED, the whole 51.5 MB ledger held
 * pass, warn and hold rows and nothing else.
 *
 * The coverage bound prints unconditionally, including when there is nothing to show, because one gate
 * writes these rows today and an empty result must not read as "nothing stopped it". A store that cannot be
 * read is an error, never "no pre-door refusals recorded".
 */
async function refusals({
  home,
  limit,
  ledger,
}: {
  home: string | undefined;
  limit: number;
  ledger: DoorLedgerPort;
}): Promise<number> {
  const read = await ledger.readRecentPreDoorRefusals({ home: resolveHome({ named: home }), limit });
  if (read.isErr()) {
    logger.error({ msg: `door: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const entries = read.value;
  if (entries.length === 0) {
    logger.out({ line: "no pre-door refusals recorded." });
  }
  for (const entry of entries) {
    for (const line of preDoorRefusalLines({ entry })) {
      logger.out({ line });
    }
  }
  for (const line of preDoorRefusalCoverageLines()) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** Print a raw-command classification (block/allow + the escape message). */
function raw({ command }: { command: string }): number {
  // Mirrors `evaluateHookPayload`'s resolution exactly: the real PreToolUse hook passes `command` straight
  // through and lets `classifyRawCommand` resolve its own per-segment inline `SLOPWEAVER_ALLOW_RAW=1 <cmd>`
  // override — composing that check here separately would demonstrate a different (and, pre-fix, a weaker)
  // gate than the one an agent's Bash call actually hits.
  const allowRaw = process.env["SLOPWEAVER_ALLOW_RAW"] === "1";
  const verdict = classifyRawCommand({ allowRaw, command });
  if (verdict.blocked) {
    logger.out({ line: `raw command: BLOCKED — ${verdict.message}` });
    return EXIT_ERROR;
  }
  // `verdict.tool` is only ever set on an ALLOWED verdict when a destructive segment was found and covered
  // by an override (global or segment-scoped inline) — an unrecognised/read-only command never sets it.
  logger.out({
    line: `raw command: ALLOWED${verdict.tool !== undefined ? ` (${verdict.tool} via SLOPWEAVER_ALLOW_RAW escape)` : ""}`,
  });
  return EXIT_OK;
}

/**
 * Run the door demo verb over a named door ledger — the seam a test passes an in-memory one through.
 *
 * @param argv the full process argv
 * @param ledger the door ledger `--simulate` records to and `--refusals` reads
 * @returns the exit code
 */
export async function runDoorWith({
  argv,
  ledger,
}: {
  argv: readonly string[];
  ledger: DoorLedgerPort;
}): Promise<number> {
  const rest = argv.slice(3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["refusals"], string: ["simulate", "raw", "home", "limit"] },
  });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: `door: ${e}` });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  const simulateMode = values["simulate"];
  const rawCommand = values["raw"];

  if (typeof simulateMode === "string") {
    if (!["warn", "pass", "hold"].includes(simulateMode)) {
      logger.error({ msg: `door: --simulate must be warn|pass|hold, got ${simulateMode}` });
      logger.error({ msg: USAGE });
      return EXIT_USAGE;
    }
    return simulate({ home, ledger, mode: simulateMode });
  }
  if (typeof rawCommand === "string") {
    return raw({ command: rawCommand });
  }
  if (values["refusals"] === true) {
    const named = values["limit"];
    const limit = typeof named === "string" ? Number(named) : DEFAULT_REFUSAL_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) {
      logger.error({ msg: `door: --limit must be a positive integer, got ${String(named)}` });
      logger.error({ msg: USAGE });
      return EXIT_USAGE;
    }
    return refusals({ home, ledger, limit });
  }
  logger.error({ msg: 'door: pass --simulate warn|pass|hold, --raw "<command>" or --refusals' });
  logger.error({ msg: USAGE });
  return EXIT_USAGE;
}

/**
 * Run the door demo verb over this install's store.
 *
 * @param argv the full process argv
 * @returns the exit code
 */
export async function runDoor(argv: readonly string[]): Promise<number> {
  return runDoorWith({ argv, ledger: doorLedgerPort() });
}

export const doorCommand = defineCommand({ run: runDoor });
