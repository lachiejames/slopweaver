/**
 * One held copy of the owner's ChatGPT conversations a refresh reads: a held export, or the live snapshots
 * `chatgpt live-sync` fetched one conversation at a time. Both are files of top-level JSON arrays whose elements are
 * one conversation each in the export's shape, so the merge and the ingest read them through the one parser and the
 * one projection, and a chat held both ways weighs as one conversation with two versions rather than two chats.
 *
 * Pure.
 */
import type { StoredExport } from "./exportStore.js";

/** One held copy of conversations, as the merge and the ingest read it. */
export interface StoredConversationInput {
  /** What a merge plan names this copy by: an export's content hash, or {@link LIVE_INPUT_KEY}. */
  readonly key: string;
  /** Where this copy came from. */
  readonly kind: "export" | "live";
  /** How a coverage gap names it to the owner: `export <hash12>`, or the live copy. */
  readonly label: string;
  /** Its files, each a JSON array of conversations, in reading order. */
  readonly files: readonly string[];
}

/** The one key every live snapshot is read under: the live copy is one held copy, however many chats it holds. */
const LIVE_INPUT_KEY = "live";

/**
 * A held export as a merge input.
 *
 * @param stored the held export
 * @returns the input, keyed by the export's content hash
 */
export function exportConversationInput({ stored }: { stored: StoredExport }): StoredConversationInput {
  return {
    files: stored.files,
    key: stored.contentHash,
    kind: "export",
    label: `export ${stored.contentHash.slice(0, 12)}`,
  };
}

/**
 * The live snapshots as one merge input.
 *
 * @param files each held snapshot's body, one conversation per file
 * @returns the input, keyed {@link LIVE_INPUT_KEY}
 */
export function liveConversationInput({ files }: { files: readonly string[] }): StoredConversationInput {
  return { files, key: LIVE_INPUT_KEY, kind: "live", label: "the live copy" };
}
