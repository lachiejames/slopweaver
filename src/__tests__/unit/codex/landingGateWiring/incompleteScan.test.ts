/**
 * `readLocalCodexLoop` fails closed over an incomplete scan, proved against a real state home and a real
 * scratch repository.
 *
 * Zero mocks: every edge is a plain function the harness writes, per `.claude/rules/testing.md`.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveRepoRoot } from "../../../../codex/gitDiff.js";
import { readLocalCodexLoop } from "../../../../codex/landingGateRun.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import {
  FALLBACK_FIXTURE_OUTAGE,
  memoryFallbackRegisterPort,
  unavailableFallbackRegisterPort,
} from "../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../landingRegistersFixture.js";
import { gitInTemp } from "../../../tempGitRepo.js";
import { BASE_SHA, BRANCH, headOf, homes, REAL_GIT, REPO, scratchHome } from "./harness.js";

/**
 * The reader's own fail-closed rule, proved against a real state home.
 *
 * `scanPassRecords` walks past an unparseable record and reports the count; `ledgerForBranch` does the same
 * for a record carrying no branch. Either could be the newest plan on this branch, BLOCKED — so reading the
 * survivors as the whole ledger would turn "some evidence is missing" into "the evidence is clean". Found by
 * a Codex review of this change.
 */
describe("readLocalCodexLoop refuses to answer over an incomplete scan", REAL_GIT, () => {
  /**
   * A REAL repository this test builds, never the ambient checkout. Reading `process.cwd()` made these cases
   * depend on whatever branch the runner happened to be on, and GitHub Actions checks a pull request out on a
   * DETACHED HEAD — which `readLocalCodexLoop` correctly calls unreadable, so the positive case went red on CI
   * while passing on every developer machine. The repository is the fixture; it is not ambient state.
   */
  function scratchRepo({ label }: { label: string }): string {
    const dir = mkdtempSync(join(tmpdir(), `slopweaver-repo-${label}-`));
    homes.push(dir);
    // `gitInTemp` is the ONLY sanctioned way for a test to run git: it strips every GIT_* variable, which
    // otherwise OVERRIDES cwd under a hook, and refuses any path outside the OS temp directory. See
    // `src/__tests__/tempGitRepo.ts` for the day a raw `execFileSync` put 35 commits in the real repository.
    const steps: readonly (readonly string[])[] = [
      ["init", "--initial-branch=feature"],
      ["config", "user.email", "dev@example.invalid"],
      ["config", "user.name", "Dev"],
      ["remote", "add", "origin", `git@github.com:${REPO}.git`],
    ];
    for (const args of steps) {
      gitInTemp({ args, cwd: dir });
    }
    writeFileSync(join(dir, "a.txt"), "one\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-m", "first"], cwd: dir });
    return dir;
  }

  it("reports unreadable when a pass record cannot be parsed, rather than judging the survivors", async () => {
    const home = scratchHome({ label: "unparseable" });
    const run = join(stateHomePaths({ home }).orchestration, "broken-run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "artifact.md"), "# a pass that completed\n");
    writeFileSync(join(run, "record.json"), "{ this is not json");
    const dir = scratchRepo({ label: "unparseable" });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: headOf({ cwd: dir }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("unreadable");
  });

  /** The witness can fire: the same shape with no broken record answers `read` instead. */
  it("answers with evidence when the home holds nothing unparseable", async () => {
    const home = scratchHome({ label: "parseable" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const dir = scratchRepo({ label: "parseable" });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: headOf({ cwd: dir }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("read");
  });

  /** The same healthy home over a store that cannot be opened refuses — never a read without the receipts. */
  it("reports unreadable when the fallback store is down, rather than judging without its receipts", async () => {
    const home = scratchHome({ label: "store-down" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const dir = scratchRepo({ label: "store-down" });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: unavailableFallbackRegisterPort(),
      head: headOf({ cwd: dir }),
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read).toEqual({
      kind: "unreadable",
      reason: `could not read the Claude fallback review receipts: ${FALLBACK_FIXTURE_OUTAGE.message}`,
    });
  });

  /**
   * The shape CI actually produces — and it is no longer a refusal, which is the finding this change closes
   * seen from its other end. The old reader asked which branch the CHECKOUT was on, so a detached HEAD had
   * nothing to say; the reader now asks which checkouts hold the pull request's head commit, and a detached
   * one holds it exactly as well as an attached one.
   */
  it("answers over a detached HEAD, which is how a CI runner checks a pull request out", async () => {
    const home = scratchHome({ label: "detached" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const dir = scratchRepo({ label: "detached" });
    const head = headOf({ cwd: dir });
    gitInTemp({ args: ["checkout", "--detach"], cwd: dir });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head,
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("read");
    expect(read.kind === "read" ? read.evidence.roots : []).toEqual([unwrap(resolveRepoRoot({ cwd: dir }))]);
  });

  /**
   * The refusal that REPLACES the four association checks, and the one case that must still cost what an
   * incomplete loop costs: a machine holding no checkout of the repository at all cannot be read as clean.
   */
  it("refuses when no checkout on this machine has the pull request's repository as its origin", async () => {
    const home = scratchHome({ label: "foreign" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const dir = scratchRepo({ label: "foreign" });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { ...headOf({ cwd: dir }), repository: "acme/somewhere-else" },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" ? read.reason : "").toContain(
      "has acme/somewhere-else as its `origin`, so nothing here holds evidence about this pull request",
    );
  });

  /** The other half of that refusal: the right repository, but this machine has never fetched the commit. */
  it("refuses when a checkout of the repository does not hold the head commit, and names the fetch", async () => {
    const home = scratchHome({ label: "unfetched" });
    mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
    const dir = scratchRepo({ label: "unfetched" });

    const read = await readLocalCodexLoop({
      cwd: dir,
      fallbackPort: memoryFallbackRegisterPort(),
      head: { baseSha: BASE_SHA, branch: BRANCH, headSha: "0".repeat(40), repository: REPO },
      home,
      signInPort: memoryCodexSignInPort(),
      supersessions: memorySupersessionPort(),
    });

    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" ? read.reason : "").toContain(
      "`git fetch origin` in the checkout that authored it",
    );
  });
});
