/**
 * The conversation a RETRIED comparison may hand Codex: what the original's recording read, never a later world.
 *
 * `slack draft compare <id>` re-reads the conversation, because the record that parked the row kept identifiers and
 * edit stamps (`readThrough`), never the text. B must be drafted from the evidence A was, or the pick measures two
 * different conversations. So the release's own freshness reading (`./releaseFreshness.ts`) decides: a message added
 * since is left out, which restores what the recording saw; an edit or a removal cannot be undone from identifiers,
 * so the retry is refused and the card keeps A alone. Pure.
 */
import { isRecord } from "../../lib/parsers.js";
import type { ParkedSlackDraft } from "./draftRegister.js";
import { conversationChanges, releaseWatermark } from "./releaseFreshness.js";

/** What a retry may run on: the rows as the recording saw them, or why it may not run at all. */
export type RecordedEvidence =
  | { readonly kind: "as-recorded"; readonly rows: readonly unknown[] }
  | { readonly kind: "moved"; readonly why: string };

/**
 * The rows a retried comparison may read, cut back to what the recording read.
 *
 * @param draft the parked row, whose watermark says what its recording read
 * @param rows the conversation as it reads now
 * @returns the recorded rows, or why the evidence cannot be restored
 */
export function recordedEvidence({
  draft,
  rows,
}: {
  draft: Pick<ParkedSlackDraft, "id" | "readThrough" | "tsIso">;
  rows: readonly unknown[];
}): RecordedEvidence {
  const watermark = releaseWatermark({ draft });
  if (watermark.isErr()) {
    return { kind: "moved", why: watermark.error.message };
  }
  // No identity is excluded: one of its own posts counted as a change can only refuse more, never hide one.
  const changes = conversationChanges({ rawMessages: rows, self: {}, watermark: watermark.value });
  const rewritten = [...changes.edited, ...changes.removed];
  if (rewritten.length > 0) {
    return {
      kind: "moved",
      why:
        `the conversation was edited or had messages removed since ${draft.id} was recorded (${rewritten.join(", ")}), ` +
        "so a Codex draft now could not see what the original saw",
    };
  }
  const { throughTs } = watermark.value;
  return {
    kind: "as-recorded",
    rows: rows.filter((row) => isRecord(row) && typeof row["ts"] === "string" && row["ts"] <= throughTs),
  };
}
