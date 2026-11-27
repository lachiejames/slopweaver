/**
 * `slopweaver handover reconcile` — what the fleet is actually working, set against the board's own ranking.
 *
 * The effectful edge over `../../../handover/reconcile.ts`. It assembles three reads the pure core cannot do
 * for itself — the board, the live Slack tags, and the sessions currently running — and prints the finding,
 * or emits it as JSON for a briefing composer to lift the headline straight out of.
 *
 * ## Where "what is being worked" comes from, and what happens when that read fails
 *
 * cmux is the authority: a live workspace is a session someone can watch, which is the only definition of
 * in-flight this repository accepts (doctrine rule 2). A workspace is mapped to a board row by the session
 * ledger's recorded binding of its workspace id to the slug `cmux spawn` opened it for, and only where nothing
 * is bound by the worktree its directory names (`./seatBinding.ts`) — exact matches both, never a fuzzy one, for
 * the same reason `../../../handover/doc.ts`'s `branch:` field exists rather than the board guessing a branch
 * from a slug.
 *
 * When cmux cannot be reached the verb does NOT go quiet. It falls back to the board's own open runs, says
 * in one line that it did, and reports on those — because a reconciliation that silently reports "nothing in
 * flight" whenever the socket is down would be worse than no reconciliation at all: it would read exactly
 * like a quiet fleet.
 *
 * ## The intake half is its OWN field, beside the headline rather than inside it
 *
 * The board can only reconcile what reached it. What the owner typed into the supervisor and nobody
 * registered is invisible to every finding above, which is the measured drop this verb also reports:
 * `../../../supervisor/intakeRead.ts` walks the supervisor chain's transcripts and
 * `../../../supervisor/intake.ts` sets each owner turn against the board's anchors and the intake ledger.
 *
 * That sentence is never APPENDED to the headline, or the two halves of the briefing gate contradict each
 * other. MEASURED with the maximal report of each half: the reconciliation's own sentence runs to 50 words,
 * the intake sentence to 44 across two when it discloses a coverage gap, and the two joined are 94 words and
 * 3 sentences — over `../../../briefing/caps.ts`'s `ALIGNMENT_MAX_WORDS` of 55 and its
 * `ALIGNMENT_MAX_SENTENCES` of 2 at once. The sweep contract says the headline goes VERBATIM into the
 * required `alignment` field, so a joined line would be REFUSED by the render, and the only way through would be
 * for a sweep to rewrite a generated sentence by hand.
 *
 * So `--json` emits two fields: `headline`, which is the reconciliation's sentence alone and fits the
 * alignment cap by construction (`src/__tests__/unit/handover/reconcile.test.ts` measures the maximal one
 * against the cap itself), and `intakeClause`, which the form carries in the alignment section's own FOLD —
 * required by `../../../outbound/briefing/schema.ts` exactly as the headline is, so the briefing still cannot
 * render without it, and folded, so it costs the capped line nothing. A read that could not be made says so
 * in the same field rather than reading as zero.
 *
 * ## A retired supervisor chair is not READY, and that is one cmux read rather than a board rule
 *
 * `ready` is what `../../../supervisor/outcomes/coverage.ts` filters `unspawned` on, so a `role: supervisor`
 * doc seated before the chair currently holding the pin — which nothing ever recorded the ending of — is work
 * a fill offers to take. `./reconcileRows.ts` is the read and the line it prints; why it is a readiness
 * question rather than a board-section one, and why it is not in `../../../handover/boardEvidence.ts`, is
 * stated there, beside the rest of what decides a row.
 */

