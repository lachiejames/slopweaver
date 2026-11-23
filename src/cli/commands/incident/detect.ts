/**
 * `slopweaver incident detect` — the corpus's incident channels, judged exactly as the live sweep judges them, with
 * nothing registered. Registration belongs to `listen recover --scheduled` alone, off live discovery: the corpus
 * store keeps only fingerprint-new captures, so a channel renamed and renamed back reads as its older name here, and
 * a row opened off that would be wrong in a way nobody sees (`../../../incident/channel.ts`).
 */
import { readStructureRows } from "../../../corpus/structures/store.js";
import { latestIncidentChannels } from "../../../incident/channel.js";
import { type JudgedIncidentChannel, judgeIncidentChannels } from "../../../incident/judge.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flag, resolvedHomeOf } from "../hand/deps.js";

import { INCIDENT_DETECT_USAGE } from "./incidentUsage.js";

/** Where the verb's arguments start in the full process argv. */
const VERB_ARG_OFFSET = 4;

/** The flags `incident detect` parses — `helpTruth.test.ts` holds its usage line to exactly these. */
export const INCIDENT_DETECT_FLAG_SPEC: FlagSpec = { boolean: ["json", "help"], string: ["since", "now", "home"] };

/**
 * An ISO flag as epoch seconds, `undefined` when absent, or the refusal when it does not parse.
 *
 * @param values the parsed flags
 * @param name the flag
 * @returns the instant, absent, or why not
 */
function instantFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): { seconds: number | undefined } | { refusal: string } {
  const raw = flag({ name, values });
  if (raw === undefined) {
    return { seconds: undefined };
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return { refusal: `incident detect: --${name} ${raw} is not an ISO instant` };
  }
  return { seconds: Math.floor(ms / 1000) };
}

/**
 * The instant the channels are judged at: the `--now` a replay passes, else the wall clock.
 *
 * @param given the parsed `--now`, absent on a live run
 * @returns epoch seconds
 */
function sweepNowSeconds({ given }: { given: number | undefined }): number {
  if (given !== undefined) {
    return given;
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * One judged channel as a human line.
 *
 * @param channel the judged channel
 * @returns the line
 */
function judgedLine({ channel }: { channel: JudgedIncidentChannel }): string {
  const opened = channel.openedIso === undefined ? "opened at an unknown time" : `opened ${channel.openedIso}`;
  const state = channel.live ? "LIVE" : `not live: ${String(channel.why)}`;
  return `${channel.verdict.padEnd(8)} #${channel.name} ${channel.id} — ${opened} — ${state}`;
}

/**
 * Run `incident detect`.
 *
 * @param argv the full process argv
 * @returns the process exit code: 3 when the corpus holds no incident-shaped channel
 */
export function runIncidentDetect(argv: readonly string[]): number {
  const parsed = parseFlags({
    args: argv.slice(VERB_ARG_OFFSET),
    spec: INCIDENT_DETECT_FLAG_SPEC,
  });
  if (parsed.isErr() || parsed.value.values["help"] === true) {
    if (parsed.isErr()) {
      parsed.error.forEach((line) => {
        logger.error({ msg: `incident detect: ${line}` });
      });
    }
    logger.error({ msg: INCIDENT_DETECT_USAGE });
    return parsed.isErr() ? EXIT_USAGE : EXIT_OK;
  }
  const values = parsed.value.values;
  const since = instantFlag({ name: "since", values });
  const now = instantFlag({ name: "now", values });
  for (const instant of [since, now]) {
    if ("refusal" in instant) {
      logger.error({ msg: instant.refusal });
      return EXIT_USAGE;
    }
  }
  if ("refusal" in since || "refusal" in now) {
    return EXIT_USAGE;
  }
  const home = resolvedHomeOf({ values });
  const read = readStructureRows({ home, source: "slack" });
  read.warnings.forEach((warning) => {
    logger.error({ msg: `incident detect: ${warning}` });
  });
  const nowSeconds = sweepNowSeconds({ given: now.seconds });
  const judged = judgeIncidentChannels({
    channels: latestIncidentChannels({ rows: read.rows }),
    nowEpochSeconds: nowSeconds,
    sinceEpochSeconds: since.seconds,
  });
  if (values["json"] === true) {
    logger.out({ line: JSON.stringify({ channels: judged, warnings: read.warnings }) });
  } else {
    judged.forEach((channel) => {
      logger.out({ line: judgedLine({ channel }) });
    });
  }
  return detectExit({ judged: judged.length, rows: read.rows.length, warnings: read.warnings.length });
}

/**
 * The verb's exit: a store that yielded no rows AND carried warnings was not read, so its empty answer is a fault
 * rather than the legitimate "no incident channels" status.
 *
 * @param judged how many channels were judged
 * @param rows how many structure rows the store yielded
 * @param warnings how many parse or read warnings it carried
 * @returns the exit code
 */
export function detectExit({ judged, rows, warnings }: { judged: number; rows: number; warnings: number }): number {
  if (rows === 0 && warnings > 0) {
    return EXIT_ERROR;
  }
  return judged > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/** `slopweaver incident detect`. */
export const incidentDetectCommand = defineCommand({ run: (argv) => runIncidentDetect(argv) });
