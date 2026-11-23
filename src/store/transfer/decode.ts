/**
 * Decoding every part of a store export with the schema its own domain already owns, a line at a time.
 *
 * A part is fed to its decoder as it streams off disk, never read whole first, so the knowledge register can
 * be any size. Every decoder refuses the WHOLE part on its first bad line rather than skipping it: a recovery
 * that quietly drops a row is the failure an export exists to prevent. Two parts are single JSON documents
 * bounded by their own domains (one owner row; a directive overlay with hard caps), so their decoders gather
 * the text and parse it once at the end. The steer part is read under the version its manifest names, since an
 * older export's v1 journal lines and a current one's v2 envelopes share one file name. Pure.
 */
import { z } from "zod";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { parseOwnerDirectiveOverlay } from "../../judgement/ownerDirective.js";
import { parseExportedRecall } from "../../knowledge/recallRestore.js";
import { parseExportedLine } from "../../knowledge/restore.js";
import { parseJudgementProfile } from "../../live/turn/judgementProfile.js";
import { foldStandingAsks } from "../../profile/standingAsks.js";
import {
  parseSteerMeasurementEnvelopeV2,
  type SteerMeasurementEnvelopeV2,
  steerMeasurementEnvelopeLine,
  steerMeasurementEnvelopeOfV1Line,
} from "../../profile/steerMeasurementTransfer.js";
import { parseOwnerSelfDescription, parseVoiceCohort } from "../profile/core.js";

import { type StoreTransferError, StoreTransferErrors } from "./errors.js";
import type { StoreExportPartKind } from "./parts.js";
import {
  directiveEntries,
  memoryEntry,
  ownerEntry,
  recallEntry,
  type StagedEntry,
  standingAskEntries,
  steerMeasurementEntry,
  voiceEntry,
} from "./retained.js";

/**
 * What a whole part decoded to: the rows its file holds, and the logical entries an import compares.
 *
 * @internal reached as what {@link PartDecoder.finish} returns, never named outside this file
 */
export interface DecodedPart {
  readonly rows: number;
  readonly retained: readonly StagedEntry[];
}

/** One part's decoder: fed every line in order, then asked what the part held. */
export interface PartDecoder {
  /** Take one line; a refusal ends the part. */
  readonly line: (args: { text: string; number: number }) => Result<true, StoreTransferError>;
  /** Every line has been fed: the rows and entries, or why the part as a whole does not decode. */
  readonly finish: () => Result<DecodedPart, StoreTransferError>;
}

/**
 * The owner row as it travels between stores: what the owner wrote and what was mined about them, and nothing local.
 *
 * `personId` is a key into one store's `person` table and means nothing in another, and `revision` and
 * `updatedAt` are that store's optimistic-write bookkeeping, so none of the three travels: carrying them
 * would either break a foreign key or make an identical profile read as a conflict.
 */
export interface PortableOwnerProfile {
  readonly displayName: string;
  readonly selfDescription: unknown;
  readonly judgementProfile: unknown;
}

const portableOwnerSchema = z.strictObject({
  // The column is `text not null` and the profile reader returns it as stored, so an empty name is a row.
  displayName: z.string(),
  judgementProfile: z.unknown(),
  selfDescription: z.unknown(),
});

/** A decoder that reads each non-blank line on its own into one entry, and counts the lines it accepted. */
function perLine({
  read,
}: {
  read: (args: { text: string; number: number }) => Result<StagedEntry, StoreTransferError>;
}): PartDecoder {
  const retained: StagedEntry[] = [];
  return {
    finish: () => ok({ retained, rows: retained.length }),
    line: ({ text, number }) => {
      if (text.trim() === "") {
        return ok(true);
      }
      return read({ number, text }).map((entry): true => {
        retained.push(entry);
        return true;
      });
    },
  };
}

/** A decoder that gathers every line and judges the part once all of them are in. */
function gathered({
  judge,
}: {
  judge: (args: { lines: readonly string[] }) => Result<DecodedPart, StoreTransferError>;
}): PartDecoder {
  const lines: string[] = [];
  return {
    finish: () => judge({ lines }),
    line: ({ text }) => {
      lines.push(text);
      return ok(true);
    },
  };
}

/** One line of JSON, or the refusal naming its part and line. */
function jsonLine({
  part,
  text,
  number,
}: {
  part: StoreExportPartKind;
  text: string;
  number: number;
}): Result<unknown, StoreTransferError> {
  try {
    return ok(JSON.parse(text));
  } catch {
    return err(StoreTransferErrors.partUndecodable({ part, why: `line ${String(number)} is not JSON` }));
  }
}

/** A single JSON document gathered from its lines, or the refusal naming its part. */
function jsonDocument({
  part,
  lines,
}: {
  part: StoreExportPartKind;
  lines: readonly string[];
}): Result<unknown, StoreTransferError> {
  try {
    return ok(safeJsonParse({ label: `store export part ${part}`, text: lines.join("\n") }));
  } catch {
    return err(StoreTransferErrors.partUndecodable({ part, why: "the file is not one JSON document" }));
  }
}

