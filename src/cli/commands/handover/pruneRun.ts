/**
 * `slopweaver handover prune` — the trimmed board: what still earns its keep, and what the register already
 * decided.
 *
 * The effectful edge over {@link ../../../handover/prune.ts}, which carries the measurement, the taxonomy and
 * the two rails. This module assembles the one read the pure core cannot do for itself — the board — and
 * prints the SURVIVORS, because the survivor list is the artefact the trimming is driven from.
 *
 * ## Why the survivors print and the pruned rows fold
 *
 * MEASURED on the p0 band the day this landed — `slopweaver handover prune --priority p0` — **183 rows read,
 * 28 survivors**: 151 already settled, 3 shipped with no settlement, 1 day-scope candidate. Printing 155
 * verdicts above the 28 that matter would be the wall of text doctrine rule 7 bans on an outbound surface and
 * the same defect on a local one — so the pruned rows are COUNTED above the fold and listed only under
 * `--verdicts`, while the survivors always print in full. `--json` carries everything, because a machine
 * reader has no fold.
 *
 * ## Why there is no `--settle`
 *
 * Every performable verdict prints the `slopweaver handover settle` command that performs it — less the
 * `--card done|recut|kept` a relay row about an open hand card also needs, which is a judgement no pruner makes, so
 * settle refuses that one and names the card — and this
 * verb never runs one. `handover settle` asks two gates before it writes — `./lessonsGate.ts` and
 * `./checksReadGate.ts` — and a pruner that spliced the front-matter itself would bypass both. A verb that
 * weakens a gate to save an operator one command is the trade this repository refuses.
 */

