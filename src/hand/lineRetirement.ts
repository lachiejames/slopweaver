/**
 * Retiring an unreadable register line whose step is PROVABLY settled — the pure half of `hand line-retire`.
 *
 * `./store.ts` skips a line it cannot read and every caller reports it, because a dropped POSTED line may be a step
 * waiting on the owner that no surface names. That report is load-bearing and stays. What it cannot tell apart is a
 * line whose step a LATER, readable line already settled: there the report is a gap that never closes, and the
 * register is append-only, so the line can never be edited out either. MEASURED on a home carried through a one-off
 * sanitiser that rewrote names into `Product 1`: three posted lines stopped parsing (a step id with a space, a board
 * row slug with one), each settled by a readable line after it, and `automation status` printed
 * `3 floating-note line(s) would not read` on every run with nothing anyone could do about it.
 *
 * A retirement is a row in a sidecar beside the register, never a change to the register. It names the line by
 * NUMBER and by the sha256 of its exact text, and the settling line the same way. The reader honours it only while
 * both still match, so a retirement over bytes that changed is ignored and the gap reappears — the failure is loud
 * in the direction that matters.
 *
 * A line's text is hashed as the UTF-8 the line reader decoded, without its newline: for every line that decodes,
 * that is its exact bytes.
 */
import { sha256Hex } from "../lib/hash.js";
import { isRecord } from "../lib/parsers.js";

import { type HandRow, isSettledRow } from "./row.js";

/**
 * The `kind` every retirement row carries, so a sidecar line of anything else is never read as one.
 *
 * @internal
 */
export const LINE_RETIREMENT_KIND = "unreadable-line-retired";

/** One line of the register as a scan saw it: its number, its hash, and its rows or why it has none. */
export type ScannedLine =
  | {
      readonly lineNumber: number;
      readonly text: string;
      readonly sha256: string;
      readonly readable: true;
      readonly rows: readonly HandRow[];
    }
  | { readonly lineNumber: number; readonly text: string; readonly sha256: string; readonly readable: false };

/** An unreadable line the planner can prove settled, and the line that proves it. */
export interface RetirementCandidate {
  readonly lineNumber: number;
  readonly lineSha256: string;
  /** The step id exactly as the line spells it — possibly not a valid id, which is often why it will not read. */
  readonly stepId: string;
  readonly settledByLine: number;
  readonly settledByLineSha256: string;
}

/**
 * An unreadable line the planner will not retire, and why.
 *
 * @internal
 */
export interface RefusedLine {
  readonly lineNumber: number;
  readonly lineSha256: string;
  readonly why: string;
}

/** One retirement row as the sidecar holds it. */
export interface LineRetirement extends RetirementCandidate {
  readonly kind: typeof LINE_RETIREMENT_KIND;
  readonly reason: string;
  readonly retiredIso: string;
  /** The visible session that retired it, or `null` when it ran outside one. */
  readonly bySession: string | null;
  /** The sha256 of the whole register the plan was made over. */
  readonly sourceSha256: string;
}

/** What a plan over one scan found. */
export interface RetirementPlan {
  readonly eligible: readonly RetirementCandidate[];
  readonly refused: readonly RefusedLine[];
  /** Unreadable lines a retirement already holds over, by line number. */
  readonly alreadyRetired: readonly number[];
}

/**
 * The sha256 of one line's text, as both the planner and the reader hash it.
 *
 * @param text the line without its newline
 * @returns the bare hex digest
 */
export function lineSha256({ text }: { text: string }): string {
  return sha256Hex({ bytes: Buffer.from(text, "utf8") });
}

/**
 * The retirements that still hold over a read: each keyed by the line it retires.
 *
 * A retirement holds only while the retired line is still unreadable and still hashes the same, and its settling line
 * is still readable, later, and still hashes the same. Anything else and it is ignored, so the gap it closed reappears.
 *
 * @param retirements every well-formed sidecar row
 * @param shaOf line number → sha256, for at least every line a retirement names
 * @param unreadable the line numbers the read skipped
 * @returns line number → the retirement holding over it
 */
export function holdingRetirements({
  retirements,
  shaOf,
  unreadable,
}: {
  retirements: readonly LineRetirement[];
  shaOf: ReadonlyMap<number, string>;
  unreadable: ReadonlySet<number>;
}): ReadonlyMap<number, LineRetirement> {
  const holding = new Map<number, LineRetirement>();
  for (const retirement of retirements) {
    const retiredStill =
      unreadable.has(retirement.lineNumber) && shaOf.get(retirement.lineNumber) === retirement.lineSha256;
    const settlerStill =
      retirement.settledByLine > retirement.lineNumber &&
      !unreadable.has(retirement.settledByLine) &&
      shaOf.get(retirement.settledByLine) === retirement.settledByLineSha256;
    if (retiredStill && settlerStill) {
      holding.set(retirement.lineNumber, retirement);
    }
  }
  return holding;
}

/**
 * Why one unreadable line cannot be retired, or the raw step id it posted when it can be considered.
 *
 * @param text the line
 * @returns the step id, or the refusal
 */
