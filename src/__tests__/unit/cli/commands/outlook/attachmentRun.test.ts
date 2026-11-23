/**
 * Unit: `outlook attachment`, driven whole over a fake mailbox. The write itself goes through the recording
 * `writeBytes` seam, and the home is a real throwaway directory because the verb prepares its owner-only
 * directory under it.
 */
import { describe, expect, it } from "vitest";
import { runOutlookAttachment } from "../../../../../cli/commands/outlook/attachmentRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { type FakeMailbox, fakeMailbox, wireMessage } from "../../../../fakeOutlookMailbox.js";
import { fakeOutlookShell, withOutlookHome } from "../../../../fakeOutlookShell.js";

/** A message carrying one file attachment and one attached message, with the file's synthetic bytes. */
function mailbox(): FakeMailbox {
  const box = fakeMailbox({ messages: [wireMessage({ id: "m-1", over: { hasAttachments: true } })] });
  box.attachments.set("m-1", [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      contentType: "text/plain",
      id: "att-1",
      name: "notes.txt",
      size: 5,
    },
    { "@odata.type": "#microsoft.graph.itemAttachment", contentType: null, id: "att-2", name: "Forwarded", size: 900 },
  ]);
  box.bytes.set("att-1", new TextEncoder().encode("hello"));
  return box;
}

describe("outlook attachment", () => {
  it("saves the named file under the home's Outlook attachments root and prints where", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const { deps, record } = fakeOutlookShell({ home, mailbox: mailbox() });
        const code = await runOutlookAttachment({ deps, rest: ["m-1", "--name", "notes.txt", "--home", home] });
        expect(code).toBe(EXIT_OK);
        expect(record.saved.length).toBe(1);
        const [saved] = record.saved;
        expect(saved!.size).toBe(5);
        expect(saved!.path.startsWith(stateHomePaths({ home }).live.outlook.attachments)).toBe(true);
        expect(record.out.join("\n").startsWith(`READ THIS: ${saved!.path}`)).toBe(true);
      },
    });
  });

  it("refuses an attachment that is not a file, naming its kind, and writes nothing", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const { deps, record } = fakeOutlookShell({ home, mailbox: mailbox() });
        const code = await runOutlookAttachment({ deps, rest: ["m-1", "--attachment-id", "att-2", "--home", home] });
        expect(code).toBe(EXIT_ERROR);
        expect(record.warn.join("\n")).toContain("itemAttachment");
        expect(record.saved).toEqual([]);
      },
    });
  });

  it("refuses a name no attachment carries, listing what the message does carry", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const { deps, record } = fakeOutlookShell({ home, mailbox: mailbox() });
        const code = await runOutlookAttachment({ deps, rest: ["m-1", "--name", "other.pdf", "--home", home] });
        expect(code).toBe(EXIT_ERROR);
        expect(record.warn.join("\n")).toContain("notes.txt [fileAttachment] id=att-1");
      },
    });
  });

  it("refuses --name beside --attachment-id before binding a session", async () => {
    await withOutlookHome({
      run: async ({ home }) => {
        const { deps, record } = fakeOutlookShell({ home, mailbox: mailbox() });
        const code = await runOutlookAttachment({
          deps,
          rest: ["m-1", "--name", "notes.txt", "--attachment-id", "att-1", "--home", home],
        });
        expect(code).toBe(EXIT_USAGE);
        expect(record.sessions).toEqual([]);
      },
    });
  });
});
