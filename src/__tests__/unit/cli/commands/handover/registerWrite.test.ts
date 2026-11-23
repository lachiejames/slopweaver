/**
 * `handover register`'s write half: the slug it may build a path from, the tags `--tag` plans, and the doc it
 * creates — judged, then written with `wx`. A real temp board, which `testing.md` allows for a round trip: the
 * property under test is what is and is not on disk afterwards.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { plannedRow, plannedTags } from "../../../../../cli/commands/handover/registerTagged.js";
import { createRowDoc, registerSlug } from "../../../../../cli/commands/handover/registerWrite.js";
import { parseTagRequest } from "../../../../../handover/tagWrite.js";
import { TagWriteErrors } from "../../../../../handover/tagWriteErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const DOC = ["---", "slug: new-row", "kind: ask", "summary: a row", "status: ready", "---", "", "# a row", ""].join(
  "\n",
);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A temp home with a board and a runs directory. */
function board(): { handoverDir: string; runsDir: string } {
  const home = mkdtempSync(join(tmpdir(), "sw-register-"));
  dirs.push(home);
  const handoverDir = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  return { handoverDir, runsDir };
}

describe("registerSlug", () => {
  it("keeps a named slug and builds one from the ask otherwise", () => {
    expect(registerSlug({ ask: "tag this row", named: "my-row" })).toEqual({ slug: "my-row" });
    expect(registerSlug({ ask: "tag this row", named: undefined })).toEqual({ slug: "tag-this-row" });
  });

  it("refuses a slug that would build a path outside the board, and an empty one", () => {
    expect(registerSlug({ ask: "x", named: "../escape" })).toEqual({
      refusal: '"../escape" is not a usable slug — a plain name of letters, digits, . _ -',
    });
    expect(registerSlug({ ask: "x", named: "" })).toEqual({
      refusal: "could not build a slug from --ask — pass --slug",
    });
  });
});

describe("plannedTags", () => {
  it("plans nothing when --tag is absent", () => {
    expect(plannedTags({ values: {} })).toEqual({ tags: undefined });
  });

  it("splits --tag on the separator and reads --new-value beside it", () => {
    expect(plannedTags({ values: { "new-value": "workstream=hiring", tag: "impact=high,workstream=hiring" } })).toEqual(
      {
        tags: {
          drop: [],
          newValues: [{ key: "workstream", value: "hiring" }],
          set: [
            { key: "impact", value: "high" },
            { key: "workstream", value: "hiring" },
          ],
        },
      },
    );
  });

  it("refuses --new-value without --tag, and --tag beside --dir", () => {
    expect(plannedTags({ values: { "new-value": "workstream=hiring" } })).toEqual({
      refusal: "--new-value acknowledges a value --tag sets — pass --tag",
    });
    expect(plannedTags({ values: { dir: "/tmp/board", tag: "impact=high" } })).toEqual({
      refusal: "--tag is refused beside --dir: a row's journal belongs to the home board, whatever --dir names",
    });
  });
});

describe("plannedRow", () => {
  it("plans the slug and tags together, refusing the slug first", () => {
    expect(plannedRow({ ask: "tag this row", values: { tag: "impact=high" } })).toEqual({
      slug: "tag-this-row",
      tags: { drop: [], newValues: [], set: [{ key: "impact", value: "high" }] },
    });
    expect(plannedRow({ ask: "x", values: { slug: "../escape", tag: "platfrom=slack" } })).toEqual({
      refusal: '"../escape" is not a usable slug — a plain name of letters, digits, . _ -',
    });
  });
});

describe("createRowDoc", () => {
  it("writes an untagged row with nothing judged", () => {
    const paths = board();
    const created = unwrap(createRowDoc({ ...paths, slug: "new-row", tags: undefined, text: DOC }));
    expect(created).toEqual({ judged: undefined, path: join(paths.handoverDir, "new-row.md") });
    expect(readFileSync(created.path, "utf8")).toBe(DOC);
  });

  it("creates the board directory a fresh home does not have yet", () => {
    const paths = board();
    const handoverDir = join(paths.handoverDir, "fresh");
    const created = unwrap(
      createRowDoc({ handoverDir, runsDir: paths.runsDir, slug: "new-row", tags: undefined, text: DOC }),
    );
    expect(readFileSync(created.path, "utf8")).toBe(DOC);
  });

  it("never overwrites a doc already at the path", () => {
    const paths = board();
    writeFileSync(join(paths.handoverDir, "new-row.md"), "keep me\n", "utf8");
    expect(unwrapErr(createRowDoc({ ...paths, slug: "new-row", tags: undefined, text: DOC }))).toBe(
      `${join(paths.handoverDir, "new-row.md")} already exists — pass --slug for a distinct row`,
    );
    expect(readFileSync(join(paths.handoverDir, "new-row.md"), "utf8")).toBe("keep me\n");
  });

  it("refuses a tagged row whose slug has a journal, before the doc exists", () => {
    const paths = board();
    writeFileSync(join(paths.runsDir, "new-row.jsonl"), "", "utf8");
    const tags = unwrap(parseTagRequest({ assignments: ["impact=high"], drops: undefined, newValues: undefined }));
    expect(unwrapErr(createRowDoc({ ...paths, slug: "new-row", tags, text: DOC }))).toBe(
      TagWriteErrors.slugHasHistory({ path: join(paths.runsDir, "new-row.jsonl") }).message,
    );
    expect(existsSync(join(paths.handoverDir, "new-row.md"))).toBe(false);
  });

  it("refuses a tagged row whose slug another doc already claims under another filename", () => {
    const paths = board();
    writeFileSync(join(paths.handoverDir, "elsewhere.md"), DOC, "utf8");
    const tags = unwrap(parseTagRequest({ assignments: ["impact=high"], drops: undefined, newValues: undefined }));
    expect(unwrapErr(createRowDoc({ ...paths, slug: "new-row", tags, text: DOC }))).toBe(
      `${join(paths.handoverDir, "elsewhere.md")} already claims the slug new-row — pass --slug for a distinct row`,
    );
    expect(existsSync(join(paths.handoverDir, "new-row.md"))).toBe(false);
  });

  it("refuses a tagged row whose slug an ARCHIVED doc claims under another filename", () => {
    const paths = board();
    mkdirSync(join(paths.handoverDir, "archive"));
    writeFileSync(join(paths.handoverDir, "archive", "old-name.md"), DOC, "utf8");
    const tags = unwrap(parseTagRequest({ assignments: ["impact=high"], drops: undefined, newValues: undefined }));
    expect(unwrapErr(createRowDoc({ ...paths, slug: "new-row", tags, text: DOC }))).toBe(
      `${join(paths.handoverDir, "archive", "old-name.md")} already claims the slug new-row, archived — pass --slug for a distinct row`,
    );
    expect(existsSync(join(paths.handoverDir, "new-row.md"))).toBe(false);
  });

  it("judges the tags against the prospective doc and hands back what to append", () => {
    const paths = board();
    const tags = unwrap(parseTagRequest({ assignments: ["impact=high"], drops: undefined, newValues: undefined }));
    const created = unwrap(createRowDoc({ ...paths, slug: "new-row", tags, text: DOC }));
    expect(created.judged!.change).toEqual({ drop: [], satisfied: [], set: [{ key: "impact", value: "high" }] });
    expect(existsSync(created.path)).toBe(true);
  });
});
