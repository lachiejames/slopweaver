/**
 * Unit: the three Drive READ document builders, over a plain fake seam. What is under test is the coverage
 * and the RESIDUE — a listing that presented one page as a total, or a binary file that reported no content
 * without saying so, is the failure class these builders exist to prevent.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DriveApi } from "../../../../live/drive/api.js";
import { DriveErrors } from "../../../../live/drive/errors.js";
import type { DriveFile } from "../../../../live/drive/files.js";
import { readDriveDrives, readDriveFile, readDriveListing } from "../../../../live/drive/read.js";

const NOW = "2026-09-05T12:00:00.000Z";
const nowIso = (): string => NOW;

const PDF: DriveFile = {
  createdAtIso: "2026-08-01T09:00:00.000Z",
  driveId: undefined,
  id: "1Pdf",
  mimeType: "application/pdf",
  modifiedAtIso: "2026-09-01T09:00:00.000Z",
  name: "Budget.pdf",
  owners: ["me@example.test"],
  parents: [],
  shared: false,
  sizeBytes: 2048,
  trashed: false,
  webViewLink: "https://drive.google.com/file/d/1Pdf/view",
};

const DOC: DriveFile = {
  ...PDF,
  id: "1Doc",
  mimeType: "application/vnd.google-apps.document",
  name: "Notes",
  sizeBytes: undefined,
};

const FOLDER: DriveFile = {
  ...PDF,
  id: "1Folder",
  mimeType: "application/vnd.google-apps.folder",
  name: "Reports",
  sizeBytes: undefined,
};

/** A seam whose every call succeeds with the fixtures the test names. */
function fakeApi({
  files = [PDF],
  nextPageToken = undefined as string | undefined,
  file = PDF,
  text = "the exported text",
  exportFails = false,
  drives = [{ id: "0AD", name: "Engineering" }],
}: {
  files?: readonly DriveFile[];
  nextPageToken?: string | undefined;
  file?: DriveFile;
  text?: string;
  exportFails?: boolean;
  drives?: readonly { id: string; name: string | undefined }[];
} = {}): DriveApi {
  return {
    exportText: async ({ mimeType }) => (exportFails ? err(DriveErrors.exportUnsupported({ mimeType })) : ok(text)),
    getFile: async () => ok(file),
    listDrives: async () => ok(drives),
    listFiles: async () => ok({ files, nextPageToken }),
  };
}

describe("readDriveListing", () => {
  it("carries the files and stamps the read instant", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi(),
        driveId: undefined,
        limit: 25,
        nowIso,
        query: "trashed = false",
      }),
    );
    expect(result.listing.files).toStrictEqual([PDF]);
    expect(result.document.readAtIso).toBe(NOW);
    expect(result.document.source).toBe("drive");
    expect(result.document.target.address).toBe("trashed = false");
  });

  it("names a listing sent with no condition at all as having no query, rather than a blank address", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi(),
        driveId: undefined,
        limit: 25,
        nowIso,
        query: undefined,
      }),
    );
    expect(result.document.target.address).toBe("(no query)");
  });

  it("says a page is a PAGE when another one exists", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi({ nextPageToken: "next" }),
        driveId: undefined,
        limit: 25,
        nowIso,
        query: undefined,
      }),
    );
    expect(result.document.coverage.residue[0]).toContain("this is one page of 1");
    expect(result.listing.more).toBe(true);
  });

  it("does NOT claim another page when the cursor is exhausted", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi(),
        driveId: undefined,
        limit: 25,
        nowIso,
        query: undefined,
      }),
    );
    expect(result.document.coverage.residue.join("\n")).not.toContain("one page of");
    expect(result.listing.more).toBe(false);
  });

  it("warns that shared drives are a SEPARATE corpus when none was named", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi(),
        driveId: undefined,
        limit: 25,
        nowIso,
        query: undefined,
      }),
    );
    expect(result.document.coverage.residue.join("\n")).toContain("SHARED DRIVE is a separate");
  });

  it("drops that warning once a shared drive IS the thing being searched", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi(),
        driveId: "0AD",
        limit: 25,
        nowIso,
        query: undefined,
      }),
    );
    expect(result.document.coverage.residue.join("\n")).not.toContain("SHARED DRIVE is a separate");
    expect(result.document.target.kind).toBe("search in drive 0AD");
  });

  it("counts folders in the coverage, because a listing of folders is not a listing of files", async () => {
    const result = unwrap(
      await readDriveListing({
        account: "me@example.test",
        api: fakeApi({ files: [FOLDER, PDF] }),
        driveId: undefined,
        limit: 25,
        nowIso,
        query: undefined,
      }),
    );
    expect(result.document.coverage.detail).toBe("2 file(s) read as metadata only (1 of them folders), capped at 25");
  });

  it("propagates a seam failure rather than reporting an empty Drive", async () => {
    const failing: DriveApi = {
      ...fakeApi(),
      listFiles: async () => err(DriveErrors.apiFailed({ message: "the grant was revoked" })),
    };
    const result = await readDriveListing({
      account: "me@example.test",
      api: failing,
      driveId: undefined,
      limit: 25,
      nowIso,
      query: undefined,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("the grant was revoked");
  });
});

