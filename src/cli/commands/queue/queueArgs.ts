/*
 * The argv and queue vocabulary every `slopweaver queue` verb shares.
 *
 * Nothing here sends, and nothing here writes: it reads the log, folds it, and turns one verb's argv into
 * the home, positionals and values the verb asked for. `./run.ts` and `./queueReleaseDoor.ts` stand on it
 * and it stands on nothing of the family.
 */
import { foldQueue, parseQueueLog, type QueueItem } from "../../../admit/queue.js";
import { readQueueText } from "../../../admit/queueStore.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { parseQueueArgs, type QueueVerb } from "./core.js";

/** Where this noun's own arguments start in `process.argv`: `[node, cli, queue, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Fold the queue log into its current entries.
 *
 * @returns the folded entries, and the 1-based numbers of the log lines that could not be read
 */
export function loadQueue({ home }: { home: string }): {
  readonly items: readonly QueueItem[];
  readonly unreadable: readonly number[];
} {
  const { events, unreadable } = parseQueueLog({ text: readQueueText({ home }) });
  return { items: foldQueue({ events }), unreadable };
}

/**
 * Warn about lines the log could not read.
 *
 * Never silent, and never fatal. A malformed line must not make the rest of the queue unreadable, but a
 * skipped `held` line is a draft somebody was PROMISED was queued — so the count is printed rather than
 * swallowed, and an operator who sees one knows the list below may be short.
 */
export function warnUnreadable({ unreadable }: { unreadable: readonly number[] }): void {
  if (unreadable.length > 0) {
    logger.error({
      msg:
        `${String(unreadable.length)} queue line(s) could not be read (line(s) ${unreadable.join(", ")}) — ` +
        "the list below may be missing a held draft",
    });
  }
}

/**
 * Read one flag out of a parsed argv's values.
 *
 * @returns the flag's value, or `undefined` when it was absent or arrived as a bare boolean
 */
export function str({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Read the `--note` a verb was given.
 *
 * @returns the note, or the empty string — the event shape has no optional note to omit
 */
export function noteText({ values }: { values: Readonly<Record<string, string | boolean>> }): string {
  const value = values["note"];
  return typeof value === "string" ? value : "";
}

/** One verb's parsed tail plus its resolved home, or `undefined` after the usage was printed. */
export interface VerbArgs {
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
  readonly home: string;
}

/**
 * Parse a verb's argv tail against its spec, reporting every rejection and then the usage.
 *
 * One helper for all four verbs rather than the same nine lines four times — a per-verb copy is how the
 * usage a caller sees drifts from the flags the verb actually accepts, which this repo already has a ratchet
 * for because it happened.
 *
 * @returns the resolved home, the positionals and the flag values, or `undefined` once the rejection is printed
 */
export function verbArgs({
  argv,
  verb,
  usage,
}: {
  argv: readonly string[];
  verb: QueueVerb;
  usage: string;
}): VerbArgs | undefined {
  const parsed = parseQueueArgs({ rest: argv.slice(VERB_ARG_OFFSET), verb });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: usage });
    return undefined;
  }
  const values = parsed.value.values;
  const { positionals } = parsed.value;
  const flagged = str({ key: "home", values });
  if (flagged === undefined) {
    return { home: slopweaverHome(), positionals, values };
  }
  return { home: flagged, positionals, values };
}

/**
 * Find one queue entry by the id an operator typed.
 *
 * @returns the entry, or `undefined` after reporting why it could not be found
 */
export function findItem({ home, id }: { home: string; id: string }): QueueItem | undefined {
  const { items, unreadable } = loadQueue({ home });
  warnUnreadable({ unreadable });
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) {
    logger.error({ msg: `no queue entry \`${id}\` — list them with \`slopweaver queue list --all\`` });
  }
  return item;
}
