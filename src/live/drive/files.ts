/**
 * The PURE half of the Drive door: reading an address a person actually has, and reducing Google's file
 * resource to the fields a document renders.
 *
 * ## Why an address is not just an id
 *
 * Nobody has a Drive file id to hand. What they have is the URL in their browser bar, and the four shapes
 * Google puts a file id into are all different — `/file/d/<id>/view`, `/document/d/<id>/edit`,
 * `/spreadsheets/d/<id>`, `?id=<id>`. Making the caller extract the id themselves is how a verb ends up
 * being given a whole URL and answering "not found" about a file that exists. So the address is parsed
 * here, once, and a bare id passes through untouched.
 *
 * Every pattern is written with bounded character classes so it has one way to match at each position and
 * cannot backtrack — the same requirement every pattern run over provider-derived text carries in this repo.
 */
import type { drive_v3 } from "@googleapis/drive";

import { err, ok, type Result } from "../../lib/result.js";
import { type DriveError, DriveErrors } from "./errors.js";

/** A Drive file id: Google's own alphabet, and nothing that could be a path segment or a query. */
const FILE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** The URL shapes a Drive or Docs address arrives in, each capturing the id. */
const URL_SHAPES: readonly RegExp[] = [
  /^https:\/\/(?:drive|docs)\.google\.com\/[A-Za-z0-9_/-]*\/d\/([A-Za-z0-9_-]+)/,
  /^https:\/\/(?:drive|docs)\.google\.com\/[A-Za-z0-9_/.-]*[?&]id=([A-Za-z0-9_-]+)/,
];

/**
 * Read a file id out of whatever the caller supplied — a bare id, a Drive URL, or a Docs/Sheets/Slides URL.
 *
 * @param address the id or URL as written on the command line
 * @returns the file id, or the typed reason nothing usable could be read out of it
 */
export function fileIdFromAddress({ address }: { address: string }): Result<string, DriveError> {
  const trimmed = address.trim();
  if (FILE_ID.test(trimmed)) {
    return ok(trimmed);
  }
  for (const shape of URL_SHAPES) {
    const match = shape.exec(trimmed);
    const id = match?.[1];
    if (id !== undefined) {
      return ok(id);
    }
  }
  return err(
    DriveErrors.invalidAddress({
      message:
        `\`${address}\` is not a Drive file id or a Drive/Docs URL — paste the address from the browser bar, ` +
        "or the id between `/d/` and the next slash",
    }),
  );
}

/** The MIME type of a Drive FOLDER. Google models a folder as a file, so this is how a listing tells them apart. */
export const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Which text export each Google-native type has.
 *
 * Only Google's OWN document types can be exported at all; everything else in a Drive is bytes the API hands
 * back as-is, which this door deliberately does not download. Docs exports as plain text, Sheets as CSV (one
 * sheet — Google's own limit, not this repo's) and Slides as plain text. A type absent from this table is
 * what produces {@link ./errors.ExportUnsupportedError}, which is a report rather than a fault.
 */
export const TEXT_EXPORTS: Readonly<Record<string, string>> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
} as const;

/** One file, reduced to what a Drive document needs. */
export interface DriveFile {
  readonly id: string;
  readonly name: string | undefined;
  readonly mimeType: string | undefined;
  /** Bytes as Google reports them. Absent for a Google-native document — those have no `size` at all. */
  readonly sizeBytes: number | undefined;
  readonly modifiedAtIso: string | undefined;
  readonly createdAtIso: string | undefined;
  /** Every owner's address. A shared-drive file has none, which is a fact rather than a gap. */
  readonly owners: readonly string[];
  /** The parent folder ids, exactly as Google reports them — a file can sit in more than one. */
  readonly parents: readonly string[];
  readonly webViewLink: string | undefined;
  /** The shared drive this file lives in, absent for a file in the owner's own My Drive. */
  readonly driveId: string | undefined;
  readonly trashed: boolean;
  readonly shared: boolean;
}

/**
 * Whether a reduced file is a folder rather than a document — Google models a folder as a file, so the type
 * is the only thing that tells them apart.
 *
 * @param file the reduced file
 * @returns true when the file is a Drive folder
 */
export function isFolder({ file }: { file: DriveFile }): boolean {
  return file.mimeType === FOLDER_MIME;
}

