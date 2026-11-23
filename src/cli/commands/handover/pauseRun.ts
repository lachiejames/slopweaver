/**
 * `slopweaver handover pause` and `slopweaver handover unpause` — the two verbs that move a row into and out
 * of the one state the board could not previously express.
 *
 * ## Why these are verbs rather than a documented hand edit
 *
 * A pause is THREE front-matter facts that only make sense together — `status: paused`, `pausedOn:` naming a
 * person, and the date it was recorded — and `../../../handover/paused.ts` refuses the row outright when they
 * disagree. A convention asking authors to type all three by hand produces exactly the malformed rows that
 * refusal exists to catch, on the surface where being wrong is most expensive: a row that falls into
 * `CONTRADICTION` is a workstream nobody is watching any more.
 *
 * `status:` is also the one scalar `addFrontMatterFields` deliberately cannot write — it is add-only, because
 * the fields it was built for are recorded once — so pausing through that door was never possible without
 * {@link ../../../handover/frontmatter.editFrontMatterFields}, which these verbs are the first callers of.
 *
 * ## No clock passes through here
 *
 * `--since` and its default record WHEN the pause was taken, and nothing in this repository subtracts from
 * that value. There is no until-date, no cadence flag and no reminder: a pause has no time
 * limit and no deadline. Unpausing is a decision somebody types, which is why `handover start` and `cmux
 * spawn` refuse a paused row and name this verb rather than resuming one on their own.
 */

import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { settledAskRefusal } from "../../../handover/askRow.js";
import { type HandoverDoc, isTerminalDocStatus, parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields } from "../../../handover/frontmatter.js";
import { pausedStateOf } from "../../../handover/paused.js";
import { type PauseEditError, PauseEditErrors } from "../../../handover/pauseEditErrors.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { recordedSubject } from "./pauseOwnerCheck.js";
import { pauseFields, pauseFlag, pausePlan, unpausePlan } from "./pausePlan.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover pause` accepts. */
const PAUSE_FLAGS: FlagSpec = { boolean: [], string: ["on", "why", "since", "dir", "home"] };