function postedIdOf({ text }: { text: string }): { stepId: string } | { why: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { why: "it is not JSON, so no step id can be read off it" };
  }
  if (!isRecord(parsed) || parsed["kind"] !== "posted") {
    return {
      why: "only a posted line can be retired — any other line that will not read may be a lost settling",
    };
  }
  const step = parsed["step"];
  if (!isRecord(step) || typeof step["id"] !== "string" || step["id"].length === 0) {
    return { why: "it carries no step id string, so nothing can prove its step settled" };
  }
  if (parsed["settles"] !== undefined) {
    return {
      why: "it carries the settling of another step on the same line, and retiring it would lose that settling",
    };
  }
  return { stepId: step["id"] };
}

/**
 * Which unreadable lines may be retired, which may not and why, and which a retirement already covers.
 *
 * A line is eligible only when it is JSON, a `posted` row, carries a string step id and no `settles`, and a LATER
 * line the ordinary reader reads settles that EXACT id — a settled row of its own or a re-cut's `settles`. Nothing
 * else proves the step is no longer waiting on the owner, so everything else is refused by name.
 *
 * @param lines every non-blank line of the register, in order
 * @param retirements every well-formed sidecar row
 * @returns the plan
 */
export function planUnreadableLineRetirements({
  lines,
  retirements,
}: {
  lines: readonly ScannedLine[];
  retirements: readonly LineRetirement[];
}): RetirementPlan {
  const shaOf = new Map(lines.map((line) => [line.lineNumber, line.sha256]));
  const unreadable = new Set(lines.filter((line) => !line.readable).map((line) => line.lineNumber));
  const holding = holdingRetirements({ retirements, shaOf, unreadable });
  const eligible: RetirementCandidate[] = [];
  const refused: RefusedLine[] = [];
  const alreadyRetired: number[] = [];
  for (const line of lines) {
    if (line.readable) {
      continue;
    }
    if (holding.has(line.lineNumber)) {
      alreadyRetired.push(line.lineNumber);
      continue;
    }
    const posted = postedIdOf({ text: line.text });
    if ("why" in posted) {
      refused.push({ lineNumber: line.lineNumber, lineSha256: line.sha256, why: posted.why });
      continue;
    }
    const settler = lines.find(
      (later) =>
        later.lineNumber > line.lineNumber &&
        later.readable &&
        later.rows.some((row) => isSettledRow(row) && row.id === posted.stepId),
    );
    if (settler === undefined) {
      refused.push({
        lineNumber: line.lineNumber,
        lineSha256: line.sha256,
        why: `no later readable line settles ${JSON.stringify(posted.stepId)}, so its step may still be waiting on the owner`,
      });
      continue;
    }
    eligible.push({
      lineNumber: line.lineNumber,
      lineSha256: line.sha256,
      settledByLine: settler.lineNumber,
      settledByLineSha256: settler.sha256,
      stepId: posted.stepId,
    });
  }
  return { alreadyRetired, eligible, refused };
}

/**
 * The retirement row one eligible line becomes.
 *
 * @param candidate the eligible line
 * @param reason why the operator is retiring it, in their words
 * @param bySession the visible session, or `null`
 * @param sourceSha256 the register digest the plan was made over
 * @returns the row to append
 */
export function buildLineRetirement({
  candidate,
  reason,
  retiredIso,
  bySession,
  sourceSha256,
}: {
  candidate: RetirementCandidate;
  reason: string;
  retiredIso: string;
  bySession: string | null;
  sourceSha256: string;
}): LineRetirement {
  return { ...candidate, bySession, kind: LINE_RETIREMENT_KIND, reason, retiredIso, sourceSha256 };
}

/**
 * Read one sidecar line as a retirement, or nothing when it is not a well-formed one — which the reader then simply
 * does not honour, so the gap it would have closed stays reported.
 *
 * @param text the sidecar line
 * @returns the retirement, or `undefined`
 */
export function parseLineRetirement({ text }: { text: string }): LineRetirement | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["kind"] !== LINE_RETIREMENT_KIND) {
    return undefined;
  }
  const lineNumber = integerField({ key: "lineNumber", record: parsed });
  const settledByLine = integerField({ key: "settledByLine", record: parsed });
  const lineHash = stringField({ key: "lineSha256", record: parsed });
  const settlerHash = stringField({ key: "settledByLineSha256", record: parsed });
  const stepId = stringField({ key: "stepId", record: parsed });
  const reason = stringField({ key: "reason", record: parsed });
  const retiredIso = stringField({ key: "retiredIso", record: parsed });
  const sourceSha256 = stringField({ key: "sourceSha256", record: parsed });
  const bySession = parsed["bySession"];
  if (
    lineNumber === undefined ||
    settledByLine === undefined ||
    lineHash === undefined ||
    settlerHash === undefined ||
    stepId === undefined ||
    reason === undefined ||
    retiredIso === undefined ||
    sourceSha256 === undefined ||
    (bySession !== null && typeof bySession !== "string")
  ) {
    return undefined;
  }
  return {
    bySession,
    kind: LINE_RETIREMENT_KIND,
    lineNumber,
    lineSha256: lineHash,
    reason,
    retiredIso,
    settledByLine,
    settledByLineSha256: settlerHash,
    sourceSha256,
    stepId,
  };
}

/** A string field off a parsed object, or `undefined` when it is not one. */
function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** A positive integer field off a parsed object, or `undefined` when it is not one. */
function integerField({ record, key }: { record: Record<string, unknown>; key: string }): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
