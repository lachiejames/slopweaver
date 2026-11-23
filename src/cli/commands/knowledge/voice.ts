/**
 * `slopweaver knowledge voice` — hand this session a bounded batch of their own recorded words to read.
 *
 * It proposes nothing. The owner's voice dumps are the SOURCE of proposed beliefs, and
 * `AGENTS.md` rule 2 forbids a headless model anywhere, so the split is structural: this verb locates,
 * deduplicates, orders and bounds; the visible session reads the batch and composes a claim with
 * `knowledge propose`.
 *
 * The watermark is printed on every run, and it is the part to read first. "How many units the scan found"
 * and "how much of what they have said this installation holds" are different claims, and only the first is
 * one this verb can make.
 */
import { type VoiceBatch, writeBatch } from "../../../knowledge/voice/batch.js";
import { scanVoice } from "../../../knowledge/voice/scan.js";
import { readProposals } from "../../../knowledge/voice/store.js";
import {
  type BeliefProposal,
  VOICE_SOURCE_KINDS,
  type VoiceSourceKind,
  type VoiceUnit,
} from "../../../knowledge/voice/types.js";
import { nextBatch, reviewedUnitIds } from "../../../knowledge/voice/unit.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { VERB_ARG_OFFSET, VOICE_USAGE } from "./core.js";
import { parseKnowledgeVoiceArgs } from "./flagSpecs.js";

/** How many units a batch carries when `--batch` is not given. Small on purpose: a session reads these. */
const DEFAULT_BATCH = 5;

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Run `knowledge voice`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runKnowledgeVoice(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VOICE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseKnowledgeVoiceArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VOICE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = flag({ name: "home", values });
  const kinds = requestedKinds({ values });
  if (kinds === undefined) {
    logger.error({ msg: `knowledge voice: --source must be one of ${VOICE_SOURCE_KINDS.join(", ")}` });
    logger.error({ msg: VOICE_USAGE });
    return EXIT_USAGE;
  }
  const size = batchSize({ values });
  if (size === undefined) {
    logger.error({
      msg: "knowledge voice: --batch must be a whole number of units, and 0 asks for the watermark alone",
    });
    logger.error({ msg: VOICE_USAGE });
    return EXIT_USAGE;
  }
  const answered = readProposals(home === undefined ? {} : { home });
  if (answered.isErr()) {
    logger.error({ msg: `knowledge voice: ${answered.error.message}` });
    return EXIT_ERROR;
  }
  const gathered = gatherBatch({ home, kinds, proposals: answered.value, size });
  const out = flag({ name: "out", values });
  if (out !== undefined) {
    const written = writeBatch({ batch: gathered, path: out });
    if (written.isErr()) {
      logger.error({ msg: `knowledge voice: ${written.error.message}` });
      return EXIT_ERROR;
    }
  }
  if (values["json"] === true) {
    logger.out({ line: JSON.stringify({ kind: "watermark", ...gathered.watermark }) });
    gathered.units.forEach((unit) => {
      logger.out({ line: JSON.stringify({ kind: "unit", ...unit }) });
    });
    return EXIT_OK;
  }
  reportBatch({ batch: gathered.units, out, watermark: gathered.watermark });
  return EXIT_OK;
}

/**
 * Scan the families asked for and take the next batch out of them, with the watermark that batch carries.
 *
 * Split out of {@link runKnowledgeVoice} so the verb's body stays a sequence of refusals: everything here
 * is the WORK, and everything left up there is a flag being checked or an outcome being printed.
 *
 * @param home the state home to scan, absent for the resolved one
 * @param kinds which families to read
 * @param proposals every row the queue holds, which is what "already reviewed" is derived from
 * @param size how many units to hand over
 * @returns the batch and its watermark, ready to write or print
 */
