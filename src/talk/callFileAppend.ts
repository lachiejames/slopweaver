/*
 * How one batch reaches the end of a call file, the caller holding the call's lock (`./callStore.ts`). A batch of the
 * call's own lines is appended in place. A batch of reconnect steps alone keeps the file's times, because a file's
 * write time is when the call's OWN lines were last written: every reader that picks calls by it — the newest few,
 * those written since a floor, an overtaken call — must not see an ended call as recent because a step landed on it
 * later.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, rmSync, statSync, utimesSync } from "node:fs";

import { appendLines } from "../lib/appendSeparator.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { fsyncFile, renameStagedFile } from "../lib/writeAtomic.js";
import type { CallEntry } from "./callRecord.js";

/**
 * Append a batch to a call file: in place, or — for reconnect steps alone onto a file already there — without moving
 * the file's times. An empty batch writes nothing. Throws whatever the write throws.
 *
 * @param entries the lines to write, none already in the file
 * @param path the call file
 */
export function appendCallBatch({ entries, path }: { entries: readonly CallEntry[]; path: string }): void {
  const times = stepsOnlyTimes({ entries, path });
  if (times === undefined) {
    appendWhole({ entries, path });
    return;
  }
  appendKeepingTimes({ entries, path, times });
}

/**
 * The file's times before a batch of reconnect steps alone is appended to it, so they can be kept.
 *
 * @param entries the lines about to be appended
 * @param path the call file
 * @returns its times, or `undefined` when the batch carries any other line or the file does not exist yet
 */
function stepsOnlyTimes({
  entries,
  path,
}: {
  entries: readonly CallEntry[];
  path: string;
}): { atimeMs: number; mtimeMs: number } | undefined {
  if (entries.length === 0 || entries.some((entry) => entry.kind !== "reconnect") || !existsSync(path)) {
    return undefined;
  }
  const { atimeMs, mtimeMs } = statSync(path);
  return { atimeMs, mtimeMs };
}

/**
 * Append a batch to a call file without moving its times, in one rename: a copy takes the batch and the file's old
 * times, then replaces it, so a crash or a failed time write leaves the file as it was rather than the steps on it
 * and its time moved. The staged name never ends `.jsonl`, so no reader lists it.
 *
 * @param entries the lines to write
 * @param path the call file, which exists
 * @param times its access and write times, put on the copy before it takes the file's place
 */
function appendKeepingTimes({
  entries,
  path,
  times,
}: {
  entries: readonly CallEntry[];
  path: string;
  times: { atimeMs: number; mtimeMs: number };
}): void {
  const staged = `${path}.${randomUUID()}.stage`;
  try {
    copyFileSync(path, staged);
    chmodSync(staged, 0o600);
    appendWhole({ entries, path: staged });
    utimesSync(staged, times.atimeMs / 1000, times.mtimeMs / 1000);
    fsyncFile({ path: staged });
    renameStagedFile({ flushDirectory: true, from: staged, to: path });
  } finally {
    rmSync(staged, { force: true });
  }
}

/**
 * Write a batch to the end of a call file whole (`appendLines`, which loops a short write), the caller
 * holding the lock so no other batch lands inside it — after a newline when a torn append left the tail
 * unterminated, so its first line never fuses onto it. An empty batch writes nothing.
 *
 * @param entries the lines to write
 * @param path the call file
 */
function appendWhole({ entries, path }: { entries: readonly CallEntry[]; path: string }): void {
  if (entries.length === 0) {
    return;
  }
  const body = entries
    .map((entry) => `${safeJsonStringify({ label: "call transcript line", value: entry })}\n`)
    .join("");
  appendLines({ mode: 0o600, path, text: body });
}
