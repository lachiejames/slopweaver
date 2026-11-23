import { describe, expect, it } from "vitest";

import { bootEnvPrefix, seatForRole, storeDirForSeat } from "../../../claude/seatPinning.js";

const ACCOUNTS = [
  { alias: "plan-one", storeDir: "/stores/one" },
  { alias: "plan-three", storeDir: "/stores/three" },
];

describe("storeDirForSeat", () => {
  it("pins the publisher to the account the gallery and the browser share", () => {
    expect(storeDirForSeat({ accounts: ACCOUNTS, pinnedAlias: "plan-three", seat: "publisher" })).toBe("/stores/three");
  });

  it("leaves the supervisor chair UNPINNED, so a handoff routes on live readings rather than riding one plan to its wall", () => {
    expect(storeDirForSeat({ accounts: ACCOUNTS, pinnedAlias: "plan-three", seat: "supervisor-chair" })).toBe(
      undefined,
    );
  });

  it("leaves a WORKER unpinned, so it follows the rotating active slot", () => {
    expect(storeDirForSeat({ accounts: ACCOUNTS, pinnedAlias: "plan-three", seat: "worker" })).toBe(undefined);
  });

  it("leaves every seat unpinned when no account is designated, rather than guessing one", () => {
    expect(storeDirForSeat({ accounts: ACCOUNTS, seat: "publisher" })).toBe(undefined);
  });

  it("returns undefined for a designated alias that is not configured, rather than a wrong store", () => {
    expect(storeDirForSeat({ accounts: ACCOUNTS, pinnedAlias: "plan-nine", seat: "publisher" })).toBe(undefined);
  });
});

describe("bootEnvPrefix", () => {
  it("names the store variable Claude Code reads, with a trailing space before the command", () => {
    expect(bootEnvPrefix({ storeDir: "/stores/three" })).toBe("CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/three ");
  });

  it("is EMPTY for a rotating seat, so its boot line is byte-identical to the unpinned one", () => {
    expect(bootEnvPrefix({})).toBe("");
  });

  it("does not set CLAUDE_CONFIG_DIR, which would move projects and settings too", () => {
    expect(bootEnvPrefix({ storeDir: "/stores/three" })).not.toContain("CLAUDE_CONFIG_DIR=");
  });
});

describe("seatForRole", () => {
  it("keeps the supervisor its own seat, which the response policy distinguishes", () => {
    expect(seatForRole({ role: "supervisor" })).toBe("supervisor-chair");
  });

  it("leaves every other role a rotating worker", () => {
    for (const role of ["bot", "scheduler", "session"]) {
      expect(seatForRole({ role })).toBe("worker");
    }
  });

  it("treats an unknown role as a worker rather than pinning it by accident", () => {
    expect(seatForRole({ role: "something-new" })).toBe("worker");
  });
});
