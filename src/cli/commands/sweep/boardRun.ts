/**
 * `slopweaver sweep board` — classify every live board row against the evidence it carries.
 *
 * Reads local state and re-runs each row's own probes. **No model, no tokens, and it deletes nothing.** That
 * split is AGENTS.md rule 2 rather than caution: a hook may not spawn a model, so the automatic half of the
 * superseded-context sweep has to be decidable by pure code, and what pure code cannot decide is reported as
 * `UNWITNESSED` for a visible session to fan detectives at.
 *
 * The board assembly here is deliberately the same four calls `handover list` makes — `scanBoard`,
 * `journalEvidence`, `probeStates`, `composeBoardModels`. A second reader of these rows would be a second
 * opinion about them, and the two would drift; this verb's whole subject is drift.
 *
 * `--write` is its one write, and it is local: the `--json` lines are also published whole to
 * `$SLOPWEAVER_HOME/live/hygiene/sweep-board.jsonl` (`skills/automation/reference/hygiene-documents.md`),
 * with the pass's verdict census beside them as `sweep-board-census.json`, which is what the
 * `sweep-board-daily` standing row leaves for a reader. It still deletes nothing.
 *
 * `--queue`, beside `--write`, is how the result reaches THEM rather than a document they never open: once both
 * documents are written it registers one decision card per UTC day when the pass found an `UNCARDED` page, naming
 * each page and its row, then settles the sweep's own earlier cards that pass contradicts (`./boardQueue.ts`). The
 * `UNCARDED` verdict is the one judged over TERMINAL rows — an ask that closed without its page reaching their Queue
 * (`../../../sweep/uncarded.ts`). What it prints is `./boardEmit.ts`.
 *
 * Its one read off the machine is GitHub's, for `PR_ENDED` (`./endedRead.ts`). Two acts on the board ride beside
 * `--write`: `--settle-ended` settles each `PR_ENDED` ask (`./endedSettle.ts`) and `--close-shipped` closes each
 * `SHIPPED` row (`./shippedClose.ts`), never carding it. After either it classifies again, so what is printed,
 * published and carded is the board AFTER those acts.
 */

import { resolve } from "node:path";

import { archivedDependencies, journalEvidence } from "../../../handover/assemble.js";
import { isClosedBoardSection } from "../../../handover/boardRefusal.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import type { FetchPrClosure } from "../../../live/github/prClosure.js";
import { writeHygieneDocument } from "../../../live/hygiene/reportStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { renderSweepBoardCensusJson, sweepBoardCensus } from "../../../sweep/census.js";
import { classifyBoard, type SweepCandidate } from "../../../sweep/classify.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { deadlineIn, probeStates } from "../handover/probeSweep.js";
import { HOME_PAGE_REACH_READERS, type PageReachReaders } from "../handover/uncardedPageGate.js";
import type { AutomaticActDeps } from "./automaticActs.js";
import { type BoardValues, boardArgs } from "./boardArgs.js";
import { emit, selectCandidates, sweepBoardJsonLines } from "./boardEmit.js";
import { partialReadReasons, unreadableSubReads } from "./boardPartialRead.js";
import { productionCardRetireDeps, queueDailyCard, uncardedCandidates } from "./boardQueue.js";
import { flag, VERB_ARG_OFFSET } from "./core.js";
import { productionFetchPrClosure, readEndedPullRequests, rememberedFetch } from "./endedRead.js";
import { type EndedSettleDeps, productionEndedSettleDeps, settleEndedRows } from "./endedSettle.js";
import { boardSupersessions } from "./rowTexts.js";
import { closeShippedRows, productionShippedCloseDeps } from "./shippedClose.js";

