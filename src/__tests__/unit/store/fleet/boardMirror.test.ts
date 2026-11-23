/**
 * The pure half of the board mirror, and the two outcomes that reach no database.
 *
 * The half that writes a row — a file and its row made to disagree, then converge through a real verb — needs
 * a live store and is `integration/boardMirror.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { docHash } from "../../../../handover/runStore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { StoreErrors } from "../../../../store/errors.js";
import {
  boardStoreIsAuthoritative,
  isHomeBoardDoc,
  mirrorBoardDoc,
  mirrorFailureLines,
  projectMirroredDoc,
} from "../../../../store/fleet/boardMirror.js";

const DOC = [
  "---",
  "slug: a-row",
  "kind: ask",
  "summary: a row",
  "status: ready",
  "artifact: null",
  "---",
  "",
  "# prose",
  "",
].join("\n");

describe("isHomeBoardDoc", () => {
  it("admits a markdown document directly in the board directory", () => {
    expect(isHomeBoardDoc({ boardDir: "/h/handovers", path: "/h/handovers/a-row.md" })).toBe(true);
  });

  it("refuses an archived document, which is not the live board", () => {
    expect(isHomeBoardDoc({ boardDir: "/h/handovers", path: "/h/handovers/archive/a-row.md" })).toBe(false);
  });

  it("refuses a document on a --dir board elsewhere, whose slug could shadow a real row", () => {
    expect(isHomeBoardDoc({ boardDir: "/h/handovers", path: "/elsewhere/a-row.md" })).toBe(false);
  });

  it("refuses a non-markdown file in the board directory", () => {
    expect(isHomeBoardDoc({ boardDir: "/h/handovers", path: "/h/handovers/notes.txt" })).toBe(false);
  });
});

describe("projectMirroredDoc", () => {
  it("hashes exactly the text it was given, so the row's hash witnesses the file", () => {
    const row = unwrap(projectMirroredDoc({ path: "/h/handovers/a-row.md", text: DOC }));
    expect(row.docHash).toBe(docHash({ text: DOC }));
    expect(row.slug).toBe("a-row");
    expect(row.body).toBe("# prose\n");
  });

  it("returns an unreadable instant as a typed failure rather than throwing", () => {
    const result = projectMirroredDoc({
      path: "/h/handovers/a-row.md",
      text: DOC.replace("status: ready", "status: ready\naskedIso: not-a-time"),
    });
    expect(unwrapErr(result).code).toBe("UNREADABLE_DOC_FIELD");
  });
});

describe("boardStoreIsAuthoritative", () => {
  it("is false during dual-write, so a failed mirror never fails the verb that wrote the file", () => {
    expect(boardStoreIsAuthoritative()).toBe(false);
  });
});

describe("mirrorFailureLines", () => {
  it("names the file as the board, the failure code, the reconcile verb and the store's own message", () => {
    const error = StoreErrors.unreachable({ reason: "connect ECONNREFUSED 127.0.0.1:55322" });
    const lines = mirrorFailureLines({ error, path: "/h/handovers/a-row.md", verb: "pause" });
    expect(lines[0]).toBe(
      "handover pause: /h/handovers/a-row.md is written and is the board, but board_row is BEHIND it " +
        "(STORE_UNREACHABLE) — reconcile with `slopweaver store import-fleet --only board` once the store answers",
    );
    expect(lines[1]).toBe(`  ${error.message}`);
  });
});

describe("mirrorBoardDoc without a database", () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length > 0) {
      rmSync(homes.pop()!, { force: true, recursive: true });
    }
  });

  function home(): { home: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "board-mirror-"));
    homes.push(dir);
    mkdirSync(join(dir, "handovers"), { recursive: true });
    const path = join(dir, "handovers", "a-row.md");
    writeFileSync(path, DOC, "utf8");
    return { home: dir, path };
  }

  it("is no-store when this home selected no store, and opens nothing", async () => {
    const fixture = home();
    const outcome = unwrap(await mirrorBoardDoc({ env: {}, home: fixture.home, path: fixture.path }));
    expect(outcome.kind).toBe("no-store");
  });

  it("is outside-board for a document that is not in the home's board directory", async () => {
    const fixture = home();
    const stray = join(fixture.home, "a-row.md");
    writeFileSync(stray, DOC, "utf8");
    const outcome = unwrap(await mirrorBoardDoc({ env: {}, home: fixture.home, path: stray }));
    expect(outcome.kind).toBe("outside-board");
  });

  it("refuses a malformed document before any store is selected", async () => {
    const fixture = home();
    writeFileSync(fixture.path, DOC.replace("status: ready", "status: ready\naskedIso: not-a-time"), "utf8");
    const result = await mirrorBoardDoc({ env: {}, home: fixture.home, path: fixture.path });
    expect(unwrapErr(result).code).toBe("UNREADABLE_DOC_FIELD");
  });
});
