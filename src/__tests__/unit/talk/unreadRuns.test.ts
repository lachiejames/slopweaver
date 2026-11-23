/**
 * `slopweaver talk unread` driven through its real argv over a throwaway `--home`: a read never moves the cursor,
 * `--mark` does, and a bad flag is refused before anything is read.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseUnreadArgs } from "../../../cli/commands/talk/callArgs.js";
import { UnreadArgsErrors } from "../../../cli/commands/talk/unreadArgsErrors.js";
import { runTalkUnread } from "../../../cli/commands/talk/unreadRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { selectUnreadWords } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const NOW = "2026-09-26T06:00:00.000Z";

const argvFor = ({ rest }: { rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  "unread",
  ...rest,
];

let home = "";
let cursorFile = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-unread-runs-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
  writeFileSync(
    join(home, "talk", "calls", `${CALL}.jsonl`),
    `${JSON.stringify({ atIso: "2026-09-26T05:00:00.000Z", final: true, id: "s", kind: "segment", text: "hi", who: "owner" })}\n`,
  );
  cursorFile = join(home, "talk", "unread-cursors", "supervisor.json");
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const unreadCount = (): number =>
  selectUnreadWords({ read: unwrap(readUnread({ home, name: "supervisor", nowIso: NOW })) }).words.length;

describe("runTalkUnread", () => {
  it("reads without writing a cursor", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--json"] }))).toBe(EXIT_OK);
    expect(existsSync(cursorFile)).toBe(false);
    expect(unreadCount()).toBe(1);
  });

  it("marks with --mark, after which nothing is unread", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark"] }))).toBe(EXIT_OK);
    expect(JSON.parse(readFileSync(cursorFile, "utf8")).recordedAtIso).toBe(NOW);
    expect(unreadCount()).toBe(0);
  });

  it("marks with --mark --json too, printing the report before the cursor is written", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark", "--json"] }))).toBe(EXIT_OK);
    expect(JSON.parse(readFileSync(cursorFile, "utf8")).recordedAtIso).toBe(NOW);
    expect(unreadCount()).toBe(0);
  });

  it("keeps a named reader's cursor apart from the supervisor's", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark", "--cursor", "voice"] }))).toBe(
      EXIT_OK,
    );
    expect(existsSync(join(home, "talk", "unread-cursors", "voice.json"))).toBe(true);
    expect(unreadCount()).toBe(1);
  });

  it("refuses an unparseable --now before reading", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", "yesterday"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a mark, recording nothing, over a cursor stamped with a loose instant that would swell the report", () => {
    mkdirSync(join(home, "talk", "unread-cursors"), { recursive: true });
    const loose = JSON.stringify({ calls: {}, recordedAtIso: `Sep 26 2026${" ".repeat(10_000)}` });
    writeFileSync(cursorFile, loose);

    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark", "--json"] }))).toBe(EXIT_ERROR);
    expect(readFileSync(cursorFile, "utf8")).toBe(loose);
  });

  it("fails on a cursor name that cannot be a filename", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--cursor", "../x"] }))).toBe(EXIT_ERROR);
  });
});

describe("a first mark with words older than the first-read window", () => {
  const OLD = "2026-09-24T05:00:00.000Z";

  beforeEach(() => {
    writeFileSync(
      join(home, "talk", "calls", `${CALL}.jsonl`),
      `${JSON.stringify({ atIso: OLD, final: true, id: "old", kind: "segment", text: "old steer", who: "owner" })}\n`,
    );
  });

  it("is refused, writing no cursor, so the old word is never taken as read unprinted", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark"] }))).toBe(EXIT_ERROR);
    expect(existsSync(cursorFile)).toBe(false);
  });

  it("is refused in --json too, before any report is printed or cursor written", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark", "--json"] }))).toBe(EXIT_ERROR);
    expect(existsSync(cursorFile)).toBe(false);
  });

  it("marks with --all, which prints every word on every call first", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark", "--all"] }))).toBe(EXIT_OK);
    expect(existsSync(cursorFile)).toBe(true);
  });

  it("marks with --adopt, taking the old word as read on purpose", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark", "--adopt"] }))).toBe(EXIT_OK);
    expect(existsSync(cursorFile)).toBe(true);
  });

  it("refuses --adopt without --mark as a usage error", () => {
    expect(runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--adopt"] }))).toBe(EXIT_USAGE);
  });
});

describe("parseUnreadArgs", () => {
  it("defaults the reader to the supervisor", () => {
    const parsed = parseUnreadArgs({ rest: ["--mark", "--adopt"] });
    expect(parsed._unsafeUnwrap()).toEqual({
      adopt: true,
      all: false,
      cursor: "supervisor",
      home: undefined,
      json: false,
      mark: true,
      now: undefined,
    });
  });

  it("refuses --adopt with no --mark to qualify", () => {
    expect(parseUnreadArgs({ rest: ["--adopt"] })._unsafeUnwrapErr()).toEqual(UnreadArgsErrors.adoptWithoutMark());
  });

  it("refuses a --now that is not an instant, naming it", () => {
    expect(parseUnreadArgs({ rest: ["--now", "yesterday"] })._unsafeUnwrapErr()).toEqual(
      UnreadArgsErrors.nowInvalid({ now: "yesterday" }),
    );
  });

  it("carries the tokenizer's own refusal of an unknown flag", () => {
    expect(parseUnreadArgs({ rest: ["--everything"] })._unsafeUnwrapErr().code).toBe("UNREAD_FLAGS_INVALID");
  });
});

describe("a line too large for any batch", () => {
  const segmentLine = `${JSON.stringify({ atIso: "2026-09-26T05:00:00.000Z", final: true, id: "s", kind: "segment", text: "hi", who: "owner" })}\n`;
  const callPath = (): string => join(home, "talk", "calls", `${CALL}.jsonl`);
  const markOnce = (): number => runTalkUnread(argvFor({ rest: ["--home", home, "--now", NOW, "--mark"] }));
  const frontier = (): { offset: number; part?: { printed: number; lineOffset?: number } } =>
    JSON.parse(readFileSync(cursorFile, "utf8")).calls[CALL];

  beforeEach(() => {
    writeFileSync(callPath(), `${"x".repeat(30_000)}\n${segmentLine}`);
  });

  it("is marked one printed part at a time, and only the last part moves the cursor past it", () => {
    expect([markOnce(), frontier().offset, frontier().part!.printed]).toEqual([EXIT_OK, 0, 1]);
    expect([markOnce(), markOnce(), markOnce(), markOnce()]).toEqual([EXIT_OK, EXIT_OK, EXIT_OK, EXIT_OK]);
    expect([frontier().offset, frontier().part!.printed]).toEqual([0, 5]);
    expect(unreadCount()).toBe(1);

    expect(markOnce()).toBe(EXIT_OK);
    expect(frontier()).toEqual({ offset: 30_001, prefixSha256: expect.stringMatching(/^sha256:/u) });
    expect(unreadCount()).toBe(1);
  });

  it("catches up with a stretch the call wrote as forty growing snapshots in two marks, then prints the next one", () => {
    // MEASURED: one stretch on 195 lines of 7.5-16 KB, two marks a snapshot, so the stretches
    // after it that `supervisor tick close` named were never printed. Each snapshot here is over one batch on its own.
    const said = ({ words, final }: { words: number; final: boolean }): string =>
      `${JSON.stringify({
        atIso: "2026-09-26T05:00:00.000Z",
        final,
        id: "long",
        kind: "segment",
        text: Array.from({ length: words }, (_, index) => `word${String(index)}`).join(" "),
        who: "owner",
      })}\n`;
    const tool = `${JSON.stringify({ atIso: "2026-09-26T05:00:01.000Z", detail: "", kind: "tool", name: "recall", refused: false })}\n`;
    // 1,100 to 1,178 words: every snapshot over one batch alone, the final cut in two parts.
    const snapshots = Array.from({ length: 40 }, (_, index) => said({ final: index === 39, words: 1100 + index * 2 }));
    const before = snapshots.map((line) => `${line}${tool}`).join("");
    const cool = `${JSON.stringify({ atIso: "2026-09-26T05:01:00.000Z", final: true, id: "cool", kind: "segment", text: "Cool", who: "owner" })}\n`;
    writeFileSync(callPath(), `${before}${cool}`);
    const finalStart = Buffer.byteLength(before) - Buffer.byteLength(snapshots[39]!) - Buffer.byteLength(tool);

    expect(markOnce()).toBe(EXIT_OK);
    expect([frontier().offset, frontier().part!.printed, frontier().part!.lineOffset]).toEqual([0, 1, finalStart]);
    expect(markOnce()).toBe(EXIT_OK);
    expect(frontier().offset).toBe(finalStart + Buffer.byteLength(snapshots[39]!));
    const read = unwrap(readUnread({ home, name: "supervisor", nowIso: NOW }));
    expect(selectUnreadWords({ read }).words.map((word) => word.text)).toEqual(["Cool"]);

    expect(markOnce()).toBe(EXIT_OK);
    expect(unreadCount()).toBe(0);
  });

  it("refuses the read once the line being read in parts is rewritten, rather than finish it from another line", () => {
    expect(markOnce()).toBe(EXIT_OK);
    writeFileSync(callPath(), `${"y".repeat(30_000)}\n${segmentLine}`);

    expect(markOnce()).toBe(EXIT_ERROR);
    expect(frontier().part!.printed).toBe(1);
  });
});