/** Everything `sweep board` touches outside itself, injected so a test drives the whole verb. */
export interface SweepBoardDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The lock-in ledger and hand register an `UNCARDED` judgement reads, once per pass. */
  readonly pageReach: PageReachReaders;
  /** The pass's instant, whose UTC day names the `--queue` card. */
  readonly now: () => Date;
  /** Register the `--queue` card's argv as `handover register` would, answering its exit code. */
  readonly registerQueueRow: ({ argv }: { argv: readonly string[] }) => Promise<number>;
  /** The pull-request closure read `PR_ENDED` is judged with, over the home's GitHub token. */
  readonly prClosure: (args: { home: string }) => FetchPrClosure;
  /** The writes `--settle-ended` acts through, over one home. */
  readonly endedSettle: (args: { home: string }) => EndedSettleDeps;
  /** The writes `--close-shipped` acts through, over one home. */
  readonly shippedClose: (args: { home: string }) => AutomaticActDeps;
  /** The writes `--queue` retires the sweep's own earlier cards through, over one home. */
  readonly cardRetire: (args: { home: string }) => AutomaticActDeps;
}

/**
 * Whether one row is in the requested priority cohort.
 *
 * @param model the composed row
 * @param priority the requested priority, or undefined for every row
 * @returns true when the row belongs in the output
 */
function matchesPriority({ model, priority }: { model: BoardModel; priority: string | undefined }): boolean {
  if (priority === undefined) {
    return true;
  }
  return model.doc.priority === priority;
}

/** One classified pass: every candidate, the docs scanned, and why a `--write` of it would be partial. */
interface BoardPass {
  readonly candidates: readonly SweepCandidate[];
  readonly docs: readonly HandoverDoc[];
  readonly partial: () => readonly string[];
}

/**
 * Compose the scanned docs into rows the way `handover list` does: their journals, their probes within the budget,
 * and the archived docs a `blockedBy` resolves against.
 *
 * @param docs the docs the scan read
 * @param handoverDir the board directory the docs came from
 * @param seconds the probe budget
 * @param values the parsed flags
 * @returns the composed rows and every read they rest on
 */
function composePass({
  deps,
  docs,
  handoverDir,
  home,
  seconds,
  values,
}: {
  deps: SweepBoardDeps;
  docs: readonly HandoverDoc[];
  handoverDir: string;
  home: string;
  seconds: number;
  values: BoardValues;
}): {
  archived: ReturnType<typeof archivedDependencies>;
  journals: ReturnType<typeof journalEvidence>;
  models: readonly BoardModel[];
  probes: ReturnType<typeof probeStates>;
} {
  const journals = journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs });
  const probes = probeStates({
    base: flag({ name: "base", values }),
    deadline: deadlineIn({ seconds }),
    docs,
    runCommands: values["probe"] === true,
  });
  if (probes.unresolved > 0) {
    deps.writeDiagnostic(
      `sweep board: the deadline cut the probe sweep short of ${String(probes.unresolved)} of ${String(probes.total)} row(s) that declare probes — they read KEEP, unevaluated, not UNWITNESSED`,
    );
  }
  const archived = archivedDependencies({ docs, handoverDir });
  const models = composeBoardModels({
    journals,
    probeStates: probes.states,
    resolutionDocs: [...docs, ...archived],
    roots: docs,
  });
  return { archived, journals, models, probes };
}

/**
 * Read the board the way `handover list` does and classify it: the live rows by `classifyBoard`, the terminal ones
 * for `UNCARDED` only.
 *
 * @param handoverDir the board directory to scan
 * @param seconds the probe budget
 * @param values the parsed flags
 * @param fetch the pull-request closure read `PR_ENDED` is judged with
 * @returns the pass, or the error exit when the board would not scan
 */
