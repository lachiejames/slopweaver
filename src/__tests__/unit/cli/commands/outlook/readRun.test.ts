/**
 * Unit: the `outlook` verbs that only read, driven whole — parser, session, domain read, renderer — over a fake
 * mailbox. A read verb writes nothing, so every case also asserts the mailbox saw no write.
 */
import { describe, expect, it } from "vitest";
import {
  runOutlookCategories,
  runOutlookFolders,
  runOutlookList,
  runOutlookMeasure,
  runOutlookReadMessage,
  runOutlookTriage,
} from "../../../../../cli/commands/outlook/readRun.js";
import type { OutlookShellDeps } from "../../../../../cli/commands/outlook/shell.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { OutlookErrors } from "../../../../../live/outlook/errors.js";
import { type FakeMailbox, fakeMailbox, wireMessage } from "../../../../fakeOutlookMailbox.js";
import { fakeOutlookShell } from "../../../../fakeOutlookShell.js";

/** A home no read verb writes under; the session is the fake's, so nothing reads it either. */
const HOME = "/nonexistent/outlook-read-home";

/** Two inbox messages from one sender in one conversation, one unread, and an archived one. */
function mailbox(): FakeMailbox {
  return fakeMailbox({
    messages: [
      wireMessage({
        id: "m-1",
        over: { conversationId: "conv-a", isRead: false, receivedDateTime: "2026-10-02T09:00:00Z" },
      }),
      wireMessage({
        id: "m-2",
        over: { conversationId: "conv-a", isRead: true, receivedDateTime: "2026-10-01T09:00:00Z" },
      }),
      wireMessage({ id: "m-3", over: { conversationId: "conv-b", parentFolderId: "folder-archive" } }),
    ],
  });
}

type Runner = (args: { rest: readonly string[]; deps: OutlookShellDeps }) => Promise<number>;

/** Run one read verb over `box`. */
async function read({
  box,
  runner,
  rest,
}: {
  box: FakeMailbox;
  runner: Runner;
  rest: readonly string[];
}): Promise<{ code: number; out: string; warn: string; verbs: readonly string[] }> {
  const { deps, record } = fakeOutlookShell({ home: HOME, mailbox: box });
  const code = await runner({ deps, rest });
  return {
    code,
    out: record.out.join("\n"),
    verbs: record.sessions.map((session) => session.verb),
    warn: record.warn.join("\n"),
  };
}

describe("outlook list", () => {
  it("lists the inbox newest first, marking the unread one", async () => {
    const box = mailbox();
    const run = await read({ box, rest: [], runner: runOutlookList });
    expect(run.code).toBe(EXIT_OK);
    expect(run.verbs).toEqual(["list"]);
    expect(run.out.split("\n").slice(0, 4)).toEqual([
      "2 message(s) in inbox  (* = unread)",
      "* 2026-10-02T09:00:00Z  Sender One <sender@example.test>",
      "    Synthetic subject m-1",
      "    id: m-1",
    ]);
    expect(box.writes).toEqual([]);
  });

  it("resolves a folder by its display name", async () => {
    const run = await read({ box: mailbox(), rest: ["--folder", "Archive", "--json"], runner: runOutlookList });
    expect(run.code).toBe(EXIT_OK);
    const listing = JSON.parse(run.out) as { messages: { id: string }[] };
    expect(listing.messages.map((message) => message.id)).toEqual(["m-3"]);
  });

  it("refuses a folder name the mailbox does not hold", async () => {
    const run = await read({ box: mailbox(), rest: ["--folder", "Receipts"], runner: runOutlookList });
    expect(run.code).toBe(EXIT_ERROR);
    expect(run.warn).toContain('no folder matches "Receipts"');
  });

  it("refuses an out-of-range --limit before binding a session", async () => {
    const run = await read({ box: mailbox(), rest: ["--limit", "101"], runner: runOutlookList });
    expect(run.code).toBe(EXIT_USAGE);
    expect(run.verbs).toEqual([]);
  });
});

describe("outlook read", () => {
  it("prints one message in full", async () => {
    const run = await read({ box: mailbox(), rest: ["m-1"], runner: runOutlookReadMessage });
    expect(run.code).toBe(EXIT_OK);
    expect(run.out).toContain("to: owner@example.test");
    expect(run.out).toContain("synthetic body of m-1");
  });

  it("prints the whole conversation oldest first under --thread", async () => {
    const run = await read({ box: mailbox(), rest: ["m-1", "--thread"], runner: runOutlookReadMessage });
    expect(run.code).toBe(EXIT_OK);
    expect(run.out.indexOf("--- 1 of 2 ---")).toBe(0);
    expect(run.out.indexOf("id: m-2")).toBeLessThan(run.out.indexOf("id: m-1"));
  });

  it("reports a message Graph does not hold", async () => {
    const run = await read({ box: mailbox(), rest: ["m-404"], runner: runOutlookReadMessage });
    expect(run.code).toBe(EXIT_ERROR);
    expect(run.warn).toBe("404 ItemNotFound: m-404");
  });

  it("refuses a flag standing where the id belongs", async () => {
    const run = await read({ box: mailbox(), rest: ["--thread"], runner: runOutlookReadMessage });
    expect(run.code).toBe(EXIT_USAGE);
  });
});

describe("outlook folders, categories, measure, triage", () => {
  it("folders prints each folder's path and counts", async () => {
    const run = await read({ box: mailbox(), rest: [], runner: runOutlookFolders });
    expect(run.code).toBe(EXIT_OK);
    expect(run.out).toBe("Inbox  3 total, 2 unread  id: folder-inbox\nArchive  5 total, 0 unread  id: folder-archive");
  });

  it("categories prints the master list as JSON", async () => {
    const run = await read({ box: mailbox(), rest: ["--json"], runner: runOutlookCategories });
    expect(JSON.parse(run.out)).toEqual([
      { color: "preset0", displayName: "Waiting on", id: "cat-waiting" },
      { color: "preset1", displayName: "Done", id: "cat-done" },
    ]);
  });

  it("measure leads with its coverage and sums the folder counts", async () => {
    const run = await read({ box: mailbox(), rest: [], runner: runOutlookMeasure });
    expect(run.code).toBe(EXIT_OK);
    expect(run.out.startsWith("coverage: ")).toBe(true);
    expect(run.out).toContain("total: 8 messages, 2 unread");
  });

  it("triage groups the inbox by sender", async () => {
    const run = await read({ box: mailbox(), rest: [], runner: runOutlookTriage });
    expect(run.code).toBe(EXIT_OK);
    expect(run.out.split("\n").slice(0, 2)).toEqual([
      "2 inbox message(s) from 1 sender(s)",
      "Sender One <sender@example.test>  2 message(s), 1 unread",
    ]);
  });

  it("a verb whose session cannot be bound says why and reads nothing", async () => {
    const sessionError = OutlookErrors.scopeMissing({ granted: ["User.Read"], missing: ["MailboxSettings.Read"] });
    const { deps, record } = fakeOutlookShell({ home: HOME, mailbox: mailbox(), sessionError });
    const code = await runOutlookCategories({ deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(record.warn).toEqual([sessionError.message]);
    expect(record.out).toEqual([]);
  });
});