/**
 * One owner row, held to the schema the profile domain owns for each of its halves: an export's part and a staged
 * row read back are judged by this one function.
 *
 * @param value the row, decoded from JSON
 * @returns the portable profile, or why it is not one
 */
export function parsePortableOwnerProfile({ value }: { value: unknown }): Result<PortableOwnerProfile, string> {
  const parsed = portableOwnerSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  const self = parseOwnerSelfDescription({ value: parsed.data.selfDescription });
  if (self.isErr()) {
    return err(self.error.message);
  }
  if (parsed.data.judgementProfile !== null) {
    const judgement = parseJudgementProfile({ value: parsed.data.judgementProfile });
    if (judgement.isErr()) {
      return err(judgement.error.join("; "));
    }
  }
  return ok(parsed.data);
}

/** The owner row, or `null` for a store that never held one. */
function judgeOwnerProfile({ lines }: { lines: readonly string[] }): Result<DecodedPart, StoreTransferError> {
  const part = "owner-profile";
  return jsonDocument({ lines, part }).andThen((value) => {
    if (value === null) {
      return ok({ retained: [], rows: 0 });
    }
    return parsePortableOwnerProfile({ value })
      .map((owner): DecodedPart => ({ retained: [ownerEntry({ owner })], rows: 1 }))
      .mapErr((why) => StoreTransferErrors.partUndecodable({ part, why }));
  });
}

/** The directive overlay; its rows are its directives and its corrections together. */
function judgeDirectives({ lines }: { lines: readonly string[] }): Result<DecodedPart, StoreTransferError> {
  const part = "owner-directives";
  return jsonDocument({ lines, part }).andThen((value) => {
    const overlay = parseOwnerDirectiveOverlay({ value });
    if (overlay.isErr()) {
      return err(StoreTransferErrors.partUndecodable({ part, why: overlay.error.message }));
    }
    const retained = directiveEntries({ overlay: overlay.value });
    return ok({ retained, rows: retained.length });
  });
}

/**
 * The standing-ask journal, folded whole so a history that breaks the register is refused here too. Its rows
 * are the asks the fold leaves active, as the register's own reader counts them; a withdrawn ask's events are
 * still in the bytes, so the hash holds them.
 */
function judgeStandingAsks({ lines }: { lines: readonly string[] }): Result<DecodedPart, StoreTransferError> {
  const folded = foldStandingAsks({ lines });
  if (folded.isErr()) {
    return err(StoreTransferErrors.partUndecodable({ part: "standing-asks", why: folded.error.message }));
  }
  return ok({ retained: standingAskEntries({ asks: folded.value }), rows: folded.value.length });
}

/** Which schema one steer line was read under. */
type SteerLineVersion = 1 | 2;

/**
 * One nonblank line of a steer part, read under the version given, or the refusal naming its line. A v2 line must
 * also BE the line its envelope writes: `JSON.parse` keeps the last of two duplicate keys, so a line naming two event
 * ids would otherwise read as the second, the first merged away unseen. Only
 * `steerMeasurementEnvelopeLine` writes a v2 part, so any other spelling of one is an edited line.
 */
function steerLine({
  text,
  number,
  version,
}: {
  text: string;
  number: number;
  version: SteerLineVersion;
}): Result<SteerMeasurementEnvelopeV2, StoreTransferError> {
  const part = "steer-verdicts";
  if (version === 1) {
    return ok(steerMeasurementEnvelopeOfV1Line({ exactText: text, sourceOrdinal: number }));
  }
  const refusal = ({ why }: { why: string }): StoreTransferError =>
    StoreTransferErrors.partUndecodable({ part, why: `line ${String(number)} is not a v2 envelope: ${why}` });
  return jsonLine({ number, part, text }).andThen((value) =>
    parseSteerMeasurementEnvelopeV2({ value })
      .mapErr((why) => refusal({ why: why.join("; ") }))
      .andThen((envelope) => {
        if (steerMeasurementEnvelopeLine({ envelope }) !== text) {
          return err(refusal({ why: "it is not the line its fields write, so it was edited (a duplicate key, say)" }));
        }
        return ok(envelope);
      }),
  );
}

/**
 * Whether one nonblank line of an unmanifested steer part CLAIMS to be an envelope: a JSON object carrying a
 * `schemaVersion` field, which no journal writer ever put on a verdict. The claim, not its validity, decides, so
 * an envelope whose fields contradict each other is read as one and refused, never taken as a journal line and
 * minted a legacy id it never had.
 *
 * The residue, stated: a journal line that never parsed and happens to carry `schemaVersion` claims too, and
 * refuses the part. No criterion read off one line closes that — any shape an edited envelope can take, a junk
 * line can also take — so the collision refuses loudly rather than losing or minting a measurement, and a
 * manifest naming v1 reads that part as journal lines.
 */
