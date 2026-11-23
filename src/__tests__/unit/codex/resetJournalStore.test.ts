/**
 * The Codex reset claims journal round-trips through a real temp home: absent reads as empty, rows come back in
 * append order, and a line that will not parse fails the whole read rather than hiding an open attempt.
 */
import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { CodexResetJournalRow } from "../../../codex/resetConsume.js";
import { appendCodexResetJournal, readCodexResetJournal } from "../../../codex/resetJournalStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const INTENT: CodexResetJournalRow = {
  alias: "plan-two",
  atIso: "2026-09-29T09:00:00.000Z",
  idempotencyKey: "k-1",
  kind: "intent",
  v: 1,
};
const OUTCOME: CodexResetJournalRow = {
  alias: "plan-two",
  atIso: "2026-09-29T09:00:01.000Z",
  idempotencyKey: "k-1",
  kind: "outcome",
  outcome: "reset",
  v: 1,
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-reset-journal-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("the Codex reset claims journal", () => {
  it("reads an absent journal as empty — no reset was ever attempted here", () => {
    expect(unwrap(readCodexResetJournal({ home }))).toEqual([]);
  });

  it("hands back every appended row in order, in an owner-only file", () => {
    expect(appendCodexResetJournal({ home, row: INTENT }).isOk()).toBe(true);
    expect(appendCodexResetJournal({ home, row: OUTCOME }).isOk()).toBe(true);

    expect(unwrap(readCodexResetJournal({ home }))).toEqual([INTENT, OUTCOME]);
    expect(statSync(stateHomePaths({ home }).codexResetClaimsJsonl).mode & 0o777).toBe(0o600);
  });

  it("fails the whole read on a line that will not parse, so an open attempt is never skipped", () => {
    expect(appendCodexResetJournal({ home, row: INTENT }).isOk()).toBe(true);
    appendFileSync(stateHomePaths({ home }).codexResetClaimsJsonl, "{not json\n");

    const read = readCodexResetJournal({ home });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("RESET_JOURNAL_FAILED");
  });
});
