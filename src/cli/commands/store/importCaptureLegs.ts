/**
 * `store import-fleet --only dictations` and `--only codex-messages` — the owner's speech-to-text dictations and
 * interactive Codex messages, into `owner_capture` with the instant each one was said.
 *
 * The only two legs whose source sits OUTSIDE the state home. Where each source is, and why a non-default home
 * reads neither without a flag, is `../../../store/fleet/captureSources.ts`; the table is
 * `../../../store/schema/ownerCapture.ts`. Both legs are append-only: a re-run over unchanged sources writes zero.
 */
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError } from "#lib/presentFile.js";
import type { Result } from "#lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import type { StoreError } from "../../../store/errors.js";
import { sourceNotResolvedNote } from "../../../store/fleet/captureSources.js";
import { projectCodexMessage } from "../../../store/fleet/codexMessageCapture.js";
import { readCodexMessages } from "../../../store/fleet/codexMessageSource.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { driftedCaptures, importOwnerCaptures } from "../../../store/fleet/ownerCaptureStore.js";
import { projectSuperwhisperCapture } from "../../../store/fleet/superwhisperCapture.js";
import type { NewOwnerCaptureRecord } from "../../../store/schema/ownerCapture.js";

import { type LegOutcome, type LegTally, newTally, outcomeOf } from "./importFleetCore.js";
import { CODEX_HOME_FLAG, DICTATIONS_FLAG, type FleetLeg } from "./importFleetUsage.js";

/** Writes one leg's rows in one transaction and answers how many were NEW — the seam a test passes a fake for. */
export type CaptureWriter = (input: { rows: readonly NewOwnerCaptureRecord[] }) => Promise<Result<number, StoreError>>;

/**
 * The writer a real run uses: every row through `importOwnerCaptures`, or none at all on a dry run.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @returns the writer, or `undefined` when nothing may be written
 */
export function captureWriterFor({ client }: { client: StoreClient | undefined }): CaptureWriter | undefined {
  if (client === undefined) {
    return undefined;
  }
  return ({ rows }) => importOwnerCaptures({ client, rows });
}

/**
 * The note a leg carries when a refusal held its projected rows back, or `undefined` when nothing was held.
 *
 * A leg is all or nothing: one record it could not project exactly means none of its rows is written, so a re-run
 * after the refusal is fixed imports the whole source at once rather than leaving the store a partial copy of it
 * — the rule, and the note's wording, the door and autonomy legs already follow.
 * A dry run reports the same hold, so it predicts what a real run would do.
 *
 * @param rows every projected row; with none there is nothing to hold, so no note
 * @param tally the leg's tally, read for its refusals
 * @returns the hold note, or `undefined`
 */
export function heldBackNote({
  rows,
  tally,
}: {
  rows: readonly NewOwnerCaptureRecord[];
  tally: LegTally;
}): string | undefined {
  if (tally.refused.length === 0 || rows.length === 0) {
    return undefined;
  }
  return `nothing written — ${String(tally.refused.length)} record(s) refused; repair them, then import again`;
}

/**
 * Write a leg's rows, unless this is a dry run or the leg refused a record, and fold the outcome into its tally.
 *
 * @param write the writer, or `undefined` on a dry run
 * @param rows every projected row
 * @param source the source, named if the store refuses the write
 * @param tally the leg's tally, mutated
 */
async function writeRows({
  write,
  rows,
  source,
  tally,
}: {
  write: CaptureWriter | undefined;
  rows: readonly NewOwnerCaptureRecord[];
  source: string;
  tally: LegTally;
}): Promise<void> {
  // Two rows of this one source under one key that disagree on any stored field is refused here too, before any
  // connection, so a dry run names it exactly as the store's own drift check would refuse the write.
  for (const row of driftedCaptures({ rows, stored: [] })) {
    tally.refused.push(
      FleetImportErrors.unstorableOwnerCapture({
        path: `${source}#${row.sourceId}`,
        reason: "another record of this source builds the same id with a different body, instant or recorded field",
      }),
    );
  }
  if (write === undefined || heldBackNote({ rows, tally }) !== undefined) {
    return;
  }
  const written = await write({ rows });
  if (written.isErr()) {
    tally.refused.push(FleetImportErrors.legWriteFailed({ path: source, reason: written.error.message }));
    return;
  }
  tally.written = written.value;
}

