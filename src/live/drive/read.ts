/**
 * The Drive READ document builders — `drive list`, `drive read` and `drive drives` — shaped exactly like
 * every other named-object reader in `src/live`: a bounded read, a `readAtIso`, and a coverage block that
 * says what the read did NOT establish.
 *
 * ## Residue is the point, not decoration
 *
 * A Drive is the source where "here is what I found" reads most convincingly as "here is everything", and
 * it is never everything. A listing is one page of a cursor. A search of My Drive does not see a shared
 * drive's files at all — Google treats those as separate corpora, so an absent file is routinely a
 * different-corpus file rather than a missing one. A file the owner can open in a browser may still be
 * unreadable through the API if the grant is metadata-only. And a binary file's bytes are deliberately left
 * on Google's servers. Each of those becomes a residue line, so a caller that renders the document cannot
 * accidentally present a page as a total.
 *
 * Effectful only through the injected {@link ./api.DriveApi} and the injected clock, so every builder is
 * unit tested against plain fakes.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import type { DriveApi } from "./api.js";
import type { DriveError } from "./errors.js";
import { type DriveFile, isFolder, type SharedDrive, TEXT_EXPORTS } from "./files.js";

/** The largest page `drive list` will ask Drive for in one call — Google's own maximum for `files.list`. */
export const MAX_LIST_LIMIT = 100;

/** The default page size when the caller names none. */
export const DEFAULT_LIST_LIMIT = 25;

/** The payload of a `drive list` document. */
interface DriveListing {
  readonly account: string;
  readonly query: string | undefined;
  /** The shared drive the search was restricted to, absent for the account's own My Drive. */
  readonly driveId: string | undefined;
  readonly files: readonly DriveFile[];
  /** Whether Drive said more files match than this one page read. */
  readonly more: boolean;
}

/** A listing read: the shared document AND the typed payload, so a caller never re-narrows `data`. */
export interface DriveListingResult {
  readonly document: ProviderReadDocument;
  readonly listing: DriveListing;
}

/** The residue lines a listing always owes its reader. */
function listingResidue({
  nextPageToken,
  driveId,
  read,
}: {
  nextPageToken: string | undefined;
  driveId: string | undefined;
  read: number;
}): readonly string[] {
  const residue: string[] = [];
  if (nextPageToken !== undefined) {
    residue.push(`more files match — this is one page of ${String(read)}, not the whole result`);
  }
  if (driveId === undefined) {
    residue.push(
      "this searched the account's own My Drive and the files shared with it; a SHARED DRIVE is a separate " +
        "corpus and was not searched — list them with `drive drives` and pass --drive <id>",
    );
  }
  residue.push("file CONTENT is not read by a listing — use `drive read <id>` for one file");
  return residue;
}

/**
 * The address a listing's target names. A listing with no condition at all — trashed files asked for, no
 * folder, no query of the caller's own — sends Drive no `q`, and its target says that rather than going blank.
 */
function listingAddress({ query }: { query: string | undefined }): string {
  if (query === undefined) {
    return "(no query)";
  }
  return query;
}

/**
 * List the files matching a query, most-recently-modified first as Drive returns them.
 *
 * @param api the injected Drive seam
 * @param account the account the grant bound to
 * @param query the fully-built Drive `q` expression, or undefined for no condition at all
 * @param driveId the shared drive to search instead of My Drive
 * @param limit how many files to read, capped at {@link MAX_LIST_LIMIT}
 * @param nowIso the read timestamp source
 * @returns the listing document and its typed payload, or the typed reason the read failed
 */
export async function readDriveListing({
  api,
  account,
  query,
  driveId,
  limit,
  nowIso,
}: {
  api: DriveApi;
  account: string;
  query: string | undefined;
  driveId: string | undefined;
  limit: number;
  nowIso: () => string;
}): Promise<Result<DriveListingResult, DriveError>> {
  const page = await api.listFiles({ driveId, limit: Math.min(limit, MAX_LIST_LIMIT), query });
  if (page.isErr()) {
    return err(page.error);
  }
  const data: DriveListing = {
    account,
    driveId,
    files: page.value.files,
    more: page.value.nextPageToken !== undefined,
    query,
  };
  const folders = page.value.files.filter((file) => isFolder({ file })).length;
  return ok({
    document: {
      coverage: {
        detail:
          `${String(page.value.files.length)} file(s) read as metadata only ` +
          `(${String(folders)} of them folders), capped at ${String(limit)}`,
        kind: "bounded",
        residue: listingResidue({
          driveId,
          nextPageToken: page.value.nextPageToken,
          read: page.value.files.length,
        }),
      },
      data,
      readAtIso: nowIso(),
      source: "drive",
      target: {
        address: listingAddress({ query }),
        identity: account,
        kind: driveId === undefined ? "search" : `search in drive ${driveId}`,
      },
    },
    listing: data,
  });
}

/** The payload of a `drive read` document. */
interface DriveFileRead {
  readonly account: string;
  readonly file: DriveFile;
  /** The exported text, absent when the file has no text export or none was asked for. */
  readonly text: string | undefined;
}

/** A file read: the shared document AND the typed payload. */
export interface DriveFileResult {
  readonly document: ProviderReadDocument;
  readonly payload: DriveFileRead;
}

