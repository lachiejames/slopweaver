/**
 * Unit: the three `outlook` change verbs — `mark`, `category`, `archive` — driven whole over a fake mailbox. The
 * assertions that matter are about what reached the mailbox: a dry run writes nothing, a message already in the
 * wanted state is not written again, a refused name stops the verb before any message is read, and a failed write
 * stops the rest and exits non-zero.
 */
import { describe, expect, it } from "vitest";
import { runOutlookChange } from "../../../../../cli/commands/outlook/modifyRun.js";
import {
  parseOutlookArchiveArgs,
  parseOutlookCategoryArgs,
  parseOutlookMarkArgs,
} from "../../../../../cli/commands/outlook/writeCore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { type FakeMailbox, fakeMailbox, wireMessage } from "../../../../fakeOutlookMailbox.js";
import { fakeOutlookShell, withOutlookHome } from "../../../../fakeOutlookShell.js";

/** Two inbox messages in one conversation, one unread, and a third already archived. */
function mailbox(): FakeMailbox {
  return fakeMailbox({
    messages: [
      wireMessage({ id: "m-1", over: { conversationId: "conv-a", isRead: false } }),
      wireMessage({ id: "m-2", over: { categories: ["Done"], conversationId: "conv-a", isRead: true } }),
      wireMessage({ id: "m-3", over: { conversationId: "conv-b", parentFolderId: "folder-archive" } }),
    ],
  });
}

const PARSERS = {
  archive: parseOutlookArchiveArgs,
  category: parseOutlookCategoryArgs,
  mark: parseOutlookMarkArgs,
} as const;

/** Run one change verb over `box` in `home`. */
async function change({
  box,
  home,
  verb,
  rest,
}: {
  box: FakeMailbox;
  home: string;
  verb: keyof typeof PARSERS;
  rest: readonly string[];
}): Promise<{ code: number; out: string; warn: string; ledger: string }> {
  const { deps, door, record } = fakeOutlookShell({ home, mailbox: box });
  const code = await runOutlookChange({ deps, parse: PARSERS[verb], rest: [...rest, "--home", home], verb });
  return { code, ledger: door.text(), out: record.out.join("\n"), warn: record.warn.join("\n") };
}

describe("outlook mark", () => {
  it("writes isRead on the one message that is not already read", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-1", "--read", "--thread"], verb: "mark" });
        expect(run.code).toBe(EXIT_OK);
        expect(box.writes).toEqual(['patch m-1 {"isRead":true}']);
        expect(box.messages.get("m-1")!.isRead).toBe(true);
        expect(run.out).toBe("mark: 1 changed, 1 already as asked\n  changed: m-1");
      },
    });
  });

  it("writes nothing on --dry-run and says so", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-1", "--read", "--dry-run"], verb: "mark" });
        expect(run.code).toBe(EXIT_OK);
        expect(box.writes).toEqual([]);
        expect(run.out).toContain("DRY RUN — nothing was written");
        expect(run.ledger).toBe("");
      },
    });
  });

  it("journals the applied change at the door, naming no message", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-2", "--unread", "--thread"], verb: "mark" });
        expect(box.writes).toEqual(['patch m-2 {"isRead":false}']);
        expect(run.ledger).toContain('"action":"verb:outlook.mark"');
        expect(run.ledger).toContain('"status":"pass"');
        expect(run.ledger).not.toContain("m-2");
      },
    });
  });

  it("refuses --read with --unread as a usage error before binding a session", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const { deps, record } = fakeOutlookShell({ home, mailbox: box });
        const code = await runOutlookChange({
          deps,
          parse: parseOutlookMarkArgs,
          rest: ["m-1", "--read", "--unread"],
          verb: "mark",
        });
        expect(code).toBe(EXIT_USAGE);
        expect(record.sessions).toEqual([]);
      },
    });
  });
});

describe("outlook archive", () => {
  it("moves inbox messages to the Archive folder and leaves an archived one alone", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-1", "m-3"], verb: "archive" });
        expect(run.code).toBe(EXIT_OK);
        expect(box.writes).toEqual(["move m-1 folder-archive"]);
        expect(box.messages.get("m-1")!.parentFolderId).toBe("folder-archive");
      },
    });
  });

  it("--restore moves an archived message back to the inbox", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        await change({ box, home, rest: ["m-3", "--restore"], verb: "archive" });
        expect(box.writes).toEqual(["move m-3 folder-inbox"]);
      },
    });
  });

  it("refuses a mailbox with no Archive folder before reading any message", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        delete box.wellKnown["archive"];
        box.messages.delete("m-1");
        const run = await change({ box, home, rest: ["m-1"], verb: "archive" });
        expect(run.code).toBe(EXIT_ERROR);
        expect(run.warn).toContain('no folder matches "archive"');
        expect(box.writes).toEqual([]);
      },
    });
  });

  it("stops at the first failed write, names what it did not reach, and exits non-zero", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        box.failWritesFor.add("m-1");
        const run = await change({ box, home, rest: ["m-1", "m-2"], verb: "archive" });
        expect(run.code).toBe(EXIT_ERROR);
        expect(box.writes).toEqual([]);
        expect(run.out).toContain("  FAILED: m-1 — 429 throttled writing m-1");
        expect(run.out).toContain("  not attempted: m-2");
      },
    });
  });
});

describe("outlook category", () => {
  it("adds a category by its display name, case-insensitively, keeping the existing ones", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-2", "--add", "waiting on"], verb: "category" });
        expect(run.code).toBe(EXIT_OK);
        expect(box.messages.get("m-2")!.categories).toEqual(["Done", "Waiting on"]);
      },
    });
  });

  it("refuses a category the mailbox does not define, and writes nothing", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-2", "--add", "Nonexistent"], verb: "category" });
        expect(run.code).toBe(EXIT_ERROR);
        expect(run.warn).toContain('no category matches "Nonexistent"');
        expect(box.writes).toEqual([]);
      },
    });
  });

  it("refuses the same category both added and removed", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = mailbox();
        const run = await change({ box, home, rest: ["m-2", "--add", "Done", "--remove", "Done"], verb: "category" });
        expect(run.code).toBe(EXIT_ERROR);
        expect(run.warn).toContain("is both added and removed");
      },
    });
  });
});
