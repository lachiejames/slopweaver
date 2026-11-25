/**
 * `slopweaver handover list` — the orchestration-doc board.
 *
 * The friction it removes: an orchestration doc goes unexecuted because it was forgotten, or because a
 * different one had to run first. Planning is not what
 * fails; landing it in order, days later, is.
 *
 * Read-only over the register, and exits `EXIT_OK` even when nothing is runnable. Refusing is the gate's job
 * (`codex status --check`); a board that scolded you for the state of your queue would be one you stopped
 * opening. Its one write is a PROJECTION: having composed the whole default board, it refreshes
 * `$SLOPWEAVER_HOME/alignment-board.json` (`./alignmentBoardRefresh.ts`), the placement fields the console's
 * Alignment count reads without waiting on this whole document.
 *
 * `handover check` used to live here too and is now `./checkRun.ts`; the probe sweep both the board and
 * `sweep`/`sessionStart` run is `./probeSweep.ts`, the scan-and-compose this verb shares with `handover
 * alignment-board` is `./boardComposition.ts`, the banners are `./listPresentation.ts`, and the flag and
 * directory helpers the two verbs really did share are `./commandSupport.ts`.
 */

import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { settledThenAskedLines, settledThenAskedOf } from "../../../handover/settledAsk.js";
import { type TagFilter } from "../../../handover/tagFilter.js";
import { logger } from "../../../lib/logger.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { refreshAlignmentBoard } from "./alignmentBoardRefresh.js";
import { composedBoard, DEFAULT_DEADLINE_SECONDS, scannedBoard } from "./boardComposition.js";
import { boardReferences } from "./boardReferences.js";
import { boolFlag, flagNamesOf, resolveHandoverDir, stringFlag, VERB_ARG_OFFSET } from "./commandSupport.js";
import { boardAndFootnoteLines } from "./listBoardLines.js";
import { boardJsonText, type DetachedFindings } from "./listJson.js";
import {
  completenessWarningLines,
  detachedAskLines,
  emptyBoardLines,
  truncationBannerLines,
} from "./listPresentation.js";
import { type ListRecovery, recoveredAnything } from "./listRecovery.js";
import { listTagArgs } from "./listTagArgs.js";
import { boardOwnerNames } from "./pauseOwnerCheck.js";
import { type Deadline, deadlineIn } from "./probeSweep.js";

/** The name every progress line and warning this verb writes to stderr carries. */
const VERB = "handover list";

/**
 * The flags `handover list` accepts. Names omit the leading `--`, which is what `parseFlags` expects.
 *
 * `--probe` is opt-in for a reason that only appears when two decisions meet. The board recomputes every time
 * (no cache, deliberately — a cache would hide exactly the drift this exists to surface), and a `command:`
 * probe runs arbitrary shell. Evaluated together by default, printing the board would run every doc's commands
 * on every invocation. So `list` evaluates only the declarative kinds and REPORTS command probes as not
 * evaluated; `--probe` forces the full sweep for someone who asked for it.
 */
const LIST_FLAGS: FlagSpec = { boolean: ["probe", "all", "json"], string: ["base", "deadline", "dir", "home", "tag"] };

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const HANDOVER_LIST_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: LIST_FLAGS });

const LIST_USAGE =
  "usage: slopweaver handover list [--all] [--probe] [--base <branch>] [--deadline <seconds>] [--dir <path>]\n" +
  "       [--home <dir>] [--json] [--tag <key=value|key|!key>[,...]]...\n" +
  "\n" +
  "Lists the orchestration docs, runnable ones first, with the absolute path and repo for each.\n" +
  "Docs live in $SLOPWEAVER_HOME/handovers by default so they are reachable from any repository.\n" +
  "\n" +
  "A doc declaring `doneWhen:` probes has its state COMPUTED from its repository, so work that has\n" +
  "already shipped is called out instead of sitting under RUN NOW. `--probe` additionally runs any\n" +
  "`command:` probes, which are skipped by default because printing the board would otherwise run\n" +
  "arbitrary shell from every doc on it. `--base` overrides the branch commits are counted against; unset, each repository's own trunk is resolved.\n" +
  "\n" +
  "A whole default-board run — no --dir elsewhere, --tag, --base or --probe, nothing cut or unreadable — also\n" +
  "refreshes $SLOPWEAVER_HOME/alignment-board.json, the projection `handover alignment-board` serves.\n" +
  "\n" +
  "--all  include computed closed sections (DONE and CLOSED — NOT SHIPPED); contradictions stay\n" +
  "       visible by default regardless of authored status, since a terminal-status doc with a\n" +
  "       live run is unresolved work rather than settled history.\n" +
  "\n" +
  `--deadline <seconds>  budget for the probe sweep, default ${String(DEFAULT_DEADLINE_SECONDS)}; 0 removes it.\n` +
  "                      When it expires the board still PRINTS, with a loud truncation banner naming how\n" +
  "                      many docs went unresolved. Progress goes to stderr throughout, so a caller that\n" +
  "                      times out can tell a slow board from an empty one.\n" +
  "\n" +
  "--json  the board as one document instead of rendered prose: a row per doc carrying its section, the\n" +
  "        reason it sits there, its run disposition and any recorded question. It emits EVERY row,\n" +
  "        including the closed sections --all governs, because a caller can filter on the section field\n" +
  "        and cannot recover a row that was dropped before it ever saw one. Progress and caveats still\n" +
  "        go to stderr, so stdout is exactly the document.\n" +
  "\n" +
  "--tag  print only the rows whose tags hold every term (AND), repeatable or comma-separated: key=value holds\n" +
  "       that value, key holds any, '!key' holds none (quote it for the shell). A term the tag registry could\n" +
  "       never match is refused before the board is read. Counts, caveats and the hidden-terminal line stay\n" +
  "       about the whole board; --json reports the terms as tagFilter and the whole count as rowsBeforeFilter.";

