/**
 * `sweep board`'s argv, parsed and refused before the board is read — the front half of `./boardRun.ts`, split along
 * that seam so the verb's file holds the pass.
 */
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { BOARD_USAGE, flag, parseSweepBoardArgs } from "./core.js";

/** How long a probe sweep may run before the rest are reported unresolved rather than dropped. */
const DEFAULT_DEADLINE_SECONDS = 300;

/** The parsed flags a pass reads. */
export type BoardValues = Readonly<Record<string, unknown>>;

/**
 * The probe budget, in seconds, from what the caller named.
 *
 * `0` is honoured as UNBOUNDED rather than rejected — `deadlineIn` gives it that meaning, and a whole-board
 * `--probe` run legitimately wants it. Anything else that is not a non-negative number is REFUSED rather than
 * defaulted, because an operator who mistyped the budget would otherwise read a truncated sweep as a complete
 * one and this verb's whole output is a claim about completeness.
 *
 * @param named whatever `--deadline` carried
 * @returns the budget in seconds, or undefined when the caller's value is not one
 */
function deadlineSeconds({ named }: { named: string | undefined }): number | undefined {
  if (named === undefined) {
    return DEFAULT_DEADLINE_SECONDS;
  }
  const parsed = Number(named);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

/**
 * A flag that only means something beside `--write`, refused without it.
 *
 * @param values the parsed flags
 * @param name the dependent flag
 * @param why the refusal's reason, after the flag
 * @param deps the diagnostic channel
 * @returns true when the flag was named without `--write`, already printed
 */
function needsWrite({
  values,
  name,
  why,
  deps,
}: {
  values: BoardValues;
  name: string;
  why: string;
  deps: { readonly writeDiagnostic: (line: string) => void };
}): boolean {
  if (values[name] !== true || values["write"] === true) {
    return false;
  }
  deps.writeDiagnostic(`sweep board: --${name} needs --write — ${why}`);
  deps.writeDiagnostic(BOARD_USAGE);
  return true;
}

/**
 * Parse `sweep board`'s argv, answering the exit code itself for `--help` and for every refusal.
 *
 * @param rest the argv tail after `sweep board`
 * @param deps the output channels help and refusals print to
 * @returns the parsed flags and deadline budget, or the exit code the verb answers without reading the board
 */
export function boardArgs({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: { readonly writeOut: (line: string) => void; readonly writeDiagnostic: (line: string) => void };
}): { values: BoardValues; seconds: number } | number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(BOARD_USAGE);
    return EXIT_OK;
  }
  const parsed = parseSweepBoardArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(BOARD_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const seconds = deadlineSeconds({ named: flag({ name: "deadline", values }) });
  if (seconds === undefined) {
    deps.writeDiagnostic("sweep board: --deadline takes a non-negative number of seconds, where 0 means unbounded");
    deps.writeDiagnostic(BOARD_USAGE);
    return EXIT_USAGE;
  }
  // The card cites the pass the documents record; a card from an unpublished pass points at nothing.
  const queueAlone = needsWrite({
    deps,
    name: "queue",
    values,
    why: "the card is registered only once both documents are",
  });
  // An act the published census did not then reflect would leave the document describing the board before it.
  const settleAlone = needsWrite({
    deps,
    name: "settle-ended",
    values,
    why: "the pass publishes the board after its acts",
  });
  const closeAlone = needsWrite({
    deps,
    name: "close-shipped",
    values,
    why: "the pass publishes the board after its acts",
  });
  if (queueAlone || settleAlone || closeAlone) {
    return EXIT_USAGE;
  }
  return { seconds, values };
}
