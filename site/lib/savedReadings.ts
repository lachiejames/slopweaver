/**
 * The last successful real reading of each live verb, saved by the console server so a page opened after an app
 * restart draws it at once, marked refreshing, instead of waiting out the read (`./savedReadingDraw.ts` says where
 * one may be drawn, and why only there).
 *
 * MEASURED on a production console (`scripts/docs-site.sh --serve`), a fresh browser context per run, median
 * of 3, time until `main` holds no block spinner: Fleet 12.5 s with nothing saved, waiting on `board` (`handover list
 * --json`, 8,932 rows, 20 MB, 8 s alone and 13 to 17 s behind the shell's reads in the three live-read slots,
 * `./liveSlots.ts`), and 2.3 s with saved readings; the Queue 7.0 s and 2.4 s. The saved-readings answer was 37 MB in
 * 0.4 to 0.6 s. Repro: `node first-draw.mjs <console-url> 3 /fleet /queue`, with `CLEAR_SAVED=` set to the
 * `saved_readings=` line `bash scripts/docs-site.sh --print-cache-paths` prints, for the before arm; the Playwright
 * script is in the body of the pull request that added this file.
 *
 * **Saved on arrival, server side, which `./liveRetained.ts` deliberately is not.** That register is page memory, and
 * caching on arrival there would let a read in flight from before a press refill what the press cleared. A saved
 * reading cannot do that: a page admits it only for a key it has neither pressed nor had an answer for, and always
 * provisional. What this file guards instead is ORDER on disk, across every console process sharing the directory (the
 * owner's on :3000 and a branch's throwaway one run at once): each reading is its own file named by the instant it
 * was true, `<slug>@<epochMs>.json`, a writer deletes only files OLDER than its own, and a read takes each slug's
 * newest. So no writer, in any process, can replace a reading with an older one (a per-process run order could not see
 * another process's save).
 *
 * Only an `ok`, non-fixture reading is saved; the slug comes from the allowlist row, never the request, and a read
 * accepts only a file named for a slug the allowlist holds. There is no expiry: the reading's own `observedAtIso`
 * states its age on the tile, and the page reads again at once.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { LiveResult } from "./liveVerbRun";
import { liveVerbFor } from "./liveVerbs";

/** A reading worth saving: one the verb answered, from the machine rather than a frozen fixture. */
export type SavedReading = Extract<LiveResult, { readonly ok: true }>;

/** Every saved reading, by slug. */
export type SavedReadings = Readonly<Record<string, SavedReading>>;

/**
 * The largest reading saved or read back, in UTF-16 code units of its JSON: the repository's own refusal for one
 * payload through one string (`src/lib/safeJson.ts`, 100 MiB). The board is about 20 MB today.
 */
export const SAVED_READING_MAX_CHARS = 100 * 1024 * 1024;

/**
 * The variable `scripts/docs-site.sh` hands every server it starts: this state home's saved-readings directory under
 * the cache root (`src/cacheHome.ts`). Rebuildable, so never under the home, and named by the launcher alone — the
 * site derives no path of its own here.
 */
export const SAVED_READINGS_DIR_VAR = "SLOPWEAVER_CONSOLE_SAVED_READINGS_DIR";

/**
 * Where this console saves its readings: the directory its launcher named, or `undefined` when none was named — a
 * server started some other way, which then saves nothing and reads nothing back rather than guessing a path.
 *
 * @param env the environment the launcher's variable is read from
 * @returns the absolute directory, or `undefined` when the launcher named none
 */
export function savedReadingsDirectory({
  env = process.env,
}: { env?: Readonly<Record<string, string | undefined>> } = {}): string | undefined {
  const named = env[SAVED_READINGS_DIR_VAR];
  if (named === undefined || named.trim() === "") {
    return undefined;
  }
  return resolve(named);
}

/**
 * The file one reading is saved as: its slug and the instant it was true, so two writers never share a name unless
 * they saved the same instant.
 *
 * @param observedMs the reading's `observedAtIso`, in epoch milliseconds
 * @returns the file name
 */
export function savedFileName({ slug, observedMs }: { slug: string; observedMs: number }): string {
  return `${slug}@${String(observedMs)}.json`;
}

/**
 * Read a saved file's name back into its slug and instant, refusing anything else — a staging sibling included.
 *
 * @param file a directory entry's name
 * @returns the slug and instant, or `undefined` when the name is not a saved reading's
 */
