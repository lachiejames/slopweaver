import { describe, expect, it } from "vitest";

import { classifyAmbientCredential } from "../../../claude/ambientCredential.js";

describe("classifyAmbientCredential", () => {
  it("reads an empty environment as the store's own subscription login", () => {
    const verdict = classifyAmbientCredential({ env: {} });
    expect(verdict.kind).toBe("subscription");
    expect(verdict.source).toBe(undefined);
    expect(verdict.reason).toContain("its store's own plan login");
  });

  it("names ANTHROPIC_API_KEY as the source when it shadows the store", () => {
    const verdict = classifyAmbientCredential({ env: { ANTHROPIC_API_KEY: "sk-ant-api03-example" } });
    expect(verdict.kind).toBe("shadowed");
    expect(verdict.source).toBe("ANTHROPIC_API_KEY");
  });

  it("names ANTHROPIC_AUTH_TOKEN too, because the CLI resolves it ahead of a store as well", () => {
    const verdict = classifyAmbientCredential({ env: { ANTHROPIC_AUTH_TOKEN: "a-gateway-token" } });
    expect(verdict.kind).toBe("shadowed");
    expect(verdict.source).toBe("ANTHROPIC_AUTH_TOKEN");
  });

  it("names apiKeyHelper, which is configured in settings rather than in the environment", () => {
    const verdict = classifyAmbientCredential({ apiKeyHelper: "/usr/local/bin/mint-key", env: {} });
    expect(verdict.kind).toBe("shadowed");
    expect(verdict.source).toBe("apiKeyHelper");
  });

  it("reports the environment variable first, matching the CLI's own resolution order", () => {
    const verdict = classifyAmbientCredential({
      apiKeyHelper: "/usr/local/bin/mint-key",
      env: { ANTHROPIC_API_KEY: "sk-ant-api03-example" },
    });
    expect(verdict.source).toBe("ANTHROPIC_API_KEY");
  });

  it("prefers ANTHROPIC_API_KEY over ANTHROPIC_AUTH_TOKEN when both are set", () => {
    const verdict = classifyAmbientCredential({
      env: { ANTHROPIC_API_KEY: "sk-ant-api03-example", ANTHROPIC_AUTH_TOKEN: "a-gateway-token" },
    });
    expect(verdict.source).toBe("ANTHROPIC_API_KEY");
  });

  it("treats an empty value as unset, because the CLI's own reader is a truthiness test", () => {
    const verdict = classifyAmbientCredential({ env: { ANTHROPIC_API_KEY: "" } });
    expect(verdict.kind).toBe("subscription");
  });

  it("treats a whitespace-only value as unset for the same reason", () => {
    const verdict = classifyAmbientCredential({ env: { ANTHROPIC_AUTH_TOKEN: "   " } });
    expect(verdict.kind).toBe("subscription");
  });

  it("leaves CLAUDE_CODE_OAUTH_TOKEN alone, because it is a subscription credential and not an API key", () => {
    const verdict = classifyAmbientCredential({ env: { CLAUDE_CODE_OAUTH_TOKEN: "an-oauth-token" } });
    expect(verdict.kind).toBe("subscription");
  });

  it("never puts the configured value in the reason it prints", () => {
    const verdict = classifyAmbientCredential({ env: { ANTHROPIC_API_KEY: "sk-ant-api03-secret-value" } });
    expect(verdict.reason).not.toContain("sk-ant-api03-secret-value");
    expect(verdict.reason).toContain("ANTHROPIC_API_KEY");
  });
});
