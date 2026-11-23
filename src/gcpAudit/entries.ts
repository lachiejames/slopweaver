/**
 * Entry paging: every `entries:list` batch read to its last page, each entry trimmed and written as it arrives.
 * A 403 on a batch's first page is bisected until the refused container is isolated, so one private project
 * costs only its own logs; any other failure stops the pull, because a generation missing pages it does not
 * know about would call itself complete.
 */
import { err, ok, type Result } from "#lib/result.js";

import { call, nextPageToken, pageTokenField, refusal } from "./call.js";
import type { GcpAuditError } from "./errors.js";
import { batchEntryBodies, viewsOf } from "./filter.js";
import type { GcpAuditManifest, GcpBucketFact, GcpEntriesWriter, GcpRefusalFact } from "./store.js";
import type { EntriesListBody, GcpAuditSend, GcpContainer } from "./transport.js";
import { trimAuditEntry } from "./trim.js";
import { type GcpLogEntryWire, LIST_ENTRIES } from "./wire.js";

/**
 * How often a batch reports mid-scan. Logging answers EMPTY pages carrying a token while it scans a long window,
 * so a batch over a long-retention bucket can run many minutes before its first entry — silence there reads as
 * a hang.
 */
const PROGRESS_EVERY_PAGES = 25;

/** Pages read and entries written. */
interface EntryTally {
  readonly pages: number;
  readonly entries: number;
}

/** What paging one body needs: where entries go, where a refusal is recorded, and who hears progress. */
interface PagingSinks {
  readonly send: GcpAuditSend;
  readonly writer: GcpEntriesWriter;
  readonly refusals: GcpRefusalFact[];
  readonly progress: (line: string) => void;
}

/** Every batch's outcome, and the containers that refused their logs. */
export interface GcpEntriesRead {
  readonly batches: GcpAuditManifest["batches"];
  readonly entriesWritten: number;
  readonly entryRefusals: readonly GcpRefusalFact[];
}

/**
 * Trim and write one page's entries, in order.
 *
 * @param wire the page's entries as the boundary validated them; absent on an empty page
 * @param writer where entries go
 * @returns how many were written and the last one's timestamp, or the trim failure that stopped the page
 */
function writePage({
  wire,
  writer,
}: {
  wire: readonly GcpLogEntryWire[] | undefined;
  writer: GcpEntriesWriter;
}): Result<{ written: number; reached: string | undefined }, GcpAuditError> {
  // Logging omits `entries` on a page that scanned and found nothing: nothing to write, not an unknown.
  if (wire === undefined) {
    return ok({ reached: undefined, written: 0 });
  }
  let written = 0;
  let reached: string | undefined;
  for (const entry of wire) {
    const trimmed = trimAuditEntry({ entry });
    if (trimmed.isErr()) {
      return err(trimmed.error);
    }
    writer.append({ entry: trimmed.value });
    written += 1;
    reached = trimmed.value.timestamp;
  }
  return ok({ reached, written });
}

/**
 * The mid-scan progress line, by timestamp only — never a caller IP or a resource name.
 *
 * @param pages pages read so far in this body
 * @param entries entries written so far in this body
 * @param reached the newest timestamp on the latest page, when it held any entry
 * @returns the line
 */
function progressLine({ pages, entries, reached }: EntryTally & { reached: string | undefined }): string {
  const through = reached === undefined ? "" : `, through ${reached}`;
  return `  …${String(pages)} page(s), ${String(entries)} entr(ies) so far${through}`;
}

/**
 * Split a body Google refused on its first page, and page each half; a single container is the refusal itself.
 *
 * @param body the refused batch
 * @param error the refusal, recorded against the isolated container
 * @returns pages read and entries written across both halves
 */
async function bisectRefused({
  body,
  error,
  sinks,
}: {
  body: EntriesListBody;
  error: GcpAuditError;
  sinks: PagingSinks;
}): Promise<Result<EntryTally, GcpAuditError>> {
  if (body.resourceNames.length === 1) {
    sinks.refusals.push(refusal({ error, what: body.resourceNames[0]! }));
    return ok({ entries: 0, pages: 0 });
  }
  const half = Math.ceil(body.resourceNames.length / 2);
  let total: EntryTally = { entries: 0, pages: 0 };
  for (const resourceNames of [body.resourceNames.slice(0, half), body.resourceNames.slice(half)]) {
    const side = await pageEntries({ body: { ...body, resourceNames }, sinks });
    if (side.isErr()) {
      return err(side.error);
    }
    total = { entries: total.entries + side.value.entries, pages: total.pages + side.value.pages };
  }
  return ok(total);
}

