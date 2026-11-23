import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendRunEvent,
  docHash,
  isSafeSlug,
  readRunJournal,
  readRunJournalAsync,
  runJournalPath,
} from "../../../handover/runStore.js";
import { unwrapErr } from "../../../lib/result.js";

const AT = "2026-08-04T00:00:00.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real runs directory, so the round-trip is genuine rather than simulated. */
function runsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-store-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("isSafeSlug", () => {
  it("accepts an ordinary slug", () => {
    expect(isSafeSlug({ slug: "handover-derived-status" })).toBe(true);
    expect(isSafeSlug({ slug: "v2.datadog_atlas-3" })).toBe(true);
  });

  /**
   * A slug is interpolated straight into a journal filename, and it comes from front-matter a human typed. An
   * adversarial pass showed `../other-doc` normalising out of the runs directory and aliasing ANOTHER doc's
   * journal, so a write was attributed to the wrong doc.
   */
  it("rejects anything that could escape the runs directory", () => {
    const unsafe = ["../other", "a/b", "./x", "..", ".", "", "/abs", "x/../y"];

    expect(unsafe.map((slug) => isSafeSlug({ slug }))).toEqual(unsafe.map(() => false));
  });

  it("rejects a leading dot or dash, so a slug cannot look like a flag or a hidden file", () => {
    expect(isSafeSlug({ slug: ".hidden" })).toBe(false);
    expect(isSafeSlug({ slug: "-dash" })).toBe(false);
  });
});

describe("the journal refuses an unsafe slug before touching disk", () => {
  it("refuses to READ through a traversing slug", () => {
    const result = readRunJournal({ runsDir: runsDir(), slug: "../escape" });

    expect(unwrapErr(result)).toEqual({
      kind: "io",
      message: '"../escape" is not usable as a journal filename — a slug must be a plain name (letters, digits, . _ -)',
      operation: "handover.readRunJournal",
      path: "../escape",
    });
  });

  it("refuses to WRITE through a traversing slug", () => {
    const result = appendRunEvent({
      event: { atIso: AT, branch: "b", docHash: "h", kind: "started" },
      runsDir: runsDir(),
      slug: "../escape",
    });

    expect(unwrapErr(result)).toEqual({
      kind: "io",
      message: '"../escape" is not usable as a journal filename — a slug must be a plain name (letters, digits, . _ -)',
      operation: "handover.appendRunEvent",
      path: "../escape",
    });
  });

  it("names the slug in the refusal, so the offending doc can be found", () => {
    const result = readRunJournal({ runsDir: runsDir(), slug: "a/b" });

    expect(result.isErr()).toBe(true);
    expect(result.isErr() ? result.error.message : "").toContain("a/b");
  });
});

describe("append and read round-trip", () => {
  it("creates the directory on first append and reads the event back", () => {
    const dir = join(runsDir(), "nested-not-yet-made");
    const written = appendRunEvent({
      event: { atIso: AT, branch: "feat/x", docHash: "abc", kind: "started" },
      runsDir: dir,
      slug: "a-doc",
    });

    expect(written.isOk()).toBe(true);
    expect(written._unsafeUnwrap()).toBe(runJournalPath({ runsDir: dir, slug: "a-doc" }));
    expect(readRunJournal({ runsDir: dir, slug: "a-doc" })._unsafeUnwrap().events).toEqual([
      { atIso: AT, branch: "feat/x", docHash: "abc", kind: "started" },
    ]);
  });

  it("appends rather than overwriting, one JSON object per line", () => {
    const dir = runsDir();
    appendRunEvent({ event: { atIso: AT, branch: "b", docHash: "h", kind: "started" }, runsDir: dir, slug: "d" });
    appendRunEvent({ event: { atIso: AT, failed: 1, kind: "probed", passed: 2 }, runsDir: dir, slug: "d" });

    const lines = readFileSync(runJournalPath({ runsDir: dir, slug: "d" }), "utf8")
      .trimEnd()
      .split("\n");

    expect(lines).toHaveLength(2);
    expect(readRunJournal({ runsDir: dir, slug: "d" })._unsafeUnwrap().events).toHaveLength(2);
  });

  it("treats a doc that was never run as an empty journal rather than an error", () => {
    expect(readRunJournal({ runsDir: runsDir(), slug: "never-run" })._unsafeUnwrap()).toEqual({
      events: [],
      unknownKind: [],
      unreadable: [],
    });
  });
});

