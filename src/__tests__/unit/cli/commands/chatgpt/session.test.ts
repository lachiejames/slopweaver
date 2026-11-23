/**
 * The session file round trip over a throwaway home: written 0600, the paste removed only after, and a read
 * that tells an absent session from a malformed one.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHATGPT_SESSION_FILE,
  importRequestPaste,
  readSessionHeaders,
} from "../../../../../cli/commands/chatgpt/session.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { secretFilePath } from "../../../../../stateHome.js";

const PASTE = [
  "authorization: Bearer opaque",
  "chatgpt-account-id: acct",
  "cookie: SENTINEL-COOKIE",
  "oai-did: did",
  "user-agent: Mozilla/5.0",
].join("\n");

describe("the chatgpt session file", () => {
  let home: string;
  let from: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "chatgpt-session-"));
    from = join(home, "paste.txt");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("writes the headers at 0600, removes the paste, and reports names only", () => {
    writeFileSync(from, PASTE);
    const report = unwrap(importRequestPaste({ from, home, nowIso: "2026-09-29T14:00:00.000Z" }));
    const path = secretFilePath({ home, name: CHATGPT_SESSION_FILE });
    expect(report.path).toBe(path);
    expect(report.kept).toEqual(["authorization", "chatgpt-account-id", "cookie", "oai-did", "user-agent"]);
    expect(report.bearerExpiresIso).toBe(null);
    expect(JSON.stringify(report)).not.toContain("SENTINEL");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(from)).toBe(false);
    expect(unwrap(readSessionHeaders({ home })).cookie).toBe("SENTINEL-COOKIE");
  });

  it("leaves the paste in place when it lacks a header", () => {
    writeFileSync(from, PASTE.replace("oai-did: did\n", ""));
    expect(unwrapErr(importRequestPaste({ from, home, nowIso: "2026-09-29T14:00:00.000Z" })).code).toBe(
      "HEADER_MISSING",
    );
    expect(existsSync(from)).toBe(true);
  });

  it("answers SESSION_ABSENT before any import", () => {
    expect(unwrapErr(readSessionHeaders({ home })).code).toBe("SESSION_ABSENT");
  });

  it("answers SESSION_MALFORMED without quoting the file", () => {
    const path = secretFilePath({ home, name: CHATGPT_SESSION_FILE });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(path, "SENTINEL-COOKIE not json");
    const error = unwrapErr(readSessionHeaders({ home }));
    expect(error.code).toBe("SESSION_MALFORMED");
    expect(error.message).not.toContain("SENTINEL");
  });
});
