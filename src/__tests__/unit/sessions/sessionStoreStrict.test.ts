/**
 * `readSessionLogTextStrict`: an absent session log tracks nothing, while one present and unreadable throws, so the
 * session harness's recorder warns instead of reading a ledger it cannot see as one that tracks no row.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSessionLogTextStrict, sessionLogPath } from "../../../sessions/sessionStore.js";

const homes: string[] = [];

/** A fresh state home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-strict-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readSessionLogTextStrict", () => {
  it("answers the empty string for a home that has never tracked a session", () => {
    expect(readSessionLogTextStrict({ home: freshHome() })).toBe("");
  });

  it("answers the log's text when it reads", () => {
    const home = freshHome();
    const path = sessionLogPath({ home });
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, '{"kind":"noted"}\n');
    expect(readSessionLogTextStrict({ home })).toBe('{"kind":"noted"}\n');
  });

  it("throws on a log path that exists and cannot be read as a file", () => {
    const home = freshHome();
    mkdirSync(sessionLogPath({ home }), { recursive: true });
    expect(() => readSessionLogTextStrict({ home })).toThrow("EISDIR");
  });
});
