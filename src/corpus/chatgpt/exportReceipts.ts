/**
 * The receipts that say which held ChatGPT exports reached the corpus and the store whole —
 * `<root>/receipts/<sha256>.json`, written only once refresh AND the store took that export.
 *
 * A receipt is a separate fact from an import: `chatgpt sync` imports and then refreshes, and a crash between the two
 * would otherwise leave an imported export every later sync saw as "already have it" and stopped on. So sync refreshes
 * while any export is WITHOUT a receipt, and the receipts are the last thing it writes. A receipt never narrows what
 * the refresh reads: it weighs every held export (`exportStore.ts` § exportsToRead).
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";

/** A content hash's directory name. */
export const HASH_DIR = /^[0-9a-f]{64}$/;

const receiptSchema = z.strictObject({
  contentHash: z.string().regex(HASH_DIR),
  schemaVersion: z.literal(1),
  syncedAtIso: z.string(),
});

/**
 * A manifest or receipt — a few hundred bytes whose size the code here fixes — parsed, or `undefined` when it is
 * not JSON at all (which the schema read after it then refuses by name).
 *
 * @param text the file's whole text
 * @returns the parsed value, or `undefined` for text that is not JSON
 */
export function parseSmallJson({ text }: { text: string }): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Where one export's receipt sits. */
function receiptPath({ root, contentHash }: { root: string; contentHash: string }): string {
  return join(root, "receipts", `${contentHash}.json`);
}

/**
 * Whether an export already reached the corpus and the store whole. A receipt counts only as a regular file that
 * names this very export: one copied or linked in from another export's path reads as no receipt, so the export is
 * refreshed again rather than certified off rows it never wrote.
 *
 * @param root the managed export root
 * @param contentHash the export
 * @returns true when its receipt is a regular file on disk that reads and names this export
 */
export function hasReceipt({ root, contentHash }: { root: string; contentHash: string }): boolean {
  const path = receiptPath({ contentHash, root });
  let text: string;
  try {
    if (!lstatSync(path).isFile()) {
      return false;
    }
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const parsed = receiptSchema.safeParse(parseSmallJson({ text }));
  return parsed.success && parsed.data.contentHash === contentHash;
}

/**
 * Forget every receipt, so the next refresh reads every held export again — `chatgpt sync --replay`, after bronze or
 * the store was rebuilt. A receipted older export is otherwise never read again, and the chats the owner deleted before a
 * newer export live only in it. Removing a receipt only ever makes a pass read more, so a crash part-way is safe.
 *
 * @param root the managed export root
 * @returns how many receipts were removed, or why the receipts folder could not be cleared
 */
export function forgetReceipts({ root }: { root: string }): Result<number, ChatgptExportError> {
  const dir = join(root, "receipts");
  if (!existsSync(dir)) {
    return ok(0);
  }
  try {
    if (!lstatSync(dir).isDirectory()) {
      return err(
        ChatgptExportErrors.exportStoreFailed({
          cause: new Error("the receipts folder is not a folder, and nothing is removed through a link"),
          path: dir,
        }),
      );
    }
    const receipts = readdirSync(dir).filter((entry) => entry.endsWith(".json") && HASH_DIR.test(entry.slice(0, -5)));
    for (const entry of receipts) {
      rmSync(join(dir, entry), { force: true });
    }
    return ok(receipts.length);
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: dir }));
  }
}

/**
 * Record that an export reached the corpus and the store whole — the last thing `chatgpt sync` writes.
 *
 * @param root the managed export root
 * @param contentHash the export
 * @param nowIso the instant stamped as the sync time
 * @returns nothing, or why the receipt could not be written
 */
export function writeReceipt({
  root,
  contentHash,
  nowIso,
}: {
  root: string;
  contentHash: string;
  nowIso: string;
}): Result<void, ChatgptExportError> {
  const path = receiptPath({ contentHash, root });
  const body = JSON.stringify({ contentHash, schemaVersion: 1, syncedAtIso: nowIso });
  try {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
    if (lstatSync(dirname(path)).isSymbolicLink()) {
      return err(
        ChatgptExportErrors.exportStoreFailed({
          cause: new Error("the receipts folder is a symbolic link, and a receipt is never written through one"),
          path,
        }),
      );
    }
    // Renamed into place, so a symbolic link planted at the receipt's own path is replaced, never written through.
    writeFileAtomic({ contents: `${body}\n`, dirMode: 0o700, fileMode: 0o600, path });
    return ok(undefined);
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path }));
  }
}