/**
 * Read one file's metadata, and its text when it is a Google-native document.
 *
 * A file whose type has no text export is NOT a failure: the metadata is returned, `text` is `undefined`,
 * and the residue says in as many words that the bytes were left on Google's servers. That distinction is
 * the reason {@link ./errors.ExportUnsupportedError} exists as its own variant — most of a real Drive is
 * binary, and a verb that errored on every PNG would be useless.
 *
 * @param api the injected Drive seam
 * @param account the account the grant bound to
 * @param fileId the file to read, already extracted from whatever address the caller supplied
 * @param withText whether to attempt a text export at all
 * @param nowIso the read timestamp source
 * @returns the read document and its typed payload, or the typed reason the read failed
 */
export async function readDriveFile({
  api,
  account,
  fileId,
  withText,
  nowIso,
}: {
  api: DriveApi;
  account: string;
  fileId: string;
  withText: boolean;
  nowIso: () => string;
}): Promise<Result<DriveFileResult, DriveError>> {
  const fetched = await api.getFile({ id: fileId });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  const file = fetched.value;
  const exported = await exportedText({ api, file, withText });
  if (exported.isErr()) {
    return err(exported.error);
  }
  const data: DriveFileRead = { account, file, text: exported.value };
  return ok({
    document: {
      coverage: {
        detail:
          exported.value === undefined
            ? "one file, metadata only"
            : `one file, metadata plus ${String(exported.value.length)} characters of exported text`,
        kind: "bounded",
        residue: fileResidue({ file, text: exported.value, withText }),
      },
      data,
      readAtIso: nowIso(),
      source: "drive",
      target: { address: fileId, identity: account, kind: isFolder({ file }) ? "folder" : "file" },
    },
    payload: data,
  });
}

/**
 * The text of a file, when one was asked for and the type has an export.
 *
 * An `EXPORT_UNSUPPORTED` refusal is turned back into "no text", because that is what it means to a reader:
 * the file is fine, it simply is not a document. Every OTHER export failure — a revoked grant, a 500, a
 * network fault — is propagated, because those are the cases where silently reporting no text would be a
 * lie about a file that has some.
 */
async function exportedText({
  api,
  file,
  withText,
}: {
  api: DriveApi;
  file: DriveFile;
  withText: boolean;
}): Promise<Result<string | undefined, DriveError>> {
  if (!withText || file.mimeType === undefined || TEXT_EXPORTS[file.mimeType] === undefined) {
    return ok(undefined);
  }
  const exported = await api.exportText({ id: file.id, mimeType: file.mimeType });
  if (exported.isErr()) {
    return exported.error.code === "EXPORT_UNSUPPORTED" ? ok(undefined) : err(exported.error);
  }
  return ok(exported.value);
}

/** The residue lines a single-file read always owes its reader. */
function fileResidue({
  file,
  text,
  withText,
}: {
  file: DriveFile;
  text: string | undefined;
  withText: boolean;
}): readonly string[] {
  const residue: string[] = [];
  if (isFolder({ file })) {
    residue.push("this is a FOLDER — its contents were not listed; use `drive list --folder <id>`");
  }
  if (!withText) {
    residue.push("content was not requested — re-read without --metadata-only to export a document's text");
  }
  if (withText && text === undefined && !isFolder({ file })) {
    residue.push(
      `${file.mimeType ?? "this file"} has no text export, so its BYTES were left on Google's servers and ` +
        "nothing here reflects its content",
    );
  }
  if (file.trashed) {
    residue.push("this file is in the TRASH — it is still readable, but it is not live");
  }
  return residue;
}

/** The payload of a `drive drives` document. */
interface DriveVocabulary {
  readonly account: string;
  readonly drives: readonly SharedDrive[];
}

/** A shared-drive read: the shared document AND the typed payload. */
export interface DriveDrivesResult {
  readonly document: ProviderReadDocument;
  readonly vocabulary: DriveVocabulary;
}

/**
 * Read the shared drives this account can see — the ids a `--drive` restriction is written in.
 *
 * This exists for the same reason `gmail labels` does: the API takes an ID and the interface shows a NAME,
 * and a person asked to supply one while looking at the other guesses.
 *
 * @param api the injected Drive seam
 * @param account the account the grant bound to
 * @param capped how many the seam asked for, so the coverage can say whether the answer could be truncated
 * @param nowIso the read timestamp source
 * @returns the shared-drive document and its typed payload, or the typed reason the read failed
 */
export async function readDriveDrives({
  api,
  account,
  capped,
  nowIso,
}: {
  api: DriveApi;
  account: string;
  capped: number;
  nowIso: () => string;
}): Promise<Result<DriveDrivesResult, DriveError>> {
  const drives = await api.listDrives();
  if (drives.isErr()) {
    return err(drives.error);
  }
  const data: DriveVocabulary = { account, drives: drives.value };
  const residue: string[] = [
    "My Drive is not a shared drive and has no id — it is what `drive list` searches when --drive is absent",
  ];
  if (drives.value.length >= capped) {
    residue.push(`exactly ${String(capped)} came back, which is the cap — there may be more`);
  }
  return ok({
    document: {
      coverage: {
        detail: `${String(drives.value.length)} shared drive(s) this account can see`,
        kind: "bounded",
        residue,
      },
      data,
      readAtIso: nowIso(),
      source: "drive",
      target: { address: "drives", identity: account, kind: "drives" },
    },
    vocabulary: data,
  });
}
