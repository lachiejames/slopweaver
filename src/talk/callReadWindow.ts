/**
 * Which call files a read opens (`./callStore.ts`'s `readCalls`), decided from their write times alone so a read
 * stays a handful of files: those written since an instant, the newest few, or — for a `speaking` read — every file
 * until no older-written one can hold a call among the newest few anyone spoke on.
 */
import { statSync } from "node:fs";

/** Which calls a read wants: those touched since an instant, the newest few, or the newest few anyone spoke on. */
export type CallsKeep = { readonly sinceIso: string } | { readonly limit: number } | { readonly speaking: number };

/**
 * How far ahead of the file's own write the sink can stamp a call's open line: one millisecond a line in a burst, so a
 * minute is far past any burst the page queues — the same slack `talk transcript` allows (`STAMP_SLACK_MS`).
 */
const OPEN_STAMP_SLACK_MS = 60_000;

/**
 * Whether a `speaking` read already holds every call it must: `speaking` calls anyone spoke on, and the next file, in
 * newest-written order, last written before the `speaking`th newest of them OPENED. A file is written no earlier than its
 * call's open line, so no file older than that holds a call that opened later — while a file written late, a retried
 * batch on an older call, never pushes a newer call out of the window.
 *
 * @param file the next file, newest-written first
 * @param speaking how many calls anyone spoke on the read must hold
 * @param spokenOpened when each call read so far that anyone spoke on opened, epoch ms, newest first
 * @returns whether to stop before reading `file`
 */
export function spokenEnough({
  file,
  speaking,
  spokenOpened,
}: {
  file: { mtimeMs: number };
  speaking: number;
  spokenOpened: readonly number[];
}): boolean {
  const floor = spokenOpened[speaking - 1];
  if (floor === undefined) {
    return false;
  }
  return file.mtimeMs + OPEN_STAMP_SLACK_MS < floor;
}

/**
 * The unopened files a `speaking` read must open after all: each written since the listing, so that its write time
 * no longer clears the floor, or no longer there to stat — reading it then names why it could not be read. The read
 * stopped on write times listed before it began, and an append since may hold a later call.
 *
 * @param rest the files the read did not open, as listed
 * @param speaking how many speaking calls the read holds
 * @param spokenOpened when each speaking call it read opened, newest first
 * @returns the files to open, as listed
 */
export function writtenSinceListed<File extends { path: string; mtimeMs: number }>({
  rest,
  speaking,
  spokenOpened,
}: {
  rest: readonly File[];
  speaking: number;
  spokenOpened: readonly number[];
}): readonly File[] {
  return rest.filter((file) => {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file.path).mtimeMs;
    } catch {
      return true;
    }
    return mtimeMs !== file.mtimeMs && !spokenEnough({ file: { mtimeMs }, speaking, spokenOpened });
  });
}

/**
 * The call files a read visits, newest-written first: those written since an instant, the newest few, or — for a
 * `speaking` read, which decides as it goes where to stop — all of them.
 *
 * @param touched every call file, with when it was last written
 * @param keep which calls the read wants
 * @returns the files to visit, in order
 */
export function chosenFiles<File extends { mtimeMs: number }>({
  touched,
  keep,
}: {
  touched: readonly File[];
  keep: CallsKeep;
}): readonly File[] {
  const newestFirst = touched.toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  if ("sinceIso" in keep) {
    // A call file is append-only, so one not written since the floor holds no line from inside the window.
    const floor = Date.parse(keep.sinceIso);
    return newestFirst.filter((file) => file.mtimeMs >= floor);
  }
  if ("limit" in keep) {
    return newestFirst.slice(0, keep.limit);
  }
  return newestFirst;
}
