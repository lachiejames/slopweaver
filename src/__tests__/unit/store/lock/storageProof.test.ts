/**
 * The Storage leg of the pre-lock backup: every object the database names is in the tar, at its size, and — where
 * its name is a sha256 — with bytes that digest to it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  parseStorageObjects,
  storageObjectsQuery,
  storageProblems,
  type TarFile,
} from "../../../../store/lock/storageProof.js";

const DIGEST = "a".repeat(64);
const OBJECT = { bucket: "measurements", name: `acme/${DIGEST}`, size: 12, version: "v1" };
const FILE: TarFile = { bytes: 12, path: `stub/stub/measurements/acme/${DIGEST}/v1`, sha256: DIGEST };

describe("storageProblems", () => {
  it("is empty when the object is in the tar at its size with bytes matching its name", () => {
    expect(storageProblems({ files: [FILE], objects: [OBJECT] })).toEqual([]);
  });

  it("names an object the tar does not hold", () => {
    expect(storageProblems({ files: [], objects: [OBJECT] })).toEqual([
      `measurements/acme/${DIGEST}: not in storage.tar`,
    ]);
  });

  it("names a size the database and the tar disagree on", () => {
    expect(storageProblems({ files: [{ ...FILE, bytes: 11 }], objects: [OBJECT] })).toEqual([
      `measurements/acme/${DIGEST}: storage.objects records 12 byte(s), the tar holds 11`,
    ]);
  });

  it("names bytes that do not digest to a content-addressed name", () => {
    expect(storageProblems({ files: [{ ...FILE, sha256: "b".repeat(64) }], objects: [OBJECT] })).toEqual([
      `measurements/acme/${DIGEST}: its bytes digest to bbbbbbbbbbbb…, not its name`,
    ]);
  });

  it("does not digest-check a name that is not a sha256, and matches a versionless object by bucket and name", () => {
    const plain = { bucket: "files", name: "report.pdf", size: null, version: null };
    expect(
      storageProblems({ files: [{ bytes: 3, path: "stub/stub/files/report.pdf", sha256: DIGEST }], objects: [plain] }),
    ).toEqual([]);
  });

  it("caps the list at ten and counts the rest", () => {
    const objects = Array.from({ length: 12 }, (_, index) => ({ ...OBJECT, name: `missing-${String(index)}` }));
    const problems = storageProblems({ files: [], objects });
    expect(problems).toHaveLength(11);
    expect(problems[10]).toBe("…and 2 more");
  });
});

describe("parseStorageObjects", () => {
  it("reads rows, carrying a missing size or version as null", () => {
    expect(
      unwrap(
        parseStorageObjects({
          value: [
            { bucket: "b", name: "n", size: 4, version: "v" },
            { bucket: "b", name: "m" },
          ],
        }),
      ),
    ).toEqual([
      { bucket: "b", name: "n", size: 4, version: "v" },
      { bucket: "b", name: "m", size: null, version: null },
    ]);
  });

  it("refuses something that is not an array of named rows", () => {
    expect(unwrapErr(parseStorageObjects({ value: {} })).message).toContain("not an array");
    expect(unwrapErr(parseStorageObjects({ value: [{ bucket: "b" }] })).message).toContain("carries no bucket or name");
  });
});

describe("storageObjectsQuery", () => {
  it("bounds the rows at the dump's start", () => {
    expect(unwrap(storageObjectsQuery({ beforeIso: "2026-11-03T09:00:00.000Z" }))).toContain(
      "where created_at <= '2026-11-03T09:00:00.000Z'::timestamptz",
    );
  });

  it("refuses anything but an ISO instant, because it is spliced into the SQL", () => {
    expect(unwrapErr(storageObjectsQuery({ beforeIso: "now'; drop table x; --" })).code).toBe("BACKUP_GATE_FAILED");
  });
});
