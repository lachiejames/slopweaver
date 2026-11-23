/**
 * A record another register holds — a Datadog monitor, a Vanta control or risk — drawn as the chip `./inlineCitations.ts`
 * cites it with. A leaf of its own so the resolver stays under its line budget.
 */
import type { CitedRecord } from "../components/live/readRecords";
import type { InlineSegment } from "./inlineCitationsReferences";

/**
 * A record the board resolved, as the chip that opens it with its title on hover; `"words"` when the board knows no
 * such record, so the spelling stays as written and nothing inside it is read as anything else.
 *
 * @param label the spelling the chip keeps
 * @param record the board's record, when it has one
 * @returns the segment, or `"words"`
 */
export function citedRecord({
  label,
  record,
}: {
  label: string;
  record: CitedRecord | undefined;
}): InlineSegment | "words" {
  if (record === undefined) {
    return "words";
  }
  if (record.title === undefined) {
    return { kind: "cite", label, url: record.url };
  }
  return { kind: "cite", label, title: record.title, url: record.url };
}