function gatherBatch({
  home,
  kinds,
  proposals,
  size,
}: {
  home: string | undefined;
  kinds: readonly VoiceSourceKind[];
  proposals: readonly BeliefProposal[];
  size: number;
}): VoiceBatch {
  const scan = scanVoice({ kinds, ...(home === undefined ? {} : { home }) });
  const reviewed = reviewedUnitIds({ proposals });
  return {
    units: nextBatch({ reviewed, size, units: scan.units }),
    watermark: {
      kinds,
      recordings: scan.recordings,
      reviewed: scan.units.filter((unit) => reviewed.has(unit.id)).length,
      scannedAtIso: new Date().toISOString(),
      units: scan.units.length,
      unreadable: scan.unreadable,
    },
  };
}

/**
 * How many units to hand over: the default when `--batch` is absent, the number when it is one, and
 * undefined when it is not.
 *
 * ZERO is a real answer, not a fallback. `--batch 0` asks for the watermark alone, which is how you measure
 * the sources without reading any of their words — and it is the shape that caught this: an earlier version
 * treated 0 as "not a positive integer" and silently handed over five units while reporting success, which
 * is the same silent-fallback defect `./list.ts` refuses on its facet flags.
 *
 * @param values the parsed flag values
 * @returns the size, or undefined when `--batch` was typed as something that is not a count
 */
function batchSize({ values }: { values: Readonly<Record<string, unknown>> }): number | undefined {
  const typed = flag({ name: "batch", values });
  if (typed === undefined) {
    return DEFAULT_BATCH;
  }
  const parsed = Number(typed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Which families to read, or undefined when `--source` named something outside the vocabulary. */
function requestedKinds({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): readonly VoiceSourceKind[] | undefined {
  const typed = flag({ name: "source", values });
  if (typed === undefined) {
    return VOICE_SOURCE_KINDS;
  }
  const found = VOICE_SOURCE_KINDS.find((kind) => kind === typed);
  return found === undefined ? undefined : [found];
}

/** The human report: the watermark, then each unit with the whole of what they said. */
function reportBatch({
  watermark,
  batch,
  out,
}: {
  watermark: {
    readonly recordings: number;
    readonly units: number;
    readonly reviewed: number;
    readonly unreadable: readonly { readonly locator: string; readonly why: string }[];
    readonly kinds: readonly VoiceSourceKind[];
  };
  batch: readonly VoiceUnit[];
  out: string | undefined;
}): void {
  logger.out({
    line:
      `knowledge voice: ${String(watermark.recordings)} recording(s) across ${watermark.kinds.join(", ")} ` +
      `collapse to ${String(watermark.units)} distinct thing(s) they said; ${String(watermark.reviewed)} already reviewed`,
  });
  if (watermark.unreadable.length > 0) {
    logger.out({ line: `  ${String(watermark.unreadable.length)} source(s) would not read:` });
    watermark.unreadable.forEach((entry) => {
      logger.out({ line: `    ${entry.locator} — ${entry.why}` });
    });
  }
  if (batch.length === 0) {
    logger.out({ line: "  nothing left unreviewed in the families asked for" });
    return;
  }
  batch.forEach((unit) => {
    logger.out({ line: "" });
    logger.out({
      line: `${unit.id} · ${unit.source} · ${String(unit.words)} word(s) · seen ${String(unit.occurrences)} time(s)`,
    });
    logger.out({ line: `  ${unit.locator}${unit.instantIso === undefined ? "" : ` · ${unit.instantIso}`}` });
    if (unit.wrapped) {
      logger.out({
        line:
          "  WRAPPED: a supervisor seat wrote this file around their words, so it carries a provenance header " +
          "and usually a reading of its own. Quote only what they said.",
      });
    }
    logger.out({ line: "" });
    logger.out({ line: unit.text });
  });
  logger.out({ line: "" });
  logger.out({
    line:
      out === undefined
        ? "Re-run with --out <path> to pin this batch, then answer each unit with `slopweaver knowledge propose`."
        : `Batch pinned at ${out}. Answer each unit with \`slopweaver knowledge propose --from ${out}\`.`,
  });
}

export const knowledgeVoiceCommand = defineCommand({ run: runKnowledgeVoice });
