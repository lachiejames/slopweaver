/**
 * `slopweaver handover tag` — set or drop typed `key=value` tags on one board row, recorded as a `tagged` event in
 * its journal. The vocabulary and why it is closed: `../../../handover/rowTags.ts`; the lock and what it freezes:
 * `../../../handover/tagStore.ts`.
 *
 * Idempotent: a write names the state the row should be in, so running it twice leaves the row as once and exits
 * 0 with `unchanged`. No `--dir`: a journal is keyed by (home, slug), so a tag on a custom
 * board's row would land in the home board's journal of the same name.
 */

import { isSafeSlug } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import { acquireRowTagsLock, tagRowUnderLock } from "../../../handover/tagStore.js";
import { parseTagRequest, type TagRequest } from "../../../handover/tagWrite.js";
import { TagWriteErrors } from "../../../handover/tagWriteErrors.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { printTagOutcome, printTagRecovery } from "./tagReceipt.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover tag` accepts. */
const TAG_FLAGS = { boolean: [], string: ["drop", "why", "new-value", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_TAG_FLAG_NAMES: readonly string[] = [...TAG_FLAGS.string, ...TAG_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover tag`'s own flags — exported for the help-truth ratchet. Positionals are the slug, then the
 * `key=value` assignments.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverTagArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: TAG_FLAGS });
}

export const TAG_USAGE =
  "usage: slopweaver handover tag <slug> [<key>=<value> ...] [--drop <key|key=value>[,...]] --why <text>\n" +
  "         [--new-value <key>=<value>[,...]] [--home <dir>]\n" +
  "\n" +
  "Sets or drops typed tags on one board row, recorded in its journal with who and why. The keys are a\n" +
  "closed list (skills/handover/reference/row-tags.md); a misspelt key is refused naming the nearest one.\n" +
  "A write names the state the row should be in: what it already holds is left alone, and a second run\n" +
  "changes nothing.\n" +
  "\n" +
  "  --drop <...>       a whole key, or key=value to drop one value of a key that holds several\n" +
  "  --why <text>       why the row carries these tags — kept in the journal beside them\n" +
  "  --new-value <...>  a workstream (or any key marked so) no row carries yet is refused as a likely typo\n" +
  "                     unless named here\n" +
  "\n" +
  "example: slopweaver handover tag iso-policy-row workstream=iso-certification impact=high --why " +
  '"ISO certification work"';

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover tag: ${problem}` });
  });
  logger.error({ msg: TAG_USAGE });
  return EXIT_USAGE;
}

/** A string flag's value, or `undefined` when it was not passed. */
function flag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** One validated `handover tag` invocation. */
interface PlannedTag {
  readonly slug: string;
  readonly why: string;
  readonly request: TagRequest;
  /** `--home` as passed — the recovery command repeats it only when the caller named one. */
  readonly named: string | undefined;
}

/** Validate everything a tag write needs before the lock is taken, or name what is wrong. */
function planTag({ rest }: { rest: readonly string[] }): { readonly problems: readonly string[] } | PlannedTag {
  const parsed = parseHandoverTagArgs({ rest });
  if (parsed.isErr()) {
    return { problems: parsed.error };
  }
  const { positionals, values } = parsed.value;
  const [slug, ...assignments] = positionals;
  if (slug === undefined || !isSafeSlug({ slug })) {
    return { problems: ["name the row first — a plain slug (letters, digits, . _ -)"] };
  }
  const why = flag({ name: "why", values });
  if (why === undefined || why.trim().length === 0) {
    return { problems: ["--why is required — why the row carries these tags"] };
  }
  const request = parseTagRequest({
    assignments,
    drops: flag({ name: "drop", values }),
    newValues: flag({ name: "new-value", values }),
  });
  if (request.isErr()) {
    return { problems: request.error };
  }
  return { named: flag({ name: "home", values }), request: request.value, slug, why };
}

/** Scan the board and write the tag, the lock ALREADY held. */
function tagWithLockHeld({ planned, home }: { planned: PlannedTag; home: string }): number {
  const paths = stateHomePaths({ home });
  const scan = scanBoard({ handoverDir: paths.handovers });
  if (scan.isErr()) {
    logger.error({ msg: `handover tag: ${TagWriteErrors.boardUnread({ cause: scan.error }).message}` });
    return EXIT_ERROR;
  }
  if (scan.value.unreadable.length > 0) {
    logger.error({
      msg: `handover tag: ${TagWriteErrors.boardPartial({ unreadable: scan.value.unreadable }).message}`,
    });
    return EXIT_ERROR;
  }
  const { request, slug, why } = planned;
  const outcome = tagRowUnderLock({
    docs: scan.value.docs,
    handoverDir: paths.handovers,
    now: () => new Date().toISOString(),
    request,
    runsDir: paths.runs,
    slug,
    why,
  });
  if (outcome.isErr()) {
    logger.error({ msg: `handover tag: ${outcome.error.message}` });
    if (outcome.error.code === "TAG_APPEND_FAILED") {
      printTagRecovery({ home: planned.named, request, runsDir: paths.runs, slug, why });
    }
    return EXIT_ERROR;
  }
  printTagOutcome({ out: logger.out, outcome: outcome.value, slug });
  return EXIT_OK;
}

/**
 * Tag one board row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runHandoverTag(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TAG_USAGE });
    return EXIT_OK;
  }
  const planned = planTag({ rest });
  if ("problems" in planned) {
    return usageRefused({ problems: planned.problems });
  }
  const home = resolveHome({ named: planned.named });
  const lock = acquireRowTagsLock({ home, nowIso: new Date().toISOString() });
  if (lock.isErr()) {
    logger.error({ msg: `handover tag: ${lock.error.message}` });
    return EXIT_ERROR;
  }
  try {
    return tagWithLockHeld({ home, planned });
  } finally {
    lock.value.release();
  }
}

export const handoverTagCommand = defineCommand({ run: runHandoverTag });