import { slopweaverHome } from "../../../config.js";
import { archivedDependencies, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import {
  PRUNE_KEEP,
  type PruneCandidate,
  type PrunePass,
  type PruneVerdict,
  type PruneVerdictKind,
  prunePass,
  pruneSummary,
} from "../../../handover/prune.js";
import { relayLandingReader } from "../../../handover/relayLandingRead.js";
import {
  type RelayBoardRow,
  type RelayLandingEvidence,
  type RelayTakenUp,
  type RelayWorkEvidence,
  relayAnchorOfRow,
  relayTakenUpOf,
} from "../../../handover/relayTakenUp.js";
import { readRelayWorkEvidence } from "../../../handover/relayTakenUpRead.js";
import { type BoardPriority, effectivePriority } from "../../../handover/rowKind.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { IntakeMark } from "../../../supervisor/intake.js";
import { readIntakeMarks } from "../../../supervisor/intakeStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The boolean flags `handover prune` accepts. */
const PRUNE_BOOLEAN_FLAGS: readonly string[] = ["json", "verdicts"];

/** The value-taking flags `handover prune` accepts. */
const PRUNE_STRING_FLAGS: readonly string[] = ["dir", "home", "now", "priority"];

/**
 * The flags `handover prune` accepts.
 *
 * Assembled from the two arrays above rather than declared inline so {@link HANDOVER_PRUNE_FLAG_NAMES} can be
 * built without reaching back through the optional members of `FlagSpec` — a `?? []` on either would be the
 * silent substitution `no-silent-fallback` refuses, and there is nothing absent here to substitute for.
 */
const PRUNE_FLAGS: FlagSpec = {
  boolean: PRUNE_BOOLEAN_FLAGS,
  string: PRUNE_STRING_FLAGS,
};

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_PRUNE_FLAG_NAMES: readonly string[] = [...PRUNE_STRING_FLAGS, ...PRUNE_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover prune`'s own flags, exported so the help-truth gate exercises the REAL parser rather than a
 * restatement of it.
 *
 * @param rest the verb's own arguments, with the noun and verb already stripped
 * @returns the parsed flags, or the reasons the parse failed
 */
export function parseHandoverPruneArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PRUNE_FLAGS });
}

export const HANDOVER_PRUNE_USAGE =
  "usage: slopweaver handover prune [--priority p0|p1|p2|p3] [--verdicts] [--json] [--now <iso>] " +
  "[--dir <path>] [--home <dir>]";

/** Every priority the `--priority` filter accepts, so a typo is refused rather than silently matching nothing. */
const PRIORITIES: readonly BoardPriority[] = ["p0", "p1", "p2", "p3"];

/**
 * Whether a `--priority` value is one the board declares.
 *
 * A predicate rather than an `includes` at the call site because narrowing is the point: the filter compares a
 * `BoardPriority` and a bare string comparison would compile while matching nothing on a typo.
 *
 * @returns true when the value is a board priority
 */
function isBoardPriority(value: string): value is BoardPriority {
  return PRIORITIES.some((known) => known === value);
}

/**
 * Turn one composed board model into the candidate the pure engine judges.
 *
 * `authoredStatus` is the `status:` LINE, and it is read here for exactly one purpose — spotting the paused
 * rail — never to decide whether the row is live. That distinction is the whole finding
 * {@link ../../../handover/prune.ts} was built on, so it is stated at the one place the line is read.
 *
 * @param model the composed model, whose `derived` state is what every other field is taken from
 * @returns the candidate
 */
export function pruneCandidateOf({
  model,
  relayTakenUp,
}: {
  model: BoardModel;
  relayTakenUp: RelayTakenUp | undefined;
}): PruneCandidate {
  return {
    askedIso: model.doc.kind === "ask" ? model.doc.askedIso : undefined,
    authoredStatus: model.doc.status,
    derived: model.derived,
    priority: effectivePriority({ declared: model.doc.priority, kind: model.doc.kind }),
    relayTakenUp,
    rowKind: model.doc.kind,
    run: model.run,
    section: model.section,
    slug: model.doc.slug,
  };
}

/**
 * The board as the relay reader sees it: every row's slug, anchor, and whether its DERIVED state is settled.
 *
 * @param models the composed board
 * @returns one row per model
 */
function relayRowsOf({ models }: { models: readonly BoardModel[] }): readonly RelayBoardRow[] {
  return models.map((model) => ({
    anchor: model.doc.anchor,
    settled: model.derived.settlement !== undefined,
    slug: model.doc.slug,
  }));
}

/** One command a verdict offers, with the verdict kind that produced it. */
interface PruneCommandRow {
  readonly kind: PruneVerdictKind;
  readonly command: string;
}

/**
 * The commands the REGISTER's own verdicts offer.
 *
 * Reached through `verdict.conclusive` rather than through the presence of a command, so the discriminant is
 * what selects the block. A filter on `performWith !== undefined` compiled against the union's first draft and
 * printed a text rule's command under this heading; a candidate arm has no `performWith` at all now, so the
 * same mistake no longer type-checks.
 *
 * @returns one row per conclusive verdict that still has something to perform
 */
function performableCommands({ pass }: { pass: PrunePass }): readonly PruneCommandRow[] {
  return pass.verdicts.flatMap((verdict) => {
    if (!verdict.conclusive) {
      return [];
    }
    if (verdict.performWith === undefined) {
      return [];
    }
    return [{ command: verdict.performWith, kind: verdict.kind }];
  });
}

/**
 * The commands a TEXT rule proposes, which no actuator may ever run unread.
 *
 * @returns one row per pruned candidate carrying a command
 */
function proposedCommands({ pass }: { pass: PrunePass }): readonly PruneCommandRow[] {
  return pass.verdicts.flatMap((verdict) => {
    if (verdict.conclusive) {
      return [];
    }
    if (verdict.kind === PRUNE_KEEP) {
      return [];
    }
    if (verdict.proposeWith === undefined) {
      return [];
    }
    return [{ command: verdict.proposeWith, kind: verdict.kind }];
  });
}

/** Print one block of commands, or nothing at all when there are none — an empty heading says less than silence. */
function emitCommandBlock({
  label,
  note,
  rows,
}: {
  label: string;
  note: string;
  rows: readonly PruneCommandRow[];
}): void {
  if (rows.length === 0) {
    return;
  }
  logger.out({ line: "" });
  logger.out({ line: `${label} (${rows.length}) — ${note}` });
  rows.forEach((row) => {
    logger.out({ line: `  ${row.kind}: ${row.command}` });
  });
}

/** One printed line for a verdict: the slug, then the checkable thing behind it. */
function verdictLine({ verdict }: { verdict: PruneVerdict }): string {
  return `  ${verdict.slug}\n      ${verdict.witness}`;
}

/**
 * Print the pass: the counts, then the survivors in full, then the commands that perform what is performable.
 *
 * @param pass what the pure engine decided
 * @param verdicts whether to list every pruned row rather than only count it
 */
export function emitPrunePass({ pass, verdicts }: { pass: PrunePass; verdicts: boolean }): void {
  logger.out({ line: `handover prune: ${pruneSummary({ pass })}` });
  logger.out({ line: "" });
  Object.entries(pass.counts)
    .filter(([kind, count]) => kind !== PRUNE_KEEP && count > 0)
    .toSorted(([, left], [, right]) => right - left)
    .forEach(([kind, count]) => {
      logger.out({ line: `  ${String(count).padStart(4)}  ${kind}` });
    });
  logger.out({ line: "" });
  logger.out({ line: `SURVIVORS (${pass.survivors.length}) — what still earns its keep` });
  pass.survivors.forEach((verdict) => {
    logger.out({ line: verdictLine({ verdict }) });
  });
  emitCommandBlock({
    label: "PERFORM",
    note: "the register decided these; settle asks two gates first",
    rows: performableCommands({ pass }),
  });
  emitCommandBlock({
    label: "WEIGH",
    note: "a TEXT rule reached these; read the row before running one",
    rows: proposedCommands({ pass }),
  });
  if (!verdicts) {
    logger.out({ line: "" });
    logger.out({ line: "  --verdicts lists every pruned row with its witness; --json carries the whole pass" });
    return;
  }
  logger.out({ line: "" });
  logger.out({ line: "PRUNED — every row and the witness that pruned it" });
  pass.verdicts
    .filter((verdict) => verdict.kind !== PRUNE_KEEP)
    .forEach((verdict) => {
      logger.out({ line: `  [${verdict.kind}]${verdictLine({ verdict }).slice(1)}` });
    });
}

/** A string flag's value, or undefined when it was not given. */
function stringFlag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/*
 * Three one-line resolvers, each written as a DESTRUCTURED DEFAULT rather than a ternary or a `??`.
 * `no-silent-fallback` bans the operator and oxlint's `prefer-nullish-coalescing` (run with
 * `--deny-warnings`) refuses the equivalent ternary, so a destructured default is the one spelling both
 * gates accept — and it is the spelling the rule names first. Each one names the absent case in its own
 * signature, which is what the ban is actually for.
 */

/** The state home a run reads: the `--home` flag, or the ambient one. */
function resolvedHome({ home = slopweaverHome() }: { home?: string | undefined }): string {
  return home;
}

/** The instant a pass is judged at: `--now`, or the wall clock. */
function resolvedNow({ now = new Date().toISOString() }: { now?: string | undefined }): string {
  return now;
}

/** What the `--json` document calls the band it read: the named priority, or every one of them. */
function bandLabel({ priority = "all" }: { priority?: BoardPriority | "all" | undefined }): string {
  return priority;
}

/** Every candidate on the board, filtered to the `--priority` band when one was named. */
function boardCandidates({
  docs,
  handoverDir,
  home,
  marks,
  priority,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
  home: string;
  marks: readonly IntakeMark[];
  priority: BoardPriority | undefined;
}): readonly PruneCandidate[] {
  const models = composeBoardModels({
    journals: journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs }),
    probeStates: new Map(),
    resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
    roots: docs,
  });
  const rows = relayRowsOf({ models });
  const landingOf = relayLandingReader({ handoverDir, home });
  const all = models.map((model) => {
    const relay = { anchor: model.doc.anchor, settled: model.derived.settlement !== undefined, slug: model.doc.slug };
    const landing = (): RelayLandingEvidence => relayLandingOf({ landingOf, relay });
    return pruneCandidateOf({
      model,
      relayTakenUp: relayTakenUpOf({ landing, marks, relay, rows, work: () => relayWorkOf({ home, relay }) }),
    });
  });
  if (priority === undefined) {
    return all;
  }
  return all.filter((candidate) => candidate.priority === priority);
}

/**
 * Where an uncut relay's landing on its ask stands, said on stderr when a register would not read: that relay then
 * survives the pass. Only called past `relayTakenUpOf`'s own relay check, so its anchor is there.
 *
 * @returns the relay's landing evidence
 */
function relayLandingOf({
  landingOf,
  relay,
}: {
  landingOf: ReturnType<typeof relayLandingReader>;
  relay: RelayBoardRow;
}): RelayLandingEvidence {
  const landing = landingOf({ anchor: relayAnchorOfRow({ row: relay })!, slug: relay.slug });
  if (landing.kind === "unreadable") {
    logger.error({ msg: `handover prune: ${relay.slug} stays — ${landing.why}` });
  }
  return landing;
}

/**
 * What became of a marked relay's words, said on stderr when a register would not read: that relay then survives
 * the pass, never reading as one spoken over no card. Only ever called for a relay's own row
 * (`relayTakenUpOf` asks once it holds a mark that would answer it), so its anchor is there.
 *
 * @returns the relay's work evidence
 */
function relayWorkOf({ home, relay }: { home: string; relay: RelayBoardRow }): RelayWorkEvidence {
  const anchor = relayAnchorOfRow({ row: relay })!;
  const work = readRelayWorkEvidence({ anchor, home, slug: relay.slug });
  if (work.kind === "unreadable") {
    logger.error({ msg: `handover prune: ${relay.slug} stays — ${work.why}` });
  }
  return work;
}

/**
 * The intake ledger the relay rule reads, or none — said on stderr, so a pass that could not read the chair's marks
 * says so rather than reading as one where nothing was marked. Only the mark half of `relay-taken-up` is lost; a
 * relay with a cut row is still found, and every other rule is untouched.
 *
 * @returns the marks, or an empty list after printing why
 */
function intakeMarksOrNone({ home }: { home: string }): readonly IntakeMark[] {
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    logger.error({ msg: `handover prune: ${marks.error.message} — relay-taken-up reads no intake marks this pass` });
    return [];
  }
  return marks.value;
}

/**
 * Read the board, judge every row, and print the trimmed one.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverPrune(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_PRUNE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverPruneArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: HANDOVER_PRUNE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const band = stringFlag({ name: "priority", values });
  if (band !== undefined && !isBoardPriority(band)) {
    logger.error({ msg: `handover prune: --priority "${band}" is not one of ${PRIORITIES.join(", ")}` });
    return EXIT_USAGE;
  }
  const home = resolvedHome({ home: stringFlag({ name: "home", values }) });
  const handoverDir = resolveHandoverDir({ dir: stringFlag({ name: "dir", values }), home });
  const nowIso = resolvedNow({ now: stringFlag({ name: "now", values }) });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    logger.error({ msg: `handover prune: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const candidates = boardCandidates({
    docs: scan.value.docs,
    handoverDir,
    home,
    marks: intakeMarksOrNone({ home }),
    priority: band,
  });
  const pass = prunePass({ candidates, nowIso });
  if (values["json"] === true) {
    logger.out({ line: JSON.stringify({ ...pass, band: bandLabel({ priority: band }), nowIso }, null, 2) });
    return EXIT_OK;
  }
  emitPrunePass({ pass, verdicts: values["verdicts"] === true });
  return EXIT_OK;
}

export const handoverPruneCommand = defineCommand({
  run: (argv) => runHandoverPrune(argv),
});
