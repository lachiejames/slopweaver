/*
 * The owner's further steers on a board row: the numbered groups read back through the real doc parser, each bad index its
 * own defect, the verdict and the text that writes one, and the effectful writer over a real temp board file. Every
 * steer here is written by the functions the verbs call and read back by `parseHandoverDoc`.
 */
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { boardRowLockSite, lockedTarget, withBoardRowLock } from "../../../cli/commands/handover/boardRowLock.js";
import { quoteLandedRow } from "../../../cli/commands/handover/quoteRow.js";
import {
  steerSlotFor,
  steerVerdict,
  steerVerdictPhrase,
  textWithSteer,
} from "../../../cli/commands/handover/quoteSteer.js";
import { writeSteerOnRow } from "../../../cli/commands/handover/quoteSteerRow.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { HisWords } from "../../../handover/hisWords.js";
import { HisWordsErrors } from "../../../handover/hisWordsErrors.js";
import { hisWordsSteerFields, nextHisWordsSteerIndex } from "../../../handover/hisWordsSteers.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const OWN = "talk:a0000015-0000-4000-8000-000000000016";
const LATER = "talk-call:a0000061-0000-4000-8000-000000000067#turn_000000000000000000004";
const EARLIER = "transcript:a0000007-0000-4000-8000-000000000008#33dac8fe-ef61-4b56-956f-1a3377e33841";
const PATH = "/h/the-ask.md";
const NOW_ISO = "2026-10-03T09:00:00.000Z";

const LATER_WORDS: HisWords = {
  anchor: LATER,
  atIso: "2026-10-03T08:57:21.724Z",
  cut: "end",
  where: "call",
  words: "show where each figure came from",
};

/** A row's text with the given extra front-matter lines. */
function docText({ extra = "" }: { extra?: string }): string {
  return `---\nslug: the-ask\nstatus: ready\nanchor: ${OWN}\n${extra}---\n\n# the ask\n`;
}

/** Whether this run's temp volume folds case, as a Mac's default volume does: one name written, its upper case read. */
function caseInsensitiveTmp(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "case-"));
  try {
    writeFileSync(join(probe, "fold"), "");
    try {
      statSync(join(probe, "FOLD"));
      return true;
    } catch {
      return false;
    }
  } finally {
    rmSync(probe, { force: true, recursive: true });
  }
}

/** The front-matter lines one steer's record is written as. */
function steerLines({ index, words }: { index: number; words: HisWords }): string {
  return hisWordsSteerFields({ index, record: { hisWords: words, kind: "held" } })
    .map((field) => `${field.key}: ${field.value}\n`)
    .join("");
}

