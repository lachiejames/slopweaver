/**
 * The app's recovery journal on disk: one owner-only (`0600`) JSON-lines file under the app's own data directory,
 * appended a row at a time and `fsync`ed before the append returns, so a row the app went on to act upon survives the
 * app — or any process of it — being killed the instant after. It does NOT promise to survive a power cut: macOS's
 * `fsync` hands the row to the drive without flushing the drive's own cache, and the call that does (`F_FULLFSYNC`)
 * is not reachable from Node without a native addon. What a row means is `sessionRecoveryRecord.ts`'s.
 */
import { closeSync, createReadStream, fchmodSync, fstatSync, fsyncSync, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "neverthrow";

import { foldRecoveryJournal, type RecoveryJournal, type SessionRecoveryEvent } from "./sessionRecoveryRecord";

/** The journal's name inside the app's data directory. */
export const RECOVERY_JOURNAL_NAME = "session-harness.jsonl";

/** Only the owner reads or writes the journal: its rows name the owner's directories and transcripts. */
const OWNER_ONLY = 0o600;

/** The byte that ends every row. */
const NEWLINE = 0x0a;

/**
 * Where the journal lives.
 *
 * @param userData the app's data directory (`app.getPath("userData")`)
 * @returns the journal's path
 */
export function recoveryJournalPath({ userData }: { userData: string }): string {
  return join(userData, RECOVERY_JOURNAL_NAME);
}

function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the file's last byte is anything but a newline: a write before this one was torn. */
function endsMidLine({ descriptor }: { descriptor: number }): boolean {
  const { size } = fstatSync(descriptor);
  if (size === 0) {
    return false;
  }
  const last = Buffer.alloc(1);
  readSync(descriptor, last, 0, 1, size - 1);
  return last[0] !== NEWLINE;
}

/**
 * Write every byte, or throw: `writeSync` may write fewer than it was handed without throwing — a nearly full disk —
 * and a row cut short is a row that was never recorded.
 */
function writeWhole({ descriptor, bytes }: { descriptor: number; bytes: Buffer }): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) {
      throw new Error(`the write stopped after ${String(offset)} of ${String(bytes.length)} bytes`);
    }
    offset += written;
  }
}

/**
 * Append one row and sync it to disk before returning. The file is made owner-only on every append, so one that
 * was created or loosened any other way is put right by the next row.
 *
 * @param path the journal
 * @param event the row
 * @returns nothing once the row is on disk, or why it is not
 */
export function appendRecoveryRow({
  path,
  event,
}: {
  path: string;
  event: SessionRecoveryEvent;
}): Result<void, string> {
  const failed = (error: unknown): Result<void, string> =>
    err(`the recovery journal ${path} could not record the ${event.kind} row: ${messageOf({ error })}`);
  let descriptor: number;
  try {
    descriptor = openSync(path, "a+", OWNER_ONLY);
  } catch (error: unknown) {
    return failed(error);
  }
  let written: Result<void, string>;
  try {
    fchmodSync(descriptor, OWNER_ONLY);
    // A row starts on a line of its own: a torn earlier write left unended stays one malformed line, never a prefix
    // that would swallow this row too.
    const separator = endsMidLine({ descriptor }) ? "\n" : "";
    writeWhole({ bytes: Buffer.from(`${separator}${JSON.stringify(event)}\n`), descriptor });
    fsyncSync(descriptor);
    written = ok(undefined);
  } catch (error: unknown) {
    written = failed(error);
  }
  // Closed in its own guard, so a failing close can never throw over the write's answer: the caller always gets a
  // Result. A close that fails after a synced write still reads as unrecorded, the cautious side.
  try {
    closeSync(descriptor);
  } catch (error: unknown) {
    return written.isErr() ? written : failed(error);
  }
  return written;
}

/**
 * Read and fold the whole journal, a line at a time: it gains rows with every session the app ever hosts, so it is
 * never read as one string. No journal yet is a journal with no sessions; one that cannot be read is an error, never
 * an empty journal, because "no rows" would read as nothing to recover.
 *
 * @param path the journal
 * @returns what the journal knows about each session, or why it could not be read
 */
export async function readRecoveryJournal({ path }: { path: string }): Promise<Result<RecoveryJournal, string>> {
  let descriptor: number;
  try {
    descriptor = openSync(path, "r");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(foldRecoveryJournal({ lines: [] }));
    }
    return err(`the recovery journal ${path} could not be opened: ${messageOf({ error })}`);
  }
  const lines: Buffer[] = [];
  try {
    // Split on the `\n` BYTE and hand each line over undecoded: a text reader would turn a corrupt byte into U+FFFD
    // before the strict decoder could refuse it. A `\r` stays part of its line, and a last line with no `\n` (a torn
    // write) is a line too.
    let pending = Buffer.alloc(0);
    for await (const read of createReadStream("", { fd: descriptor })) {
      // A stream opened with no encoding yields Buffers; anything else would be decoded text, so it is refused.
      const chunk: unknown = read;
      if (!Buffer.isBuffer(chunk)) {
        throw new Error("the read stream yielded text, not bytes");
      }
      let rest = Buffer.concat([pending, chunk]);
      for (let at = rest.indexOf(NEWLINE); at !== -1; at = rest.indexOf(NEWLINE)) {
        lines.push(rest.subarray(0, at));
        rest = rest.subarray(at + 1);
      }
      pending = rest;
    }
    if (pending.length > 0) {
      lines.push(pending);
    }
  } catch (error: unknown) {
    return err(`the recovery journal ${path} could not be read: ${messageOf({ error })}`);
  }
  return ok(foldRecoveryJournal({ lines }));
}
