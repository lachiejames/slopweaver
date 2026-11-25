/**
 * `slopweaver fleet health | resume | configure` — the restart recovery the desktop app drives.
 *
 * `health` is the sessions page's contract, read offline from outside cmux every poll; `resume` is the visible
 * recovery pass, run inside a cmux tab; `configure` sets the one number the page's capacity line is measured
 * against. What each decides lives in `../../../fleet/`; this file is flags, effects and exit codes.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";

import { type FleetConfig, isFleetCapacity, MAX_FLEET_CAPACITY } from "../../../fleet/config.js";
import { judgeFleet } from "../../../fleet/judge.js";
import { type FleetPort, fleetPort } from "../../../fleet/port.js";
import { readFleetEvidence } from "../../../fleet/read.js";
import { REORIENT_SECONDS } from "../../../fleet/reorientation.js";
import { resumeFinishLine } from "../../../fleet/resumeShell.js";
import type { FleetHealthDocument, FleetSeat } from "../../../fleet/types.js";
import { BOOT_WINDOW_SECONDS } from "../../../live/machine/recentBoots.js";
import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { boolFlag, fleetUsage, stringFlag } from "./core.js";
import { fleetFlagsOnly } from "./flagsOnly.js";
import { closeOwnShell } from "./ownShellClose.js";
import type { FleetResumeResult } from "./resumePassState.js";
import { runFleetResumePass } from "./resumeRun.js";

/** A whole number of seconds from a flag, its default when the flag is absent, or the usage problem. */
function secondsFlag({
  parsed,
  name,
  whenAbsent,
}: {
  parsed: ParsedFlags;
  name: string;
  whenAbsent: number;
}): number | { readonly problem: string } {
  const raw = stringFlag({ name, parsed });
  if (raw === undefined) {
    return whenAbsent;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return { problem: `--${name} must be a whole number of seconds, at least 1 (got ${raw})` };
  }
  return value;
}

/** How much of a row's title one terminal line shows — a board summary runs to paragraphs. */
const TITLE_CHARS = 80;

/** The episode a pass joins: the one `--episode` named, else a fresh one. */
function episodeIdOf({ named }: { named: string | undefined }): string {
  if (named === undefined) {
    return randomUUID();
  }
  return named;
}

/** One seat as a line: colour, band, what it runs, why. */
function seatLine({ seat }: { seat: FleetSeat }): string {
  const colour = seat.flashing ? `${seat.colour}*` : seat.colour;
  const title = seat.rowTitle.length > TITLE_CHARS ? `${seat.rowTitle.slice(0, TITLE_CHARS - 1)}…` : seat.rowTitle;
  return `  ${colour.padEnd(7)} ${seat.priority.padEnd(10)} ${title} — ${seat.detail}`;
}

/** The document as the lines a terminal shows. */
function healthLines({ document }: { document: FleetHealthDocument }): readonly string[] {
  const consoleText =
    document.console.state === "serving" ? `serving on :${String(document.console.port)}` : document.console.state;
  const lines = [
    `fleet: ${document.state} — ${document.reason.headline}`,
    `  ${document.reason.detail}`,
    `capacity: ${String(document.capacity.online)} of ${String(document.capacity.configured)} online · console ${consoleText}`,
    ...document.seats.filter((seat) => seat.role !== "empty").map((seat) => seatLine({ seat })),
  ];
  const step = document.reason.handStep;
  if (step !== undefined) {
    lines.push(`hand step: ${step.label} — ${step.note}`);
  }
  if (document.reason.raw !== undefined) {
    lines.push(`  (original: ${document.reason.raw})`);
  }
  for (const line of document.unmapped) {
    lines.push(`  unmapped: ${line}`);
  }
  return lines;
}

/**
 * `fleet health` over the ports it reads — the verb's whole body, so a unit test runs it without a store.
 *
 * @param argv the full process argv
 * @param fleet where the capacity and the journals are read
 * @param port where the plan register is read
 * @returns 0 when healthy, 3 when the picture is trustworthy and not healthy — recovering, degraded or down — and 1
 *   when no trustworthy picture exists
 */
export async function fleetHealth({
  argv,
  fleet,
  port,
}: {
  argv: readonly string[];
  fleet: FleetPort;
  port: PlanRegisterPort;
}): Promise<number> {
  const parsed = fleetFlagsOnly({ argv, verb: "health" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed }) });
  const config = await fleet.readConfig({ home });
  if (config.isErr()) {
    logger.error({ msg: `fleet health: ${config.error.message}` });
    return EXIT_ERROR;
  }
  const read = await readFleetEvidence({
    codexThread: codexThreadObserver(),
    config: config.value,
    fleet,
    home,
    nowMs: Date.now(),
    port,
  });
  for (const problem of read.problems) {
    logger.error({ msg: `fleet health: incomplete — ${problem}` });
  }
  const document = judgeFleet({ evidence: read.evidence });
  if (boolFlag({ name: "json", parsed })) {
    logger.out({ line: JSON.stringify(document) });
  } else {
    for (const line of healthLines({ document })) {
      logger.out({ line });
    }
  }
  return document.state === "healthy" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * `fleet health` — the sessions page's document, read offline.
 *
 * @param argv the full process argv
 * @returns the exit code {@link fleetHealth} answers
 */
