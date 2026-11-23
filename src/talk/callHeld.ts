/**
 * What an append does under a call file's lock: read the lines the file already holds, judge whether a batch from a
 * console that is not the owner's would sit under an open it did not write, refuse a quarantined call, and write. All of
 * it runs under the same lock as the write, so no other batch lands between the judgement and the append.
 */
import { existsSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { appendCallBatch } from "./callFileAppend.js";
import { readCallLines } from "./callLines.js";
import { type CallOrigin, foreignLineUnopened, isOwnerConsoleOrigin } from "./callOrigin.js";
import { ledgerClosesCall } from "./callQuarantineLedger.js";
import type { CallEntry } from "./callRecord.js";
import { secretOnStoredLine } from "./callSanitise.js";
import { REPEATED_WRITE_ID, repeatsWriteId, unwrittenEntries } from "./callWriteIds.js";
import { type TalkError, TalkErrors } from "./errors.js";
import { isMissing } from "./unreadCursorStore.js";

/**
 * The lines a call file holds, none when it does not exist yet.
 *
 * @param path the call file
 * @returns its lines, or why it could not be read
 */
export function heldEntries({ path }: { path: string }): Result<readonly CallEntry[], unknown> {
  if (!existsSync(path)) {
    return ok([]);
  }
  return readCallLines({ path }).map((read) => read.entries);
}

/**
 * Whether a batch from a console that is not the owner's would put a line under an open it did not write
 * (`foreignLineUnopened`), read off the call file as it stands. The owner's console, and a write naming no console, are never
 * held to it, and the file is not read for them.
 *
 * @param entries the batch, stamped
 * @param origin the console writing it, when one is
 * @param path the call file
 * @returns whether the batch is refused, or why the file could not be read
 */
export function foreignUnopened({
  entries,
  origin,
  path,
}: {
  entries: readonly CallEntry[];
  origin: CallOrigin | undefined;
  path: string;
}): Result<boolean, unknown> {
  if (origin === undefined || isOwnerConsoleOrigin({ origin })) {
    return ok(false);
  }
  return heldEntries({ path }).map((existing) => foreignLineUnopened({ batch: entries, existing, origin }));
}

/** Why a batch of reconnect steps alone is refused for a call with no file: there is no call for them to follow. */
const STEPS_WITHOUT_CALL =
  "reconnect steps alone, for a call with no lines on file — a step goes after its call's close";

/**
 * Why an append holding the call's lock must refuse its batch, or `undefined` when it may write. A reconnect step
 * follows its call's close, so a file it would open is no call at all — and, newest written, it would push a real call
 * out of every reader that picks the newest few. A foreign console's batch is judged on the lines
 * on disk under that same lock, so no open lands between the judgement and the write.
 *
 * @param callId the call whose file holds no open line yet, for the reconnect refusal
 * @param entries the batch
 * @param origin the console writing it, when one is
 * @param path the call file
 * @returns the refusal, or `undefined`
 */
export function refusedUnderLock({
  callId,
  entries,
  origin,
  path,
}: {
  callId: string;
  entries: readonly CallEntry[];
  origin: CallOrigin | undefined;
  path: string;
}): TalkError | undefined {
  if (!existsSync(path) && entries.every((entry) => entry.kind === "reconnect")) {
    return TalkErrors.callEntriesInvalid({ path, why: STEPS_WITHOUT_CALL });
  }
  const unopened = foreignUnopened({ entries, origin, path });
  if (unopened.isErr()) {
    return TalkErrors.pathUnreadable({ cause: unopened.error, path });
  }
  if (unopened.value) {
    return TalkErrors.callOriginUnopened({ callId });
  }
  return undefined;
}

/**
 * Under the call's lock: refuse a batch that may not land here, index a new call, and append what is not yet held.
 * Every judgement is made here, so a `talk quarantine` racing the append lands wholly before or wholly after it.
 *
 * @param home the Slopweaver home, whose quarantine ledger closes a call
 * @param indexPath the call index a new call's id is appended to before its first line
 * @param callId the call, a v4 UUID
 * @param entries the lines, already validated
 * @param origin the console writing them, when one is
 * @param path the call file
 * @param nowIso the instant each segment line is stamped with
 * @param secretGuard the denylist the stamped batch is judged against before anything is written; absent, none is
 * @returns how many lines went in, or why none did
 */
export function appendUnderLock({
  home,
  indexPath,
  callId,
  entries,
  origin,
  path,
  nowIso,
  secretGuard,
}: {
  home: string;
  indexPath: string;
  callId: string;
  entries: readonly CallEntry[];
  origin: CallOrigin | undefined;
  path: string;
  nowIso: () => string;
  secretGuard?: { readonly denylist: readonly string[] } | undefined;
}): Result<number, TalkError> {
  // A quarantined call is closed: `talk unread` reads past its id while no file sits there, so a line written now
  // could be removed again unread. `talk quarantine` writes its row under this same lock. Asked first,
  // so a closed call says it is closed whatever else the batch would be refused for.
  if (closedUnderLock({ callId, home, indexPath, path })) {
    return err(TalkErrors.callQuarantined({ callId }));
  }
  if (repeatsWriteId({ entries })) {
    return err(TalkErrors.callEntriesInvalid({ path, why: REPEATED_WRITE_ID }));
  }
  if (entries.length === 0) {
    return ok(0);
  }
  const refused = refusedUnderLock({ callId, entries, origin, path });
  if (refused !== undefined) {
    return err(refused);
  }
  const storedIso = nowIso();
  const secret = secretOnStamped({ entries: storedNow({ entries, storedIso }), path, secretGuard });
  if (secret !== undefined) {
    return err(secret);
  }
  // Indexed before its first line, so a call file never exists unindexed (`./callStore.ts`'s `callIndexPath`).
  if (!existsSync(path)) {
    appendLines({ mode: 0o600, path: indexPath, text: `${callId}\n` });
  }
  // Read under the lock, so no other batch lands between the read and the write.
  const unseen = unwrittenEntries({ entries, held: () => heldEntries({ path }) });
  if (unseen.isErr()) {
    return err(TalkErrors.pathUnreadable({ cause: unseen.error, path }));
  }
  appendCallBatch({ entries: storedNow({ entries: unseen.value, storedIso }), path });
  return ok(unseen.value.length);
}

/**
 * The store's last look for a secret, over the batch exactly as it will be written — stamped, so a field the store adds
 * is judged too. Made before the call is indexed, so a refused first batch leaves no id naming a file
 * that was never written. The whole batch is judged, a superset of what is unwritten, under the same stamp.
 *
 * @param entries the batch, stamped
 * @param path the call file, named in a refusal
 * @param secretGuard the denylist to judge against; absent, nothing is judged
 * @returns the refusal, or `undefined` when nothing on the batch is a secret
 */
function secretOnStamped({
  entries,
  path,
  secretGuard,
}: {
  entries: readonly CallEntry[];
  path: string;
  secretGuard: { readonly denylist: readonly string[] } | undefined;
}): TalkError | undefined {
  if (secretGuard === undefined) {
    return undefined;
  }
  const found = secretOnStoredLine({ denylist: secretGuard.denylist, entries });
  if (found === undefined) {
    return undefined;
  }
  return TalkErrors.callEntriesInvalid({
    path,
    why: `a ${found.kind} line carried ${found.labels.join(", ")} once the store stamped it`,
  });
}

/**
 * Whether the call is closed to appends. When the ledger cannot be read at all it cannot say, so the shape a
 * quarantine could have closed is refused — the index names the call and its file is gone — while a new
 * call and one whose file is there keep writing, so an unreadable ledger never costs a live call its words. A call
 * only a cursor names, from before the index, is the residue: it reads as new.
 *
 * @param home the Slopweaver home
 * @param callId the call about to be appended to
 * @param indexPath the call index
 * @param path the call file
 * @returns whether an append must be refused as closed
 */
function closedUnderLock({
  home,
  callId,
  indexPath,
  path,
}: {
  home: string;
  callId: string;
  indexPath: string;
  path: string;
}): boolean {
  const closed = ledgerClosesCall({ callId, home });
  if (closed !== undefined) {
    return closed;
  }
  if (existsSync(path)) {
    return false;
  }
  let indexed = false;
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line }) => {
        if (line === callId) {
          indexed = true;
        }
      },
      path: indexPath,
    });
  } catch (cause) {
    // No index yet: no call has ever been written, so this one is new. Any other failure cannot rule it out.
    return !isMissing({ cause });
  }
  return indexed;
}

/**
 * Stamp every segment line of a batch with the instant the store appends it (`./callLag.ts`). A stamp the line already
 * carries is overwritten: only the store says when the store wrote, never a page.
 *
 * @param storedIso the append's instant
 * @returns the batch, each segment line stamped
 */
function storedNow({ entries, storedIso }: { entries: readonly CallEntry[]; storedIso: string }): readonly CallEntry[] {
  return entries.map((entry) => (entry.kind === "segment" ? { ...entry, storedIso } : entry));
}
