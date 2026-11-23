/**
 * `handover register`'s pre-write refusals, exercised over two real directories.
 *
 * The criterion is a DIFFERENCE of two top-level name sets, so a fake would be restating the thing under
 * test: both directories are minted with `mkdtempSync` and given the entries each case needs. The state home
 * is passed explicitly on the plan, which is what `testing.md`'s ambient-home rule asks for — nothing here
 * touches the resolved home.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerPreWriteRefused } from "../../../../../cli/commands/handover/registerPreWrite.js";

let home = "";
let repo = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rpw-home-"));
  repo = mkdtempSync(join(tmpdir(), "rpw-repo-"));
  mkdirSync(join(home, "pages"));
  mkdirSync(join(home, "handovers"));
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "docs"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(repo, { force: true, recursive: true });
});

describe("registerPreWriteRefused", () => {
  it("passes an ask that roots nothing to hunt for", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "Land the disk-scan gate and update docs/store.md",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(false);
  });

  it("refuses an ask naming a path relative to the state home", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "Read pages/owner-turn-291-18.md before you start",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(true);
  });

  it("does not refuse a repo-relative path, which a seat roots at the checkout", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "Fix the guard in src/admit/diskScan.ts",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(false);
  });

  it("does not refuse a state path that is already rooted with the state: scheme", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "Read state:pages/owner-turn-291-18.md before you start",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(false);
  });

  it("still reaches the path check when a finding carries no code evidence", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "The row in handovers/a-seat-never-scans.md is wrong",
        dispatch: false,
        examples: undefined,
        finding: { evidence: ["acme/acme-admin#1234"] },
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(true);
  });

  it("refuses a decision row naming a Slack draft the register does not hold", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "OK to send draft sd-a0615cb5?",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(true);
  });

  it("refuses a decision row whose slug is itself a draft id the register does not hold", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "OK to ready #17941?",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo,
        shape: undefined,
        slug: "sd-deadbeef",
      },
    });
    expect(refused).toBe(true);
  });

  it("does not hold a finding row to the draft check — its evidence citing a draft asks the owner to send nothing", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "The card for sd-a0615cb5 drew no draft",
        dispatch: false,
        examples: undefined,
        finding: { evidence: ["talk:talk-ee375479d7c1"] },
        home,
        repo,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(false);
  });

  it("roots an ask against the working directory when the row declares no repo", async () => {
    const refused = await registerPreWriteRefused({
      plan: {
        anchor: undefined,
        ask: "Fix the guard in src/admit/diskScan.ts",
        dispatch: false,
        examples: undefined,
        finding: undefined,
        home,
        repo: undefined,
        shape: undefined,
        slug: "a-row",
      },
    });
    expect(refused).toBe(false);
  });
});
