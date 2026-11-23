/**
 * The exported line for one recording and one recall — the shape `knowledge export` writes, `knowledge
 * restore --file` reads, and a store export carries byte for byte. One definition, so the two exports can
 * never write the same register two ways. Pure.
 */
import type { MemoryRecordingRow } from "../store/schema/memories.js";
import type { MemoryRecallRow } from "../store/schema/memoryRecalls.js";

/**
 * One exported recording line.
 *
 * `searchable` is the ONLY column dropped, because Postgres generates it and an insert naming it is
 * refused. `createdAt` is written and restored rather than regenerated: it is one of the terms that orders
 * two recordings of one claim sharing an instant, so letting a restore default it would change what the
 * register believes. `seq` rides out the same way and is what recall actually orders
 * by; `./restore.ts` carries the rest.
 *
 * @param row one recording as the database returned it
 * @returns the line to write, without its newline
 */
export function exportedMemoryLine({ row }: { row: MemoryRecordingRow }): string {
  const { searchable, ...rest } = row;
  void searchable;
  return JSON.stringify({
    ...rest,
    createdAt: row.createdAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  });
}

/**
 * One exported recall line. Both instants go out as ISO strings, exactly as a recording's do.
 *
 * @param row one recall as the database returned it
 * @returns the line to write, without its newline
 */
export function exportedRecallLine({ row }: { row: MemoryRecallRow }): string {
  return JSON.stringify({ ...row, createdAt: row.createdAt.toISOString(), recordedAt: row.recordedAt.toISOString() });
}
