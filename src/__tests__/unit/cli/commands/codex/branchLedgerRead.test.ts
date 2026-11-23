/**
 * `readBranchLedger` refuses a scan that skipped a record, exactly as the landing floor does, so the two-pass
 * cap never reads a malformed pass record as no pass at all. Proved against a real state home.
 *
 * Zero mocks: the ports are the plain in-memory fixtures the landing-floor tests use.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readBranchLedger } from "../../../../../cli/commands/codex/branchLedgerRead.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryFallbackRegisterPort } from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh state home, removed after the test. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-branch-ledger-"));
  homes.push(home);
  return home;
}

/** Read the fold for one branch of a fixed checkout under `home`. */
async function read({ home }: { home: string }): ReturnType<typeof readBranchLedger> {
  return readBranchLedger({
    branch: "feature",
    fallbackPort: memoryFallbackRegisterPort(),
    home,
    repoRoot: "/repo",
    supersessions: memorySupersessionPort(),
  });
}

describe("readBranchLedger", () => {
  it("folds an empty home to an empty ledger", async () => {
    const ledger = await read({ home: scratchHome() });
    expect(ledger.isOk()).toBe(true);
    expect(ledger._unsafeUnwrap()).toEqual([]);
  });

  it("refuses when a completed pass record cannot be parsed, rather than folding it as no pass", async () => {
    const home = scratchHome();
    const run = join(stateHomePaths({ home }).orchestration, "broken-run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "artifact.md"), "# a pass that completed\n");
    writeFileSync(join(run, "record.json"), "{ this is not json");

    const ledger = await read({ home });
    expect(ledger.isErr()).toBe(true);
    expect(ledger._unsafeUnwrapErr().code).toBe("LEDGER_INCOMPLETE");
    expect(ledger._unsafeUnwrapErr().message).toBe(
      "1 pass record(s) could not be parsed, so the ledger for this branch may be missing the newest plan or review",
    );
  });
});
