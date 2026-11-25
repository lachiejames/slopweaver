/**
 * Unit: `outlook draft` and `outlook send`, driven whole over a fake mailbox with a real throwaway home, because
 * both route through the door. The cases that matter are the ones about what did NOT reach the mailbox: a dry-run
 * draft stores nothing, a send with no approval — or with the approval of a draft since edited — never sends.
 */
import { describe, expect, it } from "vitest";
import { runOutlookDraft, runOutlookSend } from "../../../../../cli/commands/outlook/composeRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { OutlookErrors } from "../../../../../live/outlook/errors.js";
import { unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { type FakeMailbox, fakeMailbox, wireMessage } from "../../../../fakeOutlookMailbox.js";
import { fakeOutlookShell, withOutlookHome } from "../../../../fakeOutlookShell.js";

/** A synthetic compose form. */
const FORM = JSON.stringify({
  body: "A synthetic paragraph written for this test.",
  subject: "Synthetic hello",
  to: ["Recipient Two <two@example.test>"],
});

/** Draft `FORM` into `box` and answer the stored draft's id. */
async function draft({ box, home }: { box: FakeMailbox; home: string }): Promise<string> {
  const { deps } = fakeOutlookShell({ home, mailbox: box, stdin: FORM });
  const code = await runOutlookDraft({ deps, rest: ["--form", "-", "--home", home] });
  expect(code).toBe(EXIT_OK);
  return "draft-1";
}

/** Run `send` and answer its exit, its output, the approval digest its preview printed, and the door text it recorded. */
async function send({
  box,
  home,
  rest,
}: {
  box: FakeMailbox;
  home: string;
  rest: readonly string[];
}): Promise<{ code: number; out: string; warn: string; digest: string; ledger: string }> {
  const { deps, door, record } = fakeOutlookShell({ home, mailbox: box });
  const code = await runOutlookSend({ deps, rest: [...rest, "--home", home] });
  const out = record.out.join("\n");
  const printed = /--approve ([0-9a-f]+)/u.exec(out);
  return { code, digest: printed === null ? "" : printed[1]!, ledger: door.text(), out, warn: record.warn.join("\n") };
}

describe("outlook draft", () => {
  it("stores the form as a new draft and points at the send preview", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const { deps, record } = fakeOutlookShell({ home, mailbox: box, stdin: FORM });
        const code = await runOutlookDraft({ deps, rest: ["--form", "-", "--home", home] });
        expect(code).toBe(EXIT_OK);
        expect(box.writes).toEqual(["draft draft-1"]);
        expect(box.messages.get("draft-1")!.toRecipients).toEqual([
          { emailAddress: { address: "two@example.test", name: "Recipient Two" } },
        ]);
        expect(record.out.join("\n")).toContain("  slopweaver outlook send draft-1");
      },
    });
  });

  it("stores a reply in the parent's conversation, then sets its fields", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox({ messages: [wireMessage({ id: "m-1" })] });
        const { deps, record } = fakeOutlookShell({ home, mailbox: box });
        const code = await runOutlookDraft({ deps, rest: ["--form", FORM, "--reply-to", "m-1", "--home", home] });
        expect(code).toBe(EXIT_OK);
        expect(box.writes).toEqual(["reply reply-1 to m-1", "patch-draft reply-1"]);
        expect(record.out.join("\n")).toContain("DRAFT STORED (reply): reply-1");
      },
    });
  });

  it("stores nothing and binds no session on --dry-run, and its JSON names no address", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const { deps, record } = fakeOutlookShell({ home, mailbox: box });
        const code = await runOutlookDraft({ deps, rest: ["--form", FORM, "--dry-run", "--json", "--home", home] });
        expect(code).toBe(EXIT_OK);
        expect(box.writes).toEqual([]);
        expect(record.sessions).toEqual([]);
        expect(JSON.parse(record.out.join("\n"))).toEqual({ bcc: 0, cc: 0, isReply: false, stored: false, to: 1 });
      },
    });
  });

  it("refuses a form with no recipient before binding a session", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const { deps, record } = fakeOutlookShell({ home, mailbox: box });
        const form = JSON.stringify({ body: "Synthetic.", subject: "Synthetic" });
        const code = await runOutlookDraft({ deps, rest: ["--form", form, "--home", home] });
        expect(code).toBe(EXIT_ERROR);
        expect(record.sessions).toEqual([]);
        expect(box.writes).toEqual([]);
      },
    });
  });

  it("refuses a missing --form as a usage error", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const { deps, record } = fakeOutlookShell({ home, mailbox: fakeMailbox() });
        const code = await runOutlookDraft({ deps, rest: ["--home", home] });
        expect(code).toBe(EXIT_USAGE);
        expect(record.warn.join("\n")).toContain("--form <json|-> is required");
      },
    });
  });

  it("stores nothing and exits 1 when the door cannot record its decision, naming the store rather than a hold", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const { deps, record } = fakeOutlookShell({ home, ledger: unreachableDoorLedger(), mailbox: box });
        const code = await runOutlookDraft({ deps, rest: ["--form", FORM, "--home", home] });
        expect(code).toBe(EXIT_ERROR);
        expect(box.writes).toEqual([]);
        expect(record.warn.join("\n")).toContain("slopweaver outlook draft not performed:");
        expect(record.warn.join("\n")).toContain("fixture: the store is down");
        expect(record.out).toEqual([]);
      },
    });
  });

  it("reports a session it could not bind, and stores nothing", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const sessionError = OutlookErrors.notConnected({ product: "mail" });
        const { deps, record } = fakeOutlookShell({ home, mailbox: box, sessionError });
        const code = await runOutlookDraft({ deps, rest: ["--form", FORM, "--home", home] });
        expect(code).toBe(EXIT_ERROR);
        expect(record.warn).toEqual([sessionError.message]);
        expect(box.writes).toEqual([]);
      },
    });
  });
});

