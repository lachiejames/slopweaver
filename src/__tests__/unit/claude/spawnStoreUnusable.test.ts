/**
 * The refusal every Claude spawn meets when the plans register does not read: a store refused as STALE names the one
 * hatch that lets the register read, and every other fault still names none — the refusal once said "no hatch" over a
 * store the `stale-store` hatch opens.
 */
import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { STALE_STORE_HATCH_ENV, unusableConfiguration } from "../../../claude/spawnStoreRefusals.js";

describe("unusableConfiguration", () => {
  it("names the stale-store hatch, and the investigator it seats, when the store was refused as stale", () => {
    const routing = unusableConfiguration({
      error: ClaudeRotationErrors.accountConfigStoreUnavailable({ message: "the store is stale", staleStore: true }),
      storeDir: undefined,
    });

    expect(STALE_STORE_HATCH_ENV).toBe("SLOPWEAVER_ALLOW_STALE_STORE");
    expect(routing).toEqual({
      refusal:
        "claude routing: the store is stale — the usage limit and allowance on every plan went unread with it, so no " +
        "Claude spawn boots until the register reads again; the store answered and was refused as stale, and " +
        "`SLOPWEAVER_ALLOW_STALE_STORE=1` opens it as it stands, so if the register still queries there, it and every " +
        "limit in it READ: seat ONE investigator under it to judge the pending migration " +
        "(skills/supervisor/reference/boots-refused.md), never a blind `store push`. `slopweaver plans validate` says " +
        "what is wrong, and the `claude-plan-unusable` monitor floats this fault as a note.",
      refusalKind: "configuration",
    });
  });

  it("names no way through for a store that could not be opened at all, and keeps a pinned caller's store", () => {
    const routing = unusableConfiguration({
      error: ClaudeRotationErrors.accountConfigStoreUnavailable({ message: "connection refused" }),
      storeDir: "/stores/plan-one",
    });

    expect(routing).toEqual({
      refusal:
        "claude routing: connection refused — the usage limit and allowance on every plan went unread with it, so no " +
        "Claude spawn boots until the register reads again; no hatch and no --force crosses an unread usage limit. " +
        "`slopweaver plans validate` says what is wrong, and the `claude-plan-unusable` monitor floats this fault as a note.",
      refusalKind: "configuration",
      storeDir: "/stores/plan-one",
    });
  });
});