async function classifyPass({
  deps,
  fetch,
  handoverDir,
  home,
  seconds,
  values,
}: {
  deps: SweepBoardDeps;
  fetch: FetchPrClosure;
  handoverDir: string;
  home: string;
  seconds: number;
  values: BoardValues;
}): Promise<BoardPass | number> {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    deps.writeDiagnostic(`sweep board: ${scan.error.message}`);
    return EXIT_ERROR;
  }
  const docs = scan.value.docs;
  const { archived, journals, models, probes } = composePass({ deps, docs, handoverDir, home, seconds, values });
  const priority = flag({ name: "priority", values });
  const live = models.filter((model) => !isClosedBoardSection({ section: model.section }));
  const supersessions = boardSupersessions({ docs, handoverDir, journals, live });
  const terminal = models.filter(
    (model) => isClosedBoardSection({ section: model.section }) && matchesPriority({ model, priority }),
  );
  const uncarded = uncardedCandidates({ home: resolve(home), journals, models, pageReach: deps.pageReach, terminal });
  uncarded.unread.forEach((line) => {
    deps.writeDiagnostic(`sweep board: UNCARDED was not judged — ${line}`);
  });
  const board = { handoverDir: resolve(handoverDir), home: resolve(home) };
  const wanted = live.filter((model) => matchesPriority({ model, priority }));
  // A failed GitHub read leaves its row at the verdict the board alone gives it, so it never makes a pass partial.
  const ended = await readEndedPullRequests({ fetch, models: wanted });
  ended.unread.forEach((line) => {
    deps.writeDiagnostic(`sweep board: PR_ENDED could not read ${line} — its row keeps the board's own verdict`);
  });
  const closures = ended.closures;
  const classified = classifyBoard({ board, closures, models: wanted, supersessions: supersessions.edges });
  const partial = (): readonly string[] => [
    ...partialReadReasons({
      elsewhere: resolve(handoverDir) !== resolve(stateHomePaths({ home }).handovers),
      filtered: flag({ name: "verdict", values }) !== undefined || priority !== undefined,
      subReads: unreadableSubReads({
        archived,
        docs,
        generations: supersessions.archiveUnreadable,
        handoverDir,
        journals,
        texts: supersessions.unreadable,
      }),
      unreadable: scan.value.unreadable,
      unresolved: probes.unresolved,
    }),
    ...uncarded.unread.map((line) => `the page-reach registers would not read, so UNCARDED went unjudged: ${line}`),
  ];
  return { candidates: [...classified, ...uncarded.candidates], docs, partial };
}

/**
 * The pass's acts on the board, each only when its flag is set: `--settle-ended`, then `--close-shipped`.
 * SHIPPED and PR_ENDED are disjoint verdicts, so the first pass's candidates serve both acts.
 */
async function boardActs({
  candidates,
  deps,
  home,
  values,
}: {
  candidates: readonly SweepCandidate[];
  deps: SweepBoardDeps;
  home: string;
  values: BoardValues;
}): Promise<{ attempted: number; stopped: boolean }> {
  let attempted = 0;
  let stopped = false;
  if (values["settle-ended"] === true) {
    attempted += (await settleEndedRows({ candidates, deps: deps.endedSettle({ home }), home })).attempted;
  }
  if (values["close-shipped"] === true) {
    const closes = await closeShippedRows({ candidates, deps: deps.shippedClose({ home }), home });
    attempted += closes.attempted;
    stopped = closes.stopped;
  }
  return { attempted, stopped };
}

/**
 * Run `sweep board` against injected seams.
 *
 * @param rest the argv tail after `sweep board`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runSweepBoard({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SweepBoardDeps;
}): Promise<number> {
  const args = boardArgs({ deps, rest });
  if (typeof args === "number") {
    return args;
  }
  const { seconds, values } = args;
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const handoverDir = resolveHandoverDir({ dir: flag({ name: "dir", values }), home });
  const fetch = rememberedFetch({ fetch: deps.prClosure({ home }) });
  const first = await classifyPass({ deps, fetch, handoverDir, home, seconds, values });
  if (typeof first === "number") {
    return first;
  }
  const { attempted, stopped } = await boardActs({ candidates: first.candidates, deps, home, values });
  let pass = first;
  if (attempted > 0) {
    // What is printed and published is the board AFTER the acts, so the census never counts a row just acted on —
    // read again after any ATTEMPT, since a verb exiting non-zero may already have written its row.
    const after = await classifyPass({ deps, fetch, handoverDir, home, seconds, values });
    if (typeof after === "number") {
      return after;
    }
    pass = after;
  }
  const { candidates, docs } = pass;
  const shown = selectCandidates({ candidates, verdict: flag({ name: "verdict", values }) });
  const json = values["json"] === true;
  const exitCode = emit({ candidates, json, scanned: docs.length, shown, writeOut: deps.writeOut });
  if (values["write"] !== true) {
    return exitCode;
  }
  const partial = pass.partial();
  const published = publishSweepBoard({ candidates, deps, exitCode, home, partial, scanned: docs.length, shown });
  if (published !== EXIT_OK || values["queue"] !== true) {
    return stopped ? EXIT_ERROR : published;
  }
  const queued = await queueDailyCard({
    candidates,
    deps: { ...deps, retire: deps.cardRetire({ home }) },
    docs,
    home: resolve(home),
  });
  return stopped ? EXIT_ERROR : queued;
}

/**
 * Publish the shown candidates to `$SLOPWEAVER_HOME/live/hygiene/sweep-board.jsonl`, replacing the previous
 * document whole — after stdout was already written, so the terminal output is the same with or without it —
 * and the whole pass's verdict census beside it, as `sweep-board-census.json` (`../../../sweep/census.ts`).
 *
 * An empty selection writes a ZERO-BYTE document, which is the clean pass rather than an absence: a reader
 * tells "nothing to act on" from "never ran" by the file being there and fresh. A failed write is a failed
 * run — the previous document stands and the exit code says so, and so is a read {@link partialReadReasons}
 * found partial, which writes NEITHER document: a census counted over part of the board would read as the
 * whole board's unproven count.
 *
 * @param candidates every classified live row, which the census counts
 * @param deps the output channels; the confirmation goes to the diagnostic one so `--json` stays clean
 * @param exitCode what printing the selection answered
 * @param home the state home whose hygiene documents are replaced
 * @param partial why this read is not the whole board, empty when it is
 * @param scanned how many handover docs the scan read, carried on the census
 * @param shown the candidates the selection shows
 * @returns `exitCode` once both documents are written, else the error exit
 */