describe("outlook send", () => {
  it("previews and refuses at the door with no --approve, sending nothing", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const id = await draft({ box, home });
        const run = await send({ box, home, rest: [id] });
        expect(run.code).toBe(EXIT_ERROR);
        expect(run.out).toContain("This preview sends nothing. To send exactly this content:");
        expect(run.out).toContain("to: Recipient Two <two@example.test>");
        expect(box.writes).toEqual(["draft draft-1"]);
        expect(run.ledger).toContain('"action":"verb:outlook.send"');
      },
    });
  });

  it("sends the draft when --approve carries the digest the preview printed", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const id = await draft({ box, home });
        const preview = await send({ box, home, rest: [id] });
        const run = await send({ box, home, rest: [id, "--approve", preview.digest] });
        expect(run.code).toBe(EXIT_OK);
        expect(box.writes).toEqual(["draft draft-1", "send draft-1"]);
        expect(run.out).toContain("SENT: draft draft-1");
      },
    });
  });

  it("refuses an approval taken before the draft was edited in Outlook", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox();
        const id = await draft({ box, home });
        const preview = await send({ box, home, rest: [id] });
        const stored = box.messages.get(id)!;
        box.messages.set(id, { ...stored, body: { content: "An edited synthetic paragraph.", contentType: "text" } });
        const run = await send({ box, home, rest: [id, "--approve", preview.digest] });
        expect(run.code).toBe(EXIT_ERROR);
        expect(run.digest).not.toBe(preview.digest);
        expect(box.writes).toEqual(["draft draft-1"]);
      },
    });
  });

  it("refuses a message that is not a draft before the door", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const box = fakeMailbox({ messages: [wireMessage({ id: "m-1" })] });
        const run = await send({ box, home, rest: ["m-1"] });
        expect(run.code).toBe(EXIT_ERROR);
        expect(run.warn).toBe("m-1 is not a draft — only a draft can be sent");
        expect(run.ledger).toBe("");
      },
    });
  });
});