describe("hisWordsSteersOf, through parseHandoverDoc", () => {
  it("reads a held steer and an unread one in numeric index order, two before ten", () => {
    const unread = `hisWordsSteer2Anchor: ${EARLIER}\nhisWordsSteer2Unread: "no turn file carries it"\n`;
    const doc = parseHandoverDoc({
      path: PATH,
      text: docText({ extra: steerLines({ index: 10, words: LATER_WORDS }) + unread }),
    });
    expect(doc.problems).toEqual([]);
    expect(doc.hisWordsSteers).toEqual([
      { group: { anchor: EARLIER, kind: "unread", why: "no turn file carries it" }, index: 2 },
      { group: { hisWords: LATER_WORDS, kind: "held" }, index: 10 },
    ]);
  });

  it("makes a half-written steer its OWN defect and keeps the sibling beside it", () => {
    const broken = `hisWordsSteer1Anchor: ${EARLIER}\nhisWordsSteer1Words: "half"\n`;
    const doc = parseHandoverDoc({
      path: PATH,
      text: docText({ extra: broken + steerLines({ index: 2, words: LATER_WORDS }) }),
    });
    expect(doc.hisWordsSteers.map((steer) => steer.group.kind)).toEqual(["defect", "held"]);
    expect(unwrapDefect({ group: doc.hisWordsSteers[0]!.group })).toContain("steer 1: the stored quote is missing");
  });

  it("owns a steer key declared twice as that steer's defect, never a doc problem that pulls the row", () => {
    const twice = steerLines({ index: 1, words: LATER_WORDS }) + `ownerWordsSteer1Cut: none\n`;
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: twice }) });
    expect(doc.problems).toEqual([]);
    expect(unwrapDefect({ group: doc.hisWordsSteers[0]!.group })).toBe(
      "steer 1 declares ownerWordsSteer1Cut more than once",
    );
  });

  it("reads a steer stored under the pronoun spelling exactly as the one the writer writes", () => {
    const pronoun = steerLines({ index: 3, words: LATER_WORDS }).replaceAll("ownerWordsSteer3", "hisWordsSteer3");
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: pronoun }) });
    expect(pronoun).toContain("hisWordsSteer3Words: ");
    expect(doc.problems).toEqual([]);
    expect(doc.hisWordsSteers).toEqual([{ group: { hisWords: LATER_WORDS, kind: "held" }, index: 3 }]);
  });

  it("makes a steer key declared under both spellings that steer's defect", () => {
    const twice = steerLines({ index: 1, words: LATER_WORDS }) + `hisWordsSteer1Cut: none\n`;
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: twice }) });
    expect(doc.problems).toEqual([]);
    expect(unwrapDefect({ group: doc.hisWordsSteers[0]!.group })).toBe(
      "steer 1 declares ownerWordsSteer1Cut more than once",
    );
  });

  it("refuses a steer repeating the row's own anchor, which would draw one steer of theirs twice", () => {
    const own: HisWords = { ...LATER_WORDS, anchor: OWN };
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: steerLines({ index: 1, words: own }) }) });
    expect(unwrapDefect({ group: doc.hisWordsSteers[0]!.group })).toBe(
      `steer 1 repeats ${OWN}, already quoted on this row`,
    );
  });

  it("refuses a steer whose anchor names none of the owner's words", () => {
    const slack: HisWords = { ...LATER_WORDS, anchor: "https://example.slack.com/archives/C1/p1" };
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: steerLines({ index: 1, words: slack }) }) });
    expect(unwrapDefect({ group: doc.hisWordsSteers[0]!.group })).toBe(
      "steer 1 names https://example.slack.com/archives/C1/p1, which is not the owner's words",
    );
  });

  // Two numbers past exact `number` range read as one, which silently lost a group.
  it("reports each group numbered past exact counting as its own defect, never collapsing two into one steer", () => {
    const huge = [
      `ownerWordsSteer9007199254740992Anchor: ${EARLIER}`,
      `ownerWordsSteer9007199254740993Anchor: ${LATER}`,
      "",
    ].join("\n");
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: huge }) });
    const misnumbered = ({ written, anchor }: { written: string; anchor: string }): unknown => ({
      declaredAnchor: anchor,
      group: {
        kind: "defect",
        why: `ownerWordsSteer${written}Anchor is numbered ${written}, which no row writes a steer under; renumber by hand`,
      },
      index: 0,
    });
    expect(doc.hisWordsSteers).toEqual([
      misnumbered({ anchor: EARLIER, written: "9007199254740992" }),
      misnumbered({ anchor: LATER, written: "9007199254740993" }),
    ]);
    expect(nextHisWordsSteerIndex({ steers: doc.hisWordsSteers })).toBe(1);
  });

  // A group numbered 0 was ignored outright, so relating its anchor wrote it a second time.
  it("reports a group numbered 0 or with a leading zero, and keeps its anchor so a relate never writes it again", () => {
    const zero = steerLines({ index: 1, words: LATER_WORDS }).replaceAll("ownerWordsSteer1", "ownerWordsSteer0");
    const doc = parseHandoverDoc({
      path: PATH,
      text: docText({ extra: `${zero}hisWordsSteer01Anchor: ${EARLIER}\n` }),
    });
    expect(doc.hisWordsSteers.map((steer) => [steer.index, steer.declaredAnchor])).toEqual([
      [0, LATER],
      [0, EARLIER],
    ]);
    expect(steerSlotFor({ anchor: LATER, doc })).toEqual({ kind: "held", steer: doc.hisWordsSteers[0] });
  });

  it("reads a row with no steers as none", () => {
    expect(parseHandoverDoc({ path: PATH, text: docText({}) }).hisWordsSteers).toEqual([]);
  });
});

