/**
 * The locked tag write against a real temp home: what it appends, what it leaves alone, and every journal shape it
 * refuses rather than write through. `testing.md` allows the filesystem here: each case is a round trip in a
 * `mkdtempSync` directory, and the symlink and hard-link cases are exactly what a pure test cannot express.
 */
import {
  appendFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { NO_RUN, runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { tagRowUnderLock } from "../../../handover/tagStore.js";
import { parseTagRequest, type TagRequest } from "../../../handover/tagWrite.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const AT = "2026-09-28T01:00:00.000Z";
const LATER = "2026-09-28T01:05:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A temp home with a board and a runs directory. */
function home(): { home: string; handovers: string; runs: string } {
  const dir = mkdtempSync(join(tmpdir(), "sw-tag-"));
  dirs.push(dir);
  const handovers = join(dir, "handovers");
  const runs = join(dir, "runs");
  mkdirSync(handovers, { recursive: true });
  mkdirSync(runs, { recursive: true });
  return { handovers, home: dir, runs };
}

/** One live row's doc, written to disk and parsed back as the scan would see it. */
function row({
  handovers,
  slug,
  file = `${slug}.md`,
}: {
  handovers: string;
  slug: string;
  file?: string;
}): HandoverDoc {
  const path = join(handovers, file);
  const text = ["---", `slug: ${slug}`, "kind: ask", "summary: a row", "status: ready", "---", "", "# a row", ""].join(
    "\n",
  );
  writeFileSync(path, text, "utf8");
  return parseHandoverDoc({ path, text });
}

/** A request parsed from CLI-shaped input. */
function ask({
  assignments = [],
  drops,
  newValues,
}: {
  assignments?: string[];
  drops?: string;
  newValues?: string;
}): TagRequest {
  return unwrap(parseTagRequest({ assignments, drops, newValues }));
}

/** Tag one row under the lock, as the verb does. */
function tag({
  paths,
  docs,
  slug,
  input,
  now = () => AT,
}: {
  paths: { handovers: string; runs: string };
  docs: readonly HandoverDoc[];
  slug: string;
  input: TagRequest;
  now?: () => string;
}) {
  return tagRowUnderLock({
    docs,
    handoverDir: paths.handovers,
    now,
    request: input,
    runsDir: paths.runs,
    slug,
    why: "a test",
  });
}

describe("tagRowUnderLock", () => {
  it("appends the tags and reports the row's declared tags after", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    const outcome = unwrap(
      tag({ docs, input: ask({ assignments: ["platform=slack", "impact=high"] }), paths, slug: "a" }),
    );
    expect(outcome).toEqual({
      redundant: [],
      satisfied: [],
      tags: [
        { key: "platform", source: "declared", value: "slack" },
        { key: "impact", source: "declared", value: "high" },
      ],
      written: true,
    });
    expect(unwrap(readRunJournal({ runsDir: paths.runs, slug: "a" })).events).toEqual([
      {
        atIso: AT,
        drop: [],
        kind: "tagged",
        set: [
          { key: "platform", value: "slack" },
          { key: "impact", value: "high" },
        ],
        why: "a test",
      },
    ]);
  });

  it("writes nothing the second time, and says so", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    const input = ask({ assignments: ["platform=slack"] });
    unwrap(tag({ docs, input, paths, slug: "a" }));
    const again = unwrap(tag({ docs, input, now: () => LATER, paths, slug: "a" }));
    expect(again.written).toBe(false);
    expect(again.satisfied).toEqual(["platform=slack"]);
    expect(unwrap(readRunJournal({ runsDir: paths.runs, slug: "a" })).events.length).toBe(1);
  });

  it("appends only the part not already held", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    unwrap(tag({ docs, input: ask({ assignments: ["platform=slack"] }), paths, slug: "a" }));
    unwrap(
      tag({ docs, input: ask({ assignments: ["platform=slack", "impact=low"] }), now: () => LATER, paths, slug: "a" }),
    );
    expect(unwrap(readRunJournal({ runsDir: paths.runs, slug: "a" })).events[1]).toEqual({
      atIso: LATER,
      drop: [],
      kind: "tagged",
      set: [{ key: "impact", value: "low" }],
      why: "a test",
    });
  });

  it("refuses a new workstream no row carries unless it is acknowledged, judged across every live row", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" }), row({ handovers: paths.handovers, slug: "b" })];
    unwrap(
      tag({
        docs,
        input: ask({ assignments: ["workstream=hiring"], newValues: "workstream=hiring" }),
        paths,
        slug: "a",
      }),
    );
    expect(unwrapErr(tag({ docs, input: ask({ assignments: ["workstream=hirng"] }), paths, slug: "b" })).code).toBe(
      "TAG_REQUEST_REFUSED",
    );
    expect(unwrap(tag({ docs, input: ask({ assignments: ["workstream=hiring"] }), paths, slug: "b" })).written).toBe(
      true,
    );
  });

  it("never counts a value as existing off a journal it cannot read whole", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" }), row({ handovers: paths.handovers, slug: "b" })];
    unwrap(
      tag({ docs, input: ask({ assignments: ["workstream=hirng"], newValues: "workstream=hirng" }), paths, slug: "a" }),
    );
    appendFileSync(join(paths.runs, "a.jsonl"), "{not json\n");
    expect(unwrapErr(tag({ docs, input: ask({ assignments: ["workstream=hirng"] }), paths, slug: "b" })).message).toBe(
      "workstream=hirng is new — no row on the board carries it (1 row journal(s) could not be read, so it may exist there); pass --new-value workstream=hirng if it is meant",
    );
  });

  it("refuses a slug no live row claims, one two rows claim, and a row filed under another name", () => {
    const paths = home();
    const twice = [
      row({ handovers: paths.handovers, slug: "a" }),
      row({ file: "other.md", handovers: paths.handovers, slug: "a" }),
    ];
    const renamed = [row({ file: "elsewhere.md", handovers: paths.handovers, slug: "c" })];
    const input = ask({ assignments: ["impact=high"] });
    expect(unwrapErr(tag({ docs: [], input, paths, slug: "a" })).message).toBe(
      "a: no live row on the board claims this slug",
    );
    expect(unwrapErr(tag({ docs: twice, input, paths, slug: "a" })).message).toContain("a: 2 rows claim it");
    expect(unwrapErr(tag({ docs: renamed, input, paths, slug: "c" })).message).toContain(
      `its doc is ${join(paths.handovers, "elsewhere.md")}, not ${join(paths.handovers, "c.md")}`,
    );
  });

  it("refuses a journal with a line it cannot decode, even for a write that would change nothing", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    appendFileSync(join(paths.runs, "a.jsonl"), "{not json\n");
    expect(unwrapErr(tag({ docs, input: ask({ drops: "impact" }), paths, slug: "a" })).code).toBe(
      "TAG_JOURNAL_UNREADABLE",
    );
  });

  it("refuses a dangling symlink where the journal would be, rather than calling the row empty", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    symlinkSync(join(paths.home, "nowhere.jsonl"), join(paths.runs, "a.jsonl"));
    expect(unwrapErr(tag({ docs, input: ask({ drops: "impact" }), paths, slug: "a" })).message).toContain(
      "is not a regular file",
    );
  });

  it("refuses a live symlink, leaving the file it points at byte-for-byte unchanged", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    const outside = join(paths.home, "outside.txt");
    writeFileSync(outside, "keep me\n", "utf8");
    symlinkSync(outside, join(paths.runs, "a.jsonl"));
    expect(unwrapErr(tag({ docs, input: ask({ assignments: ["impact=high"] }), paths, slug: "a" })).code).toBe(
      "TAG_JOURNAL_UNREADABLE",
    );
    expect(readFileSync(outside, "utf8")).toBe("keep me\n");
  });

  it("refuses a hard-linked journal, leaving both paths unchanged", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" }), row({ handovers: paths.handovers, slug: "b" })];
    writeFileSync(join(paths.runs, "b.jsonl"), "", "utf8");
    linkSync(join(paths.runs, "b.jsonl"), join(paths.runs, "a.jsonl"));
    expect(unwrapErr(tag({ docs, input: ask({ assignments: ["impact=high"] }), paths, slug: "a" })).message).toContain(
      "has 2 hard links",
    );
    expect(readFileSync(join(paths.runs, "b.jsonl"), "utf8")).toBe("");
  });

  it("refuses a runs directory that is a symlink, leaving the directory it points at unchanged", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    const outside = mkdtempSync(join(tmpdir(), "sw-tag-outside-"));
    dirs.push(outside);
    rmSync(paths.runs, { recursive: true });
    symlinkSync(outside, paths.runs);
    expect(unwrapErr(tag({ docs, input: ask({ assignments: ["impact=high"] }), paths, slug: "a" })).message).toContain(
      "is not a real directory",
    );
    expect(readRunJournal({ runsDir: outside, slug: "a" }).isOk()).toBe(true);
    expect(unwrap(readRunJournal({ runsDir: outside, slug: "a" })).events).toEqual([]);
  });

  it("leaves a row tagged before its first run with no run, and the run it later starts intact", () => {
    const paths = home();
    const docs = [row({ handovers: paths.handovers, slug: "a" })];
    unwrap(tag({ docs, input: ask({ assignments: ["impact=high"] }), paths, slug: "a" }));
    const before = unwrap(readRunJournal({ runsDir: paths.runs, slug: "a" }));
    expect(runStateOf({ events: before.events })).toBe(NO_RUN);
    unwrap(
      applyRowEvent({
        event: { atIso: LATER, branch: "b", docHash: "h", kind: "started" },
        runsDir: paths.runs,
        slug: "a",
      }),
    );
    const after = unwrap(readRunJournal({ runsDir: paths.runs, slug: "a" }));
    expect(runStateOf({ events: after.events }).phase).toBe("open");
    expect(runStateOf({ events: after.events }).lastIso).toBe(LATER);
  });
});