function publishSweepBoard({
  candidates,
  deps,
  exitCode,
  home,
  partial,
  scanned,
  shown,
}: {
  candidates: readonly SweepCandidate[];
  deps: SweepBoardDeps;
  exitCode: number;
  home: string;
  partial: readonly string[];
  scanned: number;
  shown: readonly SweepCandidate[];
}): number {
  if (partial.length > 0) {
    partial.forEach((reason) => {
      deps.writeDiagnostic(`sweep board: --write left the previous document standing because ${reason}`);
    });
    return EXIT_ERROR;
  }
  const paths = stateHomePaths({ home }).live.hygiene;
  const findingLines = sweepBoardJsonLines({ candidates: shown });
  // The census FIRST: whatever tears between the two writes, the census describes the newest pass, and its
  // digest matches the findings beside it only when those are byte-for-byte what this pass wrote.
  const census = writeHygieneDocument({
    chunks: [`${renderSweepBoardCensusJson({ census: sweepBoardCensus({ candidates, findingLines, scanned }) })}\n`],
    path: paths.sweepBoardCensus,
  });
  const written = census.andThen(() =>
    writeHygieneDocument({
      chunks: findingLines.map((line) => `${line}\n`),
      path: paths.sweepBoard,
    }),
  );
  if (written.isErr()) {
    written.error.forEach((line) => {
      deps.writeDiagnostic(`sweep board: ${line}`);
    });
    return EXIT_ERROR;
  }
  deps.writeDiagnostic(`sweep board: wrote ${String(shown.length)} finding(s) to ${paths.sweepBoard}`);
  deps.writeDiagnostic(
    `sweep board: wrote the census of ${String(candidates.length)} row(s) to ${paths.sweepBoardCensus}`,
  );
  return exitCode;
}

/**
 * The real seams: the two output channels, the install's page-reach registers, the clock and the registrar.
 *
 * @returns the production dependencies for {@link runSweepBoard}
 */
export function productionSweepBoardDeps(): SweepBoardDeps {
  return {
    now: () => new Date(),
    pageReach: HOME_PAGE_REACH_READERS,
    // The receipt goes to stderr, so `--json --write --queue` keeps stdout to the findings.
    registerQueueRow: ({ argv }) =>
      registerAskRow({
        argv,
        origin: "automation",
        out: ({ line }) => {
          logger.error({ msg: line });
        },
      }),
    cardRetire: productionCardRetireDeps,
    endedSettle: productionEndedSettleDeps,
    prClosure: productionFetchPrClosure,
    shippedClose: productionShippedCloseDeps,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver sweep board`. */
export const sweepBoardCommand = defineCommand({
  run: (argv) => runSweepBoard({ deps: productionSweepBoardDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
