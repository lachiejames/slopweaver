/**
 * The one strict read of an instruction journal a witnessed register imports once (`./schema/homeFileImport.ts`
 * § A witnessed register): the standing asks' and the steer measurements'. Each register maps the refusal into its
 * own error union at the one place it calls this.
 *
 * Strict, and every refusal writes nothing. A journal that is a link, or sits under a directory that is one, is
 * refused rather than followed: no writer here ever made one, and following it would carry the owner's words in from
 * wherever it points. The file is opened ONCE, `O_NOFOLLOW`, and must be a regular file on that descriptor; the
 * witness — the sha256 and size of its raw bytes — is hashed from the very chunks the lines are decoded from, so the
 * witness recorded is of exactly the bytes imported. It proves nothing about the path after that descriptor closes:
 * a later operation's own read is what notices a file that changed since — `ensureWitnessedImport`, below, is that
 * read, run before every operation of a witnessed register.
 */
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

import { isAbsentError, openFileNonBlocking } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { readJsonlDescriptorLines } from "../corpus/corpusStore.js";

import {
  ensureImported,
  homeFileWitnessVerdict,
  type ImportOnceRows,
  type ImportSource,
  type ImportSourceWitness,
  type MarkedSource,
  type StoreStepFailure,
} from "./registerImport.js";

/** One nonblank line of a journal, at its 1-based place in the file. */
export interface WitnessedJournalLine {
  readonly number: number;
  readonly line: string;
}

/** A journal as one read found it: nothing there, or its nonblank lines and the bytes they came from. */
export type WitnessedJournal =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly lines: readonly WitnessedJournalLine[];
      readonly witness: ImportSourceWitness;
    };

/** Why a journal would not read, before any register names it. */
export interface WitnessedJournalProblem {
  readonly path: string;
  readonly reason: string;
}

/**
 * The message of whatever a read threw.
 *
 * @param cause what was thrown
 * @returns its message, or a fixed sentence for a non-Error throw
 */
function readReason({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}

/**
 * One open of the journal, never through a link: its nonblank lines, and the sha256 and size of exactly the bytes
 * they were decoded from, both streamed off the same descriptor.
 *
 * @param path the journal
 * @returns the present file; throws as the open or a read does, ENOENT included, and on anything not a regular file
 */
function readJournalOnce({ path }: { path: string }): Extract<WitnessedJournal, { state: "present" }> {
  const fd = openFileNonBlocking({ noFollow: true, path });
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error(`${path} is not a regular file, so it is not read`);
    }
    const hash = createHash("sha256");
    let bytes = 0;
    const lines: WitnessedJournalLine[] = [];
    readJsonlDescriptorLines({
      fd,
      onBytes: ({ bytes: chunk }) => {
        hash.update(chunk);
        bytes += chunk.length;
      },
      onLine: ({ line, index }) => {
        if (line.trim() !== "") {
          lines.push({ line, number: index + 1 });
        }
      },
      // A byte that is not UTF-8 arrives as one lone U+FFFD, so the line fails to parse and the import refuses
      // rather than storing repaired words the owner never said.
      strictUtf8: true,
    });
    return { lines, state: "present", witness: { bytes, sha256: `sha256:${hash.digest("hex")}` } };
  } finally {
    closeSync(fd);
  }
}

/**
 * Refuse a parent directory that is a symlink: `O_NOFOLLOW` guards only the journal's own name. An absent one is fine.
 *
 * @param path the journal
 * @returns true, or the problem
 */
function refuseLinkedDir({ path }: { path: string }): Result<true, WitnessedJournalProblem> {
  const dir = dirname(path);
  try {
    if (lstatSync(dir).isSymbolicLink()) {
      return err({ path, reason: `${dir} is a symlink, which no write here makes` });
    }
  } catch (cause) {
    if (!isAbsentError({ error: cause, path: dir })) {
      return err({ path, reason: readReason({ cause }) });
    }
  }
  return ok(true);
}

/**
 * Read a witnessed journal: absent, or its nonblank lines and the witness of the bytes they came from.
 *
 * @param path the journal
 * @returns what the path holds, or why it would not read
 */
export function readWitnessedJournal({ path }: { path: string }): Result<WitnessedJournal, WitnessedJournalProblem> {
  const linked = refuseLinkedDir({ path });
  if (linked.isErr()) {
    return err(linked.error);
  }
  try {
    return ok(readJournalOnce({ path }));
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return ok({ state: "absent" });
    }
    return err({ path, reason: readReason({ cause }) });
  }
}

/** A witnessed journal as one read found it: nothing there, or present with the witness of its bytes. */
export type WitnessedRead =
  { readonly state: "absent" } | { readonly state: "present"; readonly witness: ImportSourceWitness };

/**
 * Make a WITNESSED register's tables the whole register over an open connection: the one-time import
 * (`./registerImport.ts`), then the witness check — the old path is gone, or still exactly the bytes imported.
 * Anything else refuses, because an append made there after the import would otherwise never be seen. The standing
 * asks and the steer measurements both run this; each names its refusals in its own union.
 *
 * @param rows the marker operations, and what the marker recorded of its file, over the open connection
 * @param readJournal the strict read of the old path: for its import, and again for its witness
 * @param toSource what the import writes from one read
 * @param unavailable how this register names a store step that failed
 * @param markerGone this register's refusal for a marker the import wrote that is no longer there
 * @param changed this register's refusal for a path that no longer holds the imported bytes
 * @returns nothing once the tables are the whole register, or the refusal
 */
export async function ensureWitnessedImport<T, J extends WitnessedRead, E>({
  rows,
  readJournal,
  toSource,
  unavailable,
  markerGone,
  changed,
}: {
  rows: ImportOnceRows<T> & {
    readonly markedSource: () => Promise<Result<MarkedSource | undefined, StoreStepFailure>>;
  };
  readJournal: () => Result<J, E>;
  toSource: (journal: J) => Result<ImportSource<T>, E>;
  unavailable: (failure: StoreStepFailure) => E;
  markerGone: () => E;
  changed: () => E;
}): Promise<Result<undefined, E>> {
  const imported = await ensureImported({ readSource: () => readJournal().andThen(toSource), rows, unavailable });
  if (imported.isErr()) {
    return err(imported.error);
  }
  const marked = await rows.markedSource();
  if (marked.isErr()) {
    return err(unavailable(marked.error));
  }
  if (marked.value === undefined) {
    return err(markerGone());
  }
  const current = readJournal();
  if (current.isErr()) {
    return err(current.error);
  }
  const verdict = homeFileWitnessVerdict({
    current: current.value.state === "absent" ? null : current.value.witness,
    marked: marked.value,
  });
  if (verdict === "changed") {
    return err(changed());
  }
  return ok(undefined);
}