import { slopweaverHome } from "../../../config.js";
import { archivedDependencies, type JournalEvidence, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { type BoardRow } from "../../../handover/rank.js";
import { type Reconciliation, reconcile, type WorkedItem } from "../../../handover/reconcile.js";
import { type ReleasedRowsRead, releasedRowsOf } from "../../../handover/releasedRows.js";
import { scanBoard } from "../../../handover/store.js";
import { unsetFieldAsNull } from "../../../lib/absent.js";
import { logger } from "../../../lib/logger.js";
import { standingDeferrals } from "../../../queueDefer/cardDeferral.js";
import { readCardDeferrals } from "../../../queueDefer/cardDeferralStore.js";
import { listLiveCmuxWorkspaces } from "../../../sessionHarness/cmuxHost.js";
import { stateHomePaths } from "../../../stateHome.js";
import { INTAKE_SWEEP_WINDOW_MS, type IntakeReport } from "../../../supervisor/intake.js";
import type { VoiceRelayIntake } from "../../../talk/relayIntake.js";
import { queuePriorities } from "../../../workstreams/queuePriorities.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { readIntakeHalves } from "./intakeHalves.js";
import { provenRecipeFailureSeats } from "./recipeFailureSeats.js";
import { outcomeFields, outcomeRegister, type ReconciledCoverage, reconcileOutcomes } from "./reconcileOutcomes.js";
import { type FleetSource, fullIntakeClause, renderReconciliationLines } from "./reconcilePrint.js";
import {
  type BoardHolds,
  boardHolds,
  ledgerSessions,
  rankedRows,
  workedFromCmux,
  workedFromOpenRuns,
} from "./reconcileRows.js";
import { scopeFlagsOf, scopePaths } from "./reconcileScope.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The Queue's key prefix for a board ask's card (`site/lib/queueAskRow.ts`), which a deferral names it by. */
const ASK_KEY = "ask:";

/** The flags `handover reconcile` accepts. */
const RECONCILE_FLAGS: FlagSpec = { boolean: ["full", "json"], string: ["dir", "home", "now"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_RECONCILE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: RECONCILE_FLAGS }),
  ...booleanFlagsOf({ spec: RECONCILE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover reconcile`'s own flags — exported so the help-truth ratchet can prove the usage string and
 * the real parser agree.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverReconcileArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECONCILE_FLAGS });
}

const RECONCILE_USAGE =
  "usage: slopweaver handover reconcile [--json] [--full] [--now <iso>] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "The human read prints one line per row, its label cut to 120 characters, and at most five lines per\n" +
  "finding with the rest counted. --full prints every label whole and every finding uncapped; --json is the\n" +
  "whole document either way.\n" +
  "\n" +
  "Ranks the whole board — Slack tags, the owner's open asks and planned docs on one scale — then says\n" +
  "which live sessions are on the top of it, which are lower down, which are on nothing the board knows,\n" +
  "and which top rows are READY with nobody on them. Every live session is answerable to a row — there is\n" +
  "no standing session left to exclude. The headline states ONE number, the ready top rows nobody is on,\n" +
  "and whether a live session could move to one; every other finding is a line below it and a list in --json.\n" +
  "The owner-intake sentence is a separate `intakeClause`, which the briefing carries in that line's fold.\n" +
  "Only a row the fleet can actually be on enters the top band: one that is ready, or one in flight with a\n" +
  "live seat observed on it. Everything else — paused, blocked, parked on the owner, or a `role: supervisor` doc\n" +
  "seated before the chair holding the pin — is HELD and reported as a count, because a band admitting rows\n" +
  "nobody can start reports every one of them as starving and is right about none of them.\n" +
  "\n" +
  "example: slopweaver handover reconcile --json";

/**
 * The board holds as `--json` fields, every list sorted so two runs over the same board print the same bytes.
 *
 * @returns the hold fields of the JSON document
 */
function holdFields({ holds }: { holds: BoardHolds }): Record<string, unknown> {
  return {
    disconnectedRows: [...holds.disconnected.held.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([path, row]) => ({ needs: row.needs, path, slug: row.slug })),
    // `null` when the secrets store listed, so a present key always says whether the hold could look.
    disconnectedUnread: unsetFieldAsNull({ key: "unread", record: holds.disconnected }),
    repolessRows: holds.repoless,
    duplicateRecipeFailures: holds.duplicateRecipeFailures,
    repolessUrgentRows: holds.repolessUrgent,
    sharedSlugs: holds.sharedSlugs,
    supersededSupervisors: [...holds.supersession.superseded].toSorted(),
    supersessionUnresolved: holds.supersession.unresolved,
    trunkMovedRows: [...holds.trunkMoved.held.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([path, row]) => ({ moves: row.moves, path, slug: row.slug })),
    trunkPullsUnchecked: holds.trunkMoved.pullsUnchecked,
    trunkUnread: holds.trunkMoved.unread,
  };
}

/** Print the finding as JSON for a composer, or as the human read; the intake sentence is its own line and its own field. */
function emitReconciliation({
  intake,
  json,
  full,
  coverage,
  ranked,
  result,
  source,
  holds,
  released,
  voice,
  scopeFlags,
}: {
  intake: IntakeReport;
  json: boolean;
  /** Whether the human read prints every label whole and every finding uncapped. */
  full: boolean;
  coverage: ReconciledCoverage;
  ranked: readonly BoardRow[];
  result: Reconciliation;
  source: FleetSource;
  holds: BoardHolds;
  /** The open runs a session deliberately let go of — `../../../handover/releasedRows.ts`. */
  released: ReleasedRowsRead;
  voice: VoiceRelayIntake;
  /** The `--dir` and `--home` this run was given, which every printed command carries. */
  scopeFlags: readonly string[];
}): void {
  if (json) {
    logger.out({
      line: JSON.stringify({
        ...result,
        intake,
        intakeClause: fullIntakeClause({ intake, voice }),
        ...outcomeFields({ coverage }),
        rankedCount: ranked.length,
        source,
        releasedRows: released,
        ...holdFields({ holds }),
        voiceRelayIntake: voice,
      }),
    });
    return;
  }
  const lines = renderReconciliationLines({
    full,
    holds,
    intake,
    outcomes: coverage.outcomes,
    ranked,
    result,
    scopeFlags,
    source,
    unanchored: coverage.unanchored,
    voice,
  });
  for (const line of lines) {
    logger.out({ line });
  }
}

/** Whether the reconciliation FOUND something — the diagnostic exit every other board verb uses. */
function foundSomething({
  result,
  intake,
  voice,
}: {
  result: Reconciliation;
  intake: IntakeReport;
  voice: VoiceRelayIntake;
}): boolean {
  return (
    result.misaligned.length > 0 ||
    result.unregistered.length > 0 ||
    result.starving.length > 0 ||
    result.staleAsks.length > 0 ||
    (intake.kind === "read" && intake.finding.unwitnessed.length > 0) ||
    (intake.kind === "read" && intake.typed?.kind === "read" && intake.typed.finding.unwitnessed.length > 0) ||
    (intake.kind === "read" && intake.typed?.kind === "unavailable") ||
    voice.kind === "unavailable" ||
    voice.relays.length > 0
  );
}

/**
 * What the fleet is working, and where that was read from: the live cmux seats when cmux answered, else the
 * board's own open-run journals — a designed second source the result names, so the reconciliation never
 * mistakes it for an observed fleet.
 */
function workedFleet({
  fromCmux,
  models,
}: {
  fromCmux: readonly WorkedItem[] | undefined;
  models: readonly BoardModel[];
}): { readonly source: FleetSource; readonly worked: readonly WorkedItem[] } {
  if (fromCmux === undefined) {
    return { source: "open-runs", worked: workedFromOpenRuns({ models }) };
  }
  return { source: "cmux", worked: fromCmux };
}

/**
 * The asks the owner has put off on the Queue and not restored (`../../../queueDefer/cardDeferral.ts`), so a
 * priority's card they deferred ranks here where the Queue draws it, last. A ledger that will not read says so on
 * stderr and defers nothing, since the order then leads with cards they may have put off.
 *
 * @param home the state home the deferral ledger lives in
 * @returns when each deferred ask was put off, by slug
 */
function reconcileDeferred({ home }: { home: string }): ReadonlyMap<string, string> {
  const read = readCardDeferrals({ home });
  if (read.isErr()) {
    logger.error({
      msg: `handover reconcile: the owner's Queue deferrals did not read (${read.error.message}), so a card they put off may rank as a priority`,
    });
    return new Map();
  }
  const entries = standingDeferrals({ rows: read.value.rows }).flatMap((deferral): [string, string][] =>
    deferral.cardKey.startsWith(ASK_KEY) ? [[deferral.cardKey.slice(ASK_KEY.length), deferral.deferredIso]] : [],
  );
  return new Map(entries);
}

