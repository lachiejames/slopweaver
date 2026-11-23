/**
 * `rowBySlug` over a real temp board: the file at the slug's own path wins, live then archived; only on an exact miss
 * does the one doc DECLARING the slug answer, whatever its file is called; none, two, or a board that
 * will not list each name why the slug reaches no one row.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RowBySlugErrors, rowBySlug } from "../../../handover/rowBySlug.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let handoverDir: string;

beforeEach(() => {
  handoverDir = mkdtempSync(join(tmpdir(), "row-by-slug-"));
});

afterEach(() => {
  rmSync(handoverDir, { force: true, recursive: true });
});

/** Write one minimal row declaring `slug` at `file` under `dir`, returning its path. */
function writeRow({ dir, file, slug }: { dir: string; file: string; slug: string }): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(
    path,
    `---\nslug: ${slug}\nkind: ask\nsummary: x\nstatus: ready\naskedIso: 2026-11-05T12:00:00.000Z\n---\n\n# x\n`,
  );
  return path;
}

describe("rowBySlug", () => {
  it("answers the file at the slug's own path before any doc filed elsewhere that declares it", () => {
    const own = writeRow({ dir: handoverDir, file: "the-ask.md", slug: "the-ask" });
    writeRow({ dir: handoverDir, file: "an-alias.md", slug: "the-ask" });

    expect(unwrap(rowBySlug({ handoverDir, slug: "the-ask" })).path).toBe(own);
  });

  it("answers an archived file at the slug's own path", () => {
    const archived = writeRow({ dir: join(handoverDir, "archive"), file: "the-ask.md", slug: "the-ask" });

    expect(unwrap(rowBySlug({ handoverDir, slug: "the-ask" })).path).toBe(archived);
  });

  it("answers the one doc filed under another name that declares the slug", () => {
    const alias = writeRow({ dir: handoverDir, file: "an-alias.md", slug: "the-routed-ask" });

    expect(unwrap(rowBySlug({ handoverDir, slug: "the-routed-ask" })).path).toBe(alias);
  });

  it("names no row when nothing declares the slug", () => {
    writeRow({ dir: handoverDir, file: "other.md", slug: "other" });

    expect(unwrapErr(rowBySlug({ handoverDir, slug: "the-ask" }))).toEqual(RowBySlugErrors.noRow({ slug: "the-ask" }));
  });

  it("names every file when two declare the slug and none sits at its own path", () => {
    const first = writeRow({ dir: handoverDir, file: "alias-a.md", slug: "the-ask" });
    const second = writeRow({ dir: join(handoverDir, "archive"), file: "alias-b.md", slug: "the-ask" });

    expect(unwrapErr(rowBySlug({ handoverDir, slug: "the-ask" }))).toEqual(
      RowBySlugErrors.slugDeclaredTwice({ paths: [first, second], slug: "the-ask" }),
    );
  });

  it("refuses to decide when the archive will not list, rather than reading a miss as no row", () => {
    writeFileSync(join(handoverDir, "archive"), "a file where the archive directory belongs");

    const failure = unwrapErr(rowBySlug({ handoverDir, slug: "the-ask" }));

    expect(failure.code).toBe("BOARD_UNLISTABLE");
    expect(failure.message).toContain("no file reads at the-ask's own path, and the board would not list");
  });
});
