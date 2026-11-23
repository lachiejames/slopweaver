/**
 * `slopweaver handover gate` — see, rebuild and lift the standing ruling gates.
 *
 * The other half of the mechanism `handover rule --gates` places. A refusal that surprises a session is only
 * half a guardrail; being able to ask "what is the owner currently gating, and why" in one cheap command is what
 * makes a WRONG gate findable rather than mysterious (`../../../handover/rulingGate.ts`).
 *
 * Four sub-verbs, each one act:
 *
 * - `list` — every standing gate, with the owner's words, the anchor, and whether it has lapsed.
 * - `rebuild` — reproject the index from the run journals that own it. Idempotent, ~0.7 s.
 * - `check` — is the index what the journals say it should be? A divergence is reported, never repaired
 *   silently: silently repairing it would hide the only symptom the fail-open read path has.
 * - `release <gate-id>` — record the owner's word that the constraint is over. The one thing that lifts a gate, and
 *   it is itself a ruling, so it carries the owner's words and an anchor a reader can go and check.
 *
 * This verb is in `UNGATEABLE`: a gate on it would be a gate nothing could lift.
 */

import { slopweaverHome } from "../../../config.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { isCanonicalInstant } from "../../../handover/ruling.js";
import { type StandingGate, unexpiredGates } from "../../../handover/rulingGate.js";
import { RulingGateErrors } from "../../../handover/rulingGateErrors.js";
import { readStandingGates, rebuildStandingGates, writeStandingGates } from "../../../handover/rulingGateStore.js";
import { skippedLinesNote } from "../../../handover/staleReader.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover gate` accepts. Both arms are spelled, so neither is ever absent. */
const GATE_FLAGS: FlagSpec = { boolean: [], string: ["anchor", "words", "home", "now"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_GATE_FLAG_NAMES: readonly string[] = [...GATE_FLAGS.string!, ...GATE_FLAGS.boolean!]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * The verb's own argument parse, exported so the help-truth ratchet can probe every flag the usage
 * advertises against the parser that has to accept it.
 *
 * @param rest the verb's own arguments, with `[node, cli, handover, gate]` already stripped
 * @returns the parsed flags and positionals, or the caller mistakes
 */
export function parseHandoverGateArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: GATE_FLAGS });
}

export const HANDOVER_GATE_USAGE =
  "usage: slopweaver handover gate list|rebuild|check [--now <iso>] [--home <dir>]\n" +
  "       slopweaver handover gate release <gate-id> --anchor <where the owner said it> --words <the owner's words> " +
  "[--home <dir>]\n" +
  "\n" +
  "A ruling gate is the owner's own recorded word on the board refusing the verb it rules on, so a ruling keeps\n" +
  "biting after the session that heard it is gone. `handover rule --gates` places one.\n" +
  "\n" +
  "`list` prints every standing gate; `rebuild` reprojects the index from the run journals that own it;\n" +
  "`check` reports a divergence between the two without repairing it. `release` is the ONLY thing that lifts\n" +
  "a gate — it records a ruling of its own, so the owner's words and an anchor are both required. A gate has no\n" +
  "escape hatch and no environment override.\n" +
  "\n" +
  'example: slopweaver handover gate release my-row#2026-09-21T05:35:28.000Z --anchor <permalink> --words "ok, post it"';

/** One line describing a gate, for `list` and for a release's read-back. */
function gateLines({ gate, nowIso }: { gate: StandingGate; nowIso: string }): readonly string[] {
  const lapsed = gate.untilIso !== undefined && Date.parse(gate.untilIso) <= Date.parse(nowIso);
  const verbs = gate.verbs.map((pair) => `${pair.noun} ${pair.verb}`).join(", ");
  const lines = [
    `${gate.id}${lapsed ? "  (LAPSED)" : ""}`,
    `  gates: ${verbs}`,
    `  owner said: ${gate.words}`,
    `  where: ${gate.anchor}`,
  ];
  if (gate.subjects.length > 0) {
    lines.push(`  scoped to: ${gate.subjects.join(", ")}`);
  }
  if (gate.untilIso !== undefined) {
    lines.push(`  lapses at: ${gate.untilIso}`);
  }
  return lines;
}

/** `list` — every gate the projection holds, lapsed ones included and labelled. */
function runList({ home, nowIso }: { home: string; nowIso: string }): number {
  const gates = readStandingGates({ indexPath: stateHomePaths({ home }).rulingGatesJson });
  if (gates.length === 0) {
    logger.out({ line: "handover gate list: no standing ruling gates" });
    logger.out({ line: "  if that is a surprise, the projection may be missing: slopweaver handover gate rebuild" });
    return EXIT_OK;
  }
  const live = unexpiredGates({ gates, nowIso });
  logger.out({
    line: `handover gate list: ${String(gates.length)} recorded, ${String(live.length)} in force at ${nowIso}`,
  });
  for (const gate of gates) {
    for (const line of gateLines({ gate, nowIso })) {
      logger.out({ line: `  ${line}` });
    }
  }
  return EXIT_OK;
}