/**
 * Compose the board, read the live fleet, and set one against the other.
 *
 * Everything here is I/O the pure core cannot do for itself, split out of the verb so neither half runs past
 * the length at which a reader stops holding the body.
 *
 * @param docs every board doc the scan resolved
 * @param workstreams the owner's Workstreams register's workstreams, `null` when it is empty
 * @returns the reconciliation, the rows it ranked, where the fleet was read from, its outcome coverage (with the
 *   source that coverage read), what it held that no board section records — a retired chair, a row naming no
 *   `repo:` — and the journals it read
 */
async function reconcileBoard({
  docs,
  handoverDir,
  home,
  nowIso,
  workstreams,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  home: string;
  nowIso: string;
  workstreams: readonly WorkstreamAggregate[] | null;
}): Promise<{
  readonly result: Reconciliation;
  readonly ranked: readonly BoardRow[];
  readonly source: FleetSource;
  readonly coverage: ReconciledCoverage;
  readonly holds: BoardHolds;
  readonly journals: ReadonlyMap<string, JournalEvidence>;
}> {
  const journals = journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs });
  const models = composeBoardModels({
    journals,
    probeStates: new Map(),
    resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
    roots: docs,
  });
  const listed = await listLiveCmuxWorkspaces();
  const workspaces = listed.isOk() ? listed.value : undefined;
  const sessions = ledgerSessions({ home });
  const holds = boardHolds({ docs, home, models, nowIso, sessions, workspaces });
  const ranked = rankedRows({
    deferred: reconcileDeferred({ home }),
    disconnected: new Set(holds.disconnected.held.keys()),
    home,
    models,
    nowIso,
    priorities: workstreams === null ? [] : queuePriorities({ workstreams }),
    supersession: holds.supersession,
    trunkMoved: new Set(holds.trunkMoved.held.keys()),
  });
  // A bare shell left on a recipe failure finding seats nothing: `./recipeFailureSeats.ts`.
  const fromCmux = workedFromCmux({
    rows: ranked,
    sessions,
    workspaces: await provenRecipeFailureSeats({ rowIds: new Set(ranked.map((row) => row.id)), sessions, workspaces }),
  });
  const { source, worked } = workedFleet({ fromCmux, models });
  // The fleet was OBSERVED only when cmux answered. The open-runs fallback is the board's own journals, which
  // prove an unclosed cycle and never a living agent, so it may not make an in-flight row eligible for the
  // top band — `../../../handover/reconcile.ts`'s `eligible` closes that arm on `unavailable`.
  const result = reconcile({ fleet: source === "cmux" ? "observed" : "unavailable", ranked, worked });
  const coverage = reconcileOutcomes({ home, ranked, result, workstreams });
  return { coverage, holds, journals, ranked, result, source };
}