/** A defect's reason, failing the test on any other group. */
function unwrapDefect({ group }: { group: { readonly kind: string } & Partial<{ readonly why: string }> }): string {
  expect(group.kind).toBe("defect");
  return group.why!;
}

describe("nextHisWordsSteerIndex and steerSlotFor", () => {
  it("numbers a new steer one past the highest held, a defective index included", () => {
    const broken = `hisWordsSteer4Anchor: ${EARLIER}\n`;
    const doc = parseHandoverDoc({ path: PATH, text: docText({ extra: broken }) });
    expect(nextHisWordsSteerIndex({ steers: doc.hisWordsSteers })).toBe(5);
    expect(steerSlotFor({ anchor: LATER, doc })).toEqual({ index: 5, kind: "free" });
  });

  it("finds the row's own anchor and an existing steer rather than adding a duplicate", () => {
    const doc = parseHandoverDoc({
      path: PATH,
      text: docText({ extra: steerLines({ index: 3, words: LATER_WORDS }) }),
    });
    expect(steerSlotFor({ anchor: OWN, doc })).toEqual({ kind: "answered" });
    expect(steerSlotFor({ anchor: LATER, doc })).toEqual({ kind: "held", steer: doc.hisWordsSteers[0] });
  });
});

describe("steerVerdict", () => {
  it("adds a new steer even when its words will not read yet, so the relation is kept and retried", () => {
    const read = err(HisWordsErrors.recordMissing({ anchor: LATER, what: "no card landing carries this utterance" }));
    const verdict = steerVerdict({ anchor: LATER, index: 1, read, stored: undefined });
    expect(verdict.kind).toBe("add");
    expect(steerVerdictPhrase({ applied: false, verdict })).toBe("would relate it");
  });

  it("reads a stored steer equal to its record as current, and a grown one as a refresh", () => {
    const stored = { hisWords: LATER_WORDS, kind: "held" } as const;
    expect(steerVerdict({ anchor: LATER, index: 1, read: ok(LATER_WORDS), stored }).kind).toBe("current");
    const grown = steerVerdict({ anchor: LATER, index: 1, read: ok({ ...LATER_WORDS, words: "more" }), stored });
    expect(steerVerdictPhrase({ applied: true, verdict: grown })).toBe("refresh the quote: done");
  });

  it("leaves a defective steer as it is, naming why", () => {
    const verdict = steerVerdict({
      anchor: LATER,
      index: 2,
      read: ok(LATER_WORDS),
      stored: { kind: "defect", why: "torn" },
    });
    expect(steerVerdictPhrase({ applied: true, verdict })).toBe("left as it is — torn; a hand edit repairs it");
  });
});

describe("textWithSteer", () => {
  it("writes one steer that reads back through the board's parser, leaving the row's own keys alone", () => {
    const text = docText({ extra: `hisWords: "their own"\n` });
    const written = unwrap(
      textWithSteer({ index: 1, path: PATH, record: { hisWords: LATER_WORDS, kind: "held" }, text }),
    );
    expect(written).toContain(`hisWords: "their own"\n`);
    expect(parseHandoverDoc({ path: PATH, text: written }).hisWordsSteers).toEqual([
      { group: { hisWords: LATER_WORDS, kind: "held" }, index: 1 },
    ]);
  });

  it("refuses a rewrite that would remove a hand-written line under one of the steer's keys", () => {
    const text = docText({ extra: `hisWordsSteer1Anchor: ${LATER}\n  wrapped by hand\n` });
    const refused = textWithSteer({ index: 1, path: PATH, record: { hisWords: LATER_WORDS, kind: "held" }, text });
    expect(unwrapErr(refused).code).toBe("EDIT_WOULD_DAMAGE");
  });
});

