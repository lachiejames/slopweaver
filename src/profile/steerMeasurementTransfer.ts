/**
 * The steer-verdicts export part as it travels: schema v2, one strict envelope per stored measurement, keyed by its
 * event id. Pure — the store edge is `./steerMeasurementRows.ts`, the file read is `../store/transfer/decode.ts`.
 *
 * An envelope carries only what a store cannot re-derive: the id, the exact line, and the place an imported line held
 * in its file. Whether the line parses is carried too, and checked: the reader recomputes it from the line and refuses
 * an envelope that disagrees, as it refuses one whose legacy id the line and place would not mint. The verdict itself
 * is never carried, because the line already is it.
 *
 * A v1 part is the journal's own lines. A v1 line becomes the envelope a legacy import of it would have made, its
 * place being its physical 1-based line in the part, blanks counted — exact for a copied journal and for any export
 * made before the store held the register, and the only rule the bytes support for one made after (the stated residue
 * in `skills/store/reference/import-export.md`).
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type SteerVerdict, steerVerdictOf } from "./steerKinds.js";
import { importedSteerEventId, type StoredSteerMeasurement } from "./steerMeasurementRecords.js";

/** The export part's schema version this build writes. */
export const STEER_MEASUREMENT_EXPORT_VERSION = 2;

/** Whether an envelope's line reads as a verdict. A blank line is never a measurement, so there is no third state. */
type SteerMeasurementParseStatus = "parsed" | "unparsed";

/** One measurement as the v2 part carries it. */
export interface SteerMeasurementEnvelopeV2 {
  readonly schemaVersion: 2;
  readonly eventId: string;
  readonly exactText: string;
  readonly parseStatus: SteerMeasurementParseStatus;
  /** An imported line's 1-based place in its file; `null` for one any other writer recorded. */
  readonly sourceOrdinal: number | null;
}

/** One envelope as a reader decoded it, with the part line it came from. */
export interface DecodedSteerMeasurement {
  readonly envelope: SteerMeasurementEnvelopeV2;
  /** The 1-based line of the part it was read from: for a summary only, never carried or compared. */
  readonly sequence: number;
}

const IMPORTED_ID = /^steer-legacy-[0-9a-f]{64}$/u;
/** The uuid shape the table admits (`../store/schema/steerMeasurements.ts`), version digit unrestricted. */
const EVENT_ID = /^steer-event-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const envelopeSchema = z.strictObject({
  eventId: z.string(),
  exactText: z.string().regex(/\S/u, { message: "is blank" }),
  parseStatus: z.enum(["parsed", "unparsed"]),
  schemaVersion: z.literal(2),
  sourceOrdinal: z.number().int().positive().nullable(),
});

/**
 * Whether a line reads as a verdict.
 *
 * @param exactText the line
 * @returns its parse status
 */
function parseStatusOf({ exactText }: { exactText: string }): SteerMeasurementParseStatus {
  return steerVerdictOf({ line: exactText }) === undefined ? "unparsed" : "parsed";
}

/**
 * One stored measurement as the envelope its export carries.
 *
 * @param measurement the stored row
 * @returns the envelope
 */
export function steerMeasurementEnvelopeV2({
  measurement,
}: {
  measurement: StoredSteerMeasurement;
}): SteerMeasurementEnvelopeV2 {
  return {
    eventId: measurement.eventId,
    exactText: measurement.exactLine,
    parseStatus: parseStatusOf({ exactText: measurement.exactLine }),
    schemaVersion: 2,
    sourceOrdinal: measurement.sourceOrdinal,
  };
}

/**
 * One envelope as its part line: its JSON, the fields in a fixed order.
 *
 * @param envelope the envelope to write
 * @returns the line, no trailing newline
 */
export function steerMeasurementEnvelopeLine({ envelope }: { envelope: SteerMeasurementEnvelopeV2 }): string {
  return JSON.stringify({
    eventId: envelope.eventId,
    exactText: envelope.exactText,
    parseStatus: envelope.parseStatus,
    schemaVersion: envelope.schemaVersion,
    sourceOrdinal: envelope.sourceOrdinal,
  });
}

