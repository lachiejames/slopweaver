/**
 * The authored tables' keys, and how an import cuts the projected files into statements — each body sent once,
 * before any location naming it, and no batch past its row or byte bound.
 */
import { createHash } from "node:crypto";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { ProjectedAuthoredFile } from "../../../../store/fleet/authoredFile.js";
import { authoredInsertBatches } from "../../../../store/fleet/authoredStore.js";
import { authoredBodyTable, authoredFileTable } from "../../../../store/schema/authored.js";

const WHEN = new Date("2026-09-25T01:02:03.004Z");

/** A projected file holding some text at a path. */
function file({ relativePath, text }: { relativePath: string; text: string }): ProjectedAuthoredFile {
  const body = Buffer.from(text);
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  return {
    binary: false,
    body: { body, bodySha256, byteLength: body.length },
    bundle: false,
    location: { bodySha256, directory: relativePath.split("/")[0]!, fileModifiedAt: WHEN, relativePath },
  };
}

/** Each batch as the paths and body lengths it carries, so a case reads as its shape. */
function shapes({
  batches,
}: {
  batches: Iterable<{ bodies: { byteLength: number }[]; locations: { relativePath: string }[] }>;
}): {
  bodies: number[];
  paths: string[];
}[] {
  return [...batches].map((batch) => ({
    bodies: batch.bodies.map((body) => body.byteLength),
    paths: batch.locations.map((location) => location.relativePath),
  }));
}

describe("the authored tables", () => {
  it("key a body by its sha and a location by its path and body, so one path keeps every version", () => {
    expect(getTableName(authoredBodyTable)).toBe("authored_body");
    expect(getTableName(authoredFileTable)).toBe("authored_file");
    expect(
      getTableConfig(authoredBodyTable)
        .columns.filter((column) => column.primary)
        .map((column) => column.name),
    ).toEqual(["body_sha256"]);
    expect(
      getTableConfig(authoredFileTable).primaryKeys.map((key) => key.columns.map((column) => column.name)),
    ).toEqual([["relative_path", "body_sha256"]]);
  });

  it("check a body's length against its bytes and a location's directory against its path", () => {
    expect(getTableConfig(authoredBodyTable).checks.map((check) => check.name)).toEqual([
      "authored_body_sha_shape",
      "authored_body_byte_length_matches",
    ]);
    expect(getTableConfig(authoredFileTable).checks.map((check) => check.name)).toEqual([
      "authored_file_directory_is_first_segment",
    ]);
  });
});

describe("authoredInsertBatches", () => {
  it("sends a body shared by two paths once, in the batch of the first path that holds it", () => {
    const files = [
      file({ relativePath: "briefs/a.md", text: "same" }),
      file({ relativePath: "briefs/b.md", text: "same" }),
      file({ relativePath: "briefs/c.md", text: "other" }),
    ];

    expect(shapes({ batches: authoredInsertBatches({ files, maxRows: 2 }) })).toEqual([
      { bodies: [4], paths: ["briefs/a.md", "briefs/b.md"] },
      { bodies: [5], paths: ["briefs/c.md"] },
    ]);
  });

  it("closes a batch at its byte bound, and yields nothing for no files", () => {
    const files = [
      file({ relativePath: "briefs/a.md", text: "12345" }),
      file({ relativePath: "briefs/b.md", text: "678" }),
      file({ relativePath: "briefs/c.md", text: "9" }),
    ];

    expect(shapes({ batches: authoredInsertBatches({ files, maxBytes: 5 }) })).toEqual([
      { bodies: [5], paths: ["briefs/a.md"] },
      { bodies: [3, 1], paths: ["briefs/b.md", "briefs/c.md"] },
    ]);
    expect([...authoredInsertBatches({ files: [] })]).toEqual([]);
  });
});
