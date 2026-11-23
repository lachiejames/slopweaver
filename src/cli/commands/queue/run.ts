/**
 * `slopweaver queue` — read and drain the queue of replies the door held rather than sent.
 *
 * The effectful shell over `./core.ts`. Four verbs: `list` and `show` read, `drop` resolves an entry without
 * sending it, and `release` is the BREAK-GLASS.
 *
 * ## What `release` actually does, because the mechanism matters
 *
 * It does not bypass the door. It replays the original withhold — the same finding, the same reason, built
 * from what the entry recorded — and then supplies the override token that waives it. The door therefore
 * records a `pass` whose `overridden` array names `withhold.reply`, so the ledger says "this was held, and
 * then a human released it" rather than showing an ordinary send that leaves no trace of the decision.
 *
 * That is the repo's standing constraint made concrete: block by default, always with a break-glass, and the
 * override is recorded.
 *
 * The four verbs, and the one choice between the two draft shapes. Everything else moved out beside it:
 * `./queueArgs.ts` for the argv and queue vocabulary, `./queueHeldDraft.ts` for reading a held draft back,
 * `./queueReleaseAnswer.ts` and `./queueReleaseArtifact.ts` for the two shapes, and `./queueReleaseDoor.ts`,
 * which is the only module that may append a `released` event.
 */
import { type QueueItem } from "../../../admit/queue.js";
import { appendQueueEvent } from "../../../admit/queueStore.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  QUEUE_DROP_USAGE,
  QUEUE_LIST_USAGE,
  QUEUE_RELEASE_USAGE,
  QUEUE_SHOW_USAGE,
  queueListLines,
  queueShowLines,
} from "./core.js";
import { findItem, loadQueue, noteText, str, verbArgs, warnUnreadable } from "./queueArgs.js";
import { parseHeldAnswer, replacementDraft } from "./queueHeldDraft.js";
import { sendAnswerRelease } from "./queueReleaseAnswer.js";
import { sendArtifactRelease } from "./queueReleaseArtifact.js";

/**
 * `slopweaver queue list` — the replies the door held.
 *
 * @param argv the FULL process argv; this verb's tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runQueueList(argv: readonly string[]): Promise<number> {
  const args = verbArgs({ argv, usage: QUEUE_LIST_USAGE, verb: "list" });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const { items, unreadable } = loadQueue({ home: args.home });
  warnUnreadable({ unreadable });
  if (args.values["json"] === true) {
    logger.out({ line: JSON.stringify({ items }, null, 2) });
    return EXIT_OK;
  }
  for (const line of queueListLines({ items, showResolved: args.values["all"] === true })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * `slopweaver queue show <id>` — one held entry, whole.
 *
 * @param argv the FULL process argv; this verb's tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runQueueShow(argv: readonly string[]): Promise<number> {
  const args = verbArgs({ argv, usage: QUEUE_SHOW_USAGE, verb: "show" });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const id = args.positionals[0];
  if (id === undefined) {
    logger.error({ msg: QUEUE_SHOW_USAGE });
    return EXIT_USAGE;
  }
  const item = findItem({ home: args.home, id });
  if (item === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  if (args.values["json"] === true) {
    logger.out({ line: JSON.stringify(item, null, 2) });
    return EXIT_OK;
  }
  for (const line of queueShowLines({ item })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * `slopweaver queue drop <id>` — resolve an entry without sending it.
 *
 * @param argv the FULL process argv; this verb's tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runQueueDrop(argv: readonly string[]): Promise<number> {
  const args = verbArgs({ argv, usage: QUEUE_DROP_USAGE, verb: "drop" });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const id = args.positionals[0];
  if (id === undefined) {
    logger.error({ msg: QUEUE_DROP_USAGE });
    return EXIT_USAGE;
  }
  const item = findItem({ home: args.home, id });
  if (item === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  if (item.state !== "held") {
    logger.error({ msg: `\`${id}\` is already ${item.state} — nothing to drop` });
    return EXIT_EXPECTED_EMPTY;
  }
  appendQueueEvent({
    event: { id, kind: "dropped", note: noteText({ values: args.values }), tsIso: new Date().toISOString() },
    home: args.home,
  });
  logger.out({ line: `dropped ${id} — the draft stays in the log, and nothing was sent` });
  return EXIT_OK;
}

/**
 * `slopweaver queue release <id>` — the break-glass.
 *
 * @param argv the FULL process argv; this verb's tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runQueueRelease(argv: readonly string[]): Promise<number> {
  const args = verbArgs({ argv, usage: QUEUE_RELEASE_USAGE, verb: "release" });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const id = args.positionals[0];
  if (id === undefined) {
    logger.error({ msg: QUEUE_RELEASE_USAGE });
    return EXIT_USAGE;
  }
  const item = findItem({ home: args.home, id });
  if (item === undefined) {
    return EXIT_EXPECTED_EMPTY;
  }
  // Already released and released again is a DOUBLE POST into somebody's thread, which is the one mistake a
  // queue must not make easy — so a resolved entry is refused rather than re-sent.
  if (item.state !== "held") {
    logger.error({ msg: `\`${id}\` is already ${item.state} — refusing to send it a second time` });
    return EXIT_EXPECTED_EMPTY;
  }
  const replacement = await replacementDraft({ form: str({ key: "form", values: args.values }) });
  if (replacement !== undefined && "failure" in replacement) {
    logger.error({ msg: replacement.failure });
    return EXIT_USAGE;
  }
  return sendRelease({
    dryRun: args.values["dry-run"] === true,
    home: args.home,
    item,
    note: noteText({ values: args.values }),
    ...(replacement === undefined ? {} : { replacement: replacement.draft }),
  });
}

/** The draft a release posts: the operator's `--form` substitute when one was given, else the held draft. */
function releaseDraft({
  item,
  replacement,
}: {
  item: QueueItem;
  replacement: Readonly<Record<string, unknown>> | undefined;
}): Readonly<Record<string, unknown>> {
  if (replacement !== undefined) {
    return replacement;
  }
  return item.held.draft;
}

/**
 * Validate the stored draft and release it — as the answer form when it parses as one, else as an
 * `UpdateArtifact` card. Both render through the same accent-only answer wrapper; neither ever calls the
 * operator card renderer.
 */
async function sendRelease({
  dryRun,
  home,
  item,
  note,
  replacement,
}: {
  dryRun: boolean;
  home: string;
  item: QueueItem;
  note: string;
  replacement?: Readonly<Record<string, unknown>>;
}): Promise<number> {
  const raw = releaseDraft({ item, replacement });
  const asAnswer = parseHeldAnswer({ raw });
  if (asAnswer !== undefined) {
    return sendAnswerRelease({ ...asAnswer, dryRun, home, item, note, replacement });
  }
  return sendArtifactRelease({ dryRun, home, item, note, raw, replacement });
}

export const queueListCommand = defineCommand({ run: runQueueList });

export const queueShowCommand = defineCommand({ run: runQueueShow });

export const queueReleaseCommand = defineCommand({ run: runQueueRelease });

export const queueDropCommand = defineCommand({ run: runQueueDrop });
