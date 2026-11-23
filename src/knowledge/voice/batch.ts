/**
 * The batch file `knowledge voice` writes and `knowledge propose` reads back — the pinned input a citation
 * is checked against.
 *
 * ## Why a proposal is made against a FILE rather than against a fresh scan
 *
 * A quote is only evidence if it is their words unaltered, so `knowledge propose` has to compare the quote to
 * the text the session actually read. Re-scanning would compare it to whatever the sources say NOW, which
 * is a different question and a slower one. The batch is the pinned input: the session reads it, cites a
 * span of it, and the verb checks the span against the same bytes.
 *
 * The unit's id IS the digest of its text, so the check that the file was not edited between the two steps
 * is free — recompute the id and compare. `./errors.ts`'s `UNIT_TAMPERED` is that check failing, and it is
 * a different answer from "no such unit", because one means re-scan and the other means re-read.
 *
 * ## Why JSONL rather than one JSON document
 *
 * Two reasons and both are rules rather than taste. `.claude/rules/typescript-patterns.md` refuses a
 * whole-payload JSON write whose size comes from data, and a batch's size comes from how much they said.
 * And the batch is read back line by line through the same `readJsonlLines` every other register here uses,
 * so nothing has to hold the whole file as one string.
 *
 * The FIRST line is the watermark and every line after it is a unit. A file whose first line is not a
 * watermark is not a batch this code wrote, and is refused rather than read hopefully.
 */
import { writeFileSync } from "node:fs";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type BeliefError, BeliefErrors } from "./errors.js";
import { VOICE_SOURCE_KINDS, type VoiceSourceKind, type VoiceUnit, type VoiceWatermark } from "./types.js";
import { countWords, voiceUnitId } from "./unit.js";

/** What a batch file holds, once read back. */
export interface VoiceBatch {
  readonly watermark: VoiceWatermark;
  readonly units: readonly VoiceUnit[];
}

/**
 * Write one batch, watermark first.
 *
 * @param batch the watermark and the units it describes
 * @param path where to write it
 * @returns the path written, or why it could not be written
 */
export function writeBatch({ batch, path }: { batch: VoiceBatch; path: string }): Result<string, BeliefError> {
  const lines = [
    JSON.stringify({ kind: "watermark", ...batch.watermark }),
    ...batch.units.map((unit) => JSON.stringify({ kind: "unit", ...unit })),
  ];
  try {
    writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  } catch (cause) {
    return err(BeliefErrors.batchUnreadable({ path, why: errorMessage({ error: cause }) }));
  }
  return ok(path);
}

/**
 * Read one batch back, refusing anything this code did not write.
 *
 * @param path the batch file
 * @returns the watermark and units, or why the file is not a batch
 */
export function readBatch({ path }: { path: string }): Result<VoiceBatch, BeliefError> {
  const units: VoiceUnit[] = [];
  let watermark: VoiceWatermark | undefined;
  let bad: string | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (bad !== undefined || line.trim().length === 0) {
          return;
        }
        const decoded = decodeLine({ line });
        if (decoded === undefined) {
          bad = `line ${String(index + 1)} is not a batch line`;
          return;
        }
        if (decoded.kind === "watermark") {
          watermark = decoded.watermark;
          return;
        }
        units.push(decoded.unit);
      },
      path,
    });
  } catch (cause) {
    return err(BeliefErrors.batchUnreadable({ path, why: errorMessage({ error: cause }) }));
  }
  if (bad !== undefined) {
    return err(BeliefErrors.batchUnreadable({ path, why: bad }));
  }
  if (watermark === undefined) {
    return err(BeliefErrors.batchUnreadable({ path, why: "it carries no watermark line" }));
  }
  return ok({ units, watermark });
}

/** One decoded batch line: the watermark, or one unit. */
type BatchLine =
  | { readonly kind: "watermark"; readonly watermark: VoiceWatermark }
  | { readonly kind: "unit"; readonly unit: VoiceUnit };

/** Decode one line, or undefined when it is neither shape. */
function decodeLine({ line }: { line: string }): BatchLine | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  if (decoded["kind"] === "watermark") {
    const watermark = decodeWatermark({ decoded });
    return watermark === undefined ? undefined : { kind: "watermark", watermark };
  }
  if (decoded["kind"] !== "unit") {
    return undefined;
  }
  const unit = decodeUnit({ decoded });
  return unit === undefined ? undefined : { kind: "unit", unit };
}

/**
 * Whether an unknown value is a member of the source vocabulary.
 *
 * A type predicate rather than a cast, so a batch whose watermark names a family this build does not have
 * drops that family rather than smuggling an unknown string through as one. TypeScript error TS1230 forbids
 * destructuring in a predicate signature, which is why the parameter is positional.
 */
function isSourceKind(value: unknown): value is VoiceSourceKind {
  return VOICE_SOURCE_KINDS.some((kind) => kind === value);
}

/** The watermark line, or undefined when a required field is missing or the wrong type. */
function decodeWatermark({ decoded }: { decoded: Record<string, unknown> }): VoiceWatermark | undefined {
  const { scannedAtIso, recordings, units, reviewed, unreadable, kinds } = decoded;
  const numbersOk = typeof recordings === "number" && typeof units === "number" && typeof reviewed === "number";
  if (typeof scannedAtIso !== "string" || !numbersOk || !Array.isArray(unreadable) || !Array.isArray(kinds)) {
    return undefined;
  }
  return {
    kinds: kinds.filter(isSourceKind),
    recordings,
    reviewed,
    scannedAtIso,
    units,
    unreadable: unreadable
      .filter(isRecord)
      .filter((entry) => typeof entry["locator"] === "string" && typeof entry["why"] === "string")
      .map((entry) => ({ locator: String(entry["locator"]), why: String(entry["why"]) })),
  };
}

/** One unit line, or undefined when a required field is missing or the wrong type. */
function decodeUnit({ decoded }: { decoded: Record<string, unknown> }): VoiceUnit | undefined {
  const { id, text, words, source, locator, occurrences, wrapped, instantIso } = decoded;
  const shapeOk =
    typeof id === "string" &&
    typeof text === "string" &&
    typeof words === "number" &&
    isSourceKind(source) &&
    typeof locator === "string" &&
    typeof occurrences === "number" &&
    typeof wrapped === "boolean";
  if (!shapeOk) {
    return undefined;
  }
  const base: VoiceUnit = {
    id,
    locator,
    occurrences,
    source,
    text,
    words,
    wrapped,
  };
  return typeof instantIso === "string" ? { ...base, instantIso } : base;
}

/**
 * Find the unit a proposal names, and prove the batch still holds their words unaltered.
 *
 * Three distinct answers rather than one, because each says something different about what to do next: the
 * unit is not in this batch (re-scan, or you named the wrong id), the unit is here but its text no longer
 * hashes to its id (the file was edited, re-scan), or here it is.
 *
 * @param batch the batch that was read
 * @param unitId the unit the proposal names
 * @returns the pinned unit, or which of the two checks failed
 */
export function pinnedUnit({ batch, unitId }: { batch: VoiceBatch; unitId: string }): Result<VoiceUnit, BeliefError> {
  const found = batch.units.find((unit) => unit.id === unitId);
  if (found === undefined) {
    return err(BeliefErrors.unitNotInBatch({ unitId }));
  }
  if (voiceUnitId({ text: found.text }) !== found.id || countWords({ text: found.text }) !== found.words) {
    return err(BeliefErrors.unitTampered({ unitId }));
  }
  return ok(found);
}