describe("a journal that cannot be read SAFELY is refused, never opened", () => {
  /**
   * The same class of hang `store.ts`'s `isReadableDoc` already guards against for handover docs: a FIFO
   * named `<slug>.jsonl` makes `readFileSync` block until a writer appears, in practice forever. This reader
   * is now reached by an aggregate board-wide scan (`handover list`) as well as by every named lifecycle
   * verb, so the guard has to live here rather than in any one caller.
   */
  it("refuses a FIFO instead of opening it", () => {
    const dir = runsDir();
    execFileSync("mkfifo", [join(dir, "trap.jsonl")]);

    const result = readRunJournal({ runsDir: dir, slug: "trap" });
    const path = runJournalPath({ runsDir: dir, slug: "trap" });

    expect(unwrapErr(result).message).toBe(
      `${path} is not a regular file — refusing to read a run journal that could hang`,
    );
  });

  it("a normal journal beside the FIFO still reads cleanly", () => {
    const dir = runsDir();
    execFileSync("mkfifo", [join(dir, "trap.jsonl")]);
    appendRunEvent({ event: { atIso: AT, branch: "b", docHash: "h", kind: "started" }, runsDir: dir, slug: "real" });

    expect(readRunJournal({ runsDir: dir, slug: "real" })._unsafeUnwrap().events).toHaveLength(1);
    expect(readRunJournal({ runsDir: dir, slug: "trap" }).isErr()).toBe(true);
  });

  /** ENOENT through a link that is there is a journal nobody can see — read as "no run", a row would read open. */
  it("refuses a dangling link instead of reading it as an empty journal, sync and async alike", async () => {
    const dir = runsDir();
    symlinkSync(join(dir, "nowhere.jsonl"), join(dir, "dangling.jsonl"));
    const path = runJournalPath({ runsDir: dir, slug: "dangling" });
    const expected = `${path} is a link to nothing — refusing to read it as an empty run journal`;

    expect(unwrapErr(readRunJournal({ runsDir: dir, slug: "dangling" })).message).toBe(expected);
    expect(unwrapErr(await readRunJournalAsync({ runsDir: dir, slug: "dangling" })).message).toBe(expected);
  });
});

describe("docHash", () => {
  it("is stable for the same text", () => {
    expect(docHash({ text: "a doc" })).toBe(docHash({ text: "a doc" }));
  });

  it("changes when the doc changes — which is how an amendment is detected", () => {
    expect(docHash({ text: "a doc" })).not.toBe(docHash({ text: "a doc, amended" }));
  });

  /** Editing a doc on another machine must not read as a rewrite. */
  it("ignores line-ending style", () => {
    expect(docHash({ text: "one\r\ntwo\r\n" })).toBe(docHash({ text: "one\ntwo\n" }));
  });
});

describe("an append can never fuse itself onto a newline-less final line", () => {
  /**
   * A journal whose last line lacks its newline PARSES fine — a killed process is the normal way that happens —
   * but appending straight onto it would fuse two events into one unreadable line, destroying the earlier one.
   * Found by an adversarial pass.
   */
  it("separates the new event from a truncated final line, losing neither", () => {
    const dir = runsDir();
    const path = runJournalPath({ runsDir: dir, slug: "d" });
    writeFileSync(path, '{"kind":"started","atIso":"2026-08-04T00:00:00.000Z","branch":"b","docHash":"h"}', "utf8");

    appendRunEvent({ event: { atIso: AT, failed: 0, kind: "probed", passed: 1 }, runsDir: dir, slug: "d" });

    const parsed = readRunJournal({ runsDir: dir, slug: "d" })._unsafeUnwrap();
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events.map((event) => event.kind)).toEqual(["started", "probed"]);
  });

  it("adds no separator to a journal that already ends cleanly", () => {
    const dir = runsDir();
    appendRunEvent({ event: { atIso: AT, branch: "b", docHash: "h", kind: "started" }, runsDir: dir, slug: "d" });
    appendRunEvent({ event: { atIso: AT, kind: "abandoned", why: "w" }, runsDir: dir, slug: "d" });

    expect(readFileSync(runJournalPath({ runsDir: dir, slug: "d" }), "utf8")).not.toContain("\n\n");
  });
});
