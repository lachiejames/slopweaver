/**
 * `slopweaver handover recheck` — the way back to ready for a finding the trunk-moved hold took off it.
 *
 * `handover reconcile` holds a ready finding whose evidence the trunk has changed since it was asked
 * (`../../../handover/trunkMoved.ts`), and names the commits. A session reads them: if they answered the row
 * it is settled with `handover settle`, which needs nothing new; if the row is still real, this verb records
 * the check that showed it, the instant and the trunk tip, as `trunkRechecked:`, `trunkRecheckedIso:` and
 * `trunkRecheckedSha:`. The hold then reads only commits after that instant that the tip did not already carry,
 * so the same commits never hold the row twice, a future-dated one included.
 *
 * `reconfirm` is not reused: it re-dates a question a run is WAITING on the owner with, and a ready finding has no
 * run. The instant is this verb's own clock — an age a caller can type is an age that can lie, exactly as
 * `stillRealIso:` is written by `register`.
 */

import { readFileSync } from "node:fs";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../../../config.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { withBoardRowLock } from "./boardRowLock.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { RECHECK_USAGE } from "./recheckUsage.js";
import { trunkTipSha } from "./trunkMovedRead.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover recheck` accepts. */
const RECHECK_FLAGS = { boolean: [], string: ["still-real", "dir", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_RECHECK_FLAG_NAMES: readonly string[] = [...RECHECK_FLAGS.string, ...RECHECK_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover recheck`'s own flags — exported for the help-truth ratchet. The one positional is the slug.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverRecheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: RECHECK_FLAGS });
}

/**
 * Why this row may not be rechecked, or `undefined` when it may.
 *
 * @param doc the row as it reads now
 * @returns the refusal sentence, or `undefined`
 */
export function recheckRefusal({ doc }: { doc: HandoverDoc }): string | undefined {
  if (doc.problems.length > 0) {
    return `${doc.slug} does not parse cleanly, so nothing may be written to it: ${doc.problems[0]!}`;
  }
  if (doc.kind !== "ask" || doc.origin !== "finding") {
    return `${doc.slug} is not a finding ask, and only a ready finding is held on the trunk moving under it`;
  }
  if (doc.settlement !== undefined) {
    return `${doc.slug} is already settled ${doc.settlement}, so there is nothing to offer again`;
  }
  return undefined;
}

/**
 * The front-matter lines a recheck writes, and the one it removes.
 *
 * @param stillReal the check the session re-ran against the trunk
 * @param nowIso this verb's own clock
 * @param trunkSha the row's trunk tip as it read now, or `undefined` when it did not resolve — an earlier
 *   recheck's tip is then removed rather than left to claim this recheck saw only what that one did
 * @returns the fields to set, the instant first, and the keys to remove
 */
export function recheckFields({
  stillReal,
  nowIso,
  trunkSha,
}: {
  stillReal: string;
  nowIso: string;
  trunkSha: string | undefined;
}): {
  readonly set: readonly { readonly key: string; readonly value: string }[];
  readonly remove: readonly string[];
} {
  const set = [
    { key: "trunkRecheckedIso", value: nowIso },
    { key: "trunkRechecked", value: JSON.stringify(stillReal) },
  ];
  if (trunkSha === undefined) {
    return { remove: ["trunkRecheckedSha"], set };
  }
  return { remove: [], set: [...set, { key: "trunkRecheckedSha", value: trunkSha }] };
}

/**
 * Write the recheck into one row, re-judging the file as it reads NOW rather than as the board scan saw it.
 *
 * The read, judgement and atomic write all happen inside the row's one lock (`./boardRowLock.ts`), so no other row
 * edit is written over. The trunk tip is read BEFORE the lock, off the repository the scan saw, because it runs `git`
 * and the lock is the whole board's; a row whose `repo:` changed since then is refused rather than given another
 * repository's tip.
 *
 * @param doc the row as the board scan read it
 * @param stillReal the check the session re-ran
 * @param nowIso this verb's own clock
 * @returns every reason nothing was written — empty when the row now carries the recheck
 */
function writeRecheck({
  doc,
  stillReal,
  nowIso,
}: {
  doc: HandoverDoc;
  stillReal: string;
  nowIso: string;
}): readonly string[] {
  const trunkSha = doc.repo === undefined ? undefined : trunkTipSha({ repo: doc.repo });
  const locked = withBoardRowLock({
    path: doc.path,
    write: ({ target }) => writeRecheckAt({ doc, nowIso, stillReal, target, trunkSha }),
  });
  if (locked.isErr()) {
    return [locked.error.message];
  }
  return locked.value;
}

/** {@link writeRecheck}'s read, judgement and write, run under the row's lock on the real file `target`. */
function writeRecheckAt({
  doc,
  stillReal,
  nowIso,
  target,
  trunkSha,
}: {
  doc: HandoverDoc;
  stillReal: string;
  nowIso: string;
  target: string;
  trunkSha: string | undefined;
}): readonly string[] {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return [`cannot read ${doc.path}: ${String(cause)}`];
  }
  const current = parseHandoverDoc({ path: doc.path, text });
  if (current.slug !== doc.slug) {
    return [`${doc.path} now holds the row "${current.slug}", not "${doc.slug}" — nothing was written`];
  }
  const refusal = recheckRefusal({ doc: current });
  if (refusal !== undefined) {
    return [refusal];
  }
  if (current.repo !== doc.repo) {
    return [`${doc.slug}'s repo: changed while its trunk tip was read — nothing was written, so run it again`];
  }
  const fields = recheckFields({ nowIso, stillReal, trunkSha });
  const edited = editFrontMatterFields({ path: doc.path, remove: fields.remove, set: fields.set, text });
  if (edited.isErr()) {
    return frontMatterErrorLines({ error: edited.error });
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return [`could not write ${doc.path}: ${String(cause)}`];
  }
  return [];
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover recheck: ${problem}` });
  });
  logger.error({ msg: RECHECK_USAGE });
  return EXIT_USAGE;
}

/**
 * Record that a held finding is still real after the trunk commits that held it.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverRecheck(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RECHECK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverRecheckArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const { positionals, values } = parsed.value;
  const stillReal = typeof values["still-real"] === "string" ? values["still-real"].trim() : "";
  if (positionals.length !== 1 || stillReal.length === 0) {
    return usageRefused({ problems: ["which row, and what did you re-run? Pass one slug and --still-real"] });
  }
  const slug = positionals[0]!;
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const scan = scanBoard({
    handoverDir: resolveHandoverDir({ dir: typeof values["dir"] === "string" ? values["dir"] : undefined, home }),
  });
  if (scan.isErr()) {
    logger.error({ msg: `handover recheck: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const claimed = scan.value.docs.filter((doc) => doc.slug === slug);
  if (claimed.length !== 1) {
    const why = claimed.length === 0 ? "no row on the board claims" : `${String(claimed.length)} rows claim`;
    logger.error({ msg: `handover recheck: ${why} the slug "${slug}"` });
    return EXIT_ERROR;
  }
  const doc = claimed[0]!;
  const problems = writeRecheck({ doc, nowIso: new Date().toISOString(), stillReal });
  if (problems.length > 0) {
    problems.forEach((problem) => {
      logger.error({ msg: `handover recheck: ${problem}` });
    });
    return EXIT_ERROR;
  }
  logger.out({
    line: `handover recheck: ${slug} rechecked against the trunk — the hold now reads only commits after this instant`,
  });
  return (await mirrorAfterWrite({ home, path: doc.path, verb: "recheck" })) ? EXIT_ERROR : EXIT_OK;
}

export const handoverRecheckCommand = defineCommand({ run: runHandoverRecheck });