export async function runFleetHealth(argv: readonly string[]): Promise<number> {
  return fleetHealth({ argv, fleet: fleetPort(), port: planRegisterPort() });
}

/**
 * `fleet configure` over the port it writes — the verb's whole body.
 *
 * @param argv the full process argv
 * @param fleet where the capacity is written, by compare-and-set
 * @returns the process exit code
 */
export async function fleetConfigure({ argv, fleet }: { argv: readonly string[]; fleet: FleetPort }): Promise<number> {
  const parsed = fleetFlagsOnly({ argv, verb: "configure" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const raw = stringFlag({ name: "capacity", parsed });
  const capacity = Number(raw);
  if (raw === undefined || !isFleetCapacity({ value: capacity })) {
    logger.error({ msg: `fleet configure: --capacity must be a whole number from 1 to ${String(MAX_FLEET_CAPACITY)}` });
    logger.error({ msg: fleetUsage({ verb: "configure" }) });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed }) });
  const config: FleetConfig = { capacity, schemaVersion: 1 };
  const written = await fleet.writeConfig({ config, home });
  if (written.isErr()) {
    logger.error({ msg: `fleet configure: ${written.error.message}` });
    return EXIT_ERROR;
  }
  if (boolFlag({ name: "json", parsed })) {
    logger.out({ line: JSON.stringify(written.value) });
  } else {
    logger.out({ line: `fleet configure: capacity is ${String(written.value.capacity)}` });
  }
  return EXIT_OK;
}

/**
 * `fleet configure` — set the capacity the page measures against.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runFleetConfigure(argv: readonly string[]): Promise<number> {
  return fleetConfigure({ argv, fleet: fleetPort() });
}

/** The exit code an attempt's outcome reads as. */
function resumeExit({ result }: { result: FleetResumeResult }): number {
  switch (result.outcome) {
    case "healthy":
      return EXIT_OK;
    case "hand-step":
      return EXIT_EXPECTED_EMPTY;
    case "deferred":
      return EXIT_DEFERRED;
    case "failed":
      return EXIT_ERROR;
    default: {
      const unreachable: never = result.outcome;
      return unreachable;
    }
  }
}

/**
 * `fleet resume` — the recovery pass, in the cmux tab it was typed into, which it closes once its finish is journalled,
 * however it ended, when the desktop launched it (`--episode`).
 *
 * @param argv the full process argv
 * @returns 0 once the fleet is back, 3 on a step only they can take, 4 when a prerequisite is still pending or another
 *   pass is running, 1 on a refusal
 */
export async function runFleetResume(argv: readonly string[]): Promise<number> {
  const parsed = fleetFlagsOnly({ argv, verb: "resume" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const bootPace = secondsFlag({ name: "timeout-seconds", parsed, whenAbsent: BOOT_WINDOW_SECONDS });
  const reorient = secondsFlag({ name: "reorient-seconds", parsed, whenAbsent: REORIENT_SECONDS });
  if (typeof bootPace !== "number") {
    logger.error({ msg: `fleet resume: ${bootPace.problem}` });
    return EXIT_USAGE;
  }
  if (typeof reorient !== "number") {
    logger.error({ msg: `fleet resume: ${reorient.problem}` });
    return EXIT_USAGE;
  }
  const named = stringFlag({ name: "episode", parsed });
  const request = {
    bootPaceSeconds: bootPace,
    episodeId: episodeIdOf({ named }),
    home: resolveHome({ named: stringFlag({ name: "home", parsed }) }),
    reorientSeconds: reorient,
  };
  const own = process.env["CMUX_WORKSPACE_ID"]?.trim();
  return withCmuxSessionHost({
    body: async ({ host: client }) => {
      const ran = await runFleetResumePass({ client, fleet: fleetPort(), port: planRegisterPort(), request });
      if (ran.isErr()) {
        logger.error({ msg: `fleet resume: ${ran.error}` });
        return EXIT_DEFERRED;
      }
      const { result, finishJournalled } = ran.value;
      printResume({ json: boolFlag({ name: "json", parsed }), result });
      const exit = resumeExit({ result });
      await closeOwnShell({
        client,
        episodeNamed: named !== undefined,
        finish: result,
        finishJournalled,
        ownWorkspaceId: own === undefined || own.length === 0 ? undefined : own,
      });
      return exit;
    },
  });
}

/** The pass's lines and its finish line, or the whole result as one JSON line. */
function printResume({ json, result }: { json: boolean; result: FleetResumeResult }): void {
  if (json) {
    logger.out({ line: JSON.stringify(result) });
    return;
  }
  for (const line of result.lines) {
    logger.out({ line });
  }
  logger.out({ line: resumeFinishLine({ finish: result }) });
}

export const fleetHealthCommand = defineCommand({ run: runFleetHealth });
export const fleetConfigureCommand = defineCommand({ run: runFleetConfigure });
export const fleetResumeCommand = defineCommand({ run: runFleetResume });
