/** Unit: `gmail attachment` — its parser, and the shell's dispatch, human vs `--json` output and exit codes. */
import { describe, expect, it } from "vitest";

import { type GmailAttachmentDeps, runGmailAttachment } from "../../../../../cli/commands/gmail/attachmentRun.js";
import { parseGmailAttachmentArgs } from "../../../../../cli/commands/gmail/core.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { GmailAttachmentResult } from "../../../../../live/gmail/attachment.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";

const RESULT: GmailAttachmentResult = {
  document: {
    coverage: { detail: "one attachment, 5 bytes, saved in full", kind: "bounded", residue: ["stored unredacted"] },
    data: {},
    readAtIso: "2026-09-17T01:00:00.000Z",
    source: "gmail",
    target: { address: "abc/1", identity: "me@example.test", kind: "attachment" },
  },
  saved: {
    account: "me@example.test",
    filename: "notes.txt",
    localPath: "/h/live/gmail/attachments/abc/1-notes.txt",
    messageId: "abc",
    mimeType: "text/plain",
    partId: "1",
    sizeBytes: 5,
  },
};

/** A shell harness whose fetch records its arguments and answers with `answer`. */
function harness({ answer }: { answer: Awaited<ReturnType<GmailAttachmentDeps["fetch"]>> }): {
  deps: GmailAttachmentDeps;
  out: string[];
  diagnostics: string[];
  fetched: Parameters<GmailAttachmentDeps["fetch"]>[0][];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const fetched: Parameters<GmailAttachmentDeps["fetch"]>[0][] = [];
  return {
    deps: {
      fetch: async (args) => {
        fetched.push(args);
        return answer;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    fetched,
    out,
  };
}

describe("parseGmailAttachmentArgs", () => {
  it("takes the id, a name and the default 25 MiB ceiling", () => {
    expect(unwrap(parseGmailAttachmentArgs({ rest: ["abc", "--name", "notes.txt"] }))).toStrictEqual({
      home: undefined,
      json: false,
      maxBytes: 25 * 1024 * 1024,
      messageId: "abc",
      name: "notes.txt",
      partId: undefined,
    });
  });

  it("converts --max-file-mb and accepts --part alone", () => {
    const args = unwrap(parseGmailAttachmentArgs({ rest: ["abc", "--part", "2.1", "--max-file-mb", "1", "--json"] }));
    expect(args.maxBytes).toBe(1024 * 1024);
    expect(args.partId).toBe("2.1");
    expect(args.json).toBe(true);
  });

  it("refuses when neither --name nor --part names the attachment", () => {
    expect(unwrapErr(parseGmailAttachmentArgs({ rest: ["abc"] })).message).toBe(
      "name the attachment: give --name <filename>, --part <partId>, or both",
    );
  });

  it("refuses a missing message id", () => {
    expect(unwrapErr(parseGmailAttachmentArgs({ rest: ["--name", "x"] })).message).toBe("missing <message-id>");
  });

  it("refuses a non-positive ceiling rather than falling back to the default", () => {
    expect(unwrapErr(parseGmailAttachmentArgs({ rest: ["abc", "--name", "x", "--max-file-mb", "0"] })).message).toBe(
      "--max-file-mb must be a positive number, got 0",
    );
  });
});

describe("runGmailAttachment", () => {
  it("prints the READ THIS path on success", async () => {
    const h = harness({ answer: ok(RESULT) });
    expect(await runGmailAttachment({ deps: h.deps, rest: ["abc", "--name", "notes.txt", "--home", "/h"] })).toBe(
      EXIT_OK,
    );
    expect(h.fetched).toStrictEqual([
      { home: "/h", maxBytes: 25 * 1024 * 1024, messageId: "abc", name: "notes.txt", partId: undefined },
    ]);
    expect(h.out[0]!.split("\n").at(-1)).toBe("READ THIS: /h/live/gmail/attachments/abc/1-notes.txt");
    expect(h.out[0]!.split("\n").at(-2)).toBe('attachment "notes.txt" (text/plain, 5 bytes, part 1) from message abc');
  });

  it("emits the shared document on --json", async () => {
    const h = harness({ answer: ok(RESULT) });
    expect(await runGmailAttachment({ deps: h.deps, rest: ["abc", "--part", "1", "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(h.out[0]!)).toStrictEqual(JSON.parse(JSON.stringify(RESULT.document)));
  });

  it("exits with a usage code and never fetches when the parse fails", async () => {
    const h = harness({ answer: ok(RESULT) });
    expect(await runGmailAttachment({ deps: h.deps, rest: ["abc"] })).toBe(EXIT_USAGE);
    expect(h.fetched).toStrictEqual([]);
  });

  it("reports a typed refusal's message and exits with an error code", async () => {
    const refusal = GmailErrors.attachmentTooLarge({ maxBytes: 5, sizeBytes: 9 });
    const h = harness({ answer: err(refusal) });
    expect(await runGmailAttachment({ deps: h.deps, rest: ["abc", "--part", "1"] })).toBe(EXIT_ERROR);
    expect(h.diagnostics).toStrictEqual([refusal.message]);
    expect(h.out).toStrictEqual([]);
  });
});