/**
 * Reconcile the fleet against the board.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when the reconciliation FOUND something, the same
 *   diagnostic-exit convention every other board verb uses
 */
export async function runHandoverReconcile(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RECONCILE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverReconcileArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: RECONCILE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  // Absolute, so a printed command pasted from another directory still names the board this run read, and
  // resolved BEFORE the scan, so the scan and the printed `--dir` are one path even through a symlink.
  const scope = scopePaths({ values });
  const home = typeof scope.home === "string" ? scope.home : slopweaverHome();
  const handoverDir = resolveHandoverDir({ dir: scope.dir, home });
  const nowIso = typeof values["now"] === "string" ? values["now"] : new Date().toISOString();
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover reconcile: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const docs = scan.value.docs;
  const read = await outcomeRegister({ home, store: productionWorkstreamRegister() });
  if ("refused" in read) {
    logger.error({ msg: read.refused });
    return EXIT_ERROR;
  }
  const { coverage, holds, journals, ranked, result, source } = await reconcileBoard({
    docs,
    handoverDir,
    home,
    nowIso,
    workstreams: read.workstreams,
  });
  const sinceIso = new Date(Date.parse(nowIso) - INTAKE_SWEEP_WINDOW_MS).toISOString();
  const { intake, voice } = readIntakeHalves({ docs, handoverDir, home, journals, nowIso, sinceIso });
  const json = values["json"] === true;
  emitReconciliation({
    coverage,
    full: values["full"] === true,
    holds,
    intake,
    json,
    ranked,
    released: releasedRowsOf({ journals }),
    result,
    scopeFlags: scopeFlagsOf({ scope }),
    source,
    voice,
  });
  return foundSomething({ intake, result, voice }) ? EXIT_ERROR : EXIT_OK;
}

export const handoverReconcileCommand = defineCommand({ run: runHandoverReconcile });
