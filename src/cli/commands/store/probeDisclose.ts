/**
 * `slopweaver store peek | open | around` — the bottom three rungs of the progressive-disclosure ladder.
 *
 * Where a detective reads records rather than counts them: a window of one record, the whole record, then what
 * was being said around it. Split from `./probe.ts`, which holds the counting rungs, along the seam the data
 * layer already draws ({@link ../../../store/probe/disclose}). Why the ladder is verbs at all is that file's
 * header.
 */

import { logger } from "../../../lib/logger.js";
import { resolveAroundAnchor, runAround, runOpen, runPeek } from "../../../store/probe/disclose.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { storeTail } from "./core.js";
import { parseDatadogAroundArgs, routesToDatadog } from "./datadogCore.js";
import { aroundOverDatadog, openOverDatadog, peekOverDatadog } from "./datadogRun.js";
import { parseAroundArgs, parseOpenArgs, parsePeekArgs } from "./probeCore.js";
import { aroundLines, openLines, peekLines } from "./probeLines.js";
import { emit, openOrRefuse, wantedHelp } from "./probeShell.js";
import { AROUND_USAGE, OPEN_USAGE, PEEK_USAGE } from "./probeUsage.js";
import { refuseParsed as refuse } from "./shell.js";

/**
 * Show a window of each named record, centred on the match rather than on the start of the body.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStorePeek(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantedHelp({ rest, usage: PEEK_USAGE })) {
    return EXIT_OK;
  }
  const args = parsePeekArgs({ rest });
  if (args.isErr()) {
    return refuse({ error: args.error, usage: PEEK_USAGE });
  }
  if (routesToDatadog({ rest })) {
    return peekOverDatadog({
      chars: args.value.chars,
      ids: args.value.ids,
      json: args.value.json,
      match: args.value.match,
    });
  }
  const opened = await openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const peeks = await runPeek({
      chars: args.value.chars,
      ids: args.value.ids,
      match: args.value.match,
      reader: opened.client,
    });
    if (peeks.isErr()) {
      logger.error({ msg: peeks.error.message });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: peeks.value.flatMap((peek) => peekLines({ peek })),
      payload: peeks.value,
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Print each named record whole, with the URLs its text linked to.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreOpen(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantedHelp({ rest, usage: OPEN_USAGE })) {
    return EXIT_OK;
  }
  const args = parseOpenArgs({ rest });
  if (args.isErr()) {
    return refuse({ error: args.error, usage: OPEN_USAGE });
  }
  if (routesToDatadog({ rest })) {
    return openOverDatadog({ ids: args.value.ids, json: args.value.json });
  }
  const opened = await openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const records = await runOpen({ ids: args.value.ids, reader: opened.client });
    if (records.isErr()) {
      logger.error({ msg: records.error.message });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: records.value.flatMap((record) => openLines({ record })),
      payload: records.value,
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Read what was being said around one record — its thread, or its container in time order.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreAround(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantedHelp({ rest, usage: AROUND_USAGE })) {
    return EXIT_OK;
  }
  if (routesToDatadog({ rest })) {
    const asked = parseDatadogAroundArgs({ rest });
    return asked.isErr() ? refuse({ error: asked.error, usage: AROUND_USAGE }) : aroundOverDatadog({ ...asked.value });
  }
  const args = parseAroundArgs({ rest });
  if (args.isErr()) {
    return refuse({ error: args.error, usage: AROUND_USAGE });
  }
  const opened = await openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const anchor = await resolveAroundAnchor({ address: args.value.address, reader: opened.client });
    if (anchor.isErr()) {
      logger.error({ msg: anchor.error.message });
      return EXIT_ERROR;
    }
    const page = await runAround({
      after: args.value.after,
      before: args.value.before,
      chars: args.value.chars,
      id: anchor.value,
      mode: args.value.mode,
      reader: opened.client,
    });
    if (page.isErr()) {
      logger.error({ msg: page.error.message });
      return EXIT_ERROR;
    }
    emit({ json: args.value.json, lines: aroundLines({ page: page.value }), payload: page.value });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

export const storePeekCommand = defineCommand({ run: runStorePeek });
export const storeOpenCommand = defineCommand({ run: runStoreOpen });
export const storeAroundCommand = defineCommand({ run: runStoreAround });
