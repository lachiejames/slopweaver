/**
 * Where the register's line retirements live, and the read `./store.ts` makes of them on every register read.
 *
 * Beside the register it qualifies, so any register path — the home's or one a test names — carries its own. An
 * absent sidecar is the normal case and costs one failed open. One that will not read, and every line in it that is
 * not a well-formed retirement, is honoured as NO retirement: the gaps it would have closed stay reported, which is
 * the safe direction for a reader whose silence means nothing is waiting on the owner.
 */
import { dirname, join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";

import type { HandStepError } from "./errors.js";
import { holdingRetirements, type LineRetirement, parseLineRetirement } from "./lineRetirement.js";
import { skippedLines } from "./postingChecks.js";

/**
 * The sidecar's file name, in the register's own directory.
 *
 * @internal
 */
export const RETIREMENT_SIDECAR_FILE = "unreadable-retirements.jsonl";

/**
 * The retirement sidecar for one register file.
 *
 * @param registerPath the register's `steps.jsonl`
 * @returns the sidecar path beside it
 */
export function retirementSidecarPath({ registerPath }: { registerPath: string }): string {
  return join(dirname(registerPath), RETIREMENT_SIDECAR_FILE);
}

/**
 * Every well-formed retirement the sidecar beside a register holds, in the order they were written.
 *
 * @param registerPath the register's `steps.jsonl`
 * @returns the retirements; none when the sidecar is absent or will not read
 */
export function readLineRetirements({ registerPath }: { registerPath: string }): readonly LineRetirement[] {
  const retirements: LineRetirement[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const retirement = parseLineRetirement({ text: line });
        if (retirement !== undefined) {
          retirements.push(retirement);
        }
      },
      path: retirementSidecarPath({ registerPath }),
    });
  } catch {
    // Absent or unreadable: no retirement holds, so every skipped line is still reported.
    return [];
  }
  return retirements;
}

/** A skipped line a retirement still holds over (`./lineRetirement.ts`): its step is proven settled by a later line. */
export interface RetiredHandLine {
  readonly lineNumber: number;
  readonly stepId: string;
  readonly reason: string;
}

/**
 * Split the lines one read skipped into those a retirement still holds over and those it does not. A retirement holds
 * only while its line number and the sha256 of that line's text, and the same of the later line that settled its
 * step, still match what the read hashed; anything else leaves the line unparsed.
 *
 * @param retirements every retirement the sidecar holds
 * @param shaOf the sha256 the read took of each line a retirement names
 * @param skipped every line the read skipped, in line order
 * @returns the retired lines, and every skipped line no retirement holds over
 */
export function splitRetiredLines({
  retirements,
  shaOf,
  skipped,
}: {
  retirements: readonly LineRetirement[];
  shaOf: ReadonlyMap<number, string>;
  skipped: readonly HandStepError[];
}): { readonly retired: readonly RetiredHandLine[]; readonly unparsed: readonly HandStepError[] } {
  if (retirements.length === 0 || skipped.length === 0) {
    return { retired: [], unparsed: skipped };
  }
  const holding = holdingRetirements({ retirements, shaOf, unreadable: new Set(skippedLines({ unparsed: skipped })) });
  const retired: RetiredHandLine[] = [];
  const unparsed: HandStepError[] = [];
  for (const error of skipped) {
    const retirement = error.code === "CORRUPT_ROW" ? holding.get(error.lineNumber) : undefined;
    if (retirement === undefined) {
      unparsed.push(error);
    } else {
      retired.push({ lineNumber: retirement.lineNumber, reason: retirement.reason, stepId: retirement.stepId });
    }
  }
  return { retired, unparsed };
}
