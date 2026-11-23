/**
 * `slopweaver compact heal-refs [--apply] [--home <dir>]` — rewrite the Notion content refs redact's digit
 * pass carved up earlier, from the content stores that still hold the bytes.
 *
 * A thin shell over `corpus/notion/refHealRun.ts`: parse, census, print, and — only with `--apply` — write
 * under Notion's refresh slot, because the heal APPENDS to a bronze window file and a compaction unlinking
 * that file meanwhile would lose the row.
 */
import type { Result } from "#lib/result.js";
import { slopweaverHome } from "../../../config.js";
import { applyRefHeal, censusRefHeal, type RefHealCensus } from "../../../corpus/notion/refHealRun.js";
import {
  acquireRefreshSlot,
  compactSlotRefusalLines,
  releaseRefreshSlot,
  slotUnavailableLines,
} from "../../../corpus/refreshSlot.js";
import type { SlotVerdict } from "../../../lib/loadSlots.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, flagValueOr, type ParsedFlagTail, parseFlagTail, verbTail } from "../../optionParsers.js";
import { COMPACT_HEAL_REFS_USAGE } from "./healRefsUsage.js";

/** Every flag `compact heal-refs` accepts — the one spec its parser and its advertised names both read. */
const COMPACT_HEAL_REFS_FLAG_SPEC = { boolean: ["apply"], value: ["home"] } as const satisfies FlagTailSpec;

/** `compact heal-refs`' advertised flags, for the help-truth ratchet. Derived from the same spec. */
export const COMPACT_HEAL_REFS_FLAG_NAMES: readonly string[] = [
  ...COMPACT_HEAL_REFS_FLAG_SPEC.boolean,
  ...COMPACT_HEAL_REFS_FLAG_SPEC.value,
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse the flags after `compact heal-refs`. Pure.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the lines naming what was refused
 */
export function parseCompactHealRefsArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlagTail> {
  return parseFlagTail({ rest, spec: COMPACT_HEAL_REFS_FLAG_SPEC });
}

/**
 * The census as report lines — one per damaged winner, then one per refusal under it. Pure.
 *
 * @param census what the census found
 * @returns the lines, headline first
 */
export function healRefsLines({ census }: { census: RefHealCensus }): readonly string[] {
  const healable = census.targets.filter((target) => target.heal.healed > 0).length;
  const lines = [
    `heal-refs · notion: ${String(census.damagedIdentities)} record(s) ever named a carved digest; ` +
      `${String(census.superseded)} already superseded by an intact version; ` +
      `${String(census.targets.length)} still current, ${String(healable)} healable`,
  ];
  for (const target of census.targets) {
    lines.push(`  ${target.sourceId} @ ${target.tsIso}: ${String(target.heal.healed)} ref(s) healed`);
    for (const refusal of target.heal.refusals) {
      lines.push(`    refused ${refusal.code}: ${refusal.message}`);
    }
  }
  return lines;
}

/**
 * Print a refused Notion slot and return its exit: `EXIT_DEFERRED` behind a live holder, whose finish makes the same
 * run correct, and `EXIT_ERROR` for a slot that could not be taken at all — never a heal written without one.
 */
function refusedSlot({ slot }: { slot: Extract<SlotVerdict, { admitted: false }> }): number {
  const holder = slot.holders[0];
  if (holder === undefined) {
    slotUnavailableLines({ obstacles: slot.obstacles, source: "notion", verb: "compact" }).forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  compactSlotRefusalLines({
    holder: { pid: holder.pid, source: "notion", startedAtIso: holder.startedAtIso },
    source: "notion",
  }).forEach((line) => {
    logger.error({ msg: line });
  });
  return EXIT_DEFERRED;
}

/** Print a census's or a heal's refusal, one line each, and fail. */
function reportRefusal({ lines }: { lines: readonly string[] }): number {
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/**
 * Take the census and write the heal, both under Notion's refresh slot, and report what the re-run census
 * still found. The census is taken INSIDE the slot, never passed in: one read before it could name a winner a
 * sync superseded while the slot was still held, and the heal would then append a superseded row.
 */
function applyUnderSlot({ home }: { home: string }): number {
  const slot = acquireRefreshSlot({ source: "notion" });
  if (!slot.admitted) {
    return refusedSlot({ slot });
  }
  try {
    const taken = censusRefHeal({ home });
    if (taken.isErr()) {
      return reportRefusal({ lines: taken.error });
    }
    const census = taken.value;
    healRefsLines({ census }).forEach((line) => {
      logger.info({ msg: line });
    });
    if (census.targets.length === 0) {
      return EXIT_EXPECTED_EMPTY;
    }
    const applied = applyRefHeal({ census, home });
    if (applied.isErr()) {
      return reportRefusal({ lines: applied.error });
    }
    logger.info({ msg: `heal-refs · wrote ${String(applied.value.written)} healed record(s) to notion bronze` });
    if (applied.value.stillDamaged.length > 0) {
      logger.error({
        msg: `heal-refs · ${String(applied.value.stillDamaged.length)} record(s) still name a carved digest: ${applied.value.stillDamaged.join(", ")}`,
      });
      return EXIT_ERROR;
    }
    logger.info({ msg: "heal-refs · re-run census: no current notion record names a carved digest" });
    return EXIT_OK;
  } finally {
    releaseRefreshSlot({ source: "notion" });
  }
}

/**
 * Run the heal-refs verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runCompactHealRefs(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["heal-refs"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: COMPACT_HEAL_REFS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCompactHealRefsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: COMPACT_HEAL_REFS_USAGE });
    return EXIT_USAGE;
  }
  const home = flagValueOr({ fallback: slopweaverHome(), name: "home", parsed: parsed.value });
  if (parsed.value.flags.has("apply")) {
    return applyUnderSlot({ home });
  }
  const census = censusRefHeal({ home });
  if (census.isErr()) {
    return reportRefusal({ lines: census.error });
  }
  healRefsLines({ census: census.value }).forEach((line) => {
    logger.info({ msg: line });
  });
  if (census.value.targets.length === 0) {
    return EXIT_EXPECTED_EMPTY;
  }
  logger.info({ msg: "heal-refs · dry run — nothing written; --apply appends the healed versions" });
  return EXIT_OK;
}

export const compactHealRefsCommand = defineCommand({ run: runCompactHealRefs });