describe("readDriveFile", () => {
  it("exports a Google document's text and says how much came back", async () => {
    const result = unwrap(
      await readDriveFile({
        account: "me@example.test",
        api: fakeApi({ file: DOC }),
        fileId: "1Doc",
        nowIso,
        withText: true,
      }),
    );
    expect(result.payload.text).toBe("the exported text");
    expect(result.document.coverage.detail).toBe("one file, metadata plus 17 characters of exported text");
  });

  it("reports a BINARY file rather than failing on it, and says its bytes were left behind", async () => {
    const result = unwrap(
      await readDriveFile({
        account: "me@example.test",
        api: fakeApi({ file: PDF }),
        fileId: "1Pdf",
        nowIso,
        withText: true,
      }),
    );
    expect(result.payload.text).toBe(undefined);
    expect(result.document.coverage.residue.join("\n")).toContain("left on Google's servers");
  });

  it("turns an EXPORT_UNSUPPORTED refusal back into no-text rather than propagating it", async () => {
    const result = unwrap(
      await readDriveFile({
        account: "me@example.test",
        api: fakeApi({ exportFails: true, file: DOC }),
        fileId: "1Doc",
        nowIso,
        withText: true,
      }),
    );
    expect(result.payload.text).toBe(undefined);
  });

  it("PROPAGATES any other export failure, because reporting no text would be a lie about a document", async () => {
    const failing: DriveApi = {
      ...fakeApi({ file: DOC }),
      exportText: async () => err(DriveErrors.apiFailed({ message: "Drive returned 500" })),
    };
    const result = await readDriveFile({
      account: "me@example.test",
      api: failing,
      fileId: "1Doc",
      nowIso,
      withText: true,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("API_FAILED");
  });

  it("never exports when content was not asked for, and says content was not requested", async () => {
    const result = unwrap(
      await readDriveFile({
        account: "me@example.test",
        api: fakeApi({ file: DOC }),
        fileId: "1Doc",
        nowIso,
        withText: false,
      }),
    );
    expect(result.payload.text).toBe(undefined);
    expect(result.document.coverage.residue.join("\n")).toContain("content was not requested");
  });

  it("says a FOLDER's contents were not listed, and does not claim its bytes were withheld", async () => {
    const result = unwrap(
      await readDriveFile({
        account: "me@example.test",
        api: fakeApi({ file: FOLDER }),
        fileId: "1Folder",
        nowIso,
        withText: true,
      }),
    );
    expect(result.document.target.kind).toBe("folder");
    expect(result.document.coverage.residue[0]).toContain("its contents were not listed");
    expect(result.document.coverage.residue.join("\n")).not.toContain("left on Google's servers");
  });

  it("flags a trashed file as not live", async () => {
    const result = unwrap(
      await readDriveFile({
        account: "me@example.test",
        api: fakeApi({ file: { ...PDF, trashed: true } }),
        fileId: "1Pdf",
        nowIso,
        withText: true,
      }),
    );
    expect(result.document.coverage.residue.join("\n")).toContain("in the TRASH");
  });
});

describe("readDriveDrives", () => {
  it("carries the shared drives and says My Drive is not one of them", async () => {
    const result = unwrap(await readDriveDrives({ account: "me@example.test", api: fakeApi(), capped: 100, nowIso }));
    expect(result.vocabulary.drives).toStrictEqual([{ id: "0AD", name: "Engineering" }]);
    expect(result.document.coverage.residue[0]).toContain("My Drive is not a shared drive");
  });

  it("says the answer MAY be truncated when exactly the cap came back", async () => {
    const result = unwrap(await readDriveDrives({ account: "me@example.test", api: fakeApi(), capped: 1, nowIso }));
    expect(result.document.coverage.residue[1]).toBe("exactly 1 came back, which is the cap — there may be more");
  });

  it("reports an account with no shared drives as an empty list rather than as a failure", async () => {
    const result = unwrap(
      await readDriveDrives({ account: "me@example.test", api: fakeApi({ drives: [] }), capped: 100, nowIso }),
    );
    expect(result.vocabulary.drives).toStrictEqual([]);
    expect(result.document.coverage.detail).toBe("0 shared drive(s) this account can see");
  });
});