/**
 * The shared drive a file sits in. Drive populates `driveId` only for an item in a shared drive, so a file in
 * the account's own My Drive arrives without one; the SDK's `null` is that same absence and reads as `undefined`.
 */
function sharedDriveIdOf({ file }: { file: drive_v3.Schema$File }): string | undefined {
  const { driveId } = file;
  if (driveId == null) {
    return undefined;
  }
  return driveId;
}

/**
 * The owners Drive names for a file. Drive leaves `owners` unpopulated for an item in a shared drive, which
 * the drive owns rather than a person, so an omitted list is a file with no personal owner.
 */
function ownersOf({ file }: { file: drive_v3.Schema$File }): readonly drive_v3.Schema$User[] {
  const { owners } = file;
  if (owners == null) {
    return [];
  }
  return owners;
}

/**
 * The parent folder ids Drive reports for a file. Drive reports only the parents this account can see, so a
 * file shared with it out of a folder it has no access to arrives with no `parents` at all.
 */
function visibleParentsOf({ file }: { file: drive_v3.Schema$File }): readonly string[] {
  const { parents } = file;
  if (parents == null) {
    return [];
  }
  return parents;
}

/**
 * Reduce Google's file resource to {@link DriveFile}.
 *
 * `size` arrives as a decimal STRING (Drive files exceed what JSON numbers hold safely, so Google sends
 * text), and an unparseable one becomes `undefined` rather than `NaN` — a number that renders as "NaN bytes"
 * is worse than a stated absence.
 *
 * @param file the file as the API returned it
 * @returns the reduced file, or undefined when the resource carried no id to address it by
 */
export function reduceFile({ file }: { file: drive_v3.Schema$File }): DriveFile | undefined {
  if (typeof file.id !== "string") {
    return undefined;
  }
  const size = Number(file.size);
  return {
    createdAtIso: file.createdTime ?? undefined,
    driveId: sharedDriveIdOf({ file }),
    id: file.id,
    mimeType: file.mimeType ?? undefined,
    modifiedAtIso: file.modifiedTime ?? undefined,
    name: file.name ?? undefined,
    owners: ownersOf({ file })
      .map((owner) => owner.emailAddress)
      .filter((address): address is string => typeof address === "string"),
    parents: visibleParentsOf({ file }),
    shared: file.shared === true,
    sizeBytes: typeof file.size === "string" && Number.isFinite(size) ? size : undefined,
    trashed: file.trashed === true,
    webViewLink: file.webViewLink ?? undefined,
  };
}

/** One shared drive: the id a search restricts to, and the name a person recognises. */
export interface SharedDrive {
  readonly id: string;
  readonly name: string | undefined;
}

/**
 * Reduce Google's shared-drive resource.
 *
 * @param drive the drive as the API returned it
 * @returns the reduced drive, or undefined when the resource carried no id
 */
export function reduceSharedDrive({ drive }: { drive: drive_v3.Schema$Drive }): SharedDrive | undefined {
  if (typeof drive.id !== "string") {
    return undefined;
  }
  return { id: drive.id, name: drive.name ?? undefined };
}

/**
 * The `q` expression a `drive list` invocation sends, combining the caller's own query with the two bounds
 * this door always applies.
 *
 * Trashed files are excluded unless asked for, because a listing that silently mixes deleted files into
 * live ones is the same class of lie as presenting one page as a total. A folder restriction is expressed
 * as Google's own `'<id>' in parents` clause rather than by filtering afterwards, so the bound is applied
 * at the provider and the result count means what it says. Pure.
 *
 * @param query the caller's own Drive query expression, or undefined for no extra condition
 * @param folderId restrict to the direct children of one folder
 * @param includeTrashed keep trashed files in the result
 * @returns the combined expression, or undefined when no condition applies at all
 */
export function buildListQuery({
  query,
  folderId,
  includeTrashed,
}: {
  query: string | undefined;
  folderId: string | undefined;
  includeTrashed: boolean;
}): string | undefined {
  const clauses: string[] = [];
  if (!includeTrashed) {
    clauses.push("trashed = false");
  }
  if (folderId !== undefined) {
    clauses.push(`'${folderId}' in parents`);
  }
  if (query !== undefined && query.trim().length > 0) {
    clauses.push(`(${query.trim()})`);
  }
  return clauses.length === 0 ? undefined : clauses.join(" and ");
}
