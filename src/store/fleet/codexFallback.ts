/**
 * The store rows of one Claude fallback request: built for the port's own writes (`src/codex/fallbackPort.ts`)
 * and for the one-time import of a legacy `$SLOPWEAVER_HOME/codex-fallback/<requestId>/` directory.
 *
 * Pure: the request id and the two documents' texts in; rows or a typed refusal out. The table header
 * (`../schema/codexFallback.ts`) says why both documents are stored as the text that was on disk and why the
 * packets are not stored at all.
 *
 * Nothing about a request's CONTENT can refuse it here. A request whose JSON is broken is still stored,
 * verbatim, because the reader (`src/codex/fallbackDocuments.ts`) is the one that decides what a broken
 * request means — and it fails closed on one, which it could not do on a request that never arrived.
 * The columns beside the text are read best-effort for a person filtering rows, and a missing one is NULL.
 * The refusals are a document that cannot be stored verbatim: bytes that are not valid UTF-8, which a lenient
 * decode would silently replace, and a NUL byte, which `text` cannot carry and stripping would change the
 * bytes a receipt's digest binds to.
 */
import { createHash } from "node:crypto";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  FALLBACK_READER_EPOCH,
  type NewCodexFallbackReceiptRecord,
  type NewCodexFallbackRequestRecord,
} from "../schema/codexFallback.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";

/** One directory's rows: the request always, the receipt when one was recorded. */
export interface ProjectedFallbackRequest {
  readonly request: NewCodexFallbackRequestRecord;
  readonly receipt: NewCodexFallbackReceiptRecord | undefined;
}

/** Lower-case hex sha-256 of a text's UTF-8 bytes. */
function sha256Hex({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The longest filter value kept, in UTF-16 code units. The filter columns are B-tree indexed, and Postgres
 * refuses an index entry past about 2704 bytes; 512 code units is at most 1536 UTF-8 bytes, and no real
 * branch or checkout path comes near it. A longer value is NULL rather than a refused statement, because one
 * odd document must never fail the batch every other request rides in.
 */
const MAX_FILTER_TEXT = 512;

/** A field read as a non-empty string no longer than {@link MAX_FILTER_TEXT}, or `null`. */
function nullableText({ value }: { value: unknown }): string | null {
  if (typeof value === "string" && value.length > 0 && value.length <= MAX_FILTER_TEXT) {
    return value;
  }
  return null;
}

/**
 * An ISO instant read as a date, or `null` when it is absent, does not parse, or falls outside years 1 to
 * 9999. JavaScript accepts instants `timestamptz` cannot hold (`-010000-01-01T00:00:00.000Z` parses), and
 * such a value would fail the whole insert for a column that is only a filter.
 */
function nullableInstant({ value }: { value: unknown }): Date | null {
  const text = nullableText({ value });
  if (text === null) {
    return null;
  }
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  const year = at.getUTCFullYear();
  return year >= 1 && year <= 9999 ? at : null;
}

/** The request's filter columns, read best-effort from text that may not even be JSON. */
function requestColumns({
  requestText,
}: {
  requestText: string;
}): Pick<NewCodexFallbackRequestRecord, "branch" | "createdAt" | "mode" | "pass" | "repoRoot"> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(requestText);
  } catch {
    return { branch: null, createdAt: null, mode: null, pass: null, repoRoot: null };
  }
  if (!isRecord(decoded)) {
    return { branch: null, createdAt: null, mode: null, pass: null, repoRoot: null };
  }
  const tree = decoded["tree"];
  return {
    branch: isRecord(tree) ? nullableText({ value: tree["branch"] }) : null,
    createdAt: nullableInstant({ value: decoded["createdAtIso"] }),
    mode: nullableText({ value: decoded["mode"] }),
    pass: nullableText({ value: decoded["pass"] }),
    repoRoot: nullableText({ value: decoded["repoRoot"] }),
  };
}

/**
 * A legacy document's bytes as the text a row stores, or a refusal when they are not valid UTF-8. A lenient
 * decode turns a malformed byte into U+FFFD, so the store would hold, and the read-back would agree with, a
 * text that was never on disk. A byte-order mark is kept, because it is one of the bytes.
 *
 * @param bytes the file's exact contents
 * @param path the file, carried into a refusal so the operator can go and look
 * @returns the decoded text, or the typed reason it cannot be stored verbatim
 */
