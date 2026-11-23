/**
 * Framing the autonomy register — turning its physical lines into the JSON objects they encode, one at a time.
 *
 * The adoption pass in `./adoptStore.ts` reads a register some sessions appended to by hand, so a row may be
 * pretty-printed across several lines, cut off mid-object, or name one key twice. This module is the half that
 * finds each object's span and refuses those shapes on the line they start on; what an object then MEANS is
 * `./adopt.ts`'s to decide, through the callback the caller passes.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { readJsonlLines } from "../corpus/corpusStore.js";

import { ADOPT_CANDIDATE_MAX_BYTES, decodeCandidate } from "./adopt.js";
import { duplicateTopLevelKey } from "./duplicateKey.js";
import { type AutonomyError, AutonomyErrors } from "./errors.js";

/** The refusal a candidate that never closes earns, or undefined while it is still inside the bound. */
function checkWithinBound({ text, firstLine }: { text: string; firstLine: number }): AutonomyError | undefined {
  if (text.length <= ADOPT_CANDIDATE_MAX_BYTES) {
    return undefined;
  }
  return AutonomyErrors.corruptRow({
    lineNumber: firstLine,
    why:
      `has run past ${String(ADOPT_CANDIDATE_MAX_BYTES)} characters without closing into one JSON object, ` +
      "so it is a truncated or malformed region rather than a row",
  });
}

/**
 * The refusal a candidate naming one key twice earns, or undefined when it names each once.
 *
 * Checked against the TEXT, because the decoded object has already lost one of any two same-named keys —
 * {@link duplicateTopLevelKey} carries the counterexample.
 */
function checkNoDuplicateKey({ text, firstLine }: { text: string; firstLine: number }): AutonomyError | undefined {
  const duplicate = duplicateTopLevelKey({ text });
  if (duplicate === undefined) {
    return undefined;
  }
  return AutonomyErrors.corruptRow({
    lineNumber: firstLine,
    why:
      `names "${duplicate}" twice, and JSON keeps only the last — so adopting it would drop what the session ` +
      "wrote first without saying so. Fix the row in the register, then adopt again",
  });
}

/**
 * Frame the register's physical lines into the JSON objects they encode, one at a time.
 *
 * A brace count cannot do this — every real row's `why` contains prose, and prose contains braces — so a
 * candidate is accumulated and offered to the parser after each line. A candidate that decodes is complete;
 * one that does not is still open, until it passes {@link ADOPT_CANDIDATE_MAX_BYTES}, at which point it is a
 * file that never closed a brace rather than a row.
 *
 * @returns the physical line count, or the first framing or callback refusal
 */
export function frameObjects({
  path,
  onObject,
}: {
  path: string;
  onObject: (args: {
    value: Readonly<Record<string, unknown>>;
    firstLine: number;
    lastLine: number;
  }) => AutonomyError | undefined;
}): Result<number, AutonomyError> {
  let buffer = "";
  let firstLine = 0;
  let physicalLines = 0;
  let failure: AutonomyError | undefined;
  const feed = ({ line, index }: { line: string; index: number }): void => {
    if (failure !== undefined || (buffer.length === 0 && line.trim().length === 0)) {
      return;
    }
    // Counted here rather than on every line, so the trailing newline every well-formed JSONL file ends with
    // is not reported as a 62nd line of a 61-line register.
    physicalLines = index + 1;
    if (buffer.length === 0) {
      firstLine = index + 1;
    }
    buffer += line;
    const overrun = checkWithinBound({ firstLine, text: buffer });
    if (overrun !== undefined) {
      failure = overrun;
      return;
    }
    const value = decodeCandidate({ text: buffer });
    if (value === undefined) {
      return;
    }
    const duplicate = checkNoDuplicateKey({ firstLine, text: buffer });
    if (duplicate !== undefined) {
      failure = duplicate;
      return;
    }
    failure = onObject({ firstLine, lastLine: index + 1, value });
    buffer = "";
  };
  try {
    readJsonlLines({ onLine: feed, path });
  } catch (cause) {
    return err(AutonomyErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return framingOutcome({ failure, firstLine, physicalLines, remainder: buffer });
}

/**
 * What the framing pass answers once the file has been read: its refusal, the half-open tail it ended on, or
 * the line count.
 */
function framingOutcome({
  failure,
  remainder,
  firstLine,
  physicalLines,
}: {
  failure: AutonomyError | undefined;
  remainder: string;
  firstLine: number;
  physicalLines: number;
}): Result<number, AutonomyError> {
  if (failure !== undefined) {
    return err(failure);
  }
  if (remainder.trim().length > 0) {
    return err(
      AutonomyErrors.corruptRow({
        lineNumber: firstLine,
        why: "is the start of a JSON object the file ends in the middle of",
      }),
    );
  }
  return ok(physicalLines);
}
