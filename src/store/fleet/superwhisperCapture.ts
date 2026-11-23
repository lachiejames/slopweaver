/**
 * One Superwhisper recording's `meta.json` as the `owner_capture` row it becomes. Pure: bytes and a folder name in,
 * a row, an empty recording, or a named refusal out.
 *
 * Superwhisper keeps every dictation as `<recordings>/<epoch seconds>/meta.json` beside its audio. The fields read:
 *
 * - `result` — the final text, exactly what was typed into the target app; `""` for a recording with no speech.
 *   `rawResult` is the pre-formatting transcript and is not the owner's turn as delivered, so it is never stored.
 * - `datetime` — an ISO instant (`YYYY-MM-DDTHH:MM:SS`), UTC with no zone suffix. It must agree with the folder's epoch to the
 *   second, or the record is refused: two instants that disagree mean neither can be trusted as when the owner spoke.
 *   MEASURED, all 4,440 recordings agree.
 * - `promptContext.applicationContext.name` — the app it was dictated into (`cmux`, `Slack`, `Google Chrome`, …).
 * - `duration` — the recording's length in milliseconds.
 */
import { epochSecondsToIso, parseStrictIsoInstantMs } from "#lib/date.js";
import { parseJsonObject } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import type { NewOwnerCaptureRecord } from "../schema/ownerCapture.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { decodeExactly } from "./exactText.js";
import { captureBody, isJsonObject, stringField, unstorableTextReason } from "./ownerCapture.js";

/** What one recording projects to. */
export type SuperwhisperProjection =
  /** A recording with no speech in it — skipped and counted, never stored. */
  { readonly kind: "empty" } | { readonly kind: "captured"; readonly row: NewOwnerCaptureRecord };

/** A recording folder's name: whole epoch seconds. */
const FOLDER_EPOCH = /^[0-9]{1,12}$/u;

/** Superwhisper's zone-less UTC `datetime`, to the second. */
const ZONELESS_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/u;

/**
 * The instant a recording was made, checked against its folder.
 *
 * @param datetime the record's `datetime` field
 * @param folderName the recording's folder, whole epoch seconds
 * @returns the instant, or why it cannot be trusted
 */
function recordedInstant({
  datetime,
  folderName,
  path,
}: {
  datetime: string | undefined;
  folderName: string;
  path: string;
}): Result<Date, FleetImportError> {
  if (datetime === undefined || !ZONELESS_UTC.test(datetime)) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: "its datetime is not YYYY-MM-DDTHH:MM:SS" }));
  }
  const ms = parseStrictIsoInstantMs({ text: `${datetime}Z` });
  if (ms === undefined) {
    return err(
      FleetImportErrors.unstorableOwnerCapture({ path, reason: `its datetime ${datetime} is not an instant` }),
    );
  }
  const saidAt = new Date(ms);
  let folderIso: string | undefined;
  if (FOLDER_EPOCH.test(folderName)) {
    folderIso = epochSecondsToIso({ seconds: Number(folderName) });
  }
  if (folderIso !== saidAt.toISOString()) {
    return err(
      FleetImportErrors.unstorableOwnerCapture({
        path,
        reason: `its datetime ${datetime} disagrees with its folder ${folderName}`,
      }),
    );
  }
  return ok(saidAt);
}

/**
 * The app a recording was dictated into, when the record names one.
 *
 * @param record the decoded `meta.json`
 * @returns the app's name, or null when the record carries none
 */
function targetApplication({ record }: { record: Record<string, unknown> }): string | null {
  const prompt = record["promptContext"];
  if (!isJsonObject(prompt)) {
    return null;
  }
  const application = prompt["applicationContext"];
  if (!isJsonObject(application)) {
    return null;
  }
  const name = stringField({ key: "name", record: application });
  if (name === undefined || name === "") {
    return null;
  }
  return name;
}

/**
 * A recording's length in milliseconds: null only when the record carries none, refused when it carries one that is
 * not a whole non-negative number. MEASURED, every `duration` across this Mac's recordings is a whole
 * number of milliseconds (repro: `grep -rhoE '"duration" *: *[0-9.]+' ~/Documents/superwhisper/recordings
 * --include=meta.json | grep -c '\.'` prints 0), so another shape is a malformed record. Reading it as null instead
 * would also let two records with different lengths fingerprint alike and one be dropped.
 *
 * @param record the decoded `meta.json`
 * @param path the file, named in a refusal
 * @returns the length, null when the record carries none, or the refusal
 */
function durationOf({
  record,
  path,
}: {
  record: Record<string, unknown>;
  path: string;
}): Result<number | null, FleetImportError> {
  if (!Object.hasOwn(record, "duration") || record["duration"] === null) {
    return ok(null);
  }
  const duration = record["duration"];
  if (typeof duration === "number" && Number.isSafeInteger(duration) && duration >= 0) {
    return ok(duration);
  }
  return err(
    FleetImportErrors.unstorableOwnerCapture({
      path,
      reason: "its duration is not a whole non-negative number of milliseconds",
    }),
  );
}

/**
 * Project one recording's `meta.json`.
 *
 * @param bytes the file exactly as read
 * @param folderName the recording's folder name, its epoch seconds and its `source_id`
 * @param path the file, named in a refusal
 * @returns the row, `empty` for a recording with no speech, or the refusal
 */
export function projectSuperwhisperCapture({
  bytes,
  folderName,
  path,
}: {
  bytes: Uint8Array;
  folderName: string;
  path: string;
}): Result<SuperwhisperProjection, FleetImportError> {
  const text = decodeExactly({ bytes });
  if (text === undefined) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: "its bytes are not UTF-8" }));
  }
  const parsed = parseJsonObject({ text });
  if (parsed.isErr()) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: "it is not a JSON object" }));
  }
  const record = parsed.value;
  const result = stringField({ key: "result", record });
  if (result === undefined) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: "it carries no result text" }));
  }
  if (result === "") {
    return ok({ kind: "empty" });
  }
  const saidAt = recordedInstant({ datetime: stringField({ key: "datetime", record }), folderName, path });
  if (saidAt.isErr()) {
    return err(saidAt.error);
  }
  const body = captureBody({ body: result, path });
  if (body.isErr()) {
    return err(body.error);
  }
  const application = targetApplication({ record });
  // Stored beside the body, so held to the same rule.
  const unstorableApplication =
    application === null ? undefined : unstorableTextReason({ field: "application name", text: application });
  if (unstorableApplication !== undefined) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path, reason: unstorableApplication }));
  }
  const durationMs = durationOf({ path, record });
  if (durationMs.isErr()) {
    return err(durationMs.error);
  }
  return ok({
    kind: "captured",
    row: {
      ...body.value,
      durationMs: durationMs.value,
      saidAt: saidAt.value,
      source: "superwhisper",
      sourceId: folderName,
      targetApplication: application,
    },
  });
}
