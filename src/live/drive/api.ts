/**
 * The Drive API SEAM — the narrow set of calls the door's read verbs make, and the production
 * implementation that routes each one through the paced provider door.
 *
 * The seam is deliberately smaller than `drive_v3`. A verb asks for "the files matching this query" or
 * "this file's text"; it does not get a whole SDK surface to reach into, which is what keeps the document
 * builders in `read.ts` pure enough to test with plain object fakes instead of a live Drive.
 *
 * ## `fields` is not an optimisation here, it is the contract
 *
 * Drive's `files.list` returns `id`, `name` and `mimeType` and NOTHING else unless the request names the
 * fields it wants. Owners, sizes, timestamps and parents are all absent by default, silently — a listing
 * built without a `fields` mask reads as a Drive where no file has an owner or a date. So every call below
 * names its mask explicitly, and {@link FILE_FIELDS} is the single place that list lives.
 */
import type { drive_v3 } from "@googleapis/drive";

import { absentAsEmpty } from "#lib/absent.js";
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type DriveError, DriveErrors } from "./errors.js";
import { type DriveFile, reduceFile, reduceSharedDrive, type SharedDrive, TEXT_EXPORTS } from "./files.js";

/**
 * The file fields every call asks for. Named once, because a mask that drifts between the listing and the
 * single read is a difference nothing would report — both would succeed, carrying different facts.
 */
const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,owners(emailAddress),parents,webViewLink,driveId,trashed,shared";

/**
 * How many shared drives one `drives.list` call asks for. Google's own maximum page size, so an account
 * inside it gets the complete vocabulary in one call and one past it is reported as truncated rather than
 * silently cut.
 */
export const MAX_SHARED_DRIVES = 100;

/** One page of files matching a query, plus the cursor Drive gave for the next page (if any). */
interface DriveFilePage {
  readonly files: readonly DriveFile[];
  readonly nextPageToken: string | undefined;
}

/** The calls the Drive verbs make. Injected, so a document builder never needs a live Drive. */
export interface DriveApi {
  /**
   * List files matching a Drive `q` expression, newest-modified first.
   *
   * `driveId` selects a SHARED drive to search instead of the owner's own — Drive treats those as separate
   * corpora, so a search of My Drive genuinely does not see a shared drive's files and vice versa.
   */
  readonly listFiles: (args: {
    query: string | undefined;
    limit: number;
    driveId: string | undefined;
    pageToken?: string | undefined;
  }) => Promise<Result<DriveFilePage, DriveError>>;
  /** Fetch one file's metadata by id. */
  readonly getFile: (args: { id: string }) => Promise<Result<DriveFile, DriveError>>;
  /**
   * Export one Google-native document as text.
   *
   * Fails with {@link ./errors.ExportUnsupportedError} — not a generic API failure — for a type that has no
   * text export, so a caller can report the file and say plainly that its bytes were not read.
   */
  readonly exportText: (args: { id: string; mimeType: string }) => Promise<Result<string, DriveError>>;
  /** The shared drives this account can see — the vocabulary a `--drive` restriction is written in. */
  readonly listDrives: () => Promise<Result<readonly SharedDrive[], DriveError>>;
}

/**
 * Map a boundary failure into this domain's own union at the point it is consumed, carrying the cause.
 *
 * Every seam below calls `safeProviderCall` DIRECTLY rather than through a shared helper. That is the
 * `boundary-residue` gate's requirement, not a style choice: it recognises a sanctioned boundary only when
 * the SDK call sits inside a `safeProviderCall(` — a wrapper one level up reads to it exactly like an
 * unwrapped call, which is the blindness it exists to prevent.
 */
