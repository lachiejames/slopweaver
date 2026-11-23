/**
 * `slopweaver talk list` and `talk list-add` — the running list the owner, the console voice and the fleet leave things in
 * for each other (`src/talk/runningList.ts`).
 *
 * `list` reads it: the console's overlay polls it, the supervisor reads it at boot, and with `--voice-safe` it is the
 * voice's `running_list` tool, every item's credentials masked. `list-add` puts one item on top from stdin: the console route runs
 * it for the owner and for the voice's `offer_copy`, and a fleet session runs it directly with `--origin fleet`.
 */
import { randomUUID } from "node:crypto";

import { readStdin } from "#lib/readStdin.js";

import { loadDenylistResult } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import {
  type RunningListItem,
  runningListDraftOf,
  runningListSnapshotOf,
  voiceSafeRunningList,
} from "../../../talk/runningList.js";
import { appendRunningList, readRunningList } from "../../../talk/runningListStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseListAddArgs, parseListArgs } from "./listArgs.js";
import { TALK_LIST_ADD_USAGE, TALK_LIST_USAGE } from "./listUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "list", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Who put an item in the list, as a person reads it.
 *
 * @returns "you", "the voice", or the fleet session's name
 */
export function runningListWho({ item }: { item: Pick<RunningListItem, "origin" | "from"> }): string {
  if (item.origin === "owner") {
    return "you";
  }
  if (item.origin === "voice") {
    return "the voice";
  }
  if (item.from === undefined) {
    return "fleet";
  }
  return `fleet · ${item.from}`;
}

/**
 * The human reading of the list: one heading line per item, newest first, its exact text under it.
 *
 * @returns the lines to print
 */
export function runningListLines({ items }: { items: readonly RunningListItem[] }): readonly string[] {
  if (items.length === 0) {
    return ["the running list is empty"];
  }
  return items.flatMap((item) => {
    const label = item.label === undefined ? "" : ` · ${item.label}`;
    return [`#${String(item.seq)} · ${runningListWho({ item })} · ${item.atIso}${label}`, item.text, ""];
  });
}

/**
 * Run the `talk list` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkList(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_LIST_USAGE });
    return EXIT_OK;
  }
  const parsed = parseListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_LIST_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const read = readRunningList({ home });
  if (read.isErr()) {
    logger.error({ msg: `talk list: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const snapshot = runningListSnapshotOf({
    document: read.value,
    ...(args.since === undefined ? {} : { since: args.since }),
  });
  if (args.voiceSafe) {
    const loaded = loadDenylistResult({ home });
    if (loaded.kind === "unreadable") {
      logger.error({
        msg: "talk list: the hygiene denylist could not be read, so the running list is not read to the voice",
      });
      return EXIT_ERROR;
    }
    const denylist = loaded.kind === "loaded" ? loaded.lines : [];
    const items = voiceSafeRunningList({ denylist, snapshot });
    logger.out({ line: JSON.stringify({ items, newestSeq: snapshot.newestSeq }) });
    return EXIT_OK;
  }
  if (args.json) {
    logger.out({ line: JSON.stringify(snapshot) });
    return EXIT_OK;
  }
  runningListLines({ items: snapshot.items }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/** The id an add files under: the writer's own, so a retry is one item, or a fresh one when it named none. */
function draftIdOf({ id }: { id: string | undefined }): string {
  if (id === undefined) {
    return randomUUID();
  }
  return id;
}

/**
 * Run the `talk list-add` verb: parse, then read the text from stdin, then add it under the lock.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkListAdd(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_LIST_ADD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseListAddArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_LIST_ADD_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  let text: string;
  try {
    text = await readStdin();
  } catch (cause: unknown) {
    logger.error({ msg: `talk list-add: stdin could not be read — ${String(cause)}` });
    return EXIT_ERROR;
  }
  const draft = runningListDraftOf({
    id: draftIdOf({ id: args.id }),
    origin: args.origin,
    text,
    ...(args.from === undefined ? {} : { from: args.from }),
    ...(args.label === undefined ? {} : { label: args.label }),
    ...(args.foldLine === undefined ? {} : { foldLine: args.foldLine }),
  });
  if (draft.isErr()) {
    logger.error({ msg: `talk list-add: ${draft.error.message}` });
    return EXIT_USAGE;
  }
  const added = appendRunningList({
    draft: draft.value,
    home: talkHomeOf({ home: args.home }),
    nowIso: () => new Date().toISOString(),
  });
  if (added.isErr()) {
    logger.error({ msg: `talk list-add: ${added.error.message}` });
    return EXIT_ERROR;
  }
  if (args.json) {
    logger.out({ line: JSON.stringify(added.value) });
    return EXIT_OK;
  }
  const { item, appended } = added.value;
  logger.out({
    line: appended
      ? `added #${String(item.seq)} to the running list`
      : `#${String(item.seq)} already holds ${item.id}; nothing added`,
  });
  return EXIT_OK;
}

export const talkListCommand = defineCommand({ run: runTalkList });

export const talkListAddCommand = defineCommand({ run: runTalkListAdd });
