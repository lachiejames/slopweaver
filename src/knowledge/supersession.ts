/**
 * Which claims a later claim has retired — the pure half of `supersedes`. No I/O, no clock.
 *
 * ## The rule, once
 *
 * A claim is RETIRED when some recording naming it in `supersedes` is later than the claim's own latest
 * recording. "Later" is recorded order — `recorded_at`, then `seq` — the same order that already decides which
 * recording of one claim is current. So re-recording a retired claim afterwards brings it back, and a
 * regrade of the replacement (which names nothing) leaves the retirement standing, because the recording that
 * made it is still later than the claim it retired. `./types.ts`'s overview carries why the field exists.
 *
 * `./memoryStore.ts` applies the same rule in SQL for recall, because recall is a text search the database
 * runs; {@link retiredClaimIds} is the rule for the readers that walk every recording in code (`knowledge
 * list`, the quiz). Both are read against the same `(recorded_at, seq)` order, so they cannot disagree about
 * which recording is later.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { MemoryRecordingRow } from "../store/schema/memories.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import type { MemoryRecording } from "./memory.js";

/**
 * Whether a recording may retire the claim it names, given that claim's latest recording.
 *
 * @param row the recording about to be written, which names a claim in `supersedes`
 * @param target the named claim's latest recording, or the failure reading it
 * @returns ok, or the refusal naming why this claim cannot be retired by this recording
 */
export function supersessionCheck({
  row,
  target,
}: {
  row: MemoryRecording;
  target: Result<MemoryRecordingRow, KnowledgeError>;
}): Result<true, KnowledgeError> {
  const supersedes = row.supersedes!;
  if (target.isErr()) {
    if (target.error.code === "MEMORY_UNKNOWN") {
      return err(
        KnowledgeErrors.supersedesRefused({
          supersedes,
          why: "no recording carries that claim id — copy it from `slopweaver knowledge recall`",
        }),
      );
    }
    return err(target.error);
  }
  if (target.value.kind !== row.kind) {
    return err(
      KnowledgeErrors.supersedesRefused({
        supersedes,
        why: `it is a ${target.value.kind}, and a ${row.kind} retires only another ${row.kind}`,
      }),
    );
  }
  return ok(true);
}

/**
 * Every claim id a later recording has retired.
 *
 * @param rows every recording, in recorded order — oldest first, as `./memoryStore.ts`'s readers return them
 * @returns the retired claim ids
 */
export function retiredClaimIds({
  rows,
}: {
  rows: readonly { readonly id: string; readonly supersedes?: string }[];
}): ReadonlySet<string> {
  const lastIndex = new Map<string, number>();
  rows.forEach((row, index) => {
    lastIndex.set(row.id, index);
  });
  const retired = new Set<string>();
  rows.forEach((row, index) => {
    if (row.supersedes === undefined) {
      return;
    }
    const targetLast = lastIndex.get(row.supersedes);
    if (targetLast === undefined || index > targetLast) {
      retired.add(row.supersedes);
    }
  });
  return retired;
}

/**
 * The recordings whose claim is still current — every recording of a retired claim dropped.
 *
 * @param rows every recording, in recorded order
 * @returns the same rows, in the same order, minus every recording of a retired claim
 */
export function withoutRetired<Row extends { readonly id: string; readonly supersedes?: string }>({
  rows,
}: {
  rows: readonly Row[];
}): readonly Row[] {
  const retired = retiredClaimIds({ rows });
  return rows.filter((row) => !retired.has(row.id));
}
