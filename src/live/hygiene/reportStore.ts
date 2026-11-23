/**
 * The ONE writer of a hygiene document under `$SLOPWEAVER_HOME/live/hygiene/` — `cycle reconcile --write`,
 * `sweep board --write` and the `hygiene-sweep` row's landing read all publish through it.
 *
 * It replaces a document WHOLE, atomically and durably, through `../../lib/writeAtomic.ts`: a reader sees the
 * previous document or the new one and never half of either, and a producer that fails part-way leaves the
 * previous document exactly as it was. That is the property the reader's contract
 * (`skills/automation/reference/hygiene-documents.md`) leans on — a failed run never erases yesterday's
 * usable document, so a stale file means "the last good pass", never "a pass that broke mid-write".
 *
 * It writes the bytes it is handed and parses none of them. Each producer serialises its document with the
 * same function its `--json` output uses, so the file and the terminal cannot disagree; a store that
 * re-serialised would be a second opinion about the shape.
 *
 * Owner-only (`0700` directory, `0600` file) like the rest of the `live` tier: a landing read names people,
 * pull requests and review threads.
 */

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicStream } from "#lib/writeAtomic.js";

/** The directory mode a hygiene document's parent is created with. */
const DIRECTORY_MODE = 0o700;

/** The file mode a hygiene document is written with. */
const FILE_MODE = 0o600;

/**
 * Replace one hygiene document with exactly the given bytes.
 *
 * An empty `chunks` writes a zero-byte document, which is a real answer rather than an absence: for the board
 * sweep it is the clean pass. Any throw — the filesystem's or the producer's own — comes back as the one
 * diagnostic line below with the previous document untouched.
 *
 * @param chunks the serialised document, in order; nothing is added between chunks
 * @param path the document to replace, one of `stateHomePaths({ home }).live.hygiene`'s files
 * @returns the path written, or why nothing was
 */
export function writeHygieneDocument({
  chunks,
  path,
}: {
  readonly chunks: Iterable<string>;
  readonly path: string;
}): Result<string> {
  try {
    writeFileAtomicStream({
      dirMode: DIRECTORY_MODE,
      fileMode: FILE_MODE,
      path,
      produce: ({ write }) => {
        for (const text of chunks) {
          write({ text });
        }
      },
    });
    return ok(path);
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    return err([`hygiene document ${path} was not replaced, and the previous one stands: ${why}`]);
  }
}
