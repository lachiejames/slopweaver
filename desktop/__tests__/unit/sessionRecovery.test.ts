/*
 * The app's recovery journal: each row decodes only in its exact shape, a journal folds into what it knows about each
 * session with every undecodable line numbered rather than skipped, and the file on disk is owner-only, appended a
 * synced row at a time, and read back whole — a torn last write included.
 */
import { appendFileSync, chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { unwrap } from "../../../src/lib/result";
import type { AppLaunchSpec } from "../../src/sessionControlProtocol";
import {
  decodeRecoveryLine,
  expectedExecutablesOf,
  foldRecoveryJournal,
  type SessionRecoveryEvent,
} from "../../src/sessionRecoveryRecord";
import { appendRecoveryRow, readRecoveryJournal, recoveryJournalPath } from "../../src/sessionRecoveryStore";

const AT = "2026-11-10T00:00:00.000Z";

const SPEC: AppLaunchSpec = {
  codexHome: "/h/codex-one",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "codex",
};

const OPENED: SessionRecoveryEvent = {
  atIso: AT,
  kind: "opened",
  sessionId: "0b5e",
  spec: SPEC,
  vendorSessionId: "thread-1",
};

const GROUP: SessionRecoveryEvent = {
  atIso: AT,
  expectedExecutables: ["/app/Slopweaver", "/app/codex"],
  kind: "group-started",
  pgid: 4242,
  sessionId: "0b5e",
};

const GROUP_ENDED: SessionRecoveryEvent = { atIso: AT, kind: "group-ended", pgid: 4242, sessionId: "0b5e" };

const CLOSED: SessionRecoveryEvent = { atIso: AT, kind: "closed", sessionId: "0b5e" };

const NOT_A_ROW = "the line is not an opened, group-started, group-ended or closed row";

/** A journal line's bytes, as the store reads them. */
const bytesOf = (text: string): Uint8Array => Buffer.from(text, "utf8");
/** A row's line, as the store writes it. */
const lineOf = (row: unknown): Uint8Array => bytesOf(JSON.stringify(row));
/** A closed row whose session id carries one byte that is not UTF-8. */
const CORRUPT_CLOSED = Buffer.concat([
  bytesOf('{"kind":"closed","atIso":"x","sessionId":"'),
  Buffer.from([0xff]),
  bytesOf('"}'),
]);

describe("decodeRecoveryLine", () => {
  it("decodes each of the four rows exactly as written", () => {
    for (const row of [OPENED, GROUP, GROUP_ENDED, CLOSED]) {
      expect(unwrap(decodeRecoveryLine({ line: lineOf(row) }))).toEqual(row);
    }
  });

  it("refuses a row carrying a key its shape does not declare", () => {
    expect(decodeRecoveryLine({ line: lineOf({ ...CLOSED, note: "x" }) })._unsafeUnwrapErr()).toBe(NOT_A_ROW);
  });

  it("refuses an opened row whose launch is not a launch spec", () => {
    const line = lineOf({ ...OPENED, spec: { ...SPEC, vendor: "other" } });
    expect(decodeRecoveryLine({ line })._unsafeUnwrapErr()).toBe(NOT_A_ROW);
  });

  it("refuses a group row naming no group a later run could end, or no executable to recognise it by", () => {
    for (const bad of [{ pgid: 1 }, { pgid: 4.5 }, { expectedExecutables: [] }, { expectedExecutables: [""] }]) {
      expect(decodeRecoveryLine({ line: lineOf({ ...GROUP, ...bad }) })._unsafeUnwrapErr()).toBe(NOT_A_ROW);
    }
  });

  it("refuses a group-ended row naming no group, or carrying the executables only a group-started row declares", () => {
    const bad = [{ pgid: 1 }, { pgid: 4.5 }, { expectedExecutables: ["/app/codex"] }];
    for (const over of bad) {
      expect(decodeRecoveryLine({ line: lineOf({ ...GROUP_ENDED, ...over }) })._unsafeUnwrapErr()).toBe(NOT_A_ROW);
    }
  });

  it("refuses a line that is not JSON", () => {
    expect(decodeRecoveryLine({ line: bytesOf('{"kind":"clo') })._unsafeUnwrapErr()).toBe("the line is not JSON");
  });

  it("refuses a line holding a byte that is not UTF-8, rather than reading it as U+FFFD and the line as a row", () => {
    expect(decodeRecoveryLine({ line: CORRUPT_CLOSED })._unsafeUnwrapErr()).toBe("the line is not UTF-8");
  });

  it("refuses a line that duplicates a key, rather than reading the last one's value", () => {
    const line = bytesOf(`{"kind":"opened","kind":"closed","atIso":"${AT}","sessionId":"victim"}`);
    expect(decodeRecoveryLine({ line })._unsafeUnwrapErr()).toBe("the line is not written as the app writes a row");
  });

  it("refuses a row behind a byte-order mark the app's writer never emits, rather than dropping the mark", () => {
    const line = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), lineOf({ ...CLOSED, sessionId: "victim" })]);
    expect(decodeRecoveryLine({ line })._unsafeUnwrapErr()).toBe("the line is not JSON");
  });

  it("refuses a row spaced other than the app writes it", () => {
    const line = bytesOf(JSON.stringify(CLOSED, undefined, 1));
    expect(decodeRecoveryLine({ line })._unsafeUnwrapErr()).toBe("the line is not written as the app writes a row");
  });

  it("decodes a row whose path carries multi-byte UTF-8", () => {
    const row = { ...OPENED, spec: { ...SPEC, directory: "/work/café-ü" } };
    expect(unwrap(decodeRecoveryLine({ line: lineOf(row) }))).toEqual(row);
  });
});