function claimsSteerEnvelope({ text }: { text: string }): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  return isRecord(value) && Object.hasOwn(value, "schemaVersion");
}

/**
 * The steer-verdicts part, a line at a time, every nonblank line one measurement: a parsed verdict, a read that
 * named nothing, a withdrawal and a line that does not parse alike, each its own entry keyed by its event id.
 *
 * A v1 part's lines are the journal's own, so none refuses, and each takes the id a legacy import of it would have,
 * at its physical place in the part, blanks counted. Its ROWS stay the parsed lines, the count every v1 manifest
 * recorded. A v2 part's lines are envelopes, any one that is not refusing the whole part; its rows are its
 * envelopes. With no manifest (`version` null) each line says which it is — an object carrying `schemaVersion` is
 * an envelope, held to the strict parse, and anything else a journal line — and a part holding both refuses; an
 * empty one is empty under either.
 */
function steerDecoder({ version }: { version: SteerLineVersion | null }): PartDecoder {
  const part = "steer-verdicts";
  const retained: StagedEntry[] = [];
  let rows = 0;
  let seen: SteerLineVersion | null = version;
  return {
    finish: () => ok({ retained, rows }),
    line: ({ text, number }) => {
      if (text.trim() === "") {
        return ok(true);
      }
      let lineVersion: SteerLineVersion;
      if (version !== null) {
        lineVersion = version;
      } else {
        lineVersion = claimsSteerEnvelope({ text }) ? 2 : 1;
      }
      if (seen !== null && seen !== lineVersion) {
        return err(
          StoreTransferErrors.partUndecodable({
            part,
            why: `line ${String(number)} is a v${String(lineVersion)} line in a part of v${String(seen)} lines`,
          }),
        );
      }
      seen = lineVersion;
      return steerLine({ number, text, version: lineVersion }).map((envelope): true => {
        retained.push(steerMeasurementEntry({ measurement: { envelope, sequence: number } }));
        if (lineVersion === 2 || envelope.parseStatus === "parsed") {
          rows += 1;
        }
        return true;
      });
    },
  };
}

/** A decoder for a part version this build does not read: it refuses at the end, naming the version. */
function unreadableVersion({ kind, schemaVersion }: { kind: StoreExportPartKind; schemaVersion: number }): PartDecoder {
  return {
    finish: () =>
      err(
        StoreTransferErrors.partUndecodable({
          part: kind,
          why: `this build does not read schema v${String(schemaVersion)}`,
        }),
      ),
    line: () => ok(true),
  };
}

/**
 * A fresh decoder for one part, under the schema version its manifest names.
 *
 * @param kind which part is about to stream
 * @param schemaVersion the part's version as its manifest names it, or `null` for an unmanifested part, whose steer
 *   lines then say which they are; every other part has one version and ignores it
 * @returns the decoder that judges it with its own domain's schema
 */
export function partDecoder({
  kind,
  schemaVersion,
}: {
  kind: StoreExportPartKind;
  schemaVersion: number | null;
}): PartDecoder {
  switch (kind) {
    case "memories":
      return perLine({
        read: ({ text, number }) =>
          parseExportedLine({ line: text, lineNumber: number })
            .map((recording) => memoryEntry({ recording }))
            .mapErr((error) => StoreTransferErrors.partUndecodable({ part: kind, why: error.message })),
      });
    case "memory-recalls":
      return perLine({
        read: ({ text, number }) =>
          parseExportedRecall({ line: text, lineNumber: number })
            .map((recall) => recallEntry({ recall }))
            .mapErr((error) => StoreTransferErrors.partUndecodable({ part: kind, why: error.message })),
      });
    // A cohort the profile parser refuses — descending percentiles, say — is refused here too. The register's
    // one writer, `profile voice`, validates through the same parser, so only a hand-written row holds one.
    case "owner-voice":
      return perLine({
        read: ({ text, number }) =>
          jsonLine({ number, part: kind, text }).andThen((value) =>
            parseVoiceCohort({ value })
              .map((cohort) => voiceEntry({ cohort }))
              .mapErr((error) =>
                StoreTransferErrors.partUndecodable({ part: kind, why: `line ${String(number)}: ${error.message}` }),
              ),
          ),
      });
    case "owner-profile":
      return gathered({ judge: judgeOwnerProfile });
    case "owner-directives":
      return gathered({ judge: judgeDirectives });
    case "standing-asks":
      return gathered({ judge: judgeStandingAsks });
    case "steer-verdicts":
      if (schemaVersion === null || schemaVersion === 1 || schemaVersion === 2) {
        return steerDecoder({ version: schemaVersion });
      }
      return unreadableVersion({ kind, schemaVersion });
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