/** The flags `handover unpause` accepts. */
const UNPAUSE_FLAGS: FlagSpec = { boolean: [], string: ["status", "why", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_PAUSE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: PAUSE_FLAGS }),
  ...booleanFlagsOf({ spec: PAUSE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_UNPAUSE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: UNPAUSE_FLAGS }),
  ...booleanFlagsOf({ spec: UNPAUSE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover pause`'s own flags — exported for the help-truth ratchet. Positionals are allowed because
 * the slug is one.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverPauseArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: PAUSE_FLAGS });
}

/**
 * Parse `handover unpause`'s own flags — exported for the help-truth ratchet.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverUnpauseArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: UNPAUSE_FLAGS });
}

export const PAUSE_USAGE =
  "usage: slopweaver handover pause <slug> --on <who> [--why <text>] [--since <iso>] " +
  "[--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Parks a row on a PERSON. It stays live and visible on the board and in your briefing, under\n" +
  "PAUSED, with no deadline, no cadence and nothing that can ever be overdue.\n" +
  "\n" +
  "  --on <who>     who it waits on, in your own words — a person, a team, an outside party. Required,\n" +
  "                 because `paused` with nobody named is the parking this state was built to replace.\n" +
  "                 Name the owner by role (`the owner`): the Queue reads that as waiting on the owner\n" +
  "  --why <text>   what is actually being waited for; written to `statusSummary:`\n" +
  "  --since <iso>  when the pause began, defaulting to now. Provenance only — nothing counts from it\n" +
  "\n" +
  'example: slopweaver handover pause a-daily-post --on "the reviewer it was sent to" --why "sample sent, no reply yet"';

export const UNPAUSE_USAGE =
  "usage: slopweaver handover unpause <slug> [--status ready|in-progress] [--why <text>] " +
  "[--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Takes a row off pause, because they came back or because you decided to move without them.\n" +
  "A deliberate act: `handover start` and `cmux spawn` refuse a paused row rather than doing this\n" +
  "for you.\n" +
  "\n" +
  "  --status       what it becomes; `ready` by default, `in-progress` when a session is still inside it\n" +
  "  --why <text>   what unblocked it; written to `statusSummary:`\n" +
  "\n" +
  'example: slopweaver handover unpause a-daily-post --why "they replied in the thread"';

/** The row this verb is about, or why the board refuses to touch it. */
function pauseTarget({
  docs,
  slug,
}: {
  docs: readonly HandoverDoc[];
  slug: string;
}): { readonly refusal: string } | { readonly row: HandoverDoc } {
  const row = docs.find((doc) => doc.slug === slug);
  if (row === undefined) {
    return { refusal: `no row on the board claims the slug "${slug}"` };
  }
  if (row.problems.length > 0) {
    return { refusal: `${slug} does not parse cleanly, so nothing may be written to it: ${row.problems[0]!}` };
  }
  return { row };
}

/**
 * Write a pause, or its lifting, into the row's own front-matter, or say what stopped it. The row is read, re-judged
 * by `refusal` and replaced atomically inside its one lock (`./boardRowLock.ts`), so a steer or a priority landing on
 * the same row at the same moment is kept rather than written over, and a row paused or settled since the board scan
 * is refused as it reads NOW.
 *
 * @param path the row's file, as the board scan found it
 * @param slug the row the verb resolved, which the file must still hold
 * @param set the front-matter fields to write
 * @param remove the front-matter keys to drop
 * @param refusal why the row as it reads under the lock may not take this edit, or `undefined` when it may
 * @param rowLock how the write waits on the row's lock when another writer holds it
 * @returns the row as it read under the lock before the edit, or every reason nothing was written
 */
export function writePauseEdit({
  path,
  slug,
  set,
  remove,
  refusal,
  rowLock,
}: {
  path: string;
  slug: string;
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
  refusal: (row: { readonly current: HandoverDoc }) => string | undefined;
  rowLock?: BoardRowLockOptions;
}): Result<HandoverDoc, PauseEditError> {
  const locked = withBoardRowLock({
    ...rowLock,
    path,
    write: ({ target }) => editUnderLock({ path, refusal, remove, set, slug, target }),
  });
  if (locked.isErr()) {
    return err(PauseEditErrors.lock({ message: locked.error.message }));
  }
  return locked.value;
}

/** {@link writePauseEdit}'s read, judgement and write, run under the row's lock on the real file `target`. */
function editUnderLock({
  path,
  slug,
  set,
  remove,
  refusal,
  target,
}: {
  path: string;
  slug: string;
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
  refusal: (row: { readonly current: HandoverDoc }) => string | undefined;
  target: string;
}): Result<HandoverDoc, PauseEditError> {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return err(PauseEditErrors.file({ detail: `cannot read it: ${String(cause)}`, path }));
  }
  const current = parseHandoverDoc({ path, text });
  if (current.slug !== slug) {
    return err(PauseEditErrors.file({ detail: `now holds the row "${current.slug}", not "${slug}"`, path }));
  }
  if (current.problems.length > 0) {
    return err(PauseEditErrors.malformed({ problem: current.problems[0]!, slug: current.slug }));
  }
  const refused = refusal({ current });
  if (refused !== undefined) {
    return err(PauseEditErrors.refused({ why: refused }));
  }
  const edited = editFrontMatterFields({ path, remove, set, text });
  if (edited.isErr()) {
    return err(PauseEditErrors.frontMatter({ cause: edited.error }));
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return err(PauseEditErrors.file({ detail: `could not write it: ${String(cause)}`, path }));
  }
  return ok(current);
}

/** The state home both verbs resolve the same way. */
function boardHome({ values }: { values: Readonly<Record<string, unknown>> }): string {
  return resolveHome({ named: pauseFlag({ name: "home", values }) });
}

/** The handover directory both verbs resolve the same way. */
function boardDir({ values }: { values: Readonly<Record<string, unknown>> }): string {
  return resolveHandoverDir({ dir: pauseFlag({ name: "dir", values }), home: boardHome({ values }) });
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems, usage, verb }: { problems: readonly string[]; usage: string; verb: string }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover ${verb}: ${problem}` });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/** Print every reason a write did not happen, and hand back the exit code. */
function writeRefused({ problems, verb }: { problems: readonly string[]; verb: string }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover ${verb}: ${problem}` });
  });
  return EXIT_ERROR;
}

/** The row both verbs act on, or the exit code to stop on, having already printed why. */
function resolveRow({
  slug,
  values,
  verb,
}: {
  slug: string;
  values: Readonly<Record<string, unknown>>;
  verb: string;
}): HandoverDoc | number {
  const scan = scanBoard({ handoverDir: boardDir({ values }) });
  if (scan.isErr()) {
    logger.error({ msg: `handover ${verb}: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const target = pauseTarget({ docs: scan.value.docs, slug });
  if ("refusal" in target) {
    logger.error({ msg: `handover ${verb}: ${target.refusal}` });
    return EXIT_ERROR;
  }
  return target.row;
}

