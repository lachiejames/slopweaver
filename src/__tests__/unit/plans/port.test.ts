/**
 * The production plan register port: the store row is the authority, so a home with NO store selected is a
 * refusal — never a read of the `plans.json` sitting right beside it, and never a write of one.
 *
 * Every case writes under an explicit `home` built with `mkdtempSync` and removed in `afterEach`, never the
 * ambient `$SLOPWEAVER_HOME` (`.claude/rules/testing.md`). The store-URL variable is cleared for each case and
 * restored after it, so what is under test is "nothing is selected" rather than whatever this machine exports;
 * with nothing selected `connectStore` refuses before any socket opens, so no case reaches a database. The
 * read/write/CAS behaviour over a row is `storePort.test.ts` and `store.test.ts`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { stateHomePaths } from "../../../stateHome.js";
import { STORE_URL_ENV } from "../../../store/config.js";

const NOW = "2026-09-22T11:00:00Z";

/** A valid legacy register — exactly what a file fallback would have happily read. */
const LEGACY_PLANS = JSON.stringify({
  rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }],
  version: 1,
});

describe("the production plan register port with no store selected", () => {
  let home = "";
  let previousUrl: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "plans-port-"));
    previousUrl = process.env[STORE_URL_ENV];
    delete process.env[STORE_URL_ENV];
    writeFileSync(stateHomePaths({ home }).plansJson, LEGACY_PLANS, "utf8");
  });

  afterEach(() => {
    if (previousUrl !== undefined) {
      process.env[STORE_URL_ENV] = previousUrl;
    }
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a read as REGISTER_STORE_UNAVAILABLE rather than reading the plans.json beside it", async () => {
    const error = unwrapErr(await planRegisterPort().read({ home }));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("no database is selected");
    expect(existsSync(stateHomePaths({ home }).claudeAccountsJson)).toBe(false);
  });

  it("refuses a write the same way, and leaves the projection exactly as it found it", async () => {
    const error = unwrapErr(
      await planRegisterPort().write({
        home,
        mutation: { alias: "codex-one", kind: "resume", provider: "codex" },
        nowIso: NOW,
      }),
    );

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("no database is selected");
    expect(readFileSync(stateHomePaths({ home }).plansJson, "utf8")).toBe(LEGACY_PLANS);
    expect(existsSync(stateHomePaths({ home }).claudeAccountsJson)).toBe(false);
  });
});
