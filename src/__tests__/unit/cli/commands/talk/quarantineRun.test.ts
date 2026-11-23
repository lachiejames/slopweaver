/**
 * `slopweaver talk quarantine` driven through its real argv over a throwaway `--home`: a gone indexed call is accepted
 * once, a second acceptance and a present file are refused writing nothing, and a bad flag is refused before any read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { quarantineSession, runTalkQuarantine } from "../../../../../cli/commands/talk/quarantineRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { readCallQuarantine } from "../../../../../talk/callQuarantineLedger.js";
import { callIndexPath } from "../../../../../talk/callStore.js";

const CALL = "8d74b96f-f72d-4135-be24-b78897fa3926";
const REASON = "e2e test call removed by hand; synthetic";

const argvFor = ({ rest }: { rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  "quarantine",
  ...rest,
];

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-quarantine-run-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
  writeFileSync(callIndexPath({ home }), `${CALL}\n`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const ledgerReasons = (): readonly string[] =>
  unwrap(readCallQuarantine({ home })).map((row) => `${row.callId}: ${row.reason}`);

describe("runTalkQuarantine", () => {
  it("accepts a gone indexed call once, and refuses the second acceptance leaving one row", () => {
    expect(runTalkQuarantine(argvFor({ rest: [CALL, "--reason", REASON, "--home", home] }))).toBe(EXIT_OK);
    expect(runTalkQuarantine(argvFor({ rest: [CALL, "--reason", "again", "--home", home, "--json"] }))).toBe(
      EXIT_ERROR,
    );
    expect(ledgerReasons()).toEqual([`${CALL}: ${REASON}`]);
  });

  it("refuses a call whose file is still there, writing no ledger", () => {
    writeFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), "");

    expect(runTalkQuarantine(argvFor({ rest: [CALL, "--reason", REASON, "--home", home] }))).toBe(EXIT_ERROR);
    expect(ledgerReasons()).toEqual([]);
  });

  it("refuses a missing reason as usage, before anything is read", () => {
    expect(runTalkQuarantine(argvFor({ rest: [CALL, "--home", home] }))).toBe(EXIT_USAGE);
    expect(ledgerReasons()).toEqual([]);
  });
});

describe("quarantineSession", () => {
  it("records whatever session id resolves, and none when none does or it is Unicode-blank", () => {
    expect([
      quarantineSession({ env: { CODEX_THREAD_ID: "abc/def" } }),
      quarantineSession({ env: { CLAUDE_CODE_SESSION_ID: "8ebaccdd-2250-4187-9aa6-edfd27f5929b" } }),
      quarantineSession({ env: {} }),
      quarantineSession({ env: { CODEX_THREAD_ID: "\u0085" } }),
      quarantineSession({ env: { CLAUDE_CODE_SESSION_ID: "a", CODEX_THREAD_ID: "b" } }),
    ]).toEqual(["abc/def", "8ebaccdd-2250-4187-9aa6-edfd27f5929b", null, null, null]);
  });
});