function toDriveError({ error }: { error: IngestError }): DriveError {
  return DriveErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * The cursor to the next `files.list` page. Drive leaves `nextPageToken` off once the end of the file list has
 * been reached, and the SDK's `null` is that same end: both read as `undefined`, never as an empty cursor.
 */
function laterFilesCursor({ list }: { list: drive_v3.Schema$FileList }): string | undefined {
  const { nextPageToken } = list;
  if (nextPageToken == null) {
    return undefined;
  }
  return nextPageToken;
}

/**
 * The seam over `files.list` — the one call that shapes a PAGE rather than a file.
 *
 * @param client the `@googleapis/drive` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the listing part of the seam
 */
function listSeam({ client, scopeId }: { client: drive_v3.Drive; scopeId: string }): Pick<DriveApi, "listFiles"> {
  return {
    listFiles: async ({ query, limit, driveId, pageToken }) =>
      safeProviderCall({
        execute: () =>
          client.files.list({
            fields: `nextPageToken,files(${FILE_FIELDS})`,
            // Both are required for a shared drive to be searchable at all, and both are harmless on My
            // Drive — Google refuses `driveId` outright unless the request declares it supports shared
            // drives, with an error that names neither field.
            includeItemsFromAllDrives: true,
            orderBy: "modifiedTime desc",
            pageSize: limit,
            supportsAllDrives: true,
            ...(query !== undefined ? { q: query } : {}),
            ...(driveId !== undefined ? { corpora: "drive", driveId } : {}),
            ...(pageToken !== undefined ? { pageToken } : {}),
          }),
        operation: "drive.files.list",
        provider: "drive",
        retryMode: "transient",
        scopeId,
      })
        .map((response): DriveFilePage => ({
          files: absentAsEmpty({ value: response.data.files })
            .map((file) => reduceFile({ file }))
            .filter((file): file is DriveFile => file !== undefined),
          nextPageToken: laterFilesCursor({ list: response.data }),
        }))
        .mapErr((error) => toDriveError({ error })),
  };
}

/**
 * The seams that address ONE file by id — its metadata, and its text when it has one.
 *
 * @param client the `@googleapis/drive` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the single-file part of the seam
 */
function fileSeams({
  client,
  scopeId,
}: {
  client: drive_v3.Drive;
  scopeId: string;
}): Pick<DriveApi, "getFile" | "exportText"> {
  return {
    exportText: async ({ id, mimeType }) => {
      const exportMime = TEXT_EXPORTS[mimeType];
      if (exportMime === undefined) {
        return err(DriveErrors.exportUnsupported({ mimeType }));
      }
      const exported = await safeProviderCall({
        execute: () => client.files.export({ fileId: id, mimeType: exportMime }),
        operation: "drive.files.export",
        provider: "drive",
        retryMode: "transient",
        scopeId,
      });
      if (exported.isErr()) {
        return err(toDriveError({ error: exported.error }));
      }
      // `files.export` is typed `unknown` because what comes back depends entirely on the export MIME —
      // the two this door asks for are both text, so anything else is a response shape the door did not
      // ask for and must not guess at.
      const body = exported.value.data;
      if (typeof body !== "string") {
        return err(
          DriveErrors.apiFailed({
            message: `the ${exportMime} export of ${id} came back as ${typeof body} rather than text`,
          }),
        );
      }
      return ok(body);
    },
    getFile: async ({ id }) => {
      const fetched = await safeProviderCall({
        execute: () => client.files.get({ fields: FILE_FIELDS, fileId: id, supportsAllDrives: true }),
        operation: "drive.files.get",
        provider: "drive",
        retryMode: "transient",
        scopeId,
      });
      if (fetched.isErr()) {
        return err(toDriveError({ error: fetched.error }));
      }
      const file = reduceFile({ file: fetched.value.data });
      if (file === undefined) {
        return err(DriveErrors.apiFailed({ message: `Drive returned a file with no id for ${id}` }));
      }
      return ok(file);
    },
  };
}

/**
 * The seam over `drives.list` — the shared drives this account can see.
 *
 * @param client the `@googleapis/drive` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the shared-drive part of the seam
 */
function driveSeams({ client, scopeId }: { client: drive_v3.Drive; scopeId: string }): Pick<DriveApi, "listDrives"> {
  return {
    listDrives: async () =>
      safeProviderCall({
        execute: () => client.drives.list({ pageSize: MAX_SHARED_DRIVES }),
        operation: "drive.drives.list",
        provider: "drive",
        retryMode: "transient",
        scopeId,
      })
        .map((response): readonly SharedDrive[] =>
          absentAsEmpty({ value: response.data.drives })
            .map((drive) => reduceSharedDrive({ drive }))
            .filter((drive): drive is SharedDrive => drive !== undefined),
        )
        .mapErr((error) => toDriveError({ error })),
  };
}

/**
 * Build the production Drive seam over a resolved grant.
 *
 * @param client the `@googleapis/drive` surface from a resolved grant
 * @param account the account the grant bound to, hashed into the shared rate scope
 * @returns the seam every Drive read verb calls
 */
export function makeDriveApi({ client, account }: { client: drive_v3.Drive; account: string }): DriveApi {
  const scopeId = scopeIdForToken({ token: account });
  return {
    ...listSeam({ client, scopeId }),
    ...fileSeams({ client, scopeId }),
    ...driveSeams({ client, scopeId }),
  };
}
