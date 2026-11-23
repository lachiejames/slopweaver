import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import {
  REFRESH_COMMAND_PROBLEM,
  readStoreLife,
  runStoreRefresh,
  storeRefreshInvocation,
} from "../../../claude/storeRefresh.js";

const ACCOUNT: ClaudeAccount = { alias: "plan-two", storeDir: "/stores/plan-two" };

/** A real-shaped keychain document: the account credential beside a live MCP token map. */
const DOCUMENT = {
  claudeAiOauth: {
    accessToken: "access-token-value-that-must-never-appear",
    expiresAt: 1_791_783_904_355,
    refreshToken: "refresh-token-value-that-must-never-appear",
    refreshTokenExpiresAt: 1_791_987_373_355,
    subscriptionType: "max",
  },
  mcpOAuth: { "slack|3880": { accessToken: "mcp-token-value", serverName: "slack" } },
};

describe("runStoreRefresh invokes exactly the measured primitive", () => {
  it("runs the model-free command with the store as BOTH the working directory and the override", () => {
    // Every part of this is a measurement rather than a choice. `doctor` and `auth status`
    // each exited 0 from an empty directory while moving neither the keychain modification date nor the expiry,
    // so the working directory is load-bearing; plain `mcp list` reached the refresh and also wrote an
    // `mcpOAuth` sibling into the store, so `--safe-mode` is too.
    const calls: { args: readonly string[]; binary: string; storeDir: string; timeoutMs: number }[] = [];
    const problem = runStoreRefresh({
      run: (options) => {
        calls.push(options);
      },
      storeDir: "/stores/plan-two",
    });
    expect(problem).toBe(undefined);
    expect(calls).toStrictEqual([
      { args: ["--safe-mode", "mcp", "list"], binary: "claude", storeDir: "/stores/plan-two", timeoutMs: 60_000 },
    ]);
  });

  it("names no model, so doctrine rule 5's spawn contract is untouched by a credential repair", () => {
    const seen: string[][] = [];
    runStoreRefresh({
      run: ({ args }) => {
        seen.push([...args]);
      },
      storeDir: "/stores/plan-two",
    });
    expect(seen).toStrictEqual([["--safe-mode", "mcp", "list"]]);
  });

  it("reports a CONSTANT problem when the command throws, so no caught exception reaches a log", () => {
    // A thrown `execFileSync` carries the argv and can carry captured output. Nothing on this path may print
    // one, so the wording is a constant rather than the error's own message.
    const problem = runStoreRefresh({
      run: () => {
        throw new Error("spawn claude ENOENT, argv=[--safe-mode mcp list]");
      },
      storeDir: "/stores/plan-two",
    });
    expect(problem).toBe(REFRESH_COMMAND_PROBLEM);
    expect(problem).toBe("the refresh command did not complete");
  });

  it("hands the REAL subprocess the store as both its cwd and its credential override", () => {
    // The assertion above records an injected runner's arguments and therefore cannot see this. The
    // counterexample: delete `cwd` and the override from the real call and every other test
    // here still passed. The working directory is load-bearing — MEASURED, `doctor` run from an
    // empty directory refreshed nothing while the same command from the checkout refreshed an expired store —
    // so it is pinned on the value production actually passes.
    expect(
      storeRefreshInvocation({ env: { HOME: "/home/someone", PATH: "/usr/bin" }, storeDir: "/stores/plan-two" }),
    ).toStrictEqual({
      args: ["--safe-mode", "mcp", "list"],
      binary: "claude",
      cwd: "/stores/plan-two",
      env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/stores/plan-two", HOME: "/home/someone", PATH: "/usr/bin" },
      stdio: "ignore",
      timeout: 60_000,
    });
  });

  it("lets the store override WIN over an inherited one, so a pinned caller cannot redirect the repair", () => {
    // The gate runs inside a session that is itself booted against a store, so the variable is already set in
    // the ambient environment. The refresh must go to the store it was asked for, not the one it inherited.
    const invocation = storeRefreshInvocation({
      env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: "/stores/plan-three" },
      storeDir: "/stores/plan-two",
    });
    expect(invocation.env["CLAUDE_SECURESTORAGE_CONFIG_DIR"]).toBe("/stores/plan-two");
    expect(invocation.cwd).toBe("/stores/plan-two");
  });
});

describe("readStoreLife reads only the four bounded facts", () => {
  it("reads both expiries and both token presences off one document", () => {
    expect(readStoreLife({ account: ACCOUNT, read: () => DOCUMENT })).toStrictEqual({
      alias: "plan-two",
      expiresAtIso: "2026-10-12T05:45:04.355Z",
      hasCredential: true,
      hasRefreshToken: true,
      refreshExpiresAtIso: "2026-10-14T14:16:13.355Z",
    });
  });

  it("carries no token and no document fragment into its reading", () => {
    const life = readStoreLife({ account: ACCOUNT, read: () => DOCUMENT });
    const rendered = JSON.stringify(life);
    expect(rendered.includes("access-token-value-that-must-never-appear")).toBe(false);
    expect(rendered.includes("refresh-token-value-that-must-never-appear")).toBe(false);
    expect(rendered.includes("mcp-token-value")).toBe(false);
  });

  it("reports an unreadable item as UNREADABLE rather than as a store holding nothing", () => {
    // The difference sends the owner to a browser or does not. `readCredentialDocument` collapses absence, a
    // locked keychain, a timeout and a momentarily unavailable `security` into one `undefined`, so this is
    // deliberately the conservative reading of all four.
    expect(readStoreLife({ account: ACCOUNT, read: () => undefined })).toStrictEqual({
      alias: "plan-two",
      hasCredential: false,
      hasRefreshToken: false,
      unreadable: true,
    });
  });

  it("reports an EMPTIED credential as present-but-signed-out, not unreadable", () => {
    // MEASURED: `claude doctor` exited 0 and wrote back a credential whose tokens were the empty
    // string. The item read fine, so `unreadable` is absent — and both presences are false, so nothing attempts
    // a refresh against it.
    const emptied = { claudeAiOauth: { accessToken: "", refreshToken: "" } };
    expect(readStoreLife({ account: ACCOUNT, read: () => emptied })).toStrictEqual({
      alias: "plan-two",
      hasCredential: false,
      hasRefreshToken: false,
    });
  });

  it("omits an expiry it cannot read rather than inventing one", () => {
    const noExpiry = { claudeAiOauth: { accessToken: "tok", refreshToken: "ref" } };
    expect(readStoreLife({ account: ACCOUNT, read: () => noExpiry })).toStrictEqual({
      alias: "plan-two",
      hasCredential: true,
      hasRefreshToken: true,
    });
  });

  it("reads the store the ACCOUNT names, so a reading is never of another store", () => {
    const asked: string[] = [];
    readStoreLife({
      account: ACCOUNT,
      read: ({ storeDir }) => {
        asked.push(storeDir);
        return DOCUMENT;
      },
    });
    expect(asked).toStrictEqual(["/stores/plan-two"]);
  });
});
