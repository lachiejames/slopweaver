import { describe, expect, it } from "vitest";

import { claudeStoreProbeArgv, claudeStoreService } from "../../../claude/storeService.js";

describe("claudeStoreService", () => {
  it("names the default store's item, which exists on this machine", () => {
    expect(claudeStoreService({})).toBe("Claude Code-credentials");
  });

  it("matches the first eight hex of the path's sha256, taken outside this code", () => {
    const storeDir =
      "/private/tmp/claude-501/-Users-ada-owner-ctr-dev-personal-slopweaver--claude-worktrees-noindex-three-max-plans-hands-off-account-rotation/27526cbf-2981-49f7-bf97-29941a0f9541/scratchpad/probe-store";
    // Repro: printf %s "<storeDir>" | shasum -a 256
    expect(claudeStoreService({ storeDir })).toBe("Claude Code-credentials-b0d690e0");
  });

  it("gives two different stores two different items, which is what isolates a plan", () => {
    expect(claudeStoreService({ storeDir: "/a" })).not.toBe(claudeStoreService({ storeDir: "/b" }));
  });

  it("normalises the path to NFC, so a decomposed accent names the same item", () => {
    const composed = claudeStoreService({ storeDir: "/plans/caf\u00e9" });
    const decomposed = claudeStoreService({ storeDir: "/plans/cafe\u0301" });
    expect("/plans/caf\u00e9".length).toBe(11);
    expect("/plans/cafe\u0301".length).toBe(12);
    expect(composed).toBe(decomposed);
  });

  it("takes exactly eight hex characters", () => {
    const suffix = claudeStoreService({ storeDir: "/plans/one" }).replace("Claude Code-credentials-", "");
    expect(suffix.length).toBe(8);
    expect(/^[0-9a-f]{8}$/.test(suffix)).toBe(true);
  });
});

describe("claudeStoreProbeArgv", () => {
  it("asks whether the item exists and never asks for the secret", () => {
    expect(claudeStoreProbeArgv({ account: "someone", storeDir: "/plans/one" })).toStrictEqual([
      "find-generic-password",
      "-a",
      "someone",
      "-s",
      claudeStoreService({ storeDir: "/plans/one" }),
    ]);
  });

  it("never carries -w, which is what would print a token", () => {
    expect(claudeStoreProbeArgv({ account: "someone" })).not.toContain("-w");
  });

  it("probes the default store when no directory is named", () => {
    expect(claudeStoreProbeArgv({ account: "someone" })[4]).toBe("Claude Code-credentials");
  });
});
