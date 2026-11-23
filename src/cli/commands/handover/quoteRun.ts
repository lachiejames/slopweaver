/**
 * `slopweaver handover quote` — write the owner's own words onto every board row whose anchor names them, retroactively.
 *
 * A queue card leads with the owner's exact words, on existing cards as on new ones. `handover register` quotes a row as it is born
 * (`./registerHisWords.ts`); this is the way back for every row born before that, and for a row whose record grew
 * or whose group a hand edit broke. What it reads and when it writes is `./quotePlan.ts`.
 *
 * **Dry by default.** It prints what each row needs; `--apply` writes. A row is re-read and re-judged immediately
 * before its write, exactly as `./setRepoRun.ts` does, so a row another writer changed in between is judged as it
 * is NOW, under the row's one lock (`./boardRowLock.ts`), which every row writer takes, so no two row writes
 * interleave.
 */
import { safeJsonStringify } from "#lib/safeJson.js";

import { slopweaverHome } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import { rowBySlug } from "../../../handover/rowBySlug.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { QUOTE_ATTACH_LOGGER, runQuoteAttach } from "./quoteAttach.js";
import { printQuoteOutcomes, type QuoteOutcome } from "./quoteOutcome.js";
import { quoteRunIncomplete, quoteVerdict, quoteVerdictPhrase, unreadableInScope } from "./quotePlan.js";
import { quoteWrites, readRowAnchor, writeQuotedRow } from "./quoteRow.js";
import { fencelessDocs, rowsToRead } from "./quoteRowsInScope.js";
import { relateOneSteer, steersOf, withSteers } from "./quoteSteerRun.js";
import { QUOTE_USAGE } from "./quoteUsage.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover quote` accepts. */
const QUOTE_FLAGS = {
  boolean: ["apply", "check", "json"],
  string: ["add-steer", "anchor", "dir", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_QUOTE_FLAG_NAMES: readonly string[] = [...QUOTE_FLAGS.string, ...QUOTE_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover quote`'s own flags — exported for the help-truth ratchet. Positionals narrow it to those slugs.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverQuoteArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: QUOTE_FLAGS });
}

/** The row's own quote, read and — under `--apply` — written; its steers are {@link steersOf}'. */
function primaryOf({
  doc,
  home,
  apply,
}: {
  doc: HandoverDoc;
  home: string;
  apply: boolean;
}): Omit<QuoteOutcome, "steers"> {
  const read = readRowAnchor({ doc, home });
  const verdict = quoteVerdict({ doc, read });
  const recordUnreadable = read !== undefined && read.isErr() && read.error.code === "RECORD_UNREADABLE";
  if (!apply || !quoteWrites({ verdict })) {
    const line = quoteVerdictPhrase({ applied: false, verdict });
    return { line, slug: doc.slug, verdict: verdict.kind, wrote: false, writeFailed: false, recordUnreadable };
  }
  const written = writeQuotedRow({ doc, read });
  if (written.problems.length > 0) {
    const line = `nothing written — ${written.problems.join("; ")}`;
    return { line, slug: doc.slug, verdict: verdict.kind, wrote: false, writeFailed: true, recordUnreadable };
  }
  if (written.current) {
    return { line: "current", slug: doc.slug, verdict: "current", wrote: false, writeFailed: false, recordUnreadable };
  }
  const line = quoteVerdictPhrase({ applied: true, verdict });
  return { line, slug: doc.slug, verdict: verdict.kind, wrote: true, writeFailed: false, recordUnreadable };
}

/** One row, read and — under `--apply` — written: its own quote, then every steer, then one mirror. */
async function quoteOne({
  doc,
  home,
  apply,
}: {
  doc: HandoverDoc;
  home: string;
  apply: boolean;
}): Promise<QuoteOutcome> {
  const primary = primaryOf({ apply, doc, home });
  const steers = primary.writeFailed ? [] : steersOf({ apply, doc, home });
  const wrote = primary.wrote || steers.some((steer) => steer.wrote);
  if (!wrote) {
    return { ...primary, steers };
  }
  const mirrorFailed = await mirrorAfterWrite({ home, path: doc.path, verb: "quote" });
  return { ...primary, steers, writeFailed: primary.writeFailed || mirrorFailed };
}

/**
 * `--add-steer`: relate one anchor of the owner's words to one row, by slug, whatever its own anchor names.
 *
 * @param handoverDir the board directory, and its archive, scanned only when no file sits at the slug's own path
 * @param slug the one row named
 * @param anchor the anchor of the owner's words
 * @returns the exit code
 */
async function addSteer({
  handoverDir,
  slug,
  anchor,
  home,
  apply,
  json,
}: {
  handoverDir: string;
  slug: string;
  anchor: string;
  home: string;
  apply: boolean;
  json: boolean;
}): Promise<number> {
  if (ownerWordsSchemeOf({ anchor }) === undefined) {
    return usageRefused({
      problems: [`--add-steer ${anchor} names none of the owner's words (talk:, call:, talk-call:, transcript:)`],
    });
  }
  // The same resolver `supervisor intake-mark` carries a turn through, so the command its refusal names reaches the
  // very row it tried.
  const row = rowBySlug({ handoverDir, slug });
  if (row.isErr()) {
    if (row.error.code === "BOARD_UNLISTABLE") {
      logger.error({ msg: `handover quote: ${row.error.message}` });
      return EXIT_ERROR;
    }
    return usageRefused({ problems: [row.error.message] });
  }
  const outcome = await relateOneSteer({ anchor, apply, home, path: row.value.path });
  if (json) {
    logger.out({
      line: safeJsonStringify({ label: "handover quote", value: { anchor, applied: apply, slug, steer: outcome } }),
    });
  } else {
    logger.out({ line: `handover quote: ${slug} — ${anchor} — ${outcome.line}` });
  }
  return outcome.writeFailed || outcome.verdict === "defect" ? EXIT_ERROR : EXIT_OK;
}

