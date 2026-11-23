/**
 * Unit: the pure `outlook` argument parsers, read side (`core.ts`) and write side (`writeCore.ts`). Every refusal
 * here happens before a credential is read, so each case asserts the exact error code a caller branches on.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTLOOK_LIST_LIMIT,
  parseOutlookAttachmentArgs,
  parseOutlookListArgs,
  parseOutlookReadArgs,
  parseOutlookTriageArgs,
} from "../../../../../cli/commands/outlook/core.js";
import {
  MAX_OUTLOOK_ARCHIVE_IDS,
  parseOutlookArchiveArgs,
  parseOutlookCategoryArgs,
  parseOutlookDraftArgs,
  parseOutlookMarkArgs,
  parseOutlookSendArgs,
} from "../../../../../cli/commands/outlook/writeCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("read-side parsers", () => {
  it("list defaults to the inbox at the default limit", () => {
    expect(unwrap(parseOutlookListArgs({ rest: [] }))).toEqual({
      folder: "inbox",
      home: undefined,
      json: false,
      limit: DEFAULT_OUTLOOK_LIST_LIMIT,
      query: undefined,
      unreadOnly: false,
    });
  });

  it("list carries --folder, --query, --unread and --limit", () => {
    const rest = ["--folder", "Archive", "--query", "a: b", "--unread", "--limit", "5", "--json"];
    expect(unwrap(parseOutlookListArgs({ rest }))).toEqual({
      folder: "Archive",
      home: undefined,
      json: true,
      limit: 5,
      query: "a: b",
      unreadOnly: true,
    });
  });

  it.each(["0", "101", "2.5", "many"])("list refuses --limit %s", (limit) => {
    const error = unwrapErr(parseOutlookListArgs({ rest: ["--limit", limit] }));
    expect(error.code).toBe("INVALID_FLAG_VALUE");
  });

  it("list refuses an unknown flag", () => {
    expect(unwrapErr(parseOutlookListArgs({ rest: ["--label", "x"] })).code).toBe("FLAGS_INVALID");
  });

  it("read takes one id and --thread", () => {
    expect(unwrap(parseOutlookReadArgs({ rest: ["m-1", "--thread"] }))).toEqual({
      home: undefined,
      id: "m-1",
      json: false,
      thread: true,
    });
  });

  it("read refuses a flag standing where the id belongs", () => {
    expect(unwrapErr(parseOutlookReadArgs({ rest: ["--thread", "m-1"] })).code).toBe("ARGUMENT_MISSING");
  });

  it("attachment converts --max-file-mb to bytes", () => {
    const args = unwrap(parseOutlookAttachmentArgs({ rest: ["m-1", "--attachment-id", "a-1", "--max-file-mb", "2"] }));
    expect(args.selector).toEqual({ attachmentId: "a-1" });
    expect(args.maxBytes).toBe(2 * 1024 * 1024);
  });

  it("attachment refuses a --name starting with --, loudly, rather than selecting by it", () => {
    const error = unwrapErr(parseOutlookAttachmentArgs({ rest: ["m-1", "--name=--notes.txt"] }));
    expect(error.code).toBe("FLAGS_INVALID");
    expect(error.message).toBe("--name requires a value");
  });

  it("attachment needs exactly one selector", () => {
    expect(unwrapErr(parseOutlookAttachmentArgs({ rest: ["m-1"] })).code).toBe("FLAG_MISSING");
    const both = ["m-1", "--name", "a.txt", "--attachment-id", "a-1"];
    expect(unwrapErr(parseOutlookAttachmentArgs({ rest: both })).code).toBe("MODES_CONFLICT");
  });

  it("triage refuses an out-of-range --limit", () => {
    expect(unwrapErr(parseOutlookTriageArgs({ rest: ["--limit", "0"] })).code).toBe("INVALID_FLAG_VALUE");
  });
});

describe("write-side parsers", () => {
  it("mark needs exactly one direction", () => {
    expect(unwrap(parseOutlookMarkArgs({ rest: ["m-1", "--unread"] })).request).toEqual({ kind: "mark", read: false });
    expect(unwrapErr(parseOutlookMarkArgs({ rest: ["m-1"] })).code).toBe("FLAG_MISSING");
    expect(unwrapErr(parseOutlookMarkArgs({ rest: ["m-1", "--read", "--unread"] })).code).toBe("MODES_CONFLICT");
  });

  it("category collects every repeated --add and --remove", () => {
    const rest = ["m-1", "--add", "A", "--remove", "B", "--add", "C", "--dry-run"];
    const args = unwrap(parseOutlookCategoryArgs({ rest }));
    expect(args.request).toEqual({ add: ["A", "C"], kind: "category", remove: ["B"] });
    expect(args.dryRun).toBe(true);
  });

  it("category refuses a call that changes nothing", () => {
    expect(unwrapErr(parseOutlookCategoryArgs({ rest: ["m-1", "--thread"] })).code).toBe("NOTHING_TO_CHANGE");
  });

  it("archive deduplicates its leading ids in order and reads --restore", () => {
    const args = unwrap(parseOutlookArchiveArgs({ rest: ["m-2", "m-1", "m-2", "--restore"] }));
    expect(args.ids).toEqual(["m-2", "m-1"]);
    expect(args.request).toEqual({ kind: "archive", restore: true });
  });

  it("archive refuses no id, and more than its ceiling", () => {
    expect(unwrapErr(parseOutlookArchiveArgs({ rest: ["--restore"] })).code).toBe("ARGUMENT_MISSING");
    const many = Array.from({ length: MAX_OUTLOOK_ARCHIVE_IDS + 1 }, (_, index) => `m-${String(index)}`);
    expect(unwrapErr(parseOutlookArchiveArgs({ rest: many })).code).toBe("INVALID_FLAG_VALUE");
  });

  it("draft requires --form and keeps the stdin sentinel for the shell", () => {
    expect(unwrapErr(parseOutlookDraftArgs({ rest: ["--dry-run"] })).code).toBe("FLAG_MISSING");
    expect(unwrap(parseOutlookDraftArgs({ rest: ["--form", "-", "--reply-to", "m-1"] }))).toEqual({
      dryRun: false,
      formSource: "-",
      home: undefined,
      json: false,
      replyTo: "m-1",
    });
  });

  it("send takes a draft id and an optional --approve, and has no --dry-run", () => {
    expect(unwrap(parseOutlookSendArgs({ rest: ["d-1", "--approve", "abc"] }))).toEqual({
      approve: "abc",
      draftId: "d-1",
      home: undefined,
      json: false,
    });
    expect(unwrapErr(parseOutlookSendArgs({ rest: ["d-1", "--dry-run"] })).code).toBe("FLAGS_INVALID");
  });
});
