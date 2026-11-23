/**
 * Reading a local file: a picture comes back as the picture, an attached file's line names the path to read, and a
 * page's outline points at the section a question is about.
 */
import { describe, expect, it } from "vitest";

import { FILE_TOOLS } from "../../../../talk/fileToolSchemas.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";

describe("TALK_TOOLS", () => {
  // The owner expects a PNG file to be readable by the model.
  it("tells the model, in the tool and the prompt, that a PNG, JPEG or WebP comes back as the picture", () => {
    expect(FILE_TOOLS.find((tool) => tool.name === "file_read")!.description).toContain(
      "A PNG, JPEG or WebP comes back as the picture itself, whole",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("A PNG, JPEG or WebP comes back as the picture itself");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("Never say you cannot read a local file or picture");
  });

  // The line the Messenger writes for a kept file is the line this
  // prompt names, so the model reads that path with file_read before it answers. Imported by address: `src/`'s
  // `rootDir` may not contain a `site/` file.
  it("tells the model to file_read the path an attached file's line names, the line the Messenger writes", async () => {
    const site = (await import(new URL("../../../../../site/lib/messengerAttachment.ts", import.meta.url).href)) as {
      messengerAttachmentLine: (args: {
        receipt: { path: string; name: string; kind: "text"; bytes: number };
      }) => string;
    };
    const line = site.messengerAttachmentLine({
      receipt: { bytes: 12, kind: "text", name: "notes.md", path: "/h/talk/attachments/u1/notes.md" },
    });
    expect(line).toBe(
      '[Attached: "notes.md", a text file of 12 B, saved at "/h/talk/attachments/u1/notes.md". Read it with file_read.]',
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      '- A message line \'[Attached: "<name>", …, saved at "<path>". Read it with file_read.]\' is a file attached',
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("file_read that exact path before you answer");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "'[Attached: …]' line in it is a file the owner attached there: hand it to the thinking model to file_read that path,",
    );
  });

  // One window from 7,800 of the code-ownership briefing never reached its options,
  // and the voice answered a question about proposals out of the table describing today's settings.
  it("tells the model to read the section a question is about from the page's outline, never a neighbour", () => {
    const description = FILE_TOOLS.find((tool) => tool.name === "file_read")!.description;
    expect(description).toContain("A window of an .html page with headings also carries `outline`");
    expect(description).toContain("call file_read again with that heading's `from` before answering");
    expect(description).toContain("never answer it from a neighbouring section");
    expect(description).not.toContain("Answer from the first window");
  });
});
