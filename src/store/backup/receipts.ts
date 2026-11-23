/**
 * The receipt a send leaves in a staging directory for ONE destination, and what a receipt is read back as.
 *
 * With a list of destinations a staging can be in this Mac's folder and not on the SSD that was unplugged
 * tonight, so a receipt is per destination: `<staging>/receipts/<id>.json`, keyed by the destination's stable id
 * (`./destinationConfig.ts`). A staging written before the list existed carries one `upload-receipt.json`; it
 * still counts, but only for the destination its own `destination` field names — a receipt naming
 * `unreported`, a relative path, another root, or one that does not parse counts for nobody, so it can neither
 * strand nor release the wrong destination. When both shapes are present the per-destination one wins, and a
 * read never deletes either.
 *
 * A receipt's PRESENCE proves nothing: every reader here parses it, so a truncated file is no receipt.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "#lib/jsonFile.js";

import { localPathOfAddress } from "./destination.js";
import { type ConfiguredDestination, type DestinationId, destinationId } from "./destinationConfig.js";
import type { StoredObject } from "./transport.js";

/** The directory under a staging that holds one receipt per destination. */
export const RECEIPTS_DIRECTORY = "receipts";

/** A staging's single receipt beside its manifest, naming the one destination it reached in its own field. */
export const SINGLE_UPLOAD_RECEIPT_FILE = "upload-receipt.json";

/** How a destination's objects were encrypted: the object format, and which backup key — never the key. */
export interface ReceiptEncryption {
  readonly scheme: string;
  readonly keyFingerprint: string;
}

/** What one send landed, as its receipt records it. */
export interface UploadReceipt {
  /** The destination's configured root — the logical address its id is the hash of, never a probe's report. */
  readonly destination: string;
  readonly prefix: string;
  readonly uploadedAtIso: string;
  readonly encryption: ReceiptEncryption;
  readonly objects: readonly StoredObject[];
}

/**
 * The three fields a receipt is read back FOR, and no more.
 *
 * Deliberately not `.strict()`: this reads a file this module wrote, and the only reason to open it is to answer
 * "when did bytes last reach this destination, under which prefix". A schema demanding every field would turn a
 * receipt that gained one into a silent "never uploaded".
 */
const receiptEvidenceSchema = z.object({
  destination: z.string().min(1),
  prefix: z.string().min(1),
  uploadedAtIso: z.iso.datetime(),
});

/** What a receipt is read back as: where and when the bytes landed. */
export type ReceiptEvidence = z.infer<typeof receiptEvidenceSchema>;

/** Where bytes last reached one destination, read off the newest staging holding its receipt. */
export interface LastUpload extends ReceiptEvidence {
  readonly directory: string;
}

/** One configured destination and the newest upload evidenced for it on disk, or `null` when none is. */
export interface DestinationLastUpload {
  readonly destination: ConfiguredDestination;
  readonly upload: LastUpload | null;
}

/**
 * Where a staging keeps one destination's receipt.
 *
 * @param directory the staging directory
 * @param id the destination's stable id
 * @returns the receipt's path
 */
export function receiptPath({ directory, id }: { directory: string; id: DestinationId }): string {
  return join(directory, RECEIPTS_DIRECTORY, `${id}.json`);
}

/**
 * The receipt at `path`, when it parses and names the destination `id` is the hash of.
 *
 * @param path the receipt file
 * @param id the destination the caller is asking about
 * @returns the evidence, or `null` when the file is absent, malformed, or names another destination
 */
function evidenceFor({ path, id }: { path: string; id: DestinationId }): ReceiptEvidence | null {
  const parsed = receiptEvidenceSchema.safeParse(readJsonFile({ path }));
  if (!parsed.success) {
    return null;
  }
  const root = localPathOfAddress({ address: parsed.data.destination });
  if (root.isErr() || destinationId({ root: root.value }) !== id) {
    return null;
  }
  return parsed.data;
}

/**
 * The receipt proving a staging reached one destination: its own per-destination receipt, else a single
 * `upload-receipt.json` naming that same destination.
 *
 * @param directory the staging directory
 * @param id the destination's stable id
 * @returns the evidence, or `null` when no receipt there counts for this destination
 */
export function readReceipt({ directory, id }: { directory: string; id: DestinationId }): ReceiptEvidence | null {
  const current = evidenceFor({ id, path: receiptPath({ directory, id }) });
  if (current !== null) {
    return current;
  }
  return evidenceFor({ id, path: join(directory, SINGLE_UPLOAD_RECEIPT_FILE) });
}

/**
 * Write the receipt that says this staging's bytes are in one destination. Throws on a failed write, by design:
 * a receipt that silently did not land would leave a sent staging looking stranded, which is safe, but a caller
 * reporting success over it would not be.
 *
 * @param directory the staging directory
 * @param destination the destination the bytes reached
 * @param receipt what landed
 */
export function writeReceipt({
  directory,
  destination,
  receipt,
}: {
  directory: string;
  destination: ConfiguredDestination;
  receipt: UploadReceipt;
}): void {
  mkdirSync(join(directory, RECEIPTS_DIRECTORY), { mode: 0o700, recursive: true });
  writeJsonFile({ path: receiptPath({ directory, id: destination.id }), value: receipt });
}

/**
 * When bytes last reached each destination, read off the newest staging directory holding its receipt.
 *
 * Derived rather than recorded, and derivable because pruning keeps `keep` eligible stagings — so the newest
 * staging every destination holds is on disk by construction. This is what makes a red `--status` actionable per
 * destination: the SSD's last write and this Mac's are read independently.
 *
 * @param stagings every staging directory, oldest first — the names are instants, so lexical order is chronological
 * @param destinations the configured destinations, in list order
 * @returns one entry per destination, in list order
 */
export function lastUploadsOnDisk({
  stagings,
  destinations,
}: {
  stagings: readonly string[];
  destinations: readonly ConfiguredDestination[];
}): readonly DestinationLastUpload[] {
  return destinations.map((destination) => ({ destination, upload: newestUpload({ id: destination.id, stagings }) }));
}

/**
 * The newest staging holding a receipt that counts for one destination.
 *
 * @param stagings every staging directory, oldest first
 * @param id the destination's stable id
 * @returns that upload, or `null` when no staging evidences one
 */
function newestUpload({ stagings, id }: { stagings: readonly string[]; id: DestinationId }): LastUpload | null {
  for (const directory of stagings.toReversed()) {
    const evidence = readReceipt({ directory, id });
    if (evidence !== null) {
      return { ...evidence, directory };
    }
  }
  return null;
}
