/**
 * `page export` against a fake store and a real temporary directory: the one file it creates for a page, that it
 * never replaces a file, and the document and exit code for no page, a store that cannot say and bad arguments.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type PageExportDeps,
  pageExportOptions,
  productionPageExportDeps,
  runPageExport,
} from "../../../../../cli/commands/page/exportRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrapErr } from "../../../../../lib/result.js";
import { StoreErrors } from "../../../../../store/errors.js";
import type { HeldPageFile } from "../../../../../store/publishedPages/presentation.js";
import { PublishedPagesReadErrors } from "../../../../../store/publishedPages/readErrors.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const HELD: readonly HeldPageFile[] = [
  {
    bytes: new TextEncoder().encode('<html><body><img src="shot.png"><img src="gone.png"></body></html>'),
    relativePath: "index.html",
  },
  { bytes: PNG, relativePath: "shot.png" },
];

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "page-export-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Run the verb over a store answering `answer`, creating files for real, collecting both sinks. */
async function exportWith({
  rest,
  answer,
}: {
  rest: readonly string[];
  answer: Awaited<ReturnType<PageExportDeps["files"]>>;
}): Promise<{ code: number; out: string[]; diagnostics: string[]; asked: string[] }> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const asked: string[] = [];
  const code = await runPageExport({
    deps: {
      create: productionPageExportDeps().create,
      files: async ({ slug }) => {
        asked.push(slug);
        return answer;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    rest,
  });
  return { asked, code, diagnostics, out };
}

describe("page export", () => {
  it("creates one owner-only file carrying the page's images, reports what it could not carry, and exits 0", async () => {
    const path = join(dir, "standup-brief.html");
    const run = await exportWith({ answer: ok(HELD), rest: ["standup-brief", "--out", path, "--json"] });

    const written = readFileSync(path, "utf8");
    expect(run.code).toBe(EXIT_OK);
    expect(written).toBe(
      `<html><head></head><body><img src="data:image/png;base64,${Buffer.from(PNG).toString("base64")}"><img src="gone.png"></body></html>`,
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(run.out[0]!)).toEqual({
      byteLength: Buffer.byteLength(written),
      inlined: ["shot.png"],
      kind: "exported",
      notInlined: [{ reference: "gone.png", why: "not-served" }],
      path,
      schemaVersion: 1,
      slug: "standup-brief",
    });
    expect(run.asked).toEqual(["standup-brief"]);
  });

  it("never replaces a file that is already there, and exits 1 naming the write", async () => {
    const path = join(dir, "standup-brief.html");
    writeFileSync(path, "kept");
    const run = await exportWith({ answer: ok(HELD), rest: ["standup-brief", "--out", path, "--json"] });

    expect(run.code).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe("kept");
    const document = JSON.parse(run.out[0]!) as { kind: string; message: string };
    expect(document.kind).toBe("write-failed");
    expect(document.message).toContain("EEXIST");
  });

  it("says a page the store does not hold is not found, writes nothing, and exits 3", async () => {
    const path = join(dir, "retro-brief.html");
    const answer = err(PublishedPagesReadErrors.notPublished({ pageKey: "retro-brief" }));
    const run = await exportWith({ answer, rest: ["retro-brief", "--out", path] });

    expect(run.code).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.diagnostics).toEqual(["page export: the store holds no published page retro-brief"]);
    expect(() => statSync(path)).toThrow("ENOENT");
  });

  it("says a store that cannot answer is unreadable, never not found, and exits 1", async () => {
    const failure = StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "read the files" });
    const run = await exportWith({
      answer: err(failure),
      rest: ["retro-brief", "--out", join(dir, "r.html"), "--json"],
    });

    expect(run.code).toBe(EXIT_ERROR);
    expect(JSON.parse(run.out[0]!)).toEqual({
      code: failure.code,
      kind: "store-unreadable",
      message: failure.message,
      schemaVersion: 1,
      slug: "retro-brief",
    });
  });

  it("refuses a missing or relative --out, a bad slug and two slugs before reading anything", async () => {
    expect(unwrapErr(pageExportOptions({ rest: ["standup-brief"] }))).toEqual([
      "--out is required and must be an absolute path: the one file this export creates",
    ]);
    expect(unwrapErr(pageExportOptions({ rest: ["standup-brief", "--out", "brief.html"] }))).toEqual([
      "--out is required and must be an absolute path: the one file this export creates",
    ]);
    expect(unwrapErr(pageExportOptions({ rest: ["../up", "--out", "/tmp/a.html"] }))).toEqual([
      '"../up" is not a page slug',
    ]);
    const run = await exportWith({ answer: ok(HELD), rest: ["a", "b", "--out", "/tmp/a.html"] });
    expect(run.code).toBe(EXIT_USAGE);
    expect(run.asked).toEqual([]);
    expect(run.diagnostics[0]).toBe("page export takes exactly one slug, got 2");
  });
});
