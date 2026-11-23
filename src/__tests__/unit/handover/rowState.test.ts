import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DerivedRowReadErrors, readDerivedRowState } from "../../../handover/rowState.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let root = "";
let handoverDir = "";
let runsDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "row-state-"));
  handoverDir = join(root, "handovers");
  runsDir = join(root, "runs");
  mkdirSync(join(handoverDir, "archive"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A doc at `<dir>/<file>.md` declaring `slug` and `status`. */
function doc({
  file,
  slug,
  status,
  dir = handoverDir,
}: {
  file: string;
  slug: string;
  status: string;
  dir?: string;
}): void {
  writeFileSync(join(dir, `${file}.md`), `---\nslug: ${slug}\nstatus: ${status}\n---\n# doc\n`);
}

/** A journal for `slug` holding these raw lines. */
function journal({ slug, lines }: { slug: string; lines: readonly string[] }): void {
  writeFileSync(join(runsDir, `${slug}.jsonl`), lines.map((line) => `${line}\n`).join(""));
}

const CLOSED = JSON.stringify({
  atIso: "2026-09-27T05:04:35.000Z",
  kind: "closed",
  residue: [],
  summary: "merged as #1398",
});

describe("readDerivedRowState — one row's status from its doc and journal alone", () => {
  it("derives the authored status when the row has no journal", () => {
    doc({ file: "a-row", slug: "a-row", status: "ready" });
    expect(unwrap(readDerivedRowState({ handoverDir, runsDir, slug: "a-row" }))).toEqual({
      archived: false,
      authoredStatus: "ready",
      settlement: undefined,
      settlementWitness: undefined,
      slug: "a-row",
      status: "ready",
    });
  });

  it("carries a settlement and its witness, which is what lifts a recipe's failure hold", () => {
    writeFileSync(
      join(handoverDir, "a-row.md"),
      [
        "---",
        "slug: a-row",
        "kind: ask",
        'summary: "a finding"',
        "status: ready",
        "askedIso: 2026-09-29T00:53:31.075Z",
        "origin: finding",
        "observedBy: a-session",
        "evidence: [a log line]",
        "blockedBy: []",
        "artifact: null",
        "doneWhen: []",
        "settlement: filed",
        "settlementWitness: the-fix-row",
        "---",
        "# doc",
        "",
      ].join("\n"),
    );
    expect(unwrap(readDerivedRowState({ handoverDir, runsDir, slug: "a-row" }))).toEqual({
      archived: false,
      authoredStatus: "ready",
      settlement: "filed",
      settlementWitness: "the-fix-row",
      slug: "a-row",
      status: "done",
    });
  });

  it("derives done from a closed event, over an authored ready", () => {
    doc({ file: "a-row", slug: "a-row", status: "ready" });
    journal({ lines: [CLOSED], slug: "a-row" });
    expect(unwrap(readDerivedRowState({ handoverDir, runsDir, slug: "a-row" })).status).toBe("done");
  });

  it("reads an archived doc by the same exact slug", () => {
    doc({ dir: join(handoverDir, "archive"), file: "old-row", slug: "old-row", status: "cancelled" });
    const read = unwrap(readDerivedRowState({ handoverDir, runsDir, slug: "old-row" }));
    expect([read.status, read.archived]).toEqual(["cancelled", true]);
  });

  it("is ROW_MISSING when no doc carries the slug, live or archived", () => {
    expect(unwrapErr(readDerivedRowState({ handoverDir, runsDir, slug: "no-such-row" }))).toEqual(
      DerivedRowReadErrors.missing({ slug: "no-such-row" }),
    );
  });

  it("is ROW_UNREADABLE when the file there declares another slug", () => {
    doc({ file: "a-row", slug: "b-row", status: "ready" });
    const error = unwrapErr(readDerivedRowState({ handoverDir, runsDir, slug: "a-row" }));
    expect(error.code).toBe("ROW_UNREADABLE");
    expect(error.message).toContain("its front-matter names slug b-row");
  });

  it("is ROW_UNREADABLE, never a partial derivation, when a journal line does not decode", () => {
    doc({ file: "a-row", slug: "a-row", status: "ready" });
    journal({ lines: [CLOSED, "{not json"], slug: "a-row" });
    const error = unwrapErr(readDerivedRowState({ handoverDir, runsDir, slug: "a-row" }));
    expect(error.code).toBe("ROW_UNREADABLE");
    expect(error).toEqual(
      DerivedRowReadErrors.unreadable({ slug: "a-row", why: "1 run-journal line(s) did not decode" }),
    );
    expect(error.message).toBe("the board row a-row did not read whole — 1 run-journal line(s) did not decode");
  });

  it("is ROW_UNREADABLE when the doc path is a directory rather than a file", () => {
    mkdirSync(join(handoverDir, "a-row.md"));
    const error = unwrapErr(readDerivedRowState({ handoverDir, runsDir, slug: "a-row" }));
    expect(error.code).toBe("ROW_UNREADABLE");
    expect(error.message).toContain("it is not a regular file of at most 2 MiB");
  });

  it("is ROW_UNREADABLE for a slug the run store cannot open", () => {
    expect(unwrapErr(readDerivedRowState({ handoverDir, runsDir, slug: "../escape" })).code).toBe("ROW_UNREADABLE");
  });
});
