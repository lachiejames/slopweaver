/**
 * The effectful edge of the seat check: find one session in a throwaway Claude Code registry by its id, then read
 * its boot credential through a plain fake process reader passed in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { readOwnSeat } from "../../../claude/seatAttestRead.js";
import type { ProcessRead } from "../../../claude/seatBootRead.js";

const HOME = "/Users/someone/.slopweaver/claude-accounts";
const ACCOUNTS: readonly ClaudeAccount[] = [{ alias: "plan-three", storeDir: `${HOME}/plan-three` }];
const CHAIR = "/Users/someone/.local/bin/claude --model opus";
const PROC_START = "Wed Sep 30 00:28:44 2026";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A `~/.claude` whose registry holds one record per given session. */
function claudeHomeWith({ records }: { records: readonly { pid: number; sessionId: string }[] }): string {
  const claudeHome = mkdtempSync(join(tmpdir(), "seat-attest-"));
  dirs.push(claudeHome);
  mkdirSync(join(claudeHome, "sessions"));
  for (const { pid, sessionId } of records) {
    writeFileSync(
      join(claudeHome, "sessions", `${String(pid)}.json`),
      JSON.stringify({ kind: "interactive", pid, procStart: PROC_START, sessionId }),
    );
  }
  return claudeHome;
}

/** A reader whose `ps eww` shows the given environment, and whose `lstart` matches the registry. */
function readerShowing({ env }: { env: string }): ProcessRead {
  return ({ binary, args }) => {
    if (binary === "ps" && args[0] === "eww") {
      return { text: `${CHAIR} ${env}\n` };
    }
    if (binary === "ps" && args[0] === "ww") {
      return { text: `${CHAIR}\n` };
    }
    if (binary === "ps" && args[0] === "-o") {
      return { text: `${PROC_START}\n` };
    }
    return { why: `not answered: ${binary} ${args.join(" ")}` };
  };
}

describe("readOwnSeat", () => {
  it("reads a session booted on a plan's own store as that plan", () => {
    const claudeHome = claudeHomeWith({ records: [{ pid: 4242, sessionId: "abc" }] });
    const reading = readOwnSeat({
      accounts: ACCOUNTS,
      claudeHome,
      read: readerShowing({ env: `CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-three` }),
      sessionId: "abc",
    });
    expect(reading).toStrictEqual({
      kind: "read",
      plan: { alias: "plan-three", kind: "store" },
      process: { pid: 4242, procStart: PROC_START },
    });
  });

  it("reads a session booted with no token and no store as off-plan: it spends the default login", () => {
    const claudeHome = claudeHomeWith({ records: [{ pid: 4242, sessionId: "abc" }] });
    const reading = readOwnSeat({
      accounts: ACCOUNTS,
      claudeHome,
      read: readerShowing({ env: "TERM=xterm-256color" }),
      sessionId: "abc",
    });
    expect(reading.kind).toBe("read");
    expect(reading).toMatchObject({ plan: { kind: "off-plan" } });
  });

  it("says the session was not read when no live record carries its id", () => {
    const claudeHome = claudeHomeWith({ records: [{ pid: 4242, sessionId: "other" }] });
    const reading = readOwnSeat({ accounts: ACCOUNTS, claudeHome, read: readerShowing({ env: "" }), sessionId: "abc" });
    expect(reading).toStrictEqual({
      kind: "unread",
      why: `no live session in ${join(claudeHome, "sessions")} carries id abc`,
    });
  });

  it("refuses to pick one of two records carrying the same id", () => {
    const claudeHome = claudeHomeWith({
      records: [
        { pid: 4242, sessionId: "abc" },
        { pid: 4343, sessionId: "abc" },
      ],
    });
    const reading = readOwnSeat({ accounts: ACCOUNTS, claudeHome, read: readerShowing({ env: "" }), sessionId: "abc" });
    expect(reading).toStrictEqual({
      kind: "unread",
      why: "2 live processes carry session id abc, so no one of them is this session",
    });
  });
});