/**
 * Park a row on a person.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverPause(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PAUSE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverPauseArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error, usage: PAUSE_USAGE, verb: "pause" });
  }
  const values = parsed.value.values;
  const plan = pausePlan({ nowIso: new Date().toISOString(), positionals: parsed.value.positionals, values });
  if ("refusal" in plan) {
    return usageRefused({ problems: [plan.refusal], usage: PAUSE_USAGE, verb: "pause" });
  }
  const target = resolveRow({ slug: plan.slug, values, verb: "pause" });
  if (typeof target === "number") {
    return target;
  }
  const refusal = pauseRefusal({ row: target });
  if (refusal !== undefined) {
    logger.error({ msg: `handover pause: ${refusal}` });
    return EXIT_ERROR;
  }
  // Only a row that will take the pause pays for the owner check, so a refusal stays as fast as it was.
  const recorded = {
    ...plan,
    who: await recordedSubject({ home: boardHome({ values }), identityRoster: identityRosterPort(), who: plan.who }),
  };
  const written = writePauseEdit({
    path: target.path,
    refusal: ({ current }) => pauseRefusal({ row: current }),
    remove: [],
    set: pauseFields(recorded),
    slug: plan.slug,
  });
  if (written.isErr()) {
    return writeRefused({ problems: written.error.reasons, verb: "pause" });
  }
  logger.out({
    line: `handover pause: ${plan.slug} is paused on ${recorded.who} since ${plan.since} — no deadline, never overdue`,
  });
  const mirrorFailed = await mirrorAfterWrite({ home: boardHome({ values }), path: target.path, verb: "pause" });
  return mirrorFailed ? EXIT_ERROR : EXIT_OK;
}

/**
 * Why a row may not be paused, or `undefined` when it may.
 *
 * A terminal row is refused rather than re-opened: work that was cancelled is not waiting on anybody, and a
 * pause that quietly revived it would be the kind of status reversal `boardState.ts` treats as a
 * contradiction everywhere else.
 *
 * @param row the row as it reads now
 * @returns why it may not be paused, or `undefined` when it may
 */
export function pauseRefusal({ row }: { row: HandoverDoc }): string | undefined {
  const already = pausedStateOf({ doc: row });
  if (already !== undefined) {
    return `${row.slug} is already paused on ${already.who} — unpause it first if the subject changed`;
  }
  const settled = settledAskRefusal({ doc: row });
  if (settled !== undefined) {
    return settled;
  }
  if (isTerminalDocStatus(row.status)) {
    return `${row.slug} is ${row.status} — closed work is not waiting on anybody`;
  }
  return undefined;
}

/** Why a row may not be unpaused — it is not paused — or `undefined` when it may. */
function unpauseRefusal({ row }: { row: HandoverDoc }): string | undefined {
  if (pausedStateOf({ doc: row }) !== undefined) {
    return undefined;
  }
  return `${row.slug} is not paused (status: ${row.status}) — nothing to resume`;
}

/**
 * Take a row off pause.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverUnpause(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: UNPAUSE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverUnpauseArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error, usage: UNPAUSE_USAGE, verb: "unpause" });
  }
  const values = parsed.value.values;
  const plan = unpausePlan({ positionals: parsed.value.positionals, values });
  if ("refusal" in plan) {
    return usageRefused({ problems: [plan.refusal], usage: UNPAUSE_USAGE, verb: "unpause" });
  }
  const target = resolveRow({ slug: plan.slug, values, verb: "unpause" });
  if (typeof target === "number") {
    return target;
  }
  const notPaused = unpauseRefusal({ row: target });
  if (notPaused !== undefined) {
    logger.error({ msg: `handover unpause: ${notPaused}` });
    return EXIT_ERROR;
  }
  const written = writePauseEdit({
    path: target.path,
    refusal: ({ current }) => unpauseRefusal({ row: current }),
    remove: ["pausedOn", "pausedSince"],
    set: [
      { key: "status", value: plan.status },
      ...(plan.why === undefined ? [] : [{ key: "statusSummary", value: plan.why }]),
    ],
    slug: plan.slug,
  });
  if (written.isErr()) {
    return writeRefused({ problems: written.error.reasons, verb: "unpause" });
  }
  // The pause as the row read under the lock, which `unpauseRefusal` has just confirmed is there.
  const was = pausedStateOf({ doc: written.value })!;
  logger.out({ line: `handover unpause: ${plan.slug} is ${plan.status} — it was paused on ${was.who}` });
  const mirrorFailed = await mirrorAfterWrite({ home: boardHome({ values }), path: target.path, verb: "unpause" });
  return mirrorFailed ? EXIT_ERROR : EXIT_OK;
}

export const handoverPauseCommand = defineCommand({ run: runHandoverPause });

export const handoverUnpauseCommand = defineCommand({ run: runHandoverUnpause });
