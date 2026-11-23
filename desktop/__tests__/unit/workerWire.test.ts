/*
 * The worker's launch configuration as it crosses the environment: a resumed transcript is an optional, non-empty id,
 * and a Claude resume names the same transcript the SDK streams, so a worker can never resume one id under another.
 */
import { describe, expect, it } from "vitest";

import { isFromWorker, isWorkerLaunchConfig, type WorkerLaunchConfig } from "../../src/sessionWorker/workerWire";

const CODEX: WorkerLaunchConfig = {
  adapterEntry: "/app/a.js",
  codexHome: "/h",
  codexPath: "/app/codex",
  directory: "/w",
  sessionId: "0b5e",
  vendor: "codex",
};

const CLAUDE: WorkerLaunchConfig = {
  claudeMdExcludes: [],
  claudePath: "/app/claude",
  credential: { kind: "store", secureStorageDir: "/h/c" },
  directory: "/w",
  sessionId: "0b5e",
  vendor: "claude",
  vendorSessionId: "a0000107-0000-4000-8000-000000000118",
};

describe("isWorkerLaunchConfig", () => {
  it("reads a new launch and a resumed one of either vendor", () => {
    const configs: readonly unknown[] = [
      CODEX,
      CLAUDE,
      { ...CODEX, resumeVendorSessionId: "thread-1" },
      { ...CLAUDE, resumeVendorSessionId: CLAUDE.vendorSessionId },
    ];
    expect(configs.map((config) => isWorkerLaunchConfig(config))).toEqual([true, true, true, true]);
  });

  it("refuses an empty or non-string resume, and a Claude resume under another transcript id", () => {
    const configs: readonly unknown[] = [
      { ...CODEX, resumeVendorSessionId: "" },
      { ...CODEX, resumeVendorSessionId: 7 },
      { ...CLAUDE, resumeVendorSessionId: "another-transcript" },
    ];
    expect(configs.map((config) => isWorkerLaunchConfig(config))).toEqual([false, false, false]);
  });
});

describe("isFromWorker usage reports", () => {
  const TOKENS = {
    cacheReadInputTokens: 100,
    cacheWriteInputTokens: 5,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 135,
    vendor: "claude",
  };

  it("reads a resolved model, a turn's usage of each kind, and context occupancy", () => {
    const reports: readonly unknown[] = [
      { kind: "model-resolved", model: "claude-opus-5-5", sessionId: "0b5e" },
      {
        kind: "turn-usage",
        sessionId: "0b5e",
        usage: { chargedModels: ["claude-opus-5-5"], kind: "reported", scope: "main-loop-only", tokens: TOKENS },
      },
      { kind: "turn-usage", sessionId: "0b5e", usage: { kind: "not-reported" } },
      { kind: "turn-usage", sessionId: "0b5e", usage: { kind: "unreadable", reason: "odd" } },
      { kind: "context-occupancy", sessionId: "0b5e", sizeTokens: 272000, usedTokens: 0 },
    ];
    expect(reports.map((report) => isFromWorker(report))).toEqual([true, true, true, true, true]);
  });

  it("refuses an empty model, a turn of no known shape, and a count that is not whole", () => {
    const reports: readonly unknown[] = [
      { kind: "model-resolved", model: "", sessionId: "0b5e" },
      { kind: "turn-usage", sessionId: "0b5e", usage: { kind: "reported", scope: "all", tokens: TOKENS } },
      { kind: "turn-usage", sessionId: "0b5e", usage: { kind: "unreadable" } },
      { kind: "context-occupancy", sessionId: "0b5e", sizeTokens: 272000, usedTokens: -1 },
      { kind: "context-occupancy", sessionId: "0b5e", sizeTokens: 1.5, usedTokens: 1 },
    ];
    expect(reports.map((report) => isFromWorker(report))).toEqual([false, false, false, false, false]);
  });
});
