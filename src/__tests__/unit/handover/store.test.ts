/**
 * Round-trip tests for the board scan, against real temporary directories.
 *
 * Filesystem use is sanctioned by `testing.md` for a genuine round-trip, and this is one: the property is
 * "does the scan report what is actually on disk, including when it cannot look?".
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { lookupArchivedDoc, readExactDoc, scanBoard, scanBoardConcurrently } from "../../../handover/store.js";
import { unwrapErr } from "../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function emptyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-board-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("scanBoard", () => {
  it("reads the docs that are there", () => {
    const dir = emptyDir();
    writeFileSync(join(dir, "a.md"), "---\nslug: a\nstatus: ready\n---\n");
    writeFileSync(join(dir, "b.md"), "---\nslug: b\nstatus: done\n---\n");

    const scan = scanBoard({ handoverDir: dir })._unsafeUnwrap();

    expect(scan.docs.map((doc) => doc.slug)).toEqual(["a", "b"]);
  });

  it("ignores files that are not markdown", () => {
    const dir = emptyDir();
    writeFileSync(join(dir, "notes.txt"), "not a doc\n");

    expect(scanBoard({ handoverDir: dir })._unsafeUnwrap().docs).toEqual([]);
  });

  /** A fresh machine has no directory yet, and that is emptiness rather than breakage. */
  it("treats a directory that does not exist as an empty board", () => {
    const scan = scanBoard({ handoverDir: join(emptyDir(), "not-created-yet") });

    expect(scan.isOk()).toBe(true);
    expect(scan._unsafeUnwrap().docs).toEqual([]);
  });

  /**
   * The fifth defect of one shape found in this change. Swallowing every readdir failure meant a permissions
   * error printed "No orchestration docs" and hid every piece of planned work. A board that cannot look must
   * say so, never report nothing is there.
   */
  it("fails loudly when the directory exists but cannot be read", () => {
    const parent = emptyDir();
    const dir = join(parent, "locked");
    mkdirSync(dir);
    writeFileSync(join(dir, "hidden.md"), "---\nslug: hidden\nstatus: ready\n---\n");
    chmodSync(dir, 0o000);

    const scan = scanBoard({ handoverDir: dir });

    chmodSync(dir, 0o700);
    const error = unwrapErr(scan);
    expect(error.kind).toBe("io");
    expect(error.message).toContain("permission denied");
  });
});

describe("a doc that cannot be read SAFELY is reported, never read", () => {
  /**
   * A FIFO named `something.md` makes `readFileSync` block until a writer appears — forever, in practice. That
   * is fatal inside the Stop hook, whose deadline is enforced above the wrapper script, so a blocked read cannot
   * fail open. Found by an adversarial pass.
   */
  it("reports a non-regular file as unreadable instead of opening it", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-fifo-"));
    fixtureDirs.push(dir);
    execFileSync("mkfifo", [join(dir, "trap.md")]);

    const scan = scanBoard({ handoverDir: dir })._unsafeUnwrap();

    expect(scan.docs).toEqual([]);
    expect(scan.unreadable).toEqual(["trap.md"]);
  });

  it("still reads an ordinary doc alongside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-fifo2-"));
    fixtureDirs.push(dir);
    execFileSync("mkfifo", [join(dir, "trap.md")]);
    writeFileSync(join(dir, "real.md"), "---\nslug: real\nstatus: ready\n---\n", "utf8");

    const scan = scanBoard({ handoverDir: dir })._unsafeUnwrap();

    expect(scan.docs.map((doc) => doc.slug)).toEqual(["real"]);
    expect(scan.unreadable).toEqual(["trap.md"]);
  });
});

