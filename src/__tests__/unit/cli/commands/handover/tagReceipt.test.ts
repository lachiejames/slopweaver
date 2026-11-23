/**
 * What a failed tag write tells its caller to do next, and the command it hands them — the two halves of a
 * recovery that has to be right whether or not the append landed.
 */
import { describe, expect, it } from "vitest";

import { tagRecoveryAdvice, tagRecoveryCommand } from "../../../../../cli/commands/handover/tagReceipt.js";
import { parseTagRequest } from "../../../../../handover/tagWrite.js";
import { unwrap } from "../../../../../lib/result.js";

const COMMAND = "slopweaver handover tag a-row impact=high --why x";

describe("tagRecoveryAdvice", () => {
  it("promises the command finishes the write once its cause is fixed, when every line still decodes", () => {
    expect(tagRecoveryAdvice({ command: COMMAND, journalPath: "/h/runs/a-row.jsonl", unreadableLines: [] })).toBe(
      `  the append may have landed; once what stopped it above is fixed, this finishes it either way: ${COMMAND}`,
    );
  });

  it("names the undecodable lines to repair first, since the command cannot converge over them", () => {
    expect(tagRecoveryAdvice({ command: COMMAND, journalPath: "/h/runs/a-row.jsonl", unreadableLines: [3, 5] })).toBe(
      "  /h/runs/a-row.jsonl now holds undecodable line(s) 3, 5, and the tag may sit beside them — repair or " +
        `remove those lines, then run: ${COMMAND}`,
    );
  });

  it("says whether the tag landed is unknown when the journal cannot be read at all", () => {
    expect(
      tagRecoveryAdvice({ command: COMMAND, journalPath: "/h/runs/a-row.jsonl", unreadableLines: undefined }),
    ).toBe(
      `  /h/runs/a-row.jsonl could not be read back, so whether the tag landed is unknown — once it reads, run: ${COMMAND}`,
    );
  });
});

describe("tagRecoveryCommand", () => {
  it("repeats every part of the request, quoted, naming the home only when one was passed", () => {
    const request = unwrap(
      parseTagRequest({ assignments: ["workstream=payroll"], drops: "impact", newValues: "workstream=payroll" }),
    );
    expect(tagRecoveryCommand({ home: undefined, request, slug: "a-row", why: "it's a retry" })).toBe(
      "slopweaver handover tag a-row workstream=payroll --drop impact --new-value workstream=payroll --why 'it'\\''s a retry'",
    );
    expect(tagRecoveryCommand({ home: "/tmp/h", request, slug: "a-row", why: "x" })).toContain("--home /tmp/h");
  });
});
