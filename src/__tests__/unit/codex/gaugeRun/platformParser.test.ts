/*
 * Whether a Codex auth document is valid JSON is the platform parser's answer: a trailing comma, a missing
 * comma and an unterminated string are each unreadable, and a real oauth file still reads.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexAuth } from "../../../../codex/auth.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("validity is the platform parser's answer, so every JSON grammar rule holds", () => {
  // Three rounds found three holes in a hand-derived grammar — a bare token, a nested bare token, a trailing
  // comma. `readable: false` is a claim about the JSON grammar, so it comes from `JSON.parse` now.
  it("refuses a trailing comma", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(
      join(codexHome, "auth.json"),
      '{"tokens":{"access_token":"synthetic",},"auth_mode":"chatgpt"}',
      "utf8",
    );
    const report = readCodexAuth({ codexHome });

    expect(report.readable).toBe(false);
    expect(report.hasTokens).toBe(false);
    expect(report.authMode).toBeUndefined();
  });

  it("refuses a missing comma between members", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(join(codexHome, "auth.json"), '{"auth_mode":"chatgpt" "tokens":{"a":"b"}}', "utf8");

    expect(readCodexAuth({ codexHome }).readable).toBe(false);
  });

  it("refuses an unterminated string", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(join(codexHome, "auth.json"), '{"auth_mode":"chatgpt', "utf8");

    expect(readCodexAuth({ codexHome }).readable).toBe(false);
  });

  it("still reads a real, valid oauth auth.json", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(
      join(codexHome, "auth.json"),
      '{"OPENAI_API_KEY":null,"tokens":{"access_token":"a","refresh_token":"b"},"auth_mode":"chatgpt"}',
      "utf8",
    );

    expect(readCodexAuth({ codexHome })).toEqual({
      authMode: "chatgpt",
      hasApiKey: false,
      hasTokens: true,
      path: join(codexHome, "auth.json"),
      readable: true,
    });
  });
});
