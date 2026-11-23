/**
 * Human rendering for every Drive document — the three reads (`list`, `read`, `drives`).
 *
 * The shared `renderProviderReadText` prints a header and then the raw provider payload as JSON, which is
 * the right call for a GitHub pull request an agent is about to reason over. It is the wrong call for a
 * Drive: "what is in this folder" is a triage question, and a screen of JSON is not a triage answer. So the
 * `--json` lane keeps the shared, stable document renderer and the human lane gets these — the same
 * document, read out loud.
 *
 * All of them keep freshness and residue ABOVE the payload, for the same reason the shared renderer does: a
 * reader who scrolls past the residue has still seen it.
 *
 * Pure: no I/O, no clock.
 */
import type { ProviderReadDocument } from "../providerRead.js";
import { type DriveFile, FOLDER_MIME } from "./files.js";
import type { DriveDrivesResult, DriveFileResult, DriveListingResult } from "./read.js";

/** How much of a file name a listing line shows before it is cut. */
const NAME_WIDTH = 56;

/** How much exported text `drive read` prints before it says how much it withheld. */
const TEXT_PREVIEW_CHARS = 4_000;

/** The header block every Drive render leads with — what was read, when, and what it did not cover. */
function documentHeader({ document }: { document: ProviderReadDocument }): readonly string[] {
  const residue = document.coverage.residue;
  return [
    `drive ${document.target.kind}: ${document.target.identity}`,
    `read at: ${document.readAtIso}`,
    `coverage: ${document.coverage.kind} — ${document.coverage.detail}`,
    ...(residue.length === 0 ? ["residue: none"] : ["residue:", ...residue.map((line) => `  - ${line}`)]),
    "",
  ];
}

/**
 * Cut a single-line preview to width, marking the cut rather than hiding it.
 *
 * The stand-in for a missing value is chosen HERE, at the point of display, and it is a visible one
 * (`(no name)`) rather than a blank a reader would read as a file someone left unnamed.
 */
function preview({ text, width, missing }: { text: string | undefined; width: number; missing: string }): string {
  if (text === undefined || text.trim().length === 0) {
    return missing;
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

/** The date column: the first 16 characters of the instant, or a visible stand-in when there is none. */
function dateColumn({ iso }: { iso: string | undefined }): string {
  return iso === undefined ? "(no date)      " : iso.slice(0, 16).replace("T", " ");
}

/**
 * The size column.
 *
 * A Google-native document genuinely HAS no size — Drive reports none for a Doc or a Sheet — so it reads
 * `—` rather than `0 B`, which would be a claim about an empty file. Everything else is shown in whole
 * kibibytes above a kibibyte, because a listing is for recognising files and not for accounting.
 */
function sizeColumn({ sizeBytes }: { sizeBytes: number | undefined }): string {
  if (sizeBytes === undefined) {
    return "        —";
  }
  if (sizeBytes < 1024) {
    return `${String(sizeBytes)} B`.padStart(9);
  }
  return `${String(Math.round(sizeBytes / 1024))} KiB`.padStart(9);
}

/** The short type word a listing shows — the Google-native suffix, or the media subtype, or a folder. */
function typeColumn({ file }: { file: DriveFile }): string {
  if (file.mimeType === FOLDER_MIME) {
    return "folder";
  }
  if (file.mimeType === undefined) {
    return "(unknown)";
  }
  const native = /^application\/vnd\.google-apps\.([a-z]+)$/.exec(file.mimeType);
  if (native !== null) {
    // The pattern's one group is not optional, so a match always carries the native suffix.
    return native[1]!;
  }
  // The media subtype: everything after the last slash, or the whole type when it carries none.
  return file.mimeType.slice(file.mimeType.lastIndexOf("/") + 1);
}

/**
 * Render a `drive list` document for a human.
 *
 * The parameter types are spelled INLINE rather than as the imported result alias, because the `jsdoc-tags`
 * gate validates a tag against the fields of the declared type and cannot enumerate a type it has to follow
 * into another module. It is structurally the same type the reader returns.
 *
 * @param document the listing document, for its freshness and residue header
 * @param listing the same read's typed payload
 * @returns the text block, most-recently-modified first as Drive returned it
 */
export function renderDriveListingText({
  document,
  listing,
}: {
  document: ProviderReadDocument;
  listing: DriveListingResult["listing"];
}): string {
  if (listing.files.length === 0) {
    return [...documentHeader({ document }), "no files matched."].join("\n");
  }
  return [
    ...documentHeader({ document }),
    ...listing.files.map((file) =>
      [
        dateColumn({ iso: file.modifiedAtIso }),
        sizeColumn({ sizeBytes: file.sizeBytes }),
        typeColumn({ file }).padEnd(12),
        preview({ missing: "(no name)", text: file.name, width: NAME_WIDTH }).padEnd(NAME_WIDTH),
        file.id,
      ].join("  "),
    ),
  ].join("\n");
}

/**
 * Render a `drive read` document for a human — the file's facts, then its text when it has one.
 *
 * @param document the file document, for its freshness and residue header
 * @param payload the same read's typed payload
 * @returns the text block
 */
export function renderDriveFileText({
  document,
  payload,
}: {
  document: ProviderReadDocument;
  payload: DriveFileResult["payload"];
}): string {
  const { file, text } = payload;
  const facts = [
    `name:     ${file.name ?? "(no name)"}`,
    `id:       ${file.id}`,
    `type:     ${file.mimeType ?? "(unknown)"}`,
    `modified: ${file.modifiedAtIso ?? "(no date)"}`,
    `created:  ${file.createdAtIso ?? "(no date)"}`,
    `owners:   ${file.owners.length === 0 ? "(none reported — a shared-drive file has no owner)" : file.owners.join(", ")}`,
    `size:     ${file.sizeBytes === undefined ? "(none — Google-native documents report no size)" : `${String(file.sizeBytes)} bytes`}`,
    `link:     ${file.webViewLink ?? "(none)"}`,
  ];
  if (text === undefined) {
    return [...documentHeader({ document }), ...facts].join("\n");
  }
  const cut = text.length > TEXT_PREVIEW_CHARS;
  return [
    ...documentHeader({ document }),
    ...facts,
    "",
    cut ? text.slice(0, TEXT_PREVIEW_CHARS) : text,
    ...(cut
      ? ["", `… ${String(text.length - TEXT_PREVIEW_CHARS)} more characters — read with --json for all of it`]
      : []),
  ].join("\n");
}

/**
 * Render a `drive drives` document for a human — the id/name pairs a `--drive` restriction is written in.
 *
 * @param document the shared-drive document, for its freshness and residue header
 * @param vocabulary the same read's typed payload
 * @returns the text block
 */
export function renderDriveDrivesText({
  document,
  vocabulary,
}: {
  document: ProviderReadDocument;
  vocabulary: DriveDrivesResult["vocabulary"];
}): string {
  if (vocabulary.drives.length === 0) {
    return [...documentHeader({ document }), "no shared drives — this account sees only its own My Drive."].join("\n");
  }
  return [
    ...documentHeader({ document }),
    ...vocabulary.drives.map((drive) => `${drive.id}  ${drive.name ?? "(no name)"}`),
  ].join("\n");
}