describe("writeSteerOnRow over a real board file", () => {
  let dir = "";
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("relates a steer under --apply, then reads the same record as current", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    writeFileSync(path, docText({}));
    const first = writeSteerOnRow({ anchor: LATER, apply: true, path, read: ok(LATER_WORDS) });
    expect(first).toEqual({
      problems: [],
      verdict: { index: 1, kind: "add", record: { hisWords: LATER_WORDS, kind: "held" } },
      wrote: true,
    });
    const again = writeSteerOnRow({ anchor: LATER, apply: true, path, read: ok(LATER_WORDS) });
    expect(again).toEqual({ problems: [], verdict: { index: 1, kind: "current" }, wrote: false });
    expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers.length).toBe(1);
  });

  it("frees the row's lock once a write ends, so the next writer reads what the last one wrote", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    writeFileSync(path, docText({}));
    writeSteerOnRow({ anchor: LATER, apply: true, path, read: ok(LATER_WORDS) });
    // A lock this live process still held would refuse here, so `unwrap` throwing is the failure.
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    held.release();
    expect(held.stoleFromPid).toBeUndefined();
  });

  it("keeps the row's lock in its own board directory, so writers with different homes share it", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    writeFileSync(path, docText({}));
    expect(boardRowLockSite({ path }).home).toBe(join(realpathSync(dir), ".quote-locks"));
  });

  it("refuses a write while another writer holds the row, running nothing under it", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    let ran = 0;
    const refused = withBoardRowLock({
      attempts: 1,
      path,
      write: () => {
        ran += 1;
      },
    });
    held.release();
    expect(unwrapErr(refused).code).toBe("ROW_LOCK_BUSY");
    expect(unwrapErr(refused).message).toContain(`another board-row write holds ${path}`);
    expect(ran).toBe(0);
  });

  it("gives a row reached through a symlinked board directory the lock of the file it names", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    mkdirSync(join(dir, "board"));
    symlinkSync(join(dir, "board"), join(dir, "alias"));
    const path = join(dir, "board", "the-ask.md");
    writeFileSync(path, docText({}));
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    const viaAlias = join(dir, "alias", "the-ask.md");
    const refused = withBoardRowLock({ attempts: 1, path: viaAlias, write: () => "wrote" });
    held.release();
    expect(unwrapErr(refused).code).toBe("ROW_LOCK_BUSY");
    expect(unwrapErr(refused).message).toContain(`another board-row write holds ${viaAlias}`);
  });

  it("keys the lock by the board's identity on disk, so every row of one board shares it", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const board = statSync(dir, { bigint: true });
    const identity = `handover-quote:${String(board.dev)}:${String(board.ino)}`;
    expect(boardRowLockSite({ path: join(dir, "the-ask.md") }).key).toBe(identity);
    expect(boardRowLockSite({ path: join(dir, "another-ask.md") }).key).toBe(identity);
  });

  // `realpathSync` keeps the caller's casing, so on a case-insensitive volume two spellings of one board were two
  // locks. Only such a volume can spell one directory two ways without a symlink.
  it.runIf(caseInsensitiveTmp())("gives a row reached through another casing of its board the same lock", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    mkdirSync(join(dir, "Board"));
    const path = join(dir, "Board", "the-ask.md");
    writeFileSync(path, docText({}));
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    const recased = join(dir, "board", "THE-ASK.md");
    const refused = withBoardRowLock({ attempts: 1, path: recased, write: () => "wrote" });
    held.release();
    expect(unwrapErr(refused).code).toBe("ROW_LOCK_BUSY");
  });

  // A volume whose rename takes the new name would re-case the entry to the caller's spelling, and the board lists only
  // a lower-case `.md`. APFS keeps the stored name, so the name handed to the write is what
  // can fail here, and the row reading back on the board is the outcome.
  it.runIf(caseInsensitiveTmp())(
    "writes a row reached through another casing of its name under its stored name",
    () => {
      dir = mkdtempSync(join(tmpdir(), "steer-"));
      const path = join(dir, "the-ask.md");
      writeFileSync(path, docText({}));
      const recased = join(dir, "THE-ASK.MD");
      expect(unwrap(withBoardRowLock({ path: recased, write: ({ target }) => target }))).toBe(realpathSync(path));
      const related = writeSteerOnRow({ anchor: LATER, apply: true, path: recased, read: ok(LATER_WORDS) });
      expect(related.wrote).toBe(true);
      expect(readdirSync(dir).filter((entry) => !entry.startsWith("."))).toEqual(["the-ask.md"]);
      expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers.length).toBe(1);
    },
  );

  // `stat` follows a link, so another symlink to the row, or a second hard link, passed for its stored name and the
  // atomic write replaced that entry rather than the row the board reads.
  it.runIf(caseInsensitiveTmp())("never takes another link to the row for its stored name", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    writeFileSync(path, docText({}));
    symlinkSync(path, join(dir, "00-row-alias"));
    const recased = join(dir, "THE-ASK.MD");
    expect(unwrap(withBoardRowLock({ path: recased, write: ({ target }) => target }))).toBe(realpathSync(path));
    writeSteerOnRow({ anchor: LATER, apply: true, path: recased, read: ok(LATER_WORDS) });
    expect(lstatSync(join(dir, "00-row-alias")).isSymbolicLink()).toBe(true);
    expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers.length).toBe(1);
  });

  // The lock is chosen from one resolution of the path; a symlink retargeted before the write resolves it again would
  // hand the write another row — on another board, or on this one. `intended` stands for
  // the row the lock was chosen for, before the retarget.
  it("refuses a target that names another row than the one its lock was taken for, on any board", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "a", "row.md"), docText({}));
    writeFileSync(join(dir, "a", "other.md"), docText({}));
    writeFileSync(join(dir, "b", "row.md"), docText({}));
    const intended = realpathSync(join(dir, "a", "row.md"));
    symlinkSync(join(dir, "b"), join(dir, "alias"));
    symlinkSync(join(dir, "a", "other.md"), join(dir, "row-link.md"));
    expect(unwrapErr(lockedTarget({ intended, path: join(dir, "alias", "row.md") })).code).toBe("ROW_MOVED");
    expect(unwrapErr(lockedTarget({ intended, path: join(dir, "row-link.md") })).code).toBe("ROW_MOVED");
    expect(unwrap(lockedTarget({ intended, path: join(dir, "a", "row.md") }))).toBe(intended);
  });

  // Two hard-link names in two directories are two boards and two locks, and replacing the file through one strands a
  // write through the other. No whole-file write keeps hard links together, so it refuses.
  it("refuses to write a row whose file has another hard link, writing nothing", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    const path = join(dir, "a", "the-ask.md");
    writeFileSync(path, docText({}));
    linkSync(path, join(dir, "b", "hard.md"));
    let ran = 0;
    const refused = withBoardRowLock({
      path: join(dir, "b", "hard.md"),
      write: () => {
        ran += 1;
      },
    });
    expect(unwrapErr(refused).code).toBe("ROW_HARD_LINKED");
    expect(ran).toBe(0);
    const related = writeSteerOnRow({ anchor: LATER, apply: true, path, read: ok(LATER_WORDS) });
    expect(related.wrote).toBe(false);
    expect(related.problems[0]).toContain("has 2 hard links");
    expect(readFileSync(path, "utf8")).toBe(docText({}));
  });

  it("writes a steer related through a symlinked row file into the row it points at, leaving the link a link", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    const link = join(dir, "linked-ask.md");
    writeFileSync(path, docText({}));
    symlinkSync(path, link);
    const related = writeSteerOnRow({ anchor: LATER, apply: true, path: link, read: ok(LATER_WORDS) });
    expect(related.wrote).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers).toEqual([
      { group: { hisWords: LATER_WORDS, kind: "held" }, index: 1 },
    ]);
  });

  it("quotes nothing for a landing on an absent row, but reports a row that is there and will not read", async () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const absent = join(dir, "archived.md");
    expect(await quoteLandedRow({ anchors: [LATER], home: dir, path: absent })).toEqual([]);
    // A directory standing at the row's path is there and fails to read with EISDIR, as an unreadable row would.
    const unreadable = join(dir, "the-ask.md");
    mkdirSync(unreadable);
    const problems = await quoteLandedRow({ anchors: [LATER], home: dir, path: unreadable });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain(`cannot read ${unreadable} to quote it`);
  });

  it("reports a landing on a row whose path is a dangling symlink, rather than reading it as archived", async () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const dangling = join(dir, "the-ask.md");
    symlinkSync(join(dir, "gone.md"), dangling);
    const problems = await quoteLandedRow({ anchors: [LATER], home: dir, path: dangling });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain(`cannot read ${dangling} to quote it`);
  });

  // A board reached through a directory symlink that now points nowhere reads ENOENT at the
  // row with nothing standing there, exactly as an archived row does.
  it("reports a landing on a row whose board directory is a dangling symlink, rather than reading it as archived", async () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    symlinkSync(join(dir, "gone"), join(dir, "alias"));
    const unreachable = join(dir, "alias", "the-ask.md");
    const problems = await quoteLandedRow({ anchors: [LATER], home: dir, path: unreachable });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain(`cannot read ${unreachable} to quote it`);
  });

  it("writes nothing without --apply, and nothing for the row's own anchor", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    writeFileSync(path, docText({}));
    expect(writeSteerOnRow({ anchor: LATER, apply: false, path, read: ok(LATER_WORDS) }).wrote).toBe(false);
    expect(writeSteerOnRow({ anchor: OWN, apply: true, path, read: ok(LATER_WORDS) }).verdict).toEqual({
      index: 0,
      kind: "answered",
    });
    expect(readFileSync(path, "utf8")).toBe(docText({}));
  });

  it("lands a relate of a half-written steer's anchor on that defect, never on a second group beside it", () => {
    dir = mkdtempSync(join(tmpdir(), "steer-"));
    const path = join(dir, "the-ask.md");
    const text = docText({ extra: `hisWordsSteer1Anchor: ${LATER}\nhisWordsSteer1Words: "half"\n` });
    writeFileSync(path, text);
    const related = writeSteerOnRow({ anchor: LATER, apply: true, path, read: ok(LATER_WORDS) });
    expect([related.verdict!.kind, related.wrote]).toEqual(["defect", false]);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});

describe("a defective steer keeps its declared anchor", () => {
  it("makes a later steer repeating a half-written one's anchor a repeat, so one anchor is never drawn twice", () => {
    const broken = `hisWordsSteer1Anchor: ${LATER}\nhisWordsSteer1Words: "half"\n`;
    const doc = parseHandoverDoc({
      path: PATH,
      text: docText({ extra: broken + steerLines({ index: 2, words: LATER_WORDS }) }),
    });
    expect(doc.hisWordsSteers[0]!.declaredAnchor).toBe(LATER);
    expect(unwrapDefect({ group: doc.hisWordsSteers[1]!.group })).toBe(
      `steer 2 repeats ${LATER}, already quoted on this row`,
    );
  });
});
