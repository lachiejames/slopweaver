/**
 * The instant `chatgpt sync` last certified the corpus's ChatGPT current as of — `<root>/as-of.json`, written by
 * every sync that succeeds (exit 0 or 3) and read by the scheduled resync that ran it.
 *
 * **Why a sync's success is not its own clock.** A scheduled resync stamps the verified-sync clock the freshness page
 * judges, and stamping the attempt's FINISH time would let a 3 from a day-old export hold the page current for almost
 * another day — or a 0 that only filled in an older straggler renew it outright. So the resync stamps the instant
 * the export itself is current as of (`exportFreshness.ts#currentAsOfIso`), which only the sync knows: it alone saw
 * which archives this pass took in and when their files were written.
 *
 * **Bound to its export.** The record names the export it dates, and is believed only while that export is still
 * the newest held: one left behind by a sync before a newer export arrived dates nothing.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";
import { HASH_DIR, parseSmallJson } from "./exportReceipts.js";
import { heldExports } from "./exportStore.js";

const asOfSchema = z.strictObject({
  asOfIso: z.string().min(1),
  contentHash: z.string().regex(HASH_DIR),
  schemaVersion: z.literal(1),
});

/** Where the record sits. */
function asOfPath({ root }: { root: string }): string {
  return join(root, "as-of.json");
}

/**
 * Record the instant a sync certified the corpus current as of — the last thing a succeeding sync writes.
 *
 * @param root the managed export root
 * @param contentHash the newest held export, the one the instant dates
 * @param asOfIso the instant its corpus is current as of
 * @returns nothing, or why the record could not be written
 */
export function writeCertifiedAsOf({
  root,
  contentHash,
  asOfIso,
}: {
  root: string;
  contentHash: string;
  asOfIso: string;
}): Result<void, ChatgptExportError> {
  const path = asOfPath({ root });
  try {
    // Renamed into place, so a link planted at the path is replaced, never written through.
    writeFileAtomic({
      contents: `${JSON.stringify({ asOfIso, contentHash, schemaVersion: 1 })}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
    return ok(undefined);
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path }));
  }
}

/**
 * The instant the last succeeding sync certified, believed only while the export it names is still the newest held.
 *
 * @param root the managed export root
 * @returns the instant, or why there is none to believe
 */
export function readCertifiedAsOf({ root }: { root: string }): Result<string, ChatgptExportError> {
  const path = asOfPath({ root });
  let text: string;
  try {
    if (!lstatSync(path).isFile()) {
      return err(ChatgptExportErrors.asOfUnreadable({ detail: "not a regular file", path }));
    }
    text = readFileSync(path, "utf8");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(ChatgptExportErrors.asOfUnreadable({ detail, path }));
  }
  const parsed = asOfSchema.safeParse(parseSmallJson({ text }));
  if (!parsed.success) {
    return err(ChatgptExportErrors.asOfUnreadable({ detail: parsed.error.message, path }));
  }
  const [newest] = heldExports({ root }).exports;
  if (newest === undefined || newest.contentHash !== parsed.data.contentHash) {
    return err(
      ChatgptExportErrors.asOfUnreadable({
        detail: `it dates export ${parsed.data.contentHash.slice(0, 12)}, which is not the newest held`,
        path,
      }),
    );
  }
  return ok(parsed.data.asOfIso);
}
