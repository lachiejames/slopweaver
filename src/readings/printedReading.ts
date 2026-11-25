/**
 * The one contract a self-recording verb keeps: the document it prints and the document it appends to the readings
 * ledger are the SAME text, serialised once, observed at the document's own instant.
 *
 * A verb whose `--record-reading <by>` flag the console's sync route runs (`site/lib/syncVerbs.ts`) prints the
 * document first and appends it second. This module is the pure half — the text and the exact append — so the verb's
 * effectful shell only writes the one and hands the other to `recordReading` (`./store.ts`).
 */
import { safeJsonStringify } from "#lib/safeJson.js";

/** Exactly what one `--record-reading` append hands the readings ledger. */
export interface PrintedReadingAppend {
  readonly by: string;
  /** The serialised document — byte for byte the text the verb printed. */
  readonly document: string;
  readonly home: string;
  /** The append instant, read after the document was built. */
  readonly nowIso: string;
  /** When the document was true: its own observation instant, never the append clock. */
  readonly observedAtIso: string;
  readonly producer: string;
}

/** What a self-recording verb prints, and the append it makes when one was asked for. */
export interface PrintedReadingOutput {
  /** The document's JSON text, serialised once. */
  readonly text: string;
  /** `undefined` when `--record-reading` was not given. */
  readonly append: PrintedReadingAppend | undefined;
}

/**
 * Serialise a document once and, when `--record-reading` named who took it, build the append of that same text.
 * Pure: the instants are passed in, and nothing is written.
 *
 * @param by the flag's value — `sync-now` from the console — or `undefined` when the flag was absent
 * @param document the value the verb prints as JSON
 * @param home the state home the document was read under, where it is recorded too
 * @param observedAtIso the document's own observation instant
 * @param producer the verb words the reading files under, as `reading last --producer` reads them
 * @param recordedAtIso the append instant
 * @returns the text to print and the append, if any
 */
export function printedReadingOutputOf({
  by,
  document,
  home,
  observedAtIso,
  producer,
  recordedAtIso,
}: {
  by: string | undefined;
  document: unknown;
  home: string;
  observedAtIso: string;
  producer: string;
  recordedAtIso: string;
}): PrintedReadingOutput {
  const text = safeJsonStringify({ label: `a ${producer} document`, value: document });
  if (by === undefined) {
    return { append: undefined, text };
  }
  return { append: { by, document: text, home, nowIso: recordedAtIso, observedAtIso, producer }, text };
}
