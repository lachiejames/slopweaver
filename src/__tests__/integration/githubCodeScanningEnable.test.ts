/**
 * INTEGRATION test: `github code-scanning enable`'s PREVIEW against the REAL GitHub API, recorded and replayed
 * via a Polly cassette (`src/__tests__/setup-polly.ts`).
 *
 * Recorded against this repository's own address while it is private on a free plan, where code scanning
 * answers 403 to the very first read. That is the one live behaviour reachable before the repository goes
 * public, and the one the verb must get right there: print GitHub's line, read nothing further, write no door
 * row, exit 1. The suite never passes `--approve`, so a record run sends no write — the rail on this
 * repository holds until the owner's yes on the switch. The cassette holds exactly one entry, a GET; a second
 * read (the configuration, the identity) would find no recording and fail replay, which is what proves
 * "nothing further read".
 *
 * Run:
 *   yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/githubCodeScanningEnable.test.ts
 *   POLLY_MODE=record SLOPWEAVER_RECORD_GITHUB_TOKEN=<tok> yarn vitest run --config config/vitest/integration.ts \
 *     src/__tests__/integration/githubCodeScanningEnable.test.ts                                     # (re)record
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGithubCodeScanning } from "../../cli/commands/github/codeScanningRun.js";
import { makeGithubDefaultSetupApi } from "../../outbound/github/defaultSetup.js";
import { memoryDoorLedger } from "../doorLedgerFixture.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** The token to record with (a real GitHub token); in replay a dummy stands in (the auth header is redacted). */
function githubToken(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_GITHUB_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_GITHUB_TOKEN to record the code-scanning enable cassette");
  }
  return token;
}

describe("github code-scanning enable (integration — real GitHub via Polly cassette)", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-cs-enable-cassette-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("previews on a private free-plan repository: GitHub's 403 printed, nothing further read, nothing recorded", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const ledger = memoryDoorLedger();
    const argv = ["node", "slopweaver", "github", "code-scanning", "enable", "--repo", "lachiejames/slopweaver"];

    const code = await runGithubCodeScanning({
      argv,
      deps: {
        doorLedger: ledger.port,
        home: () => home,
        makeApi: ({ token }) => makeGithubDefaultSetupApi({ privacy: NO_TERMS_GITHUB_PRIVACY, token }),
        out: (line) => out.push(line),
        token: () => githubToken(),
        writeDiagnostic: (line) => diagnostic.push(line),
      },
    });

    expect(argv).not.toContain("--approve");
    expect(code).toBe(1);
    expect(out).toEqual([]);
    // GitHub's message text is allowlist-redacted in the cassette, so replay proves the status and the
    // operation; the measured wording is pinned by `./githubDefaultSetupTransport.test.ts`.
    expect(diagnostic.length).toBe(1);
    expect(diagnostic[0]).toContain("github github.codeScanning.getDefaultSetup HTTP 403: ");
    expect(ledger.records()).toEqual([]);
  });
});
