/*
 * A launch confined to a state home runs its verbs against THAT home at every scrub a session's processes pass
 * through: the worker's own, then the Codex adapter's or the native Claude process's second scrub of the worker's
 * mutable environment. An unconfined launch keeps whatever home the scrub kept.
 */
import { describe, expect, it } from "vitest";

import { adapterEnvironment } from "../../src/sessionWorker/adapterEnvironment";
import { claudeNativeEnvironment } from "../../src/sessionWorker/claudeEnvironmentPolicy";
import type { ClaudeWorkerLaunchConfig, CodexWorkerLaunchConfig } from "../../src/sessionWorker/workerWire";
import { workerEnvironment } from "../../src/sessionWorkerLaunch";

const CODEX: CodexWorkerLaunchConfig = {
  adapterEntry: "/app/codex-acp.js",
  codexHome: "/h/codex-one",
  codexPath: "/app/codex",
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

const APP_ENVIRONMENT = { PATH: "/usr/bin", SLOPWEAVER_HOME: "/home/acme/.slopweaver" };

/** A worker environment that gained a different home after launch: the second scrub must not trust it. */
const DRIFTED = { PATH: "/usr/bin", SLOPWEAVER_HOME: "/wrong/home" };

describe("workerEnvironment", () => {
  it("sets a confined launch's state home over the app's own, on either vendor", () => {
    expect(
      [
        workerEnvironment({ config: { ...CODEX, stateHome: "/scratch/home" }, inherited: APP_ENVIRONMENT }),
        workerEnvironment({ config: { ...CLAUDE, stateHome: "/scratch/home" }, inherited: APP_ENVIRONMENT }),
      ].map((environment) => environment["SLOPWEAVER_HOME"]),
    ).toEqual(["/scratch/home", "/scratch/home"]);
  });

  it("keeps the app's own home for a launch that names none", () => {
    expect(workerEnvironment({ config: CLAUDE, inherited: APP_ENVIRONMENT })["SLOPWEAVER_HOME"]).toBe(
      "/home/acme/.slopweaver",
    );
  });

  it("sets a confined state home even when the app itself was started with none", () => {
    expect(
      workerEnvironment({ config: { ...CODEX, stateHome: "/scratch/home" }, inherited: { PATH: "/usr/bin" } })[
        "SLOPWEAVER_HOME"
      ],
    ).toBe("/scratch/home");
  });

  it("still carries the worker's own variables beside the state home", () => {
    const environment = workerEnvironment({ config: { ...CODEX, stateHome: "/scratch/home" }, inherited: {} });
    expect(environment["ELECTRON_RUN_AS_NODE"]).toBe("1");
    expect(JSON.parse(environment["SLOPWEAVER_SESSION_WORKER"]!).stateHome).toBe("/scratch/home");
  });
});

describe("the second scrub", () => {
  it("re-sets the confined home over one the worker's environment drifted to, on either vendor", () => {
    const confinedCodex = { ...CODEX, stateHome: "/scratch/home" };
    const confinedClaude = { ...CLAUDE, stateHome: "/scratch/home" };
    expect([
      adapterEnvironment({ config: confinedCodex, guardian: undefined, inherited: DRIFTED })["SLOPWEAVER_HOME"],
      claudeNativeEnvironment({ config: confinedClaude, inherited: DRIFTED })["SLOPWEAVER_HOME"],
    ]).toEqual(["/scratch/home", "/scratch/home"]);
  });

  it("leaves an unconfined session's home exactly as the scrub kept it", () => {
    expect([
      adapterEnvironment({ config: CODEX, guardian: undefined, inherited: APP_ENVIRONMENT })["SLOPWEAVER_HOME"],
      claudeNativeEnvironment({ config: CLAUDE, inherited: APP_ENVIRONMENT })["SLOPWEAVER_HOME"],
    ]).toEqual(["/home/acme/.slopweaver", "/home/acme/.slopweaver"]);
  });

  it("keeps the scrub's null prototype on a confined environment", () => {
    const confined = { ...CODEX, stateHome: "/scratch/home" };
    expect(Object.getPrototypeOf(adapterEnvironment({ config: confined, guardian: undefined, inherited: {} }))).toBe(
      null,
    );
  });
});
