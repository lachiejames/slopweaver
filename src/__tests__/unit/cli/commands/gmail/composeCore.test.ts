/**
 * The two outbound verbs' pure parsers. Nothing here reaches a mailbox, which is the property that lets
 * both verbs declare `parseRejectIsIoFree` — a refusal below has, by construction, read no credential and
 * opened no socket.
 */
import { describe, expect, it } from "vitest";

import { parseGmailDraftArgs, parseGmailSendArgs } from "../../../../../cli/commands/gmail/composeCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGmailDraftArgs", () => {
  it("takes the form source verbatim, leaving the stdin read to the shell", () => {
    expect(unwrap(parseGmailDraftArgs({ rest: ["--form", "-"] })).formSource).toBe("-");
  });

  it("takes inline JSON as the form source too", () => {
    const args = unwrap(parseGmailDraftArgs({ rest: ["--form", '{"to":["a@b.com"]}'] }));
    expect(args.formSource).toBe('{"to":["a@b.com"]}');
  });

  it("refuses a missing --form, naming stdin as the recommended way", () => {
    expect(unwrapErr(parseGmailDraftArgs({ rest: [] })).message).toContain("--form is required");
  });

  it("reads --reply-to", () => {
    expect(unwrap(parseGmailDraftArgs({ rest: ["--form", "-", "--reply-to", "m-1"] })).replyToId).toBe("m-1");
  });

  it("leaves replyToId undefined when no reply was asked for, rather than inventing an empty string", () => {
    expect(unwrap(parseGmailDraftArgs({ rest: ["--form", "-"] })).replyToId).toBe(undefined);
  });

  it("reads --dry-run and --json", () => {
    const args = unwrap(parseGmailDraftArgs({ rest: ["--form", "-", "--dry-run", "--json"] }));
    expect(args.dryRun).toBe(true);
    expect(args.json).toBe(true);
  });

  it("defaults --dry-run off, so a plain draft really does store", () => {
    expect(unwrap(parseGmailDraftArgs({ rest: ["--form", "-"] })).dryRun).toBe(false);
  });

  it("reads --home", () => {
    expect(unwrap(parseGmailDraftArgs({ rest: ["--form", "-", "--home", "/tmp/h"] })).home).toBe("/tmp/h");
  });

  it("refuses an unknown flag and prints the usage with it", () => {
    const problem = unwrapErr(parseGmailDraftArgs({ rest: ["--form", "-", "--send-now"] }));
    expect(problem.code).toBe("FLAGS_INVALID");
    expect(problem.usage).toContain("usage: slopweaver gmail draft");
  });
});

describe("parseGmailSendArgs", () => {
  it("takes the draft id as a leading positional", () => {
    expect(unwrap(parseGmailSendArgs({ rest: ["d-1"] })).draftId).toBe("d-1");
  });

  it("refuses a missing draft id", () => {
    expect(unwrapErr(parseGmailSendArgs({ rest: [] })).message).toBe("missing <draft-id>");
  });

  it("refuses a flag where the draft id should be, rather than treating it as an id", () => {
    expect(unwrapErr(parseGmailSendArgs({ rest: ["--approve", "abc"] })).message).toBe("missing <draft-id>");
  });

  it("reads --approve", () => {
    expect(unwrap(parseGmailSendArgs({ rest: ["d-1", "--approve", "abc123"] })).approve).toBe("abc123");
  });

  it("leaves approve undefined when none was given, which is the refusing path", () => {
    expect(unwrap(parseGmailSendArgs({ rest: ["d-1"] })).approve).toBe(undefined);
  });

  it("has NO --dry-run, because the unapproved run is already the preview", () => {
    const problem = unwrapErr(parseGmailSendArgs({ rest: ["d-1", "--dry-run"] }));
    expect(problem.code).toBe("FLAGS_INVALID");
    expect(problem.usage).toContain("usage: slopweaver gmail send");
  });

  it("warns in its usage that this reaches another person and cannot be undone", () => {
    const problem = unwrapErr(parseGmailSendArgs({ rest: [] }));
    expect(problem.code).toBe("ARGUMENT_MISSING");
    expect(problem.usage).toContain("THIS PUTS MAIL IN FRONT OF ANOTHER PERSON");
  });
});
