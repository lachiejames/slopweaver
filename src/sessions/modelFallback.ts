/**
 * The one reader of Claude Code's `model_refusal_fallback` record — the system record a safeguard writes when
 * it takes a session off the model it was seated with.
 *
 * ## Why this is its own module rather than a helper inside the chair gate
 *
 * `supervisor/chairModel.ts` spelled this record's subtype and field names itself, because the chair was the only
 * reader then. It is not: a seat of ANY tier can be demoted, and
 * `cli/commands/session/fallbacks.ts` now reads the same record for every live session. This repository has
 * already paid for the alternative once — four independent `tsToIso` copies stood in this tree at the same
 * time, two answering `""` on a bad input and two `undefined`, and none was wrong on its own
 * (`.claude/rules/typescript-patterns.md`). One parse, two readers.
 *
 * ## The criterion, and the case that rules out the obvious one
 *
 * A seat is DEMOTED when a fallback record exists and no assistant record after it ran on anything other than
 * that record's `fallbackModel`. The tempting shorter test — "a fallback fired after the newest turn" — is
 * what `chairModel.ts` uses, and it is correct there only because a Fable chair's newest turn tells you the
 * answer by itself.
 *
 * MEASURED on one transcript: the
 * fallback record sits at LINE 32 of 3,691, `claude-opus-5` to `claude-opus-4-8`, category `cyber`, and all
 * 1,042 assistant records after it run on the fallback model. Nothing fired "after the newest turn" there, and
 * the seat had still been demoted for its whole life. Repro:
 *
 * ```bash
 * grep -n 'model_refusal_fallback' <transcript>; wc -l < <transcript>
 * grep -o '"model":"claude-[a-z0-9.-]*"' <transcript> | sort | uniq -c
 * ```
 *
 * That line number is also why nothing here may be built on a transcript TAIL: the 1 MiB
 * `sessions/tokenDepth.ts` reads would have reported the one transcript this exists for as clean.
 *
 * Pure: lines in, verdict out.
 */
import { isRecord } from "#lib/parsers.js";

/**
 * The `subtype` Claude Code gives the system record it writes when a safeguard switches a session's model.
 *
 * @internal — the one literal this file matches on; named so the criterion is greppable, not a consumer API.
 */
const MODEL_REFUSAL_FALLBACK_SUBTYPE = "model_refusal_fallback";

/** One safeguard fallback, as its system record states it. */
export interface ModelFallbackRecord {
  readonly atIso: string;
  readonly originalModel: string;
  readonly fallbackModel: string;
  /** The refusal category the record names — `cyber` in every case measured here. Empty when it named none. */
  readonly category: string;
}

/** What a whole transcript says about whether a safeguard moved this seat and whether anything moved it back. */
export type SeatFallbackVerdict =
  /** A fallback fired and every assistant record since has run on its `fallbackModel`. */
  | { readonly kind: "demoted"; readonly fallback: ModelFallbackRecord }
  /**
   * A fallback fired and a later assistant record ran on `model`, which is not the fallback's — the owner's
   * `/model`, or the chair restoring itself (`supervisor/chairRestore.ts`).
   */
  | { readonly kind: "restored"; readonly fallback: ModelFallbackRecord; readonly model: string }
  /** No fallback record was present in what was read. */
  | { readonly kind: "none" };

