/**
 * `slopweaver profile` — the command surface over what the world model knows about its owner and about
 * the people they work with.
 *
 * People are tracked on the identity register
 * and a column on it carries facts and per-person judgement; the measured voice register lands in the same
 * database; what is known about THEM is global rather than per Claude project; and loading of all of it is
 * mechanically enforced rather than left to a session remembering.
 *
 * A thin effectful shell. Every parser and every rendered line is {@link ./core}; the reads and writes are
 * {@link ../../../store/profile/client}; the always-loaded assembly is {@link ../../../context/load}.
 * Human report → stderr, `--json` → stdout, so a pipe still works.
 */
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import type { StoreClient } from "../../../store/client.js";
import { readOwnerProfile, readVoiceRegister, writeVoiceCohort } from "../../../store/profile/client.js";
import { parseOwnerSelfDescription, parseVoiceCohort } from "../../../store/profile/core.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { ownerLines, parseProfileShowArgs, parseProfileWriteArgs, profileTail, voiceLines } from "./core.js";
import { runProfilePerson } from "./personRun.js";
import { writeOwnerRowMarked } from "./setOwnerMarked.js";
import { emit, openOrRefuse, readJsonFile, refuse } from "./verbShell.js";
import { parseProfileVoiceArgs } from "./voiceArgs.js";
import { runProfileVoiceMeasure } from "./voiceRun.js";
import { PROFILE_VOICE_USAGE as VOICE_USAGE } from "./voiceUsage.js";

const SHOW_USAGE = "usage: slopweaver profile show [--json]";
const SET_USAGE = "usage: slopweaver profile set --file <owner.json> [--json]";

/**
 * Show the owner row — what is known about them, globally.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileShow(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SHOW_USAGE });
    return EXIT_OK;
  }
  const args = parseProfileShowArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: SHOW_USAGE });
  }
  const opened = openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const owner = await readOwnerProfile({ client: opened.client });
    if (owner.isErr()) {
      logger.error({ msg: owner.error.message });
      return owner.error.code === "PROFILE_ABSENT" ? EXIT_OK : EXIT_ERROR;
    }
    emit({ json: args.value.json, lines: ownerLines({ owner: owner.value }), payload: owner.value });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Write the owner row from a file, pinned to the revision it declares.
 *
 * The file carries the whole self-description rather than a patch, so an edit is a diff a human can read
 * before it is applied. The revision to pin to is read from the store rather than taken from the file:
 * a file that named its own expected revision would let a stale export overwrite a newer row by claiming
 * a number, which is exactly what the pin exists to stop.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileSet(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SET_USAGE });
    return EXIT_OK;
  }
  const args = parseProfileWriteArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: SET_USAGE });
  }
  const file = readJsonFile({ path: args.value.file });
  if ("errors" in file) {
    return refuse({ lines: file.errors, usage: SET_USAGE });
  }
  const record = file.value;
  if (!isRecord(record)) {
    return refuse({ lines: [`${args.value.file} must hold a JSON object`], usage: SET_USAGE });
  }
  const displayName = typeof record["displayName"] === "string" ? record["displayName"] : "";
  if (displayName.length === 0) {
    return refuse({ lines: [`${args.value.file} needs a non-empty "displayName"`], usage: SET_USAGE });
  }
  const payload = parseOwnerSelfDescription({ value: record["selfDescription"] });
  if (payload.isErr()) {
    return refuse({ lines: [payload.error.message], usage: SET_USAGE });
  }
  const personId = typeof record["personId"] === "string" ? record["personId"] : null;
  const opened = openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const revision = await writeOwnerRowMarked({
      client: opened.client,
      displayName,
      personId,
      selfDescription: payload.value,
      url: opened.url,
    });
    if (revision === undefined) {
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: [`profile set: owner row now at revision ${String(revision)}`],
      payload: { revision },
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Read the measured voice register, import cohorts into it from a file, or measure it from their sent Slack.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileVoice(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VOICE_USAGE });
    return EXIT_OK;
  }
  const args = parseProfileVoiceArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: VOICE_USAGE });
  }
  if (args.value.kind === "measure") {
    return runProfileVoiceMeasure(args.value);
  }
  const opened = openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    if (args.value.kind === "import") {
      return await importCohorts({ client: opened.client, file: args.value.file, json: args.value.json });
    }
    const cohorts = await readVoiceRegister({ client: opened.client });
    if (cohorts.isErr()) {
      logger.error({ msg: cohorts.error.message });
      return EXIT_ERROR;
    }
    emit({ json: args.value.json, lines: voiceLines({ cohorts: cohorts.value }), payload: { cohorts: cohorts.value } });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/** Import every cohort in a file, refusing the whole file rather than writing half of it. */
async function importCohorts({
  client,
  file,
  json,
}: {
  client: StoreClient;
  file: string;
  json: boolean;
}): Promise<number> {
  const read = readJsonFile({ path: file });
  if ("errors" in read) {
    return refuse({ lines: read.errors, usage: VOICE_USAGE });
  }
  const raw = Array.isArray(read.value) ? read.value : [read.value];
  const parsed = raw.map((value) => parseVoiceCohort({ value }));
  const refusals = parsed.flatMap((entry) => (entry.isErr() ? [entry.error.message] : []));
  if (refusals.length > 0) {
    return refuse({ lines: refusals, usage: VOICE_USAGE });
  }
  const cohorts = parsed.flatMap((entry) => (entry.isOk() ? [entry.value] : []));
  for (const cohort of cohorts) {
    const written = await writeVoiceCohort({ client, cohort });
    if (written.isErr()) {
      logger.error({ msg: written.error.message });
      return EXIT_ERROR;
    }
  }
  emit({
    json,
    lines: [`profile voice: ${String(cohorts.length)} cohort(s) written`],
    payload: { written: cohorts.length },
  });
  return EXIT_OK;
}

export const profileShowCommand = defineCommand({ run: runProfileShow });
export const profileSetCommand = defineCommand({ run: runProfileSet });
export const profilePersonCommand = defineCommand({ run: runProfilePerson });
export const profileVoiceCommand = defineCommand({ run: runProfileVoice });