export function savedFileOf({ file }: { file: string }): { slug: string; observedMs: number } | undefined {
  if (!/^[a-z0-9-]+@\d+\.json$/.test(file)) {
    return undefined;
  }
  // Sliced rather than read from capture groups: a group's type differs between the root and site tsconfigs
  // (`noUncheckedIndexedAccess`), and a slug never carries an `@`, so the split is exact.
  const at = file.indexOf("@");
  const observedMs = Number(file.slice(at + 1, -".json".length));
  // An instant past the safe-integer range reads back as a different number, so it could not be ordered honestly
  // no real reading's instant is anywhere near it (`Date` itself stops at 8.64e15).
  if (!Number.isSafeInteger(observedMs)) {
    return undefined;
  }
  return { observedMs, slug: file.slice(0, at) };
}

/**
 * Narrow anything to a saved reading, refusing a failed read, a fixture and every other shape.
 *
 * @param value what a saved file parsed to
 * @returns the reading, or `undefined` when it is not one worth drawing
 */
export function savedReadingOf({ value }: { value: unknown }): SavedReading | undefined {
  if (typeof value !== "object" || value === null || !("payload" in value)) {
    return undefined;
  }
  const held = value as Partial<Record<"ok" | "observedAtIso" | "stampedByRoute" | "fixture" | "payload", unknown>>;
  if (held.ok !== true || typeof held.observedAtIso !== "string" || typeof held.stampedByRoute !== "boolean") {
    return undefined;
  }
  if (held.fixture !== undefined) {
    return undefined;
  }
  return { observedAtIso: held.observedAtIso, ok: true, payload: held.payload, stampedByRoute: held.stampedByRoute };
}

/** What one save came to. Never thrown: a save that fails costs only the next first load its head start. */
export type SaveOutcome =
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "skipped"; readonly why: string }
  | { readonly kind: "failed"; readonly why: string };

/**
 * Save one real flight's reading, unless a reading of the slug observed at the same instant or later is already on
 * disk, then delete every one of the slug's readings observed before it.
 *
 * The encode and the write start on a later turn of the event loop, so a caller that does not await this has
 * answered its own request before a 20 MB board is encoded a second time.
 *
 * @param directory the saved-readings directory, {@link savedReadingsDirectory}'s answer
 * @param slug the allowlist row's slug, never request text
 * @param result the reading the flight answered
 * @returns what the save came to
 */
