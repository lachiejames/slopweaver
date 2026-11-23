/**
 * The per-source side rows a batch writes beside its content rows, one statement per table, refreshed on
 * conflict. `./ingest.ts` calls it inside the batch's transaction; this module imports nothing back from there.
 */
import type { StoreWriter } from "./client.js";
import { excludedFor } from "./excludedSet.js";
import type { ProjectedRecord } from "./project.js";
import {
  contentGithubTable,
  contentLinearTable,
  contentNotionTable,
  contentSlackTable,
  type NewContentGithubRow,
  type NewContentLinearRow,
  type NewContentNotionRow,
  type NewContentSlackRow,
  type SOURCE_ROW_TABLES,
} from "./schema/sourceRows.js";

/**
 * Write every per-source side row for a batch, grouped so each table takes one statement.
 *
 * @param writer the transaction the batch is being written in
 * @param batch the projected records, paired with the content ids the database minted for them
 */
export async function writeSourceRows({
  writer,
  batch,
}: {
  writer: StoreWriter;
  batch: readonly { readonly contentId: string; readonly record: ProjectedRecord }[];
}): Promise<void> {
  const slack: NewContentSlackRow[] = [];
  const github: NewContentGithubRow[] = [];
  const linear: NewContentLinearRow[] = [];
  const notion: NewContentNotionRow[] = [];
  for (const { contentId, record } of batch) {
    const projected = record.sourceRow;
    if (projected?.source === "slack") {
      slack.push({ ...projected.row, contentId });
    }
    if (projected?.source === "github") {
      github.push({ ...projected.row, contentId });
    }
    if (projected?.source === "linear") {
      linear.push({ ...projected.row, contentId });
    }
    if (projected?.source === "notion") {
      notion.push({ ...projected.row, contentId });
    }
  }
  await upsertSourceRows({ rows: slack, table: contentSlackTable, writer });
  await upsertSourceRows({ rows: github, table: contentGithubTable, writer });
  await upsertSourceRows({ rows: linear, table: contentLinearTable, writer });
  await upsertSourceRows({ rows: notion, table: contentNotionTable, writer });
}

/**
 * Write one source's side rows, refreshing any that are already there.
 *
 * `on conflict do update` rather than `do nothing`: a re-ingest refreshes the content row, and `do
 * nothing` would leave the OLD side row beside it — the one shape where the two halves of a record could
 * disagree with each other.
 *
 * @param writer the transaction the batch is being written in
 * @param table which per-source table to write
 * @param rows the rows for it, possibly none
 */
async function upsertSourceRows<TRow extends { contentId: string }>({
  writer,
  table,
  rows,
}: {
  writer: StoreWriter;
  table: (typeof SOURCE_ROW_TABLES)[keyof typeof SOURCE_ROW_TABLES];
  rows: readonly TRow[];
}): Promise<void> {
  const first = rows[0];
  if (first === undefined) {
    return;
  }
  await writer
    .insert(table)
    .values([...rows])
    .onConflictDoUpdate({ set: excludedFor({ row: first }), target: table.contentId });
}
