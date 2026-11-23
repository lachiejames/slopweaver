/**
 * Read an `answer` form's attachment paths into uploadable bytes, in order.
 *
 * The bot's own turn reads these paths off disk itself — the same `readFile` + `basename` shape
 * `slack post --media` already uses — because the paths NAME a file the working checkout already
 * produced; nothing here captures, crops or annotates anything.
 *
 * It serves BOTH of the answer form's attachment lanes — `images` and `documents` — and is indifferent to
 * which: bytes are bytes, and the lanes differ in what is done with them afterwards, never in how they are
 * read. The one thing it must not do is guess, which is why the caller names what it is reading.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { SlackUpload } from "./writeTransport.js";

/**
 * Read every attachment path into a {@link SlackUpload}, sequentially and in the caller's order.
 *
 * Sequential rather than `Promise.all`, so the FIRST unreadable path is the one named in the failure — a
 * parallel read would report whichever rejected first, which is a race rather than an answer, and an
 * unreadable path must fail before a working or answer message is posted rather than mid-upload.
 *
 * @param paths the paths to read, in the order they should attach
 * @param what the singular noun for what these paths are, so a failed read names the right thing —
 *   a document whose failure claimed an image was unreadable would send a reader to the wrong lane
 * @returns the loaded uploads, in the same order
 */
export async function loadSlackUploads({
  paths,
  what,
}: {
  paths: readonly string[];
  what: string;
}): Promise<readonly SlackUpload[]> {
  const uploads: SlackUpload[] = [];
  for (const path of paths) {
    try {
      uploads.push({ bytes: await readFile(path), filename: basename(path) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`could not read the ${what} at "${path}": ${reason}`, { cause: error });
    }
  }
  return uploads;
}