/**
 * Parse `handover list` flags. Exported so the ratchet probes the real parser, not a copy of it.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseHandoverListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/**
 * Print the board.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverList(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LIST_USAGE });
    return EXIT_OK;
  }
  // `--tag` is read off the raw tail first, before any I/O: a bad term refuses the verb rather than widening it.
  const tagged = listTagArgs({ rest });
  const parsed = tagged.andThen((args) =>
    parseHandoverListArgs({ rest: args.rest }).map((flags) => ({ ...flags, filter: args.filter })),
  );
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: LIST_USAGE });
    return EXIT_USAGE;
  }
  // Both the journals directory and the doc directory come from this one home, so the absent case is named
  // at the single place it is decided. `resolveHome`'s early return is the shape that satisfies both gates:
  // a `??` is refused by `no-silent-fallback`, and the `let`-plus-reassign spelling of the same idea is
  // refused by oxlint's `prefer-nullish-coalescing` (run 35521660124, job `lint`).
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const handoverDir = resolveHandoverDir({ dir: stringFlag({ name: "dir", parsed: parsed.value }), home });
  const seconds = deadlineSeconds({ raw: stringFlag({ name: "deadline", parsed: parsed.value }) });
  if (seconds === undefined) {
    logger.error({ msg: "handover list: --deadline takes a non-negative whole number of seconds" });
    logger.error({ msg: LIST_USAGE });
    return EXIT_USAGE;
  }
  // The FIRST bytes this verb emits, and they land before any disk work. Measured: the old shape printed
  // nothing at all — stdout and stderr both — for 474 s, so a caller bounded at 100 s could not tell a board
  // that was still working from one that was empty. Progress is a diagnostic, so it goes to stderr and a
  // `… | wc -l` pipeline still sees only the board.
  logger.info({ msg: `handover list: scanning ${handoverDir}…` });
  // Taken BEFORE the scan, because the scan is not atomic and `observedAtIso` is stamped at the end: a doc
  // written mid-scan can be missed by a board stamped after it, so only this instant bounds what the board saw.
  const scanStartedIso = new Date().toISOString();
  const scanned = scannedBoard({ handoverDir, home, verb: VERB });
  if (scanned.kind === "failed") {
    return EXIT_ERROR;
  }
  const json = boolFlag({ name: "json", parsed: parsed.value });
  // Only the JSON document publishes `pausedOn`, so only it pays for the store read behind the owner's names.
  const ownerNames = json ? await boardOwnerNames({ home, identityRoster: identityRosterPort() }) : new Set<string>();
  return printBoard({
    ...scanned.board,
    base: stringFlag({ name: "base", parsed: parsed.value }),
    deadline: deadlineIn({ seconds }),
    deadlineSeconds: seconds,
    filter: parsed.value.filter,
    handoverDir,
    home,
    json,
    ownerNames,
    runCommands: boolFlag({ name: "probe", parsed: parsed.value }),
    scanStartedIso,
    showAll: boolFlag({ name: "all", parsed: parsed.value }),
  });
}

/**
 * The `--deadline` value in seconds, defaulting when it is absent and rejecting anything that is not a
 * non-negative whole number.
 *
 * Parsed strictly rather than through a bare `parseInt`, which reads `30s` as 30 and `later` as `NaN` —
 * a budget silently taken from a typo is exactly the kind of quiet wrong answer this whole change is about.
 *
 * @param raw the flag's value, or `undefined` when it was not passed
 * @returns the seconds, or `undefined` when the value is not a valid budget
 */
export function deadlineSeconds({ raw }: { raw: string | undefined }): number | undefined {
  if (raw === undefined) {
    return DEFAULT_DEADLINE_SECONDS;
  }
  return /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : undefined;
}

/**
 * What `--json` carries beyond the board: every doc `repo:` path's `origin` repository and the install's Linear
 * context. Read FIRST, before the journals and the sweep, inside its own 20s budget, so work that spends the whole
 * deadline can never cost a card its repository — an ask's uncited bare pull-request number would read as words.
 *
 * @returns the references the JSON document carries
 */
function jsonBoardReferences({
  deadline,
  docs,
  home,
  ownerNames,
}: {
  deadline: Deadline;
  docs: readonly HandoverDoc[];
  home: string;
  ownerNames: ReadonlySet<string>;
}): ReturnType<typeof boardReferences> {
  return boardReferences({
    deadline,
    home,
    ownerNames,
    paths: docs.flatMap((doc) => (doc.repo === undefined ? [] : [doc.repo])),
  });
}

