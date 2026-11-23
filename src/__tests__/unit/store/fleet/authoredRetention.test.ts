import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { retentionNote } from "../../../../cli/commands/store/importAuthoredRetention.js";
import { callVersionRewrite, scratchLocations, scratchPaths } from "../../../../store/fleet/authoredRetention.js";

const sha = ({ text }: { text: string }): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const TOOL = '{"kind":"tool","name":"board_read","detail":"d","refused":false,"turnId":"t1","answer":"masked rows"}';
const TOOL_STRIPPED = '{"kind":"tool","name":"board_read","detail":"d","refused":false,"turnId":"t1"}';
const SEGMENT = '{"kind":"segment","text":"spoken words","who":"voice"}';

describe("scratchLocations", () => {
  it("takes every version of a call-thread path, its part files included, and nothing authored or unclassified", () => {
    const locations = [
      { bodySha256: "a", relativePath: "talk/threads/abc.jsonl" },
      { bodySha256: "b", relativePath: "talk/threads/abc.part-000001.jsonl" },
      { bodySha256: "c", relativePath: "talk/attachments/pasted.png" },
      { bodySha256: "d", relativePath: "talk/calls/abc.jsonl" },
      { bodySha256: "e", relativePath: "talk/relays.jsonl" },
      { bodySha256: "f", relativePath: "handovers/acme-row.md" },
      { bodySha256: "g", relativePath: "nothing-classifies-this/x.txt" },
    ];
    expect(scratchLocations({ locations }).map((location) => location.relativePath)).toEqual([
      "talk/threads/abc.jsonl",
      "talk/threads/abc.part-000001.jsonl",
      "talk/attachments/pasted.png",
    ]);
  });

  it("takes nothing from an empty store", () => {
    expect(scratchLocations({ locations: [] })).toEqual([]);
  });
});

describe("scratchPaths", () => {
  it("takes an absent thread path, and leaves a call and an unclassified path", () => {
    expect(
      scratchPaths({
        paths: ["talk/calls/abc.jsonl", "talk/threads/ghost.jsonl", "nothing-classifies-this/x.txt"],
      }),
    ).toEqual(["talk/threads/ghost.jsonl"]);
  });
});

describe("callVersionRewrite", () => {
  const fileModifiedAt = new Date("2026-11-03T09:56:33.697Z");

  it("replaces a version carrying a tool answer at the same path and mtime, hashed over the stripped bytes", () => {
    const original = `${SEGMENT}\n${TOOL}\n`;
    const rewrite = callVersionRewrite({
      version: {
        body: Buffer.from(original, "utf8"),
        bodySha256: sha({ text: original }),
        directory: "talk",
        fileModifiedAt,
        relativePath: "talk/calls/abc.jsonl",
      },
    })!;
    const stripped = `${SEGMENT}\n${TOOL_STRIPPED}\n`;
    expect(rewrite.body.body.toString("utf8")).toBe(stripped);
    expect(rewrite.body.bodySha256).toBe(sha({ text: stripped }));
    expect(rewrite.body.byteLength).toBe(Buffer.byteLength(stripped));
    expect(rewrite.location).toEqual({
      bodySha256: sha({ text: stripped }),
      directory: "talk",
      fileModifiedAt,
      relativePath: "talk/calls/abc.jsonl",
    });
    expect(rewrite.remove).toEqual({ bodySha256: sha({ text: original }), relativePath: "talk/calls/abc.jsonl" });
  });

  it("leaves a file nested under talk/calls alone, which the import stores whole", () => {
    const original = `${TOOL}\n`;
    expect(
      callVersionRewrite({
        version: {
          body: Buffer.from(original, "utf8"),
          bodySha256: sha({ text: original }),
          directory: "talk",
          fileModifiedAt,
          relativePath: "talk/calls/archive/abc.jsonl",
        },
      }),
    ).toBe(undefined);
  });

  it("leaves a version alone whose only 'answer' is a spoken word", () => {
    const original = '{"kind":"segment","text":"the \\"answer\\" is no","who":"voice"}\n';
    expect(
      callVersionRewrite({
        version: {
          body: Buffer.from(original, "utf8"),
          bodySha256: sha({ text: original }),
          directory: "talk",
          fileModifiedAt,
          relativePath: "talk/calls/abc.jsonl",
        },
      }),
    ).toBe(undefined);
  });

  it("keeps a CRLF line's ending and an unterminated last line as they were", () => {
    const original = `${SEGMENT}\r\n${TOOL}\r\n${TOOL}`;
    const rewrite = callVersionRewrite({
      version: {
        body: Buffer.from(original, "utf8"),
        bodySha256: sha({ text: original }),
        directory: "talk",
        fileModifiedAt,
        relativePath: "talk/calls/abc.jsonl",
      },
    })!;
    expect(rewrite.body.body.toString("utf8")).toBe(`${SEGMENT}\r\n${TOOL_STRIPPED}\r\n${TOOL_STRIPPED}`);
  });
});

describe("retentionNote", () => {
  it("names every count", () => {
    expect(
      retentionNote({
        counts: {
          absentRowsDeleted: 2,
          callVersionsRewritten: 60,
          orphanBodiesDeleted: 107,
          rowsInserted: 120,
          scratchLocationsDeleted: 47,
        },
      }),
    ).toBe(
      "retention: 47 local-only location(s) removed from the store (2 absent row(s) with them), 60 call version(s) rewritten without tool answers, 107 unreferenced body(ies) deleted",
    );
  });
});
