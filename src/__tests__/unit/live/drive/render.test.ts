/**
 * Unit: the human renderings of the three Drive documents. Every assertion here is about what a reader is
 * TOLD — the residue appearing above the payload, and the two absences that must not read as zeroes.
 */
import { describe, expect, it } from "vitest";
import type { DriveFile } from "../../../../live/drive/files.js";
import { renderDriveDrivesText, renderDriveFileText, renderDriveListingText } from "../../../../live/drive/render.js";
import type { ProviderReadDocument } from "../../../../live/providerRead.js";

const DOCUMENT: ProviderReadDocument = {
  coverage: {
    detail: "1 file(s) read as metadata only (0 of them folders), capped at 25",
    kind: "bounded",
    residue: ["more files match — this is one page of 1, not the whole result"],
  },
  data: {},
  readAtIso: "2026-09-05T12:00:00.000Z",
  source: "drive",
  target: { address: "trashed = false", identity: "me@example.test", kind: "search" },
};

const PDF: DriveFile = {
  createdAtIso: "2026-08-01T09:00:00.000Z",
  driveId: undefined,
  id: "1Pdf",
  mimeType: "application/pdf",
  modifiedAtIso: "2026-09-01T09:30:00.000Z",
  name: "Budget.pdf",
  owners: ["me@example.test"],
  parents: [],
  shared: false,
  sizeBytes: 204_800,
  trashed: false,
  webViewLink: "https://drive.google.com/file/d/1Pdf/view",
};

const DOC: DriveFile = {
  ...PDF,
  id: "1Doc",
  mimeType: "application/vnd.google-apps.document",
  name: "Notes",
  owners: [],
  sizeBytes: undefined,
};

describe("renderDriveListingText", () => {
  it("puts the read instant and every residue line ABOVE the files", () => {
    const text = renderDriveListingText({
      document: DOCUMENT,
      listing: { account: "me@example.test", driveId: undefined, files: [PDF], more: true, query: undefined },
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("drive search: me@example.test");
    expect(lines[1]).toBe("read at: 2026-09-05T12:00:00.000Z");
    expect(lines[4]).toBe("  - more files match — this is one page of 1, not the whole result");
    expect(text.indexOf("Budget.pdf")).toBeGreaterThan(text.indexOf("this is one page"));
  });

  it("shows a size in whole kibibytes and the Google-native suffix as the type", () => {
    const text = renderDriveListingText({
      document: DOCUMENT,
      listing: { account: "me@example.test", driveId: undefined, files: [PDF, DOC], more: false, query: undefined },
    });
    expect(text).toContain("200 KiB");
    expect(text).toContain("document");
  });

  it("shows a media type's subtype after its last slash, and a type with no slash whole", () => {
    const text = renderDriveListingText({
      document: DOCUMENT,
      listing: {
        account: "me@example.test",
        driveId: undefined,
        files: [
          { ...PDF, id: "1Txt", mimeType: "text/plain" },
          { ...PDF, id: "1Odd", mimeType: "octet" },
        ],
        more: false,
        query: undefined,
      },
    });
    const lines = text.split("\n");
    const tail = `  ${"Budget.pdf".padEnd(56)}  `;
    expect(lines.at(-2)).toBe(`2026-09-01 09:30    200 KiB  ${"plain".padEnd(12)}${tail}1Txt`);
    expect(lines.at(-1)).toBe(`2026-09-01 09:30    200 KiB  ${"octet".padEnd(12)}${tail}1Odd`);
  });

  it("renders a Google document's ABSENT size as a dash, never as 0 B", () => {
    const text = renderDriveListingText({
      document: DOCUMENT,
      listing: { account: "me@example.test", driveId: undefined, files: [DOC], more: false, query: undefined },
    });
    expect(text).toContain("—");
    expect(text).not.toContain("0 B");
  });

  it("says so plainly when nothing matched", () => {
    const text = renderDriveListingText({
      document: DOCUMENT,
      listing: { account: "me@example.test", driveId: undefined, files: [], more: false, query: undefined },
    });
    expect(text.endsWith("no files matched.")).toBe(true);
  });
});

describe("renderDriveFileText", () => {
  it("names the file's facts and prints its exported text below them", () => {
    const text = renderDriveFileText({
      document: DOCUMENT,
      payload: { account: "me@example.test", file: DOC, text: "line one\nline two" },
    });
    expect(text).toContain("name:     Notes");
    expect(text).toContain("id:       1Doc");
    expect(text.indexOf("line one")).toBeGreaterThan(text.indexOf("id:       1Doc"));
  });

  it("says a Google document reports NO size rather than printing a zero", () => {
    const text = renderDriveFileText({
      document: DOCUMENT,
      payload: { account: "me@example.test", file: DOC, text: undefined },
    });
    expect(text).toContain("(none — Google-native documents report no size)");
  });

  it("says a shared-drive file's absent owner is an absence rather than leaving the line blank", () => {
    const text = renderDriveFileText({
      document: DOCUMENT,
      payload: { account: "me@example.test", file: DOC, text: undefined },
    });
    expect(text).toContain("(none reported — a shared-drive file has no owner)");
  });

  it("marks a cut in long exported text and says how much it withheld", () => {
    const long = "x".repeat(4_100);
    const text = renderDriveFileText({
      document: DOCUMENT,
      payload: { account: "me@example.test", file: DOC, text: long },
    });
    expect(text).toContain("… 100 more characters — read with --json for all of it");
  });
});

describe("renderDriveDrivesText", () => {
  it("lists id and name so a --drive restriction can be written from it", () => {
    const text = renderDriveDrivesText({
      document: DOCUMENT,
      vocabulary: { account: "me@example.test", drives: [{ id: "0AD", name: "Engineering" }] },
    });
    expect(text).toContain("0AD  Engineering");
  });

  it("says an account with no shared drives sees only My Drive", () => {
    const text = renderDriveDrivesText({ document: DOCUMENT, vocabulary: { account: "me@example.test", drives: [] } });
    expect(text.endsWith("no shared drives — this account sees only its own My Drive.")).toBe(true);
  });
});
