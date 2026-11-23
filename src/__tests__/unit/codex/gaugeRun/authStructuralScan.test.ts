/*
 * The Codex auth file is scanned structurally: `scanJsonShape` walks keys and skips values by index, so no token
 * ever becomes a live string, and `readCodexAuth` reads what that scan reports.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexAuth } from "../../../../codex/auth.js";
import { keyShape, scanJsonShape } from "../../../../codex/authScan.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("the auth file is scanned structurally — no value is ever assembled", () => {
  // A Codex review found that `readCodexAuth` went through `JSON.parse`, which builds every value in the
  // document, so the access and refresh tokens became live strings in a retained object graph. These cases
  // pin the replacement: the scanner walks keys and skips values by index.
  const SECRET = "sk-this-must-never-be-assembled";

  it("reports the real oauth shape from keys alone", () => {
    const scan = scanJsonShape({
      captureText: new Set(["auth_mode"]),
      text: JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: "chatgpt",
        last_refresh: "2026-09-13T00:00:00.000Z",
        tokens: { access_token: SECRET, account_id: "acct", id_token: SECRET, refresh_token: SECRET },
      }),
    });

    expect(scan.wellFormed).toBe(true);
    expect(keyShape({ key: "auth_mode", scan }).text).toBe("chatgpt");
    expect(keyShape({ key: "tokens", scan }).nonEmptyContainer).toBe(true);
    expect(keyShape({ key: "OPENAI_API_KEY", scan }).isNull).toBe(true);
  });

  it("captures NO text for a key the caller did not name as non-sensitive", () => {
    const scan = scanJsonShape({
      captureText: new Set(["auth_mode"]),
      text: JSON.stringify({ OPENAI_API_KEY: SECRET, auth_mode: "apikey" }),
    });

    expect(keyShape({ key: "OPENAI_API_KEY", scan }).text).toBeUndefined();
    expect(keyShape({ key: "OPENAI_API_KEY", scan }).present).toBe(true);
    expect(keyShape({ key: "OPENAI_API_KEY", scan }).isNull).toBe(false);
  });

  it("skips a value carrying braces, brackets and escaped quotes without losing its place", () => {
    const scan = scanJsonShape({
      captureText: new Set(["auth_mode"]),
      // A token containing `","auth_mode":"forged` would end the value early for a naive scanner and let the
      // document's own data name a key. The escape handling is what stops that.
      text: '{"tokens":{"access_token":"a\\"{}[],:b"},"auth_mode":"chatgpt","OPENAI_API_KEY":null}',
    });

    expect(keyShape({ key: "auth_mode", scan }).text).toBe("chatgpt");
    expect(keyShape({ key: "tokens", scan }).nonEmptyContainer).toBe(true);
    expect(keyShape({ key: "OPENAI_API_KEY", scan }).isNull).toBe(true);
  });

  it("reports an EMPTY tokens object as carrying nothing", () => {
    const scan = scanJsonShape({ captureText: new Set(), text: '{"tokens":{}}' });

    expect(keyShape({ key: "tokens", scan }).present).toBe(true);
    expect(keyShape({ key: "tokens", scan }).nonEmptyContainer).toBe(false);
  });

  it("reports a key nobody wrote as absent rather than as undefined", () => {
    const scan = scanJsonShape({ captureText: new Set(), text: "{}" });

    expect(keyShape({ key: "tokens", scan })).toEqual({
      isNull: false,
      nonEmptyContainer: false,
      present: false,
      text: undefined,
    });
  });

  it("says a non-object document is not well formed rather than throwing", () => {
    expect(scanJsonShape({ captureText: new Set(), text: "not json at all" }).wellFormed).toBe(false);
    expect(scanJsonShape({ captureText: new Set(), text: "" }).wellFormed).toBe(false);
    expect(scanJsonShape({ captureText: new Set(), text: "[1,2,3]" }).wellFormed).toBe(false);
  });

  it("reports a truncated document as not well formed", () => {
    expect(scanJsonShape({ captureText: new Set(), text: '{"tokens":{"a":"b"' }).wellFormed).toBe(false);
  });

  it("readCodexAuth reads an auth.json whose tokens are long and quote-bearing", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(
      join(codexHome, "auth.json"),
      '{"OPENAI_API_KEY":null,"tokens":{"access_token":"a\\"b","refresh_token":"c"},"auth_mode":"chatgpt"}',
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

  it("reports a corrupt auth.json as unreadable rather than as a signed-out state it did not observe", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(join(codexHome, "auth.json"), "{not json", "utf8");

    expect(readCodexAuth({ codexHome }).readable).toBe(false);
  });
});