/**
 * A leg's notes with the hold note appended when there is one.
 *
 * @param notes the leg's own notes
 * @param rows every projected row
 * @param tally the leg's tally
 * @returns every note the leg reports
 */
function withHoldNote({
  notes,
  rows,
  tally,
}: {
  notes: readonly string[];
  rows: readonly NewOwnerCaptureRecord[];
  tally: LegTally;
}): string[] {
  const held = heldBackNote({ rows, tally });
  if (held === undefined) {
    return [...notes];
  }
  return [...notes, held];
}

/** The outcome of a leg whose source was not resolved for this home. */
function notResolved({ leg, flag }: { leg: FleetLeg; flag: string }): LegOutcome {
  return { ...outcomeOf({ leg, tally: newTally() }), notes: [sourceNotResolvedNote({ flag })] };
}

/** What one recording folder came to. */
type RecordingRead =
  | { readonly kind: "not-a-folder" }
  | { readonly kind: "no-meta" }
  | { readonly kind: "empty" }
  | { readonly kind: "refused"; readonly error: FleetImportError }
  | { readonly kind: "row"; readonly row: NewOwnerCaptureRecord };

/**
 * Read and project one entry of the dictations folder.
 *
 * @param recordings the dictations folder the entry sits in
 * @param entry one listed entry
 * @returns what that entry came to
 */
function readRecording({ recordings, entry }: { recordings: string; entry: Dirent }): RecordingRead {
  // Only a plain file is passed over, and counted. A symlink is read THROUGH, so a recording linked into the folder is
  // imported rather than dropped; a link or special entry that is no folder fails the read
  // below with ENOTDIR, a named refusal.
  if (entry.isFile()) {
    return { kind: "not-a-folder" };
  }
  const path = join(recordings, entry.name, "meta.json");
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    // Judged on the read itself, never a check before it: `existsSync` files an unreachable recording as one still
    // being written, and a stat first races the recorder.
    if (isAbsentError({ error: cause, path })) {
      return { kind: "no-meta" };
    }
    return {
      error: FleetImportErrors.unstorableOwnerCapture({ path, reason: errorMessage({ error: cause }) }),
      kind: "refused",
    };
  }
  const projected = projectSuperwhisperCapture({ bytes, folderName: entry.name, path });
  if (projected.isErr()) {
    return { error: projected.error, kind: "refused" };
  }
  if (projected.value.kind === "empty") {
    return { kind: "empty" };
  }
  return { kind: "row", row: projected.value.row };
}

/**
 * List the dictations folder, folding a folder that is not there or will not list into the tally.
 *
 * @param recordings the dictations folder
 * @param tally the leg's tally, mutated when the folder is absent or refused
 * @returns the entries in name order, or `undefined` when there is nothing to read
 */
function listRecordings({ recordings, tally }: { recordings: string; tally: LegTally }): Dirent[] | undefined {
  // A folder that exists and will not list (EACCES) is this leg's named refusal, never a rejection —
  // and so is one that cannot even be reached, which `existsSync` would have reported as absent.
  try {
    return readdirSync(recordings, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));
  } catch (cause) {
    if (isAbsentError({ error: cause, path: recordings })) {
      tally.absentSource = recordings;
      return undefined;
    }
    tally.refused.push(
      FleetImportErrors.unstorableOwnerCapture({ path: recordings, reason: errorMessage({ error: cause }) }),
    );
    return undefined;
  }
}