/** `rebuild` — reproject the index out of the run journals. */
function runRebuild({ home, nowIso }: { home: string; nowIso: string }): number {
  const paths = stateHomePaths({ home });
  const gates = rebuildStandingGates({ runsDir: paths.runs });
  const written = writeStandingGates({ builtAtIso: nowIso, gates, indexPath: paths.rulingGatesJson });
  if (written.isErr()) {
    logger.error({ msg: `handover gate rebuild: ${written.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover gate rebuild: ${String(gates.length)} standing gate(s) → ${written.value}` });
  return EXIT_OK;
}

/**
 * `check` — is the projection what the journals say it should be?
 *
 * Reported, never repaired. The read path fails OPEN, so a divergence is its only symptom; a check that
 * quietly fixed one would remove the evidence that anything had gone wrong.
 */
function runCheck({ home }: { home: string }): number {
  const paths = stateHomePaths({ home });
  const projected = readStandingGates({ indexPath: paths.rulingGatesJson });
  const journalled = rebuildStandingGates({ runsDir: paths.runs });
  const projectedIds = new Set(projected.map((gate) => gate.id));
  const journalledIds = new Set(journalled.map((gate) => gate.id));
  const missing = journalled.filter((gate) => !projectedIds.has(gate.id));
  const extra = projected.filter((gate) => !journalledIds.has(gate.id));
  if (missing.length === 0 && extra.length === 0) {
    logger.out({ line: `handover gate check: the index matches the journals (${String(journalled.length)} gate(s))` });
    return EXIT_OK;
  }
  logger.error({
    msg:
      `handover gate check: the index and the journals disagree — ${String(missing.length)} gate(s) the ` +
      `journals hold are not projected, ${String(extra.length)} projected gate(s) no journal holds`,
  });
  for (const gate of missing) {
    logger.error({ msg: `  not projected (so not firing): ${gate.id}` });
  }
  for (const gate of extra) {
    logger.error({ msg: `  projected with no journal behind it: ${gate.id}` });
  }
  logger.error({ msg: "  slopweaver handover gate rebuild" });
  return EXIT_ERROR;
}

/** `release <gate-id>` — record the owner's word that the constraint is over, on the row that placed it. */
function runRelease({
  home,
  id,
  anchor,
  words,
  nowIso,
}: {
  home: string;
  id: string;
  anchor: string;
  words: string;
  nowIso: string;
}): number {
  const paths = stateHomePaths({ home });
  const gates = rebuildStandingGates({ runsDir: paths.runs });
  const gate = gates.find((candidate) => candidate.id === id);
  if (gate === undefined) {
    logger.error({ msg: `handover gate release: ${RulingGateErrors.notFound({ id }).message}` });
    return EXIT_ERROR;
  }
  const written = applyRowEvent({
    event: {
      anchor,
      atIso: nowIso,
      decidedIso: nowIso,
      gateReleases: [gate.id],
      kind: "ruling",
      ruling: words,
    },
    runsDir: paths.runs,
    slug: gate.slug,
  });
  if (written.isErr()) {
    logger.error({ msg: `handover gate release: ${written.error.message}` });
    return EXIT_ERROR;
  }
  const remaining = rebuildStandingGates({ runsDir: paths.runs });
  const reprojected = writeStandingGates({ builtAtIso: nowIso, gates: remaining, indexPath: paths.rulingGatesJson });
  if (reprojected.isErr()) {
    logger.error({ msg: `handover gate release: ${reprojected.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover gate release: ${gate.id} is lifted — recorded in ${written.value.path}` });
  const skipped = skippedLinesNote({ skipped: written.value.skipped });
  if (skipped !== undefined) {
    logger.out({ line: `  ${skipped}` });
  }
  logger.out({ line: `  ${String(remaining.length)} gate(s) still standing` });
  return EXIT_OK;
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @returns the process exit code
 */
export function runHandoverGate(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_GATE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverGateArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: HANDOVER_GATE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const declaredNow = typeof values["now"] === "string" ? values["now"] : new Date().toISOString();
  // A release is written as a ruling whose `decidedIso` is this instant, so it is held to the canonical spelling
  // `handover rule --decided-iso` is: `Date.parse` reads `0001-01-01 00:00:00.000Z` as 2001.
  if (!isCanonicalInstant({ iso: declaredNow })) {
    logger.error({
      msg: `handover gate: --now "${declaredNow}" is not a canonical UTC instant (YYYY-MM-DDTHH:MM:SS.sssZ)`,
    });
    return EXIT_USAGE;
  }
  const nowIso = declaredNow;
  const sub = parsed.value.positionals[0];
  if (sub === "list") {
    return runList({ home, nowIso });
  }
  if (sub === "rebuild") {
    return runRebuild({ home, nowIso });
  }
  if (sub === "check") {
    return runCheck({ home });
  }
  if (sub === "release") {
    return release({ argv: parsed.value.positionals, home, nowIso, values });
  }
  logger.error({ msg: "handover gate: name a sub-verb — list, rebuild, check or release" });
  logger.error({ msg: HANDOVER_GATE_USAGE });
  return EXIT_USAGE;
}

/** `release`'s own argument checks, split out so {@link runHandoverGate} stays one dispatch. */
function release({
  argv,
  home,
  nowIso,
  values,
}: {
  argv: readonly string[];
  home: string;
  nowIso: string;
  values: Readonly<Record<string, unknown>>;
}): number {
  const id = argv[1];
  if (id === undefined) {
    logger.error({
      msg: "handover gate release: which gate? Pass its id — `slopweaver handover gate list` names them",
    });
    return EXIT_USAGE;
  }
  const anchor = typeof values["anchor"] === "string" ? values["anchor"].trim() : "";
  if (anchor.length === 0) {
    logger.error({ msg: "handover gate release: --anchor is required — where the owner said the constraint is over" });
    return EXIT_USAGE;
  }
  const words = typeof values["words"] === "string" ? values["words"] : "";
  if (words.trim().length === 0) {
    logger.error({
      msg: "handover gate release: --words is required — a release is itself a ruling, in the owner's words",
    });
    return EXIT_USAGE;
  }
  return runRelease({ anchor, home, id, nowIso, words });
}

export const handoverGateCommand = defineCommand({ run: (argv) => runHandoverGate(argv) });
