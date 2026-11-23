/**
 * `slopweaver sweep recheck` — the few Queue cards the morning seat reads against later evidence.
 *
 * Read-only and local: no network, no model, nothing written. What the seat does with the list is
 * `skills/automation/reference/queue-recheck.md`. A partial board refuses, because a card it could not read may be
 * the one that outranks all five printed.
 */
import { registeredAskOf } from "../../../handover/registeredAsk.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { RECHECK_LIMIT, type RecheckRow, recheckBand, recheckCandidates } from "../../../sweep/recheck.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { boardJsonRow } from "../handover/listJson.js";

import { partialReadReasons, unreadableSubReads } from "./boardPartialRead.js";
import { flag, parseSweepRecheckArgs, RECHECK_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { type LiveBoard, readLiveBoard } from "./sweepRead.js";

/** How much of a question one line of the list carries; `handover row <slug>` prints the whole card. */
const QUESTION_CHARS = 160;

/** Everything `sweep recheck` touches outside itself, injected so a test drives the whole verb. */
export interface SweepRecheckDeps {
  readonly now: () => Date;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** `--limit` as a positive whole number, the default when absent, or nothing when it is neither. */
function limitOf({ raw }: { raw: string | undefined }): number | undefined {
  if (raw === undefined) {
    return RECHECK_LIMIT;
  }
  const limit = Number(raw);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

/** Why this board is not whole, one reason per failed read, empty when it is. */
function partialReasons({ board }: { board: LiveBoard }): readonly string[] {
  return partialReadReasons({
    elsewhere: false,
    filtered: false,
    subReads: unreadableSubReads({
      archived: board.archived,
      docs: board.docs,
      generations: [],
      handoverDir: board.handoverDir,
      journals: board.journals,
      texts: [],
    }),
    unreadable: board.unreadable,
    unresolved: 0,
  });
}

/** Each registered ask as the board publishes it: the Queue's own verdict on who it waits on, with no run behind it. */
function askRows({ board }: { board: LiveBoard }): readonly RecheckRow[] {
  return board.live
    .filter(({ derived, doc, run }) => registeredAskOf({ derived, doc, run }) !== undefined)
    .map((model) => boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }));
}

/** One card as a line of the list. */
function cardLine({ row }: { row: RecheckRow }): string {
  const asked = row.questionAskedIso === undefined ? "unknown" : row.questionAskedIso.slice(0, 10);
  const checked = row.stillRealIso === undefined ? "never" : row.stillRealIso.slice(0, 10);
  const question = row.question === undefined ? "(no question recorded)" : row.question.slice(0, QUESTION_CHARS);
  return `  ${recheckBand({ row })} ${row.slug} · asked ${asked} · checked ${checked} · ${question}`;
}

/** Print the picked cards, as JSON lines or as the list a seat reads. */
function emit({
  deps,
  due,
  json,
  picked,
}: {
  deps: SweepRecheckDeps;
  due: number;
  json: boolean;
  picked: readonly RecheckRow[];
}): void {
  if (json) {
    picked.forEach((row) => {
      const value = { ...row, band: recheckBand({ row }) };
      deps.writeOut(safeJsonStringify({ label: "a sweep recheck card", value }));
    });
    return;
  }
  deps.writeOut(`sweep recheck: ${String(picked.length)} of ${String(due)} unattended card(s) not verified today`);
  picked.forEach((row) => {
    deps.writeOut(cardLine({ row }));
  });
}

/**
 * Run `sweep recheck` against injected seams.
 *
 * @param rest the argv tail after `sweep recheck`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export function runSweepRecheck({ rest, deps }: { rest: readonly string[]; deps: SweepRecheckDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECHECK_USAGE);
    return EXIT_OK;
  }
  const parsed = parseSweepRecheckArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, RECHECK_USAGE].forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const limit = limitOf({ raw: flag({ name: "limit", values }) });
  if (limit === undefined) {
    deps.writeDiagnostic("sweep recheck: --limit takes a positive whole number");
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const board = readLiveBoard({ dir: flag({ name: "dir", values }), home });
  if (board.isErr()) {
    deps.writeDiagnostic(`sweep recheck: ${board.error.message}`);
    return EXIT_ERROR;
  }
  const reasons = partialReasons({ board: board.value });
  if (reasons.length > 0) {
    reasons.forEach((reason) => {
      deps.writeDiagnostic(`sweep recheck: the board is partial, so the list would be too — ${reason}`);
    });
    return EXIT_ERROR;
  }
  const todayIso = deps.now().toISOString().slice(0, 10);
  const { due, picked } = recheckCandidates({ limit, rows: askRows({ board: board.value }), todayIso });
  emit({ deps, due, json: values["json"] === true, picked });
  return EXIT_OK;
}

/**
 * The real seams: the wall clock and the two output channels.
 *
 * @returns the production dependencies for {@link runSweepRecheck}
 */
export function productionSweepRecheckDeps(): SweepRecheckDeps {
  return {
    now: () => new Date(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver sweep recheck`. */
export const sweepRecheckCommand = defineCommand({
  run: (argv) => runSweepRecheck({ deps: productionSweepRecheckDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