/** A string field on a record, or the empty string when absent or not a string. */
function field({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

/** A parsed JSONL line, or `undefined` for a partial or malformed one. */
function parseLine({ line }: { line: string }): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * The safeguard fallback one transcript line states, when it is that record.
 *
 * A cheap substring test runs before the parse, the same way `sessions/sessionCost.ts`'s `readUsageLine` does it:
 * these lines are scanned by the million and all but a handful are not this record.
 *
 * @param line one transcript line, which may be a fragment
 * @returns the fallback it states, or `undefined` when the line is not one or cannot be read
 */
export function readModelFallbackLine({ line }: { line: string }): ModelFallbackRecord | undefined {
  if (!line.includes(MODEL_REFUSAL_FALLBACK_SUBTYPE)) {
    return undefined;
  }
  const record = parseLine({ line });
  if (record === undefined) {
    return undefined;
  }
  if (record["type"] !== "system" || record["subtype"] !== MODEL_REFUSAL_FALLBACK_SUBTYPE) {
    return undefined;
  }
  return {
    atIso: field({ key: "timestamp", on: record }),
    category: field({ key: "apiRefusalCategory", on: record }),
    fallbackModel: field({ key: "fallbackModel", on: record }),
    originalModel: field({ key: "originalModel", on: record }),
  };
}

/**
 * The model an assistant record ran on, when the line is one and names a real model.
 *
 * `<synthetic>` is Claude Code's own marker for a message no model produced, so it says nothing about the seat.
 *
 * @param line one transcript line, which may be a fragment
 * @returns the model id, or `undefined`
 */
export function readAssistantModelLine({ line }: { line: string }): string | undefined {
  if (!line.includes('"assistant"')) {
    return undefined;
  }
  const record = parseLine({ line });
  if (record === undefined) {
    return undefined;
  }
  if (record["type"] !== "assistant" || !isRecord(record["message"])) {
    return undefined;
  }
  const model = field({ key: "model", on: record["message"] });
  if (model === "" || model === "<synthetic>") {
    return undefined;
  }
  return model;
}

/**
 * Fold one transcript's lines, in FILE order, into a seat verdict.
 *
 * File order rather than timestamp order: a transcript is append-only and two records written in the same
 * millisecond are real — the measured fallback record shares its second with the tool call before it.
 *
 * @param lines every line read, oldest first
 * @returns whether a safeguard demoted this seat and whether anything has moved it back since
 */
export function judgeSeatFallback({ lines }: { lines: Iterable<string> }): SeatFallbackVerdict {
  let fold = EMPTY_SEAT_FALLBACK_FOLD;
  for (const line of lines) {
    fold = foldSeatFallbackLine({ fold, line });
  }
  return seatFallbackVerdict({ fold });
}

/**
 * The state a streaming fold carries between lines.
 *
 * Exposed so a reader that STREAMS a transcript never has to collect its lines first: a 41.9 MB transcript's
 * assistant records are the bulk of the file, and holding them to answer one question about the last one is
 * the data-sized-payload class `.claude/rules/typescript-patterns.md` names.
 */
export interface SeatFallbackFold {
  readonly fallback: ModelFallbackRecord | undefined;
  readonly restoredTo: string | undefined;
}

/** A fold that has read nothing. */
export const EMPTY_SEAT_FALLBACK_FOLD: SeatFallbackFold = { fallback: undefined, restoredTo: undefined };

/**
 * Advance a fold by one transcript line.
 *
 * @param fold what the lines before it came to
 * @param line the next line, in FILE order
 * @returns the advanced fold
 */
export function foldSeatFallbackLine({ fold, line }: { fold: SeatFallbackFold; line: string }): SeatFallbackFold {
  const record = readModelFallbackLine({ line });
  if (record !== undefined) {
    return { fallback: record, restoredTo: undefined };
  }
  if (fold.fallback === undefined) {
    return fold;
  }
  const model = readAssistantModelLine({ line });
  if (model === undefined || model === fold.fallback.fallbackModel) {
    return fold;
  }
  return { fallback: fold.fallback, restoredTo: model };
}

/**
 * Turn a finished fold into a verdict.
 *
 * @param fold what every line came to
 * @returns whether a safeguard demoted this seat and whether anything has moved it back since
 */
export function seatFallbackVerdict({ fold }: { fold: SeatFallbackFold }): SeatFallbackVerdict {
  const { fallback, restoredTo } = fold;
  if (fallback === undefined) {
    return { kind: "none" };
  }
  if (restoredTo === undefined) {
    return { fallback, kind: "demoted" };
  }
  return { fallback, kind: "restored", model: restoredTo };
}