/**
 * Page one `entries:list` body to the end, writing each entry as it arrives. A 403 on the first page is
 * bisected until the refused container is isolated.
 *
 * @param body the batch
 * @param sinks the sender, the writer, the refusal list and the progress line, told every
 *   {@link PROGRESS_EVERY_PAGES} pages how far the scan has reached
 * @returns pages read and entries written across the batch and every bisected half
 */
async function pageEntries({
  body,
  sinks,
}: {
  body: EntriesListBody;
  sinks: PagingSinks;
}): Promise<Result<EntryTally, GcpAuditError>> {
  let pages = 0;
  let entries = 0;
  let pageToken: string | undefined;
  do {
    const page = await call({
      boundary: LIST_ENTRIES,
      request: { body: { ...body, ...pageTokenField({ pageToken }) }, kind: "list-entries" },
      send: sinks.send,
    });
    if (page.isErr()) {
      const forbidden = page.error.code === "TRANSPORT_FAILED" && page.error.status === 403 && pages === 0;
      if (!forbidden) {
        return err(page.error);
      }
      return bisectRefused({ body, error: page.error, sinks });
    }
    pages += 1;
    const written = writePage({ wire: page.value.entries, writer: sinks.writer });
    if (written.isErr()) {
      return err(written.error);
    }
    entries += written.value.written;
    if (pages % PROGRESS_EVERY_PAGES === 0) {
      sinks.progress(progressLine({ entries, pages, reached: written.value.reached }));
    }
    pageToken = nextPageToken({ next: page.value.nextPageToken });
  } while (pageToken !== undefined);
  return ok({ entries, pages });
}

/**
 * How many buckets the inventory saw in each container, which is what a batch's view budget is charged on.
 *
 * @param buckets every bucket fact
 * @returns the count per container
 */
function bucketsPerContainer({ buckets }: { buckets: readonly GcpBucketFact[] }): ReadonlyMap<string, number> {
  const held = new Map<string, number>();
  for (const bucket of buckets) {
    const before = held.get(bucket.container);
    held.set(bucket.container, before === undefined ? 1 : before + 1);
  }
  return held;
}

/**
 * Read every batch of every container's entries into the open writer, one batch at a time.
 *
 * @param filter the audit filter every batch carries
 * @param containers every container discovery kept
 * @param buckets the inventory's buckets, which set each container's view cost
 * @param send the sender
 * @param writer the generation's open entries file; the caller closes it
 * @param progress told each batch's outcome, and every few pages within one
 * @returns each batch's outcome, or the failure that stopped the pull
 */
export async function readEntryBatches({
  filter,
  containers,
  buckets,
  send,
  writer,
  progress,
}: {
  filter: string;
  containers: readonly GcpContainer[];
  buckets: readonly GcpBucketFact[];
  send: GcpAuditSend;
  writer: GcpEntriesWriter;
  progress: (line: string) => void;
}): Promise<Result<GcpEntriesRead, GcpAuditError>> {
  const held = bucketsPerContainer({ buckets });
  const views = ({ container }: { container: GcpContainer }): number => {
    const count = held.get(container);
    // A container the inventory listed no bucket in is charged as holding none.
    if (count === undefined) {
      return viewsOf({ buckets: 0 });
    }
    return viewsOf({ buckets: count });
  };
  const sinks: PagingSinks = { progress, refusals: [], send, writer };
  const batches: GcpAuditManifest["batches"] = [];
  let entriesWritten = 0;
  for (const body of batchEntryBodies({ filter, resources: containers, views })) {
    const read = await pageEntries({ body, sinks });
    if (read.isErr()) {
      return err(read.error);
    }
    batches.push({ entries: read.value.entries, pages: read.value.pages, resourceCount: body.resourceNames.length });
    entriesWritten += read.value.entries;
    progress(
      `batch ${String(batches.length)}: ${String(read.value.entries)} entr(ies) over ${String(read.value.pages)} page(s)`,
    );
  }
  return ok({ batches, entriesWritten, entryRefusals: sinks.refusals });
}