export async function saveReading({
  directory,
  slug,
  result,
}: {
  directory: string | undefined;
  slug: string;
  result: SavedReading;
}): Promise<SaveOutcome> {
  if (directory === undefined) {
    return { kind: "skipped", why: `${SAVED_READINGS_DIR_VAR} names no directory, so this console saves nothing` };
  }
  await new Promise<void>((settle) => {
    setImmediate(settle);
  });
  const observedMs = Date.parse(result.observedAtIso);
  if (Number.isNaN(observedMs)) {
    return { kind: "skipped", why: `${slug} carries no readable instant: ${result.observedAtIso}` };
  }
  const path = join(directory, savedFileName({ observedMs, slug }));
  const staging = join(directory, `.${slug}.${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { mode: 0o700, recursive: true });
    const newer = (await savedOf({ directory, slug })).find((one) => one.observedMs >= observedMs);
    if (newer !== undefined) {
      return { kind: "skipped", why: `${slug} already has a reading from ${new Date(newer.observedMs).toISOString()}` };
    }
    const text = JSON.stringify(result);
    if (text.length > SAVED_READING_MAX_CHARS) {
      return { kind: "skipped", why: `${slug} is ${String(text.length)} characters, over the saved-reading ceiling` };
    }
    await writeFile(staging, text, { mode: 0o600 });
    await rename(staging, path);
  } catch (cause) {
    await rm(staging, { force: true });
    return { kind: "failed", why: cause instanceof Error ? cause.message : String(cause) };
  }
  // Only OLDER readings are deleted, so two writers racing this sweep can never remove the newest one between them.
  const older = (await savedOf({ directory, slug })).filter((one) => one.observedMs < observedMs);
  await Promise.all(older.map((one) => rm(join(directory, one.file), { force: true })));
  return { kind: "saved", path };
}

/**
 * Every saved file of one slug, by instant.
 *
 * @returns each file with its instant
 */
async function savedOf({
  directory,
  slug,
}: {
  directory: string;
  slug: string;
}): Promise<readonly { file: string; observedMs: number }[]> {
  const names = await readdir(directory);
  return names.flatMap((file) => {
    const named = savedFileOf({ file });
    if (named === undefined || named.slug !== slug) {
      return [];
    }
    return [{ file, observedMs: named.observedMs }];
  });
}

/** A saved file a read did not draw, and why — returned rather than logged, since the console server logs nothing. */
export interface DroppedReading {
  readonly file: string;
  readonly why: string;
}

/**
 * Read each slug's newest saved reading. A missing directory, or none named, is no readings; a file that is not a
 * reading is dropped and named, never thrown, and a slug whose newest file is bad falls back to its next newest, so
 * one bad file cannot hide a reading.
 *
 * @param directory the saved-readings directory, {@link savedReadingsDirectory}'s answer
 * @returns the readings by slug, and every file dropped with its reason
 */
export async function readSavedReadings({
  directory,
}: {
  directory: string | undefined;
}): Promise<{ readings: SavedReadings; dropped: readonly DroppedReading[] }> {
  if (directory === undefined) {
    return { dropped: [], readings: {} };
  }
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { dropped: [], readings: {} };
    }
    const why = cause instanceof Error ? cause.message : String(cause);
    return { dropped: [{ file: directory, why }], readings: {} };
  }
  const dropped: DroppedReading[] = [];
  const bySlug = new Map<string, { file: string; observedMs: number }[]>();
  for (const file of names.toSorted()) {
    // A staging sibling (`.<slug>.<uuid>.tmp`) is a write in progress, not a reading, and is passed over unnamed.
    if (file.startsWith(".")) {
      continue;
    }
    const named = savedFileOf({ file });
    if (named === undefined) {
      dropped.push({ file, why: "not named as a saved reading" });
      continue;
    }
    if (liveVerbFor({ slug: named.slug }) === undefined) {
      dropped.push({ file, why: `${named.slug} is not a live verb this console reads` });
      continue;
    }
    const files = bySlug.get(named.slug);
    if (files === undefined) {
      bySlug.set(named.slug, [{ file, observedMs: named.observedMs }]);
    } else {
      files.push({ file, observedMs: named.observedMs });
    }
  }
  const read = await Promise.all(
    [...bySlug.entries()].map(async ([slug, files]) => ({
      slug,
      ...(await newestReading({ directory, files: files.toSorted((a, b) => b.observedMs - a.observedMs) })),
    })),
  );
  const readings: Record<string, SavedReading> = {};
  for (const one of read.toSorted((a, b) => a.slug.localeCompare(b.slug))) {
    dropped.push(...one.dropped);
    if (one.reading !== undefined) {
      readings[one.slug] = one.reading;
    }
  }
  return { dropped, readings };
}

/**
 * The newest of one slug's files that holds a reading, and every newer one that did not.
 *
 * @param files the slug's files, newest first
 * @returns the reading, `undefined` when none held one, and the files dropped on the way
 */
async function newestReading({
  directory,
  files,
}: {
  directory: string;
  files: readonly { file: string; observedMs: number }[];
}): Promise<{ reading: SavedReading | undefined; dropped: readonly DroppedReading[] }> {
  const dropped: DroppedReading[] = [];
  for (const { file } of files) {
    const one = await readOne({ path: join(directory, file) });
    if (one.kind === "reading") {
      return { dropped, reading: one.reading };
    }
    dropped.push({ file, why: one.why });
  }
  return { dropped, reading: undefined };
}

/**
 * Read one saved file.
 *
 * @returns its reading, or why it holds none
 */
async function readOne({
  path,
}: {
  path: string;
}): Promise<
  { readonly kind: "reading"; readonly reading: SavedReading } | { readonly kind: "dropped"; readonly why: string }
> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    return { kind: "dropped", why: cause instanceof Error ? cause.message : String(cause) };
  }
  if (text.length > SAVED_READING_MAX_CHARS) {
    return { kind: "dropped", why: `${String(text.length)} characters, over the saved-reading ceiling` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return { kind: "dropped", why: cause instanceof Error ? cause.message : String(cause) };
  }
  const reading = savedReadingOf({ value });
  if (reading === undefined) {
    return { kind: "dropped", why: "not a successful reading from the machine" };
  }
  return { kind: "reading", reading };
}