describe("foldRecoveryJournal", () => {
  it("folds rows into each session in the order they were written", () => {
    const journal = foldRecoveryJournal({
      lines: [GROUP, OPENED, { ...GROUP, pgid: 4343 }, CLOSED].map((row) => lineOf(row)),
    });
    expect(journal.malformedLines).toEqual([]);
    expect(journal.sessions.get("0b5e")).toEqual({
      closed: true,
      groups: [GROUP, { ...GROUP, pgid: 4343 }],
      opened: OPENED,
      sessionId: "0b5e",
    });
  });

  it("keeps interleaved sessions apart, each with only its own rows", () => {
    const other = (row: SessionRecoveryEvent): SessionRecoveryEvent => ({ ...row, sessionId: "7a1d" });
    const otherGroup = { ...other(GROUP), pgid: 5151 };
    const journal = foldRecoveryJournal({
      lines: [GROUP, otherGroup, other(OPENED), OPENED, CLOSED].map((row) => lineOf(row)),
    });
    expect(journal.sessions.get("0b5e")).toEqual({ closed: true, groups: [GROUP], opened: OPENED, sessionId: "0b5e" });
    expect(journal.sessions.get("7a1d")).toEqual({
      closed: false,
      groups: [otherGroup],
      opened: other(OPENED),
      sessionId: "7a1d",
    });
  });

  it("keeps a session whose worker started but never came up, with no opened row and not closed", () => {
    const journal = foldRecoveryJournal({ lines: [lineOf(GROUP)] });
    expect(journal.sessions.get("0b5e")).toEqual({
      closed: false,
      groups: [GROUP],
      opened: undefined,
      sessionId: "0b5e",
    });
  });

  it("retires every earlier group row for an id a group-ended row names, and only that id", () => {
    const journal = foldRecoveryJournal({
      lines: [GROUP, OPENED, { ...GROUP, pgid: 4343 }, GROUP, GROUP_ENDED].map((row) => lineOf(row)),
    });
    expect(journal.sessions.get("0b5e")!.groups).toEqual([{ ...GROUP, pgid: 4343 }]);
  });

  it("keeps a group row written after the group-ended row naming its id: a newer worker handed that id again", () => {
    const newer = { ...GROUP, atIso: "2026-11-10T00:05:00.000Z" };
    const journal = foldRecoveryJournal({ lines: [GROUP, GROUP_ENDED, newer].map((row) => lineOf(row)) });
    expect(journal.sessions.get("0b5e")!.groups).toEqual([newer]);
  });

  it("retires every earlier row, of any session, for a group id a later group-started row names again", () => {
    const later = { ...GROUP, atIso: "2026-11-10T02:00:00.000Z", sessionId: "7a1d" };
    const kept = { ...GROUP, pgid: 4343 };
    const journal = foldRecoveryJournal({ lines: [GROUP, OPENED, kept, later].map((row) => lineOf(row)) });
    expect(journal.sessions.get("0b5e")!.groups).toEqual([kept]);
    expect(journal.sessions.get("7a1d")!.groups).toEqual([later]);
  });

  it("keeps only the newest of one session's own rows naming the same group id", () => {
    const newer = { ...GROUP, atIso: "2026-11-10T00:05:00.000Z" };
    const journal = foldRecoveryJournal({ lines: [GROUP, newer].map((row) => lineOf(row)) });
    expect(journal.sessions.get("0b5e")!.groups).toEqual([newer]);
  });

  it("lets a group-ended row retire nothing in another session that recorded the same group id later", () => {
    const otherGroup = { ...GROUP, sessionId: "7a1d" };
    const journal = foldRecoveryJournal({ lines: [GROUP, otherGroup, GROUP_ENDED].map((row) => lineOf(row)) });
    expect(journal.sessions.get("0b5e")!.groups).toEqual([]);
    expect(journal.sessions.get("7a1d")!.groups).toEqual([otherGroup]);
  });

  it("numbers every line no row decodes from, rather than skipping it", () => {
    const journal = foldRecoveryJournal({
      lines: [bytesOf(""), lineOf(OPENED), bytesOf("nonsense"), bytesOf('{"kind":"clo'), CORRUPT_CLOSED],
    });
    expect(journal.malformedLines).toEqual([1, 3, 4, 5]);
    expect(journal.sessions.get("0b5e")!.opened).toEqual(OPENED);
    expect(journal.sessions.size).toBe(1);
  });

  it("numbers an opened row written before the title bound whose title is past it, and never opens that session", () => {
    const overlong = { ...OPENED, spec: { ...SPEC, title: "a".repeat(201) } };
    const journal = foldRecoveryJournal({ lines: [GROUP, overlong].map((row) => lineOf(row)) });
    expect(journal.malformedLines).toEqual([2]);
    expect(journal.sessions.get("0b5e")!.opened).toBeUndefined();
  });

  it("is empty for no lines", () => {
    const journal = foldRecoveryJournal({ lines: [] });
    expect(journal.sessions.size).toBe(0);
    expect(journal.malformedLines).toEqual([]);
  });
});

