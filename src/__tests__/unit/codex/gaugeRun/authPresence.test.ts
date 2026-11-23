/*
 * `readCodexAuth` reports whether a key or tokens are present, and its rendering never carries a token value.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexAuth, renderCodexAuth } from "../../../../codex/auth.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("readCodexAuth reads presence and nothing else", () => {
  it("reports an api key as configured without inspecting its value", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "x", auth_mode: "apikey" }), "utf8");

    expect(readCodexAuth({ codexHome })).toEqual({
      authMode: "apikey",
      hasApiKey: true,
      hasTokens: false,
      path: join(codexHome, "auth.json"),
      readable: true,
    });
  });

  it("reports a NULL api key as not configured, which is the real shape of an oauth auth.json", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: null, auth_mode: "chatgpt", tokens: { id_token: "…" } }),
      "utf8",
    );
    const report = readCodexAuth({ codexHome });

    expect(report.hasApiKey).toBe(false);
    expect(report.hasTokens).toBe(true);
  });

  it("renders no token value — every line is a boolean, a mode or a path", () => {
    const codexHome = emptyCodexHome();
    const secret = "sk-this-must-never-appear";
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: secret, auth_mode: "apikey", tokens: { access_token: secret } }),
      "utf8",
    );

    expect(renderCodexAuth({ report: readCodexAuth({ codexHome }) }).join("\n")).not.toContain(secret);
  });
});