describe("scanBoardConcurrently", () => {
  /** A `keep` that names the doc and the length of the text it was handed, so what was kept is checkable exactly. */
  const lengthOf = ({ doc, text }: { doc: { slug: string }; text: string }): string =>
    `${doc.slug}:${String(text.length)}`;

  /** A board with more docs than the scan has open at once, so the pool's ordering is what is under test. */
  function wideBoard(): string {
    const dir = emptyDir();
    for (let index = 0; index < 80; index += 1) {
      const slug = `row-${String(index).padStart(3, "0")}`;
      writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n\n# ${slug}\n`);
    }
    execFileSync("mkfifo", [join(dir, "row-040-trap.md")]);
    mkdirSync(join(dir, "row-041-dir.md"));
    return dir;
  }

  it("finds the same docs, in the same order, with the same unreadable names, as the serial scan", async () => {
    const dir = wideBoard();
    const serial = scanBoard({ handoverDir: dir })._unsafeUnwrap();

    const concurrent = (await scanBoardConcurrently({ handoverDir: dir, keep: lengthOf }))._unsafeUnwrap();

    expect(serial.docs.length).toBe(80);
    expect(concurrent.docs).toEqual(serial.docs);
    expect(concurrent.unreadable).toEqual(["row-040-trap.md", "row-041-dir.md"]);
    expect(concurrent.unreadable).toEqual(serial.unreadable);
  });

  it("keeps what `keep` took from each read doc's text under its path, and none for a file it refused", async () => {
    const dir = wideBoard();

    const scan = (await scanBoardConcurrently({ handoverDir: dir, keep: lengthOf }))._unsafeUnwrap();

    expect(scan.kept.size).toBe(80);
    expect(scan.kept.get(join(dir, "row-007.md"))).toBe("row-007:47");
    expect(scan.kept.has(join(dir, "row-040-trap.md"))).toBe(false);
  });

  it("keeps a doc whose `keep` threw on the board, with nothing kept for it", async () => {
    const dir = wideBoard();
    const keep = ({ doc }: { doc: { slug: string } }): string => {
      if (doc.slug === "row-007") {
        throw new Error("could not take the owner's words");
      }
      return doc.slug;
    };

    const scan = (await scanBoardConcurrently({ handoverDir: dir, keep }))._unsafeUnwrap();

    expect(scan.docs.map((doc) => doc.slug)).toContain("row-007");
    expect(scan.docs.length).toBe(80);
    expect(scan.kept.size).toBe(79);
    expect(scan.kept.has(join(dir, "row-007.md"))).toBe(false);
    expect(scan.unreadable).toEqual(["row-040-trap.md", "row-041-dir.md"]);
  });

  it("treats a directory that does not exist as an empty board", async () => {
    const scan = await scanBoardConcurrently({ handoverDir: join(emptyDir(), "not-created-yet"), keep: lengthOf });

    expect(scan._unsafeUnwrap().docs).toEqual([]);
  });

  it("fails loudly when the directory exists but cannot be read", async () => {
    const parent = emptyDir();
    const dir = join(parent, "locked");
    mkdirSync(dir);
    writeFileSync(join(dir, "hidden.md"), "---\nslug: hidden\nstatus: ready\n---\n");
    chmodSync(dir, 0o000);

    const scan = await scanBoardConcurrently({ handoverDir: dir, keep: lengthOf });

    chmodSync(dir, 0o700);
    expect(unwrapErr(scan).message).toContain("permission denied");
  });
});

describe("lookupArchivedDoc", () => {
  it("resolves a doc that exists only under archive/, by exact slug", () => {
    const dir = emptyDir();
    mkdirSync(join(dir, "archive"));
    writeFileSync(
      join(dir, "archive", "shelved.md"),
      "---\nslug: shelved\nstatus: cancelled\nstatusSummary: superseded\n---\n",
    );

    const doc = lookupArchivedDoc({ handoverDir: dir, slug: "shelved" });

    expect(doc?.slug).toBe("shelved");
    expect(doc?.status).toBe("cancelled");
  });

  it("returns undefined for a slug archive/ does not have", () => {
    const dir = emptyDir();
    mkdirSync(join(dir, "archive"));

    expect(lookupArchivedDoc({ handoverDir: dir, slug: "ghost" })).toBeUndefined();
  });

  it("returns undefined rather than substituting a same-named file with the wrong slug inside", () => {
    const dir = emptyDir();
    mkdirSync(join(dir, "archive"));
    writeFileSync(join(dir, "archive", "requested.md"), "---\nslug: actually-something-else\nstatus: done\n---\n");

    expect(lookupArchivedDoc({ handoverDir: dir, slug: "requested" })).toBeUndefined();
  });

  it("never enumerates the archive directory — a FIFO named after an unrelated slug does not hang this", () => {
    const dir = emptyDir();
    mkdirSync(join(dir, "archive"));
    execFileSync("mkfifo", [join(dir, "archive", "unrelated-trap.md")]);
    writeFileSync(join(dir, "archive", "shelved.md"), "---\nslug: shelved\nstatus: done\n---\n");

    expect(lookupArchivedDoc({ handoverDir: dir, slug: "shelved" })?.slug).toBe("shelved");
  });

  it("refuses to open a FIFO placed exactly at the requested slug's path", () => {
    const dir = emptyDir();
    mkdirSync(join(dir, "archive"));
    execFileSync("mkfifo", [join(dir, "archive", "trap.md")]);

    expect(lookupArchivedDoc({ handoverDir: dir, slug: "trap" })).toBeUndefined();
  });
});

describe("readExactDoc", () => {
  it("names every front-matter problem in its refusal, never only a count", () => {
    const dir = emptyDir();
    const doneWhen = '  - "present: src/a.ts#one"\n  - "absent: src/b.ts#two"\n';
    writeFileSync(join(dir, "quoted.md"), `---\nslug: quoted\nstatus: ready\ndoneWhen:\n${doneWhen}---\n`);

    const refused = unwrapErr(readExactDoc({ handoverDir: dir, slug: "quoted" }));

    expect(refused.code).toBe("DOC_UNREADABLE");
    expect(refused.why).toBe(
      "its front-matter has 2 problem(s): doneWhen[0] is not a `kind: value` entry; doneWhen[1] is not a `kind: value` entry",
    );
  });

  it("reads the same entries written as maps", () => {
    const dir = emptyDir();
    const doneWhen = "  - present: src/a.ts#one\n  - absent: 'src/b.ts#two === \"x\" && y'\n";
    writeFileSync(join(dir, "mapped.md"), `---\nslug: mapped\nstatus: ready\ndoneWhen:\n${doneWhen}---\n`);

    const read = readExactDoc({ handoverDir: dir, slug: "mapped" })._unsafeUnwrap();

    expect(read!.doc.doneWhen).toEqual([
      { file: "src/a.ts", kind: "present", symbol: "one" },
      { file: "src/b.ts", kind: "absent", symbol: 'two === "x" && y' },
    ]);
  });
});