/**
 * Print the board as its one `--json` document.
 *
 * Emitted BEFORE the banners, which write to stdout by design: a truncation caveat belongs with the board a reader
 * pipes to a file, and stdout here has to be exactly one document. The caveat is not lost, it is the document’s own
 * `unresolved` count, which a caller branches on rather than reads.
 *
 * @returns the exit code
 */
function printBoardDocument({
  detached,
  filter,
  handoverDir,
  models,
  references,
  scanStartedIso,
  sweep,
  unreadable,
}: {
  detached: DetachedFindings;
  filter: TagFilter;
  handoverDir: string;
  models: readonly BoardModel[];
  references: ReturnType<typeof boardReferences>;
  scanStartedIso: string;
  sweep: { unresolved: number };
  unreadable: readonly string[];
}): number {
  logger.out({
    line: boardJsonText({
      detached,
      filter,
      handoverDir,
      models,
      references,
      scanStartedIso,
      unreadable,
      unresolved: sweep.unresolved,
    }),
  });
  return EXIT_OK;
}

/** The text board: its caveats first, then the board, its footnotes and any detached asks. */
function printBoardText({
  budget,
  detached,
  docs,
  filter,
  models,
  showAll,
  sweep,
  unreadable,
}: {
  budget: number;
  detached: DetachedFindings;
  docs: readonly HandoverDoc[];
  filter: TagFilter;
  models: readonly BoardModel[];
  showAll: boolean;
  sweep: Parameters<typeof truncationBannerLines>[0]["sweep"];
  unreadable: readonly string[];
}): void {
  // Written the moment they are known, BEFORE the board is built, and that ordering is the rule rather
  // than a style: the caveats are computed from the sweep alone, while the board below reads the working
  // tree of every live doc. Batching all of it into one array and writing once deferred a truncation
  // banner behind that read, so a board that hung printed nothing at all — which is the exact failure the
  // banner was added for. A review pass caught it by replacing a doc with a FIFO.
  [...truncationBannerLines({ budget, sweep }), ...completenessWarningLines({ docs, models })].forEach((line) => {
    logger.out({ line });
  });
  [
    ...boardAndFootnoteLines({ filter, liveDocs: docs, models, showAll, unreadable }),
    ...detachedAskLines({ detached }),
    // Board-wide, like the detached asks: a settled row is in no section `--all` or `--tag` would bring back.
    ...settledThenAskedLines({ rows: detached.settledThenAsked }),
  ].forEach((line) => {
    logger.out({ line });
  });
}

/** Render, or say plainly that there is nothing there — an empty directory is normal, not an error. */
function printBoard({
  docs,
  filter,
  unreadable,
  handoverDir,
  home,
  base,
  runCommands,
  showAll,
  json,
  deadline,
  deadlineSeconds: budget,
  recovery,
  scanStartedIso,
  ownerNames,
}: {
  ownerNames: ReadonlySet<string>;
  docs: readonly HandoverDoc[];
  filter: TagFilter;
  unreadable: readonly string[];
  handoverDir: string;
  home: string;
  base: string | undefined;
  runCommands: boolean;
  showAll: boolean;
  json: boolean;
  deadline: Deadline;
  deadlineSeconds: number;
  recovery: ListRecovery;
  scanStartedIso: string;
}): number {
  // After the journal sweep, never before it: a run whose doc was deleted from an otherwise empty board is
  // exactly the question this verb must not report as "No orchestration docs".
  if (docs.length === 0 && unreadable.length === 0 && !recoveredAnything({ recovery })) {
    // No doc and nothing recovered composes no row at all, so no settled row can hold a question either.
    const detached = { ...recovery, settledThenAsked: [] };
    emptyBoardLines({ detached, filter, handoverDir, json, scanStartedIso, unreadable }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  }
  // Live docs only: an archived repo's origin read would spend the probe sweep's deadline.
  const references = json ? jsonBoardReferences({ deadline, docs, home, ownerNames }) : undefined;
  const composition = { base, deadline, docs, filter, handoverDir, home, recovery, runCommands, verb: VERB };
  const { models, settledOffBoard, sweep } = composedBoard(composition);
  // Over the archived settled rows too, which `models` leaves out: one asked again is on no surface otherwise.
  const detached = { ...recovery, settledThenAsked: settledThenAskedOf({ models: [...models, ...settledOffBoard] }) };
  if (references !== undefined) {
    const document = { filter, handoverDir, models, references, scanStartedIso, sweep, unreadable };
    printBoardDocument({ ...document, detached });
  } else {
    printBoardText({ budget, detached, docs, filter, models, showAll, sweep, unreadable });
  }
  // AFTER the board is printed, so a caller reading stdout waits on nothing it did not ask for.
  refreshAlignmentBoard({ ...composition, models, scanStartedIso, sweep, unreadable });
  return EXIT_OK;
}

export const handoverListCommand = defineCommand({ run: runHandoverList });
