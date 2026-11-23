/**
 * The Claude reset claims journal round-trips through a real temp home: absent reads as empty, rows come back in
 * append order, and a line that will not parse fails the whole read rather than hiding an open attempt.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { ClaudeResetJournalRow } from "../../../claude/resetAttempt.js";
import { appendClaudeResetJournal, readClaudeResetJournal } from "../../../claude/resetJournalStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const INTENT: ClaudeResetJournalRow = {
  alias: "plan-five",
  atIso: "2026-09-30T08:00:00.000Z",
  atLimitAtIntent: true,
  grantId: "welcome-1",
  kind: "intent",
  requestId: "req-1",
  resetsLeftAtIntent: 2,
  v: 1,
};
const OUTCOME: ClaudeResetJournalRow = {
  alias: "plan-five",
  atIso: "2026-09-30T08:00:01.000Z",
  kind: "outcome",
  requestId: "req-1",
  result: "reset",
  v: 1,
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-claude-reset-journal-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("the Claude reset claims journal", () => {
  it("reads an absent journal as empty — no claim was ever attempted here", () => {
    expect(unwrap(readClaudeResetJournal({ home }))).toEqual([]);
  });

  it("hands back every appended row in order, in an owner-only file", () => {
    expect(appendClaudeResetJournal({ home, row: INTENT }).isOk()).toBe(true);
    expect(appendClaudeResetJournal({ home, row: OUTCOME }).isOk()).toBe(true);

    expect(unwrap(readClaudeResetJournal({ home }))).toEqual([INTENT, OUTCOME]);
    expect(statSync(stateHomePaths({ home }).claudeResetClaimsJsonl).mode & 0o777).toBe(0o600);
  });

  it("fails the whole read on a line that will not parse, so an open attempt is never skipped", () => {
    expect(appendClaudeResetJournal({ home, row: INTENT }).isOk()).toBe(true);
    appendFileSync(stateHomePaths({ home }).claudeResetClaimsJsonl, "{not json\n");

    const read = readClaudeResetJournal({ home });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("RESET_JOURNAL_FAILED");
  });

  it("fails a read it cannot open rather than reading it as empty", () => {
    mkdirSync(stateHomePaths({ home }).claudeResetClaimsJsonl, { recursive: true });

    const read = readClaudeResetJournal({ home });

    expect(read._unsafeUnwrapErr().code).toBe("RESET_JOURNAL_FAILED");
    expect(read._unsafeUnwrapErr().message).toContain("reading");
  });

  it("fails an append it cannot write, so an unrecorded intent is never sent", () => {
    mkdirSync(stateHomePaths({ home }).claudeResetClaimsJsonl, { recursive: true });

    const appended = appendClaudeResetJournal({ home, row: INTENT });

    expect(appended._unsafeUnwrapErr().code).toBe("RESET_JOURNAL_FAILED");
    expect(appended._unsafeUnwrapErr().message).toContain("appending");
  });
});