/** A string flag's value, or `undefined` when it was not passed. */
function stringValue({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/** What every mode of the verb resolves from its flags before it reads the board. */
function quoteContext({ values }: { values: Readonly<Record<string, unknown>> }): {
  readonly addSteer: string | undefined;
  readonly anchor: string | undefined;
  readonly apply: boolean;
  readonly check: boolean;
  readonly handoverDir: string;
  readonly home: string;
  readonly json: boolean;
} {
  let home = slopweaverHome();
  const homeFlag = stringValue({ name: "home", values });
  if (homeFlag !== undefined) {
    home = homeFlag;
  }
  return {
    addSteer: stringValue({ name: "add-steer", values }),
    anchor: stringValue({ name: "anchor", values }),
    apply: values["apply"] === true,
    check: values["check"] === true,
    handoverDir: resolveHandoverDir({ dir: stringValue({ name: "dir", values }), home }),
    home,
    json: values["json"] === true,
  };
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover quote: ${problem}` });
  });
  logger.error({ msg: QUOTE_USAGE });
  return EXIT_USAGE;
}

/**
 * Quote every row in scope, or print what each would need.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when a write or its mirror failed, a row or board file in scope could not
 *   be read or quoted, or `--check` found a row still needing a write
 */
export async function runHandoverQuote(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUOTE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverQuoteArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const { positionals, values } = parsed.value;
  const { addSteer: steer, anchor, apply, check, handoverDir, home, json } = quoteContext({ values });
  if (anchor !== undefined && steer !== undefined) {
    return usageRefused({
      problems: [
        "--anchor ties an unanchored row to the owner's words and --add-steer adds to an anchored one — give one",
      ],
    });
  }
  if (anchor !== undefined) {
    return runQuoteAttach({
      anchor,
      apply,
      check,
      handoverDir,
      home,
      json,
      sink: QUOTE_ATTACH_LOGGER,
      slugs: positionals,
    });
  }
  if (apply && check) {
    return usageRefused({ problems: ["--check writes nothing, so it cannot be given with --apply"] });
  }
  if (steer !== undefined) {
    if (check || positionals.length !== 1) {
      return usageRefused({
        problems: ["--add-steer relates one anchor to exactly one <slug>, and --check writes nothing"],
      });
    }
    return addSteer({ anchor: steer, apply, handoverDir, home, json, slug: positionals[0]! });
  }
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover quote: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  return quoteRows({
    apply,
    check,
    docs: scan.value.docs,
    home,
    json,
    scanUnreadable: scan.value.unreadable,
    slugs: positionals,
  });
}

/**
 * The whole-board run, or the one narrowed to named slugs: every row in scope quoted, its steers with it.
 *
 * @param scanUnreadable the board files the scan could not read at all
 * @param slugs the named rows, or none for the whole scope
 * @returns the exit code
 */
async function quoteRows({
  docs,
  scanUnreadable,
  slugs,
  home,
  apply,
  check,
  json,
}: {
  docs: readonly HandoverDoc[];
  scanUnreadable: readonly string[];
  slugs: readonly string[];
  home: string;
  apply: boolean;
  check: boolean;
  json: boolean;
}): Promise<number> {
  const unreadable = unreadableInScope({ slugs, unreadable: [...scanUnreadable, ...fencelessDocs({ docs })] });
  const { rows, unknown } = rowsToRead({ docs, slugs, unreadable });
  if (unknown.length > 0) {
    return usageRefused({
      problems: unknown.map((slug) => `"${slug}" names no one row that anchors on the owner's words or holds a quote`),
    });
  }
  const outcomes: QuoteOutcome[] = [];
  for (const doc of rows) {
    outcomes.push(await quoteOne({ apply, doc, home }));
  }
  if (json) {
    logger.out({
      line: safeJsonStringify({ label: "handover quote", value: { applied: apply, rows: outcomes, unreadable } }),
    });
  } else {
    printQuoteOutcomes({ outcomes, unreadable });
  }
  return quoteRunIncomplete({ check, outcomes: withSteers({ outcomes }), unreadable }) ? EXIT_ERROR : EXIT_OK;
}

export const handoverQuoteCommand = defineCommand({ run: runHandoverQuote });