/**
 * Project every recording under a dictations folder and, unless this is a dry run, write the rows.
 *
 * Only `<recordings>/<folder>/meta.json` is opened, Superwhisper's layout and the one read today; the audio beside it
 * is never read.
 *
 * @param write the writer, or `undefined` on a dry run
 * @param recordings the dictations folder, or `undefined` when none was resolved for this home
 * @returns what this leg did
 */
export async function runDictationsLeg({
  write,
  recordings,
}: {
  write: CaptureWriter | undefined;
  recordings: string | undefined;
}): Promise<LegOutcome> {
  if (recordings === undefined) {
    return notResolved({ flag: DICTATIONS_FLAG, leg: "dictations" });
  }
  const tally = newTally();
  const entries = listRecordings({ recordings, tally });
  if (entries === undefined) {
    return outcomeOf({ leg: "dictations", tally });
  }
  const rows: NewOwnerCaptureRecord[] = [];
  let empty = 0;
  let withoutMeta = 0;
  let files = 0;
  for (const entry of entries) {
    const read = readRecording({ entry, recordings });
    if (read.kind === "not-a-folder") {
      files += 1;
    } else if (read.kind === "no-meta") {
      withoutMeta += 1;
    } else if (read.kind === "empty") {
      empty += 1;
    } else if (read.kind === "refused") {
      tally.refused.push(read.error);
    } else {
      tally.projected += 1;
      rows.push(read.row);
    }
  }
  await writeRows({ rows, source: recordings, tally, write });
  return {
    ...outcomeOf({ leg: "dictations", tally }),
    notes: withHoldNote({
      notes: [
        `${String(empty)} recording(s) with no speech skipped`,
        `${String(withoutMeta)} recording folder(s) with no meta.json yet (a recording still being written) skipped`,
        `${String(files)} plain file(s) beside the recording folders skipped`,
      ],
      rows,
      tally,
    }),
  };
}

/**
 * Project every message the owner sent an interactive Codex thread and, unless this is a dry run, write the rows.
 *
 * @param write the writer, or `undefined` on a dry run
 * @param codexHome the Codex home, or `undefined` when none was resolved for this home
 * @returns what this leg did
 */
export async function runCodexMessagesLeg({
  write,
  codexHome,
}: {
  write: CaptureWriter | undefined;
  codexHome: string | undefined;
}): Promise<LegOutcome> {
  if (codexHome === undefined) {
    return notResolved({ flag: CODEX_HOME_FLAG, leg: "codex-messages" });
  }
  const tally = newTally();
  const read = await readCodexMessages({ codexHome });
  if (read.isErr()) {
    tally.refused.push(read.error);
    return outcomeOf({ leg: "codex-messages", tally });
  }
  if (read.value.kind === "absent") {
    tally.absentSource = read.value.path;
    return outcomeOf({ leg: "codex-messages", tally });
  }
  const { historyPath, messages, threads } = read.value;
  for (const refusal of read.value.refused) {
    tally.refused.push(refusal);
  }
  const rows: NewOwnerCaptureRecord[] = [];
  let attachments = 0;
  for (const message of messages) {
    const thread = threads.get(message.threadId)!;
    const projected = projectCodexMessage({ message, path: historyPath, thread });
    if (projected.isErr()) {
      tally.refused.push(projected.error);
      continue;
    }
    tally.projected += 1;
    attachments += projected.value.attachmentParts;
    rows.push(projected.value.row);
  }
  await writeRows({ rows, source: historyPath, tally, write });
  return {
    ...outcomeOf({ leg: "codex-messages", tally }),
    notes: withHoldNote({
      notes: [
        `${String(threads.size)} interactive thread(s) read; exec threads (the fleet's own Codex passes) never are`,
        `${String(attachments)} attachment part(s) (an attached image) counted, not read`,
      ],
      rows,
      tally,
    }),
  };
}