describe("expectedExecutablesOf", () => {
  it("names the app's own executable first, then the vendor binary the worker drives", () => {
    const codex = { adapterEntry: "/app/a.js", codexHome: "/h", codexPath: "/app/codex", directory: "/w" };
    expect(
      expectedExecutablesOf({ config: { ...codex, sessionId: "0b5e", vendor: "codex" }, execPath: "/app/Slopweaver" }),
    ).toEqual(["/app/Slopweaver", "/app/codex"]);
    const claude = {
      claudeMdExcludes: [],
      claudePath: "/app/claude",
      credential: { kind: "store", secureStorageDir: "/h/c" } as const,
      directory: "/w",
      sessionId: "0b5e",
      vendor: "claude",
      vendorSessionId: "a0000107-0000-4000-8000-000000000118",
    } as const;
    expect(expectedExecutablesOf({ config: claude, execPath: "/app/Slopweaver" })).toEqual([
      "/app/Slopweaver",
      "/app/claude",
    ]);
  });
});

describe("the journal on disk", () => {
  const dirs: string[] = [];
  const journalIn = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-"));
    dirs.push(dir);
    return recoveryJournalPath({ userData: dir });
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("names session-harness.jsonl inside the app's data directory", () => {
    expect(recoveryJournalPath({ userData: "/u/Slopweaver" })).toBe("/u/Slopweaver/session-harness.jsonl");
  });

  it("creates the journal owner-only and reads back every appended row", async () => {
    const path = journalIn();
    for (const event of [GROUP, OPENED, CLOSED]) {
      expect(appendRecoveryRow({ event, path }).isOk()).toBe(true);
    }
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const journal = unwrap(await readRecoveryJournal({ path }));
    expect(journal.sessions.get("0b5e")).toEqual({ closed: true, groups: [GROUP], opened: OPENED, sessionId: "0b5e" });
  });

  it("puts a loosened journal back to owner-only on the next row", () => {
    const path = journalIn();
    writeFileSync(path, "");
    chmodSync(path, 0o644);
    expect(appendRecoveryRow({ event: CLOSED, path }).isOk()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reads a journal that does not exist yet as one with no sessions", async () => {
    const journal = unwrap(await readRecoveryJournal({ path: journalIn() }));
    expect(journal.sessions.size).toBe(0);
    expect(journal.malformedLines).toEqual([]);
  });

  it("numbers a torn last write rather than dropping it", async () => {
    const path = journalIn();
    expect(appendRecoveryRow({ event: OPENED, path }).isOk()).toBe(true);
    appendFileSync(path, '{"atIso":"2026');
    const journal = unwrap(await readRecoveryJournal({ path }));
    expect(journal.malformedLines).toEqual([2]);
    expect(journal.sessions.get("0b5e")!.opened).toEqual(OPENED);
  });

  it("starts the next row on a line of its own after a torn write, so the tear swallows only itself", async () => {
    const path = journalIn();
    expect(appendRecoveryRow({ event: OPENED, path }).isOk()).toBe(true);
    appendFileSync(path, '{"atIso":"2026');
    expect(appendRecoveryRow({ event: CLOSED, path }).isOk()).toBe(true);
    const journal = unwrap(await readRecoveryJournal({ path }));
    expect(journal.malformedLines).toEqual([2]);
    expect(journal.sessions.get("0b5e")).toEqual({ closed: true, groups: [], opened: OPENED, sessionId: "0b5e" });
  });

  it("numbers a line carrying a byte that is not UTF-8, rather than reading it as a row", async () => {
    const path = journalIn();
    expect(appendRecoveryRow({ event: OPENED, path }).isOk()).toBe(true);
    appendFileSync(path, Buffer.concat([CORRUPT_CLOSED, bytesOf("\n")]));
    const journal = unwrap(await readRecoveryJournal({ path }));
    expect(journal.malformedLines).toEqual([2]);
    expect(journal.sessions.get("0b5e")!.closed).toBe(false);
    expect(journal.sessions.size).toBe(1);
  });

  it("says which row it could not record when the journal's directory is gone", () => {
    const path = join(journalIn(), "missing", "session-harness.jsonl");
    expect(appendRecoveryRow({ event: CLOSED, path })._unsafeUnwrapErr()).toContain(
      `the recovery journal ${path} could not record the closed row`,
    );
  });
});