/**
 * The lines a store export carries for the register: one envelope per stored measurement, in `journal_seq` order.
 *
 * @param measurements every stored measurement, in `journal_seq` order
 * @returns the lines, no trailing newlines
 */
export function steerExportLines({
  measurements,
}: {
  measurements: readonly StoredSteerMeasurement[];
}): readonly string[] {
  return measurements.map((measurement) =>
    steerMeasurementEnvelopeLine({ envelope: steerMeasurementEnvelopeV2({ measurement }) }),
  );
}

/**
 * Why an envelope's fields contradict each other, or undefined when they agree: the parse status must be the line's
 * own, a legacy id needs a place and must be the one its line and place mint, a recorded id carries no place.
 *
 * @param envelope the shape-checked envelope
 * @returns the contradiction, or undefined
 */
function envelopeContradiction({ envelope }: { envelope: SteerMeasurementEnvelopeV2 }): string | undefined {
  const status = parseStatusOf({ exactText: envelope.exactText });
  if (envelope.parseStatus !== status) {
    return `its parseStatus is ${envelope.parseStatus}, and its line is ${status}`;
  }
  if (IMPORTED_ID.test(envelope.eventId)) {
    if (envelope.sourceOrdinal === null) {
      return "a legacy id carries no source ordinal";
    }
    const minted = importedSteerEventId({ exactLine: envelope.exactText, sourceOrdinal: envelope.sourceOrdinal });
    return minted === envelope.eventId ? undefined : "its legacy id is not the one its line and source ordinal mint";
  }
  if (EVENT_ID.test(envelope.eventId)) {
    return envelope.sourceOrdinal === null ? undefined : "a recorded id carries a source ordinal";
  }
  return `its event id ${JSON.stringify(envelope.eventId)} is neither a legacy nor a recorded id`;
}

/**
 * Read one parsed JSON value as a v2 envelope, strictly: exactly its five fields, and fields that agree.
 *
 * @param value one line's parsed JSON
 * @returns the envelope, or why it is not one
 */
export function parseSteerMeasurementEnvelopeV2({ value }: { value: unknown }): Result<SteerMeasurementEnvelopeV2> {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => {
        const where = issue.path.length === 0 ? "envelope" : issue.path.join(".");
        return `${where}: ${issue.message}`;
      }),
    );
  }
  const envelope: SteerMeasurementEnvelopeV2 = parsed.data;
  const contradiction = envelopeContradiction({ envelope });
  if (contradiction !== undefined) {
    return err([contradiction]);
  }
  return ok(envelope);
}

/**
 * One v1 line as the envelope a legacy import of it would have made, at its physical place in the part.
 *
 * @param exactText the nonblank line, exactly
 * @param sourceOrdinal its 1-based line in the part, blanks counted
 * @returns the envelope
 */
export function steerMeasurementEnvelopeOfV1Line({
  exactText,
  sourceOrdinal,
}: {
  exactText: string;
  sourceOrdinal: number;
}): SteerMeasurementEnvelopeV2 {
  return {
    eventId: importedSteerEventId({ exactLine: exactText, sourceOrdinal }),
    exactText,
    parseStatus: parseStatusOf({ exactText }),
    schemaVersion: 2,
    sourceOrdinal,
  };
}

/**
 * The one line a question shows for a measurement: what a kind-bearing verdict says and of which turn, `nothing` and
 * its turn for a read that named no kind, and the line's place for one that does not parse.
 *
 * @param measurement the decoded envelope and its part line
 * @returns the summary
 */
export function steerMeasurementSummary({ measurement }: { measurement: DecodedSteerMeasurement }): string {
  const verdict: SteerVerdict | undefined = steerVerdictOf({ line: measurement.envelope.exactText });
  if (verdict === undefined) {
    return `unparsed line at sequence ${String(measurement.sequence)}`;
  }
  if (verdict.says === "nothing") {
    return `nothing ${verdict.anchor}`;
  }
  return `${verdict.kind} ${verdict.says} ${verdict.anchor}`;
}
