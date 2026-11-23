import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyAmbientCredential } from "../../../claude/ambientCredential.js";
import { resolveAmbientCredential } from "../../../claude/ambientCredentialRead.js";

describe("resolveAmbientCredential", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "claude-config-"));
  });

  afterEach(() => {
    rmSync(configDir, { force: true, recursive: true });
  });

  it("reads apiKeyHelper out of the relocated config directory's settings and reports it as shadowing", () => {
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ apiKeyHelper: "/usr/local/bin/key-alpha" }));
    const verdict = resolveAmbientCredential({ env: { CLAUDE_CONFIG_DIR: configDir } });
    expect(verdict.kind).toBe("shadowed");
    expect(verdict.source).toBe("apiKeyHelper");
    expect(verdict).toEqual(
      classifyAmbientCredential({ apiKeyHelper: "/usr/local/bin/key-alpha", env: { CLAUDE_CONFIG_DIR: configDir } }),
    );
  });

  it("trims whitespace around CLAUDE_CONFIG_DIR before reading the settings under it", () => {
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ apiKeyHelper: "helper-bravo" }));
    const verdict = resolveAmbientCredential({ env: { CLAUDE_CONFIG_DIR: `  ${configDir}  ` } });
    expect(verdict.source).toBe("apiKeyHelper");
  });

  it("lets a non-blank ANTHROPIC_API_KEY outrank a configured helper", () => {
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ apiKeyHelper: "helper-charlie" }));
    const verdict = resolveAmbientCredential({ env: { ANTHROPIC_API_KEY: "key-delta", CLAUDE_CONFIG_DIR: configDir } });
    expect(verdict.kind).toBe("shadowed");
    expect(verdict.source).toBe("ANTHROPIC_API_KEY");
  });

  it("answers subscription when the settings file is missing and no credential variable is set", () => {
    expect(resolveAmbientCredential({ env: { CLAUDE_CONFIG_DIR: configDir } })).toEqual({
      kind: "subscription",
      reason: "no Anthropic-issued credential is configured, so a session presents its store's own plan login",
    });
  });

  it("reads unparseable settings exactly as missing ones, as its contract states", () => {
    writeFileSync(join(configDir, "settings.json"), '{"apiKeyHelper": "helper-echo",');
    expect(resolveAmbientCredential({ env: { CLAUDE_CONFIG_DIR: configDir } }).kind).toBe("subscription");
  });

  it("ignores an apiKeyHelper that is not a string", () => {
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ apiKeyHelper: ["helper-foxtrot"] }));
    expect(resolveAmbientCredential({ env: { CLAUDE_CONFIG_DIR: configDir } }).kind).toBe("subscription");
  });

  it("treats a blank helper as no helper, as the classifier does", () => {
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ apiKeyHelper: "   " }));
    expect(resolveAmbientCredential({ env: { CLAUDE_CONFIG_DIR: configDir } }).kind).toBe("subscription");
  });
});
