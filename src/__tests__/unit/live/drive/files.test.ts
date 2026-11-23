/** Unit: the pure half of the Drive door — address parsing, the file projection, and the `q` builder. */
import type { drive_v3 } from "@googleapis/drive";
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  buildListQuery,
  type DriveFile,
  FOLDER_MIME,
  fileIdFromAddress,
  isFolder,
  reduceFile,
  reduceSharedDrive,
  TEXT_EXPORTS,
} from "../../../../live/drive/files.js";

/**
 * The reduced file for a fixture that certainly has an id. `testing.md` permits a non-null assertion for a
 * `T | undefined` the test is sure of; the "no id" case is asserted separately and explicitly.
 */
function reduced({ file }: { file: drive_v3.Schema$File }): DriveFile {
  return reduceFile({ file })!;
}

describe("fileIdFromAddress", () => {
  it("passes a bare id through untouched", () => {
    expect(unwrap(fileIdFromAddress({ address: "1AbCdEfGhIjKlMnO" }))).toBe("1AbCdEfGhIjKlMnO");
  });

  it("reads the id out of a Drive file URL", () => {
    const address = "https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing";
    expect(unwrap(fileIdFromAddress({ address }))).toBe("1AbCdEfGhIjK");
  });

  it("reads the id out of a Docs URL, which is the shape a browser bar actually holds", () => {
    const address = "https://docs.google.com/document/d/1AbCdEfGhIjK/edit#heading=x";
    expect(unwrap(fileIdFromAddress({ address }))).toBe("1AbCdEfGhIjK");
  });

  it("reads the id out of a Sheets URL", () => {
    const address = "https://docs.google.com/spreadsheets/d/1SheetIdHere0/edit#gid=0";
    expect(unwrap(fileIdFromAddress({ address }))).toBe("1SheetIdHere0");
  });

  it("reads the id out of the older ?id= query shape", () => {
    expect(unwrap(fileIdFromAddress({ address: "https://drive.google.com/open?id=1AbCdEfGhIjK" }))).toBe(
      "1AbCdEfGhIjK",
    );
  });

  it("trims surrounding whitespace, because a pasted URL routinely carries some", () => {
    expect(unwrap(fileIdFromAddress({ address: "  1AbCdEfGhIjKlMnO\n" }))).toBe("1AbCdEfGhIjKlMnO");
  });

  it("REFUSES a URL that is not a Drive or Docs address", () => {
    const result = fileIdFromAddress({ address: "https://example.test/document/d/1AbCdEfGhIjK" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("INVALID_ADDRESS");
  });

  it("REFUSES a short token that could not be a file id, rather than sending it to the API", () => {
    const result = fileIdFromAddress({ address: "budget" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("browser bar");
  });
});

describe("reduceFile", () => {
  it("carries the fields a document renders, with the size parsed out of Google's decimal string", () => {
    const file = reduced({
      file: {
        createdTime: "2026-08-01T09:00:00.000Z",
        driveId: "0ADriveId",
        id: "1AbCdEfGhIjK",
        mimeType: "application/pdf",
        modifiedTime: "2026-09-01T09:00:00.000Z",
        name: "Budget.pdf",
        owners: [{ emailAddress: "me@example.test" }],
        parents: ["1ParentFolder"],
        shared: true,
        size: "204800",
        trashed: false,
        webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view",
      },
    });
    expect(file.id).toBe("1AbCdEfGhIjK");
    expect(file.name).toBe("Budget.pdf");
    expect(file.sizeBytes).toBe(204_800);
    expect(file.owners).toStrictEqual(["me@example.test"]);
    expect(file.parents).toStrictEqual(["1ParentFolder"]);
    expect(file.driveId).toBe("0ADriveId");
    expect(file.shared).toBe(true);
    expect(file.trashed).toBe(false);
  });

  it("reports a Google-native document's ABSENT size as undefined rather than as zero bytes", () => {
    const file = reduced({ file: { id: "1Doc", mimeType: "application/vnd.google-apps.document", name: "Notes" } });
    expect(file.sizeBytes).toBe(undefined);
  });

  it("reports an unparseable size as undefined rather than as NaN", () => {
    expect(reduced({ file: { id: "1Doc", size: "not-a-number" } }).sizeBytes).toBe(undefined);
  });

  it("drops a resource with no id, because nothing could address it afterwards", () => {
    expect(reduceFile({ file: { name: "Orphan" } })).toBe(undefined);
  });

  it("reports absent owners as an empty list, which is what a shared-drive file genuinely has", () => {
    expect(reduced({ file: { id: "1File" } }).owners).toStrictEqual([]);
  });

  it("carries a My Drive file's unset driveId, omitted or null, as an own undefined field", () => {
    const omitted = reduced({ file: { id: "1File" } });
    expect(Object.hasOwn(omitted, "driveId")).toBe(true);
    expect(omitted.driveId).toBe(undefined);
    expect(reduced({ file: { driveId: null, id: "1File" } }).driveId).toBe(undefined);
  });

  it("reads a file with no visible parent, omitted or null, as having no parents, and keeps Google's own list", () => {
    expect(reduced({ file: { id: "1File" } }).parents).toStrictEqual([]);
    expect(reduced({ file: { id: "1File", parents: null } }).parents).toStrictEqual([]);
    const parents = ["1ParentFolder", "1OtherFolder"];
    expect(reduced({ file: { id: "1File", parents } }).parents).toBe(parents);
  });
});

describe("isFolder", () => {
  it("recognises Google's folder type", () => {
    expect(isFolder({ file: reduced({ file: { id: "1F", mimeType: FOLDER_MIME } }) })).toBe(true);
  });

  it("does not call a document a folder", () => {
    expect(isFolder({ file: reduced({ file: { id: "1F", mimeType: "application/pdf" } }) })).toBe(false);
  });
});

describe("reduceSharedDrive", () => {
  it("carries the id and the name", () => {
    expect(reduceSharedDrive({ drive: { id: "0AD", name: "Engineering" } })).toStrictEqual({
      id: "0AD",
      name: "Engineering",
    });
  });

  it("drops a drive with no id", () => {
    expect(reduceSharedDrive({ drive: { name: "Engineering" } })).toBe(undefined);
  });
});

describe("buildListQuery", () => {
  it("excludes trashed files by default, so a listing never mixes deleted files into live ones", () => {
    expect(buildListQuery({ folderId: undefined, includeTrashed: false, query: undefined })).toBe("trashed = false");
  });

  it("drops the trashed clause when they were asked for", () => {
    expect(buildListQuery({ folderId: undefined, includeTrashed: true, query: undefined })).toBe(undefined);
  });

  it("expresses a folder restriction as Drive's own parents clause, so the bound is applied at the provider", () => {
    expect(buildListQuery({ folderId: "1Folder", includeTrashed: true, query: undefined })).toBe(
      "'1Folder' in parents",
    );
  });

  it("parenthesises the caller's own query so an `or` inside it cannot escape the other clauses", () => {
    expect(buildListQuery({ folderId: undefined, includeTrashed: false, query: "a = 1 or b = 2" })).toBe(
      "trashed = false and (a = 1 or b = 2)",
    );
  });

  it("ignores a whitespace-only query rather than emitting an empty parenthesis", () => {
    expect(buildListQuery({ folderId: undefined, includeTrashed: true, query: "   " })).toBe(undefined);
  });

  it("combines all three in a stable order", () => {
    expect(buildListQuery({ folderId: "1Folder", includeTrashed: false, query: "name contains 'x'" })).toBe(
      "trashed = false and '1Folder' in parents and (name contains 'x')",
    );
  });
});

describe("TEXT_EXPORTS", () => {
  it("exports a Doc as plain text and a Sheet as CSV", () => {
    expect(TEXT_EXPORTS["application/vnd.google-apps.document"]).toBe("text/plain");
    expect(TEXT_EXPORTS["application/vnd.google-apps.spreadsheet"]).toBe("text/csv");
  });

  it("has NO entry for a binary type, which is what makes an unsupported export a report rather than a fault", () => {
    expect(TEXT_EXPORTS["application/pdf"]).toBe(undefined);
    expect(TEXT_EXPORTS["image/png"]).toBe(undefined);
  });
});