export function decodeFallbackDocument({
  bytes,
  path,
}: {
  bytes: Uint8Array;
  path: string;
}): Result<string, FleetImportError> {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return err(FleetImportErrors.unstorableFallbackDocument({ path, reason: "it is not valid UTF-8" }));
  }
}

/**
 * Project one fallback directory's texts into the rows an insert takes.
 *
 * @param requestId the directory's name, which is the request id and both rows' key
 * @param requestText `request.json`'s exact text
 * @param receiptText `receipt.json`'s exact text, or `undefined` for a request never answered
 * @param path the directory, carried into a refusal so the operator can go and look
 * @returns the rows, or the typed reason the store cannot hold them verbatim
 */
export function projectFallbackRequest({
  requestId,
  requestText,
  receiptText,
  path,
}: {
  requestId: string;
  requestText: string;
  receiptText: string | undefined;
  path: string;
}): Result<ProjectedFallbackRequest, FleetImportError> {
  if (requestText.includes("\u0000") || receiptText?.includes("\u0000") === true) {
    return err(FleetImportErrors.unstorableFallbackDocument({ path, reason: "it holds a NUL byte" }));
  }
  const request = fallbackRequestRow({ requestId, requestText });
  if (receiptText === undefined) {
    return ok({ receipt: undefined, request });
  }
  return ok({ receipt: fallbackReceiptRow({ receiptText, requestId }), request });
}

/**
 * Every legacy document whose text differs from the row the store holds under its id, read back after the
 * import's `DO NOTHING` insert. The stored row is the authority, so a difference is reported, never repaired.
 *
 * A receipt the store holds that the legacy directory does not is NOT a divergence: the request was answered
 * after the import, through the store, which is exactly the authority working. A legacy receipt the store
 * lacks cannot happen after a successful insert and would be reported as one.
 *
 * @param projected each legacy directory's rows, as the import tried to write them
 * @param stored the rows the store holds, keyed by request id
 * @param pathOf the legacy directory of a request id, carried into the refusal so the operator can go and look
 * @returns one refusal per diverging document, in the projection's order
 */
export function fallbackImportDivergences({
  projected,
  stored,
  pathOf,
}: {
  projected: readonly ProjectedFallbackRequest[];
  stored: ReadonlyMap<string, { readonly requestText: string; readonly receiptText: string | null }>;
  pathOf: ({ requestId }: { requestId: string }) => string;
}): readonly FleetImportError[] {
  const diverged: FleetImportError[] = [];
  for (const one of projected) {
    const { requestId } = one.request;
    const row = stored.get(requestId);
    const path = pathOf({ requestId });
    if (row?.requestText !== one.request.requestText) {
      diverged.push(FleetImportErrors.fallbackImportDiverged({ document: "request", path, requestId }));
    }
    if (one.receipt !== undefined && row?.receiptText !== one.receipt.receiptText) {
      diverged.push(FleetImportErrors.fallbackImportDiverged({ document: "receipt", path, requestId }));
    }
  }
  return diverged;
}

/**
 * The request row an insert takes: the exact text, its digest, the best-effort filter columns and this
 * build's reader epoch (`../schema/codexFallback.ts` § "The reader epoch"). The caller has already refused a
 * text Postgres cannot hold.
 *
 * @param requestId the request id, the row's key
 * @param requestText the request's exact text
 * @returns the row
 */
export function fallbackRequestRow({
  requestId,
  requestText,
}: {
  requestId: string;
  requestText: string;
}): NewCodexFallbackRequestRecord {
  return {
    ...requestColumns({ requestText }),
    readerEpoch: FALLBACK_READER_EPOCH,
    requestId,
    requestSha256: sha256Hex({ text: requestText }),
    requestText,
  };
}

/**
 * The receipt row an insert takes: the exact text and its digest.
 *
 * @param requestId the request the receipt answers, the row's key
 * @param receiptText the receipt's exact text
 * @returns the row
 */
export function fallbackReceiptRow({
  requestId,
  receiptText,
}: {
  requestId: string;
  receiptText: string;
}): NewCodexFallbackReceiptRecord {
  return { receiptSha256: sha256Hex({ text: receiptText }), receiptText, requestId };
}
