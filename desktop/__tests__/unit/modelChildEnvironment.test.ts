/*
 * Every variable the app ADDS to a model child, pinned as an exact list per vendor: over an empty inheritance, what a
 * child's environment holds is only what the app put there. `SLOPWEAVER_APP_SESSION_ID` is the one variable the
 * session-origin check added, so any other new variable reddens the list it lands in, and an inherited app id never
 * survives into a child.
 */
import { describe, expect, it } from "vitest";

import { APP_SESSION_ID_ENV } from "../../src/sessionControlProtocol";
import { adapterEnvironment } from "../../src/sessionWorker/adapterEnvironment";
import { claudeNativeEnvironment, claudeSettingsEnvironment } from "../../src/sessionWorker/claudeEnvironmentPolicy";
import type { ClaudeWorkerLaunchConfig, CodexWorkerLaunchConfig } from "../../src/sessionWorker/workerWire";

const CODEX: CodexWorkerLaunchConfig = {
  adapterEntry: "/a.js",
  codexHome: "/home/codex-plan-1",
  codexPath: "/bin/codex",
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "codex",
};

const CLAUDE: ClaudeWorkerLaunchConfig = {
  claudeMdExcludes: [],
  claudePath: "/app/claude",
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  directory: "/work/acme",
  sessionId: "0b5e",
  vendor: "claude",
  vendorSessionId: "a0000107-0000-4000-8000-000000000118",
};

const CLAUDE_TOKEN: ClaudeWorkerLaunchConfig = {
  ...CLAUDE,
  credential: { kind: "setup-token", secureStorageDir: "/h/claude-three", tokenFilePath: "/h/three.token" },
};

/** An app id some parent process carried, which must never reach a child as that child's own. */
const INHERITED_APP_ID = { [APP_SESSION_ID_ENV]: "FIXTURE-SIBLING-SESSION" };

describe("the variable the app names a model child's session by", () => {
  it("is SLOPWEAVER_APP_SESSION_ID", () => {
    expect(APP_SESSION_ID_ENV).toBe("SLOPWEAVER_APP_SESSION_ID");
  });
});

describe("the variables the app adds to a model child", () => {
  it("adds exactly these to the Codex adapter, and the guardian pair only when there is a guardian", () => {
    const unguarded = adapterEnvironment({ config: CODEX, guardian: undefined, inherited: {} });
    expect(Object.keys(unguarded).toSorted()).toEqual([
      "CODEX_CONFIG",
      "CODEX_HOME",
      "CODEX_PATH",
      "ELECTRON_RUN_AS_NODE",
      "INITIAL_AGENT_MODE",
      "SLOPWEAVER_APP_SESSION_ID",
    ]);
    const guarded = adapterEnvironment({ config: CODEX, guardian: { pid: 5151, start: "s" }, inherited: {} });
    expect(Object.keys(guarded).toSorted()).toEqual([
      "CODEX_CONFIG",
      "CODEX_HOME",
      "CODEX_PATH",
      "ELECTRON_RUN_AS_NODE",
      "INITIAL_AGENT_MODE",
      "SLOPWEAVER_APP_SESSION_ID",
      "SLOPWEAVER_SESSION_GUARDIAN_PID",
      "SLOPWEAVER_SESSION_GUARDIAN_START",
    ]);
  });

  it("adds exactly these to the native Claude Code process, the descriptor only on a setup-token seat", () => {
    expect(Object.keys(claudeNativeEnvironment({ config: CLAUDE, inherited: {} })).toSorted()).toEqual([
      "CLAUDE_SECURESTORAGE_CONFIG_DIR",
      "SLOPWEAVER_APP_SESSION_ID",
    ]);
    expect(Object.keys(claudeNativeEnvironment({ config: CLAUDE_TOKEN, inherited: {} })).toSorted()).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
      "CLAUDE_SECURESTORAGE_CONFIG_DIR",
      "SLOPWEAVER_APP_SESSION_ID",
    ]);
  });

  it("pins exactly these to a value in the Claude flag tier, every other key it carries blanked", () => {
    const pinned = Object.entries(claudeSettingsEnvironment({ config: CLAUDE }))
      .filter(([, value]) => value !== "")
      .map(([name]) => name)
      .toSorted();
    expect(pinned).toEqual(["CLAUDE_SECURESTORAGE_CONFIG_DIR", "SLOPWEAVER_APP_SESSION_ID"]);
  });
});

describe("the app session id a model child carries", () => {
  it("is the control plane's own id for the session, over an inherited one, on the Codex adapter", () => {
    const environment = adapterEnvironment({ config: CODEX, guardian: undefined, inherited: INHERITED_APP_ID });
    expect(environment[APP_SESSION_ID_ENV]).toBe("0b5e");
  });

  it("is the control plane's own id for the session, over an inherited one, on the native Claude process", () => {
    expect(claudeNativeEnvironment({ config: CLAUDE, inherited: INHERITED_APP_ID })[APP_SESSION_ID_ENV]).toBe("0b5e");
  });

  it("is pinned in the Claude flag tier too, so a settings file's env cannot name another session", () => {
    expect(claudeSettingsEnvironment({ config: CLAUDE })[APP_SESSION_ID_ENV]).toBe("0b5e");
  });

  it("never carries the inherited value anywhere in either child's environment", () => {
    const children = [
      adapterEnvironment({ config: CODEX, guardian: undefined, inherited: INHERITED_APP_ID }),
      claudeNativeEnvironment({ config: CLAUDE, inherited: INHERITED_APP_ID }),
    ];
    expect(INHERITED_APP_ID[APP_SESSION_ID_ENV]).toBe("FIXTURE-SIBLING-SESSION");
    expect(children.map((child) => Object.values(child).includes("FIXTURE-SIBLING-SESSION"))).toEqual([false, false]);
  });
});
