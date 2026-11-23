/**
 * The effectful edge of `claude gauge`'s chair mark: which listings it asks for, what it does with each failure,
 * and how it identifies each plan's setup token on disk. The process reader is a plain fake passed in; the token
 * identities are read off real files in a throwaway directory.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import {
  type ProcessRead,
  planTokenIdentities,
  readChairPlansForSessions,
  readSeatBoot,
} from "../../../claude/seatBootRead.js";

const HOME = "/Users/someone/.slopweaver/claude-accounts";
const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-three", storeDir: `${HOME}/plan-three` },
  { alias: "plan-five", storeDir: `${HOME}/plan-five` },
];
const PLAN_TOKENS = [
  { alias: "plan-three", identity: { dev: "16777231", ino: "300" } },
  { alias: "plan-five", identity: { dev: "16777231", ino: "500" } },
];
const CHAIR = "/Users/someone/.local/bin/claude --model fable";
const UNBOUND = `${HOME}/unbound/fresh-supervisor-handoff-9292`;

/** A reader answering each listing by its binary and first argument, recording every one it was asked for. */
function fakeRead({ answers }: { answers: Readonly<Record<string, { text: string } | { why: string }>> }): {
  read: ProcessRead;
  asked: string[];
} {
  const asked: string[] = [];
  const read: ProcessRead = ({ binary, args }) => {
    const key = `${binary} ${args[0]!}`;
    asked.push(key);
    return answers[key]!;
  };
  return { asked, read };
}

describe("readSeatBoot", () => {
  it("names the plan whose token is on descriptor 3, from ps twice and lsof once", () => {
    const { asked, read } = fakeRead({
      answers: {
        "lsof -a": { text: `p38858\nf3\nD0x100000f\ni500\nn${HOME}/plan-five/setup-token\n` },
        "ps eww": {
          text: `${CHAIR} CLAUDE_SECURESTORAGE_CONFIG_DIR=${UNBOUND} CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3\n`,
        },
        "ps ww": { text: `${CHAIR}\n` },
      },
    });

    expect(readSeatBoot({ accounts: ACCOUNTS, pid: 38858, planTokens: PLAN_TOKENS, read })).toStrictEqual({
      alias: "plan-five",
      kind: "token",
    });
    expect(asked).toStrictEqual(["ps eww", "ps ww", "lsof -a"]);
  });

  it("never lists descriptor 3 for a seat that declared no token, and names its store", () => {
    const { asked, read } = fakeRead({
      answers: {
        "ps eww": { text: `${CHAIR} CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-three\n` },
        "ps ww": { text: `${CHAIR}\n` },
      },
    });

    expect(readSeatBoot({ accounts: ACCOUNTS, pid: 1, planTokens: PLAN_TOKENS, read })).toStrictEqual({
      alias: "plan-three",
      kind: "store",
    });
    expect(asked).toStrictEqual(["ps eww", "ps ww"]);
  });

  it("says the environment was not read when ps fails, and asks nothing further", () => {
    const { asked, read } = fakeRead({ answers: { "ps eww": { why: "`ps` could not read it (exit 1)" } } });

    expect(readSeatBoot({ accounts: ACCOUNTS, pid: 1, planTokens: PLAN_TOKENS, read })).toStrictEqual({
      kind: "unresolved",
      why: "its environment was not read: `ps` could not read it (exit 1)",
    });
    expect(asked).toStrictEqual(["ps eww"]);
  });

  it("says the command line was not read when the second ps fails", () => {
    const { read } = fakeRead({
      answers: { "ps eww": { text: `${CHAIR} A=1\n` }, "ps ww": { why: "`ps` could not read it (exit 1)" } },
    });

    expect(readSeatBoot({ accounts: ACCOUNTS, pid: 1, planTokens: PLAN_TOKENS, read })).toStrictEqual({
      kind: "unresolved",
      why: "its command line was not read: `ps` could not read it (exit 1)",
    });
  });

  it("says the environment is hidden when ps printed the bare command", () => {
    const { read } = fakeRead({ answers: { "ps eww": { text: `${CHAIR}\n` }, "ps ww": { text: `${CHAIR}\n` } } });

    expect(readSeatBoot({ accounts: ACCOUNTS, pid: 1, planTokens: PLAN_TOKENS, read })).toStrictEqual({
      kind: "unresolved",
      why: "its environment is not visible to `ps`, so what it booted on cannot be read",
    });
  });

  it("carries lsof's failure into the answer rather than falling back to the store", () => {
    const { read } = fakeRead({
      answers: {
        "lsof -a": { why: "`lsof` could not read it (ENOENT)" },
        "ps eww": {
          text: `${CHAIR} CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-three CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3\n`,
        },
        "ps ww": { text: `${CHAIR}\n` },
      },
    });

    expect(readSeatBoot({ accounts: ACCOUNTS, pid: 1, planTokens: PLAN_TOKENS, read })).toStrictEqual({
      kind: "unresolved",
      why: "it declares a setup token on descriptor 3, but descriptor 3 was not read: `lsof` could not read it (ENOENT)",
    });
  });
});

describe("planTokenIdentities", () => {
  let dir: string | undefined;

  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("identifies a present token, leaves a missing one bare, and says why one could not be read", () => {
    dir = mkdtempSync(join(tmpdir(), "seat-boot-read-"));
    const present = join(dir, "plan-one");
    mkdirSync(present);
    writeFileSync(join(present, "setup-token"), "sk-ant-oat01-fixture\n");
    const missing = join(dir, "plan-two");
    mkdirSync(missing);
    // A store path that is a FILE makes `<store>/setup-token` ENOTDIR — a failure that is not "no such file",
    // whatever user the test runs as.
    const blocked = join(dir, "plan-three");
    writeFileSync(blocked, "");
    const stat = statSync(join(present, "setup-token"), { bigint: true });

    const identities = planTokenIdentities({
      accounts: [
        { alias: "plan-one", storeDir: present },
        { alias: "plan-two", storeDir: missing },
        { alias: "plan-three", storeDir: blocked },
      ],
    });

    expect(identities[0]).toStrictEqual({
      alias: "plan-one",
      identity: { dev: stat.dev.toString(), ino: stat.ino.toString() },
    });
    expect(identities[1]).toStrictEqual({ alias: "plan-two" });
    expect(identities[2]!.alias).toBe("plan-three");
    expect(identities[2]!.unread).toContain("ENOTDIR");
  });
});

describe("readChairPlansForSessions", () => {
  let dir: string | undefined;

  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("reads each given session in order, the token on descriptor 3 over its unbound store, bound to its own process", () => {
    dir = mkdtempSync(join(tmpdir(), "seat-boot-sessions-"));
    const planOne = join(dir, "plan-one");
    mkdirSync(planOne);
    writeFileSync(join(planOne, "setup-token"), "sk-ant-oat01-fixture\n");
    const planThree = join(dir, "plan-three");
    mkdirSync(planThree);
    writeFileSync(join(planThree, "setup-token"), "sk-ant-oat01-fixture\n");
    const token = statSync(join(planOne, "setup-token"), { bigint: true });
    const env = `${CHAIR} CLAUDE_SECURESTORAGE_CONFIG_DIR=${planThree} CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3\n`;
    const listing = `p61965\nf3\nD0x${token.dev.toString(16)}\ni${token.ino.toString()}\nn${planOne}/setup-token\n`;
    // Pids 61965 and 80000 hold plan-one's token on descriptor 3, pid 70000's cannot be listed, and pid 80000 now
    // holds a process that started after its registry file was written — a reused pid under a stale registry.
    const asked: string[] = [];
    const read: ProcessRead = ({ binary, args }) => {
      const pid = args[args.indexOf("-p") + 1]!;
      asked.push(`${pid} ${binary} ${args[0]!}`);
      if (binary === "ps" && args[0] === "-o") {
        return { text: pid === "80000" ? "Sun Sep 27 02:43:09 2026\n" : "Sun Sep 27 00:58:16 2026   \n" };
      }
      if (binary === "ps") {
        return { text: args[0] === "eww" ? env : `${CHAIR}\n` };
      }
      return pid === "70000" ? { why: "`lsof` could not read it (exited 1)" } : { text: listing };
    };

    const chair = readChairPlansForSessions({
      accounts: [
        { alias: "plan-one", storeDir: planOne },
        { alias: "plan-three", storeDir: planThree },
      ],
      read,
      sessions: [
        { pid: 70000, procStart: "Sun Sep 27 00:58:16 2026", sessionId: "s-unread" },
        { pid: 61965, procStart: "Sun Sep 27 00:58:16 2026", sessionId: "s-chair" },
        { pid: 80000, procStart: "Sun Sep 27 00:58:16 2026", sessionId: "s-departed" },
      ],
    });

    expect(chair.sessions).toStrictEqual([
      {
        pid: 70000,
        plan: {
          kind: "unresolved",
          why: "it declares a setup token on descriptor 3, but descriptor 3 was not read: `lsof` could not read it (exited 1)",
        },
        sessionId: "s-unread",
      },
      { pid: 61965, plan: { alias: "plan-one", kind: "token" }, sessionId: "s-chair" },
      {
        pid: 80000,
        plan: {
          kind: "unresolved",
          why: "the process at its pid started Sun Sep 27 02:43:09 2026, not Sun Sep 27 00:58:16 2026 as its registry says, so the credential read is another process's",
        },
        sessionId: "s-departed",
      },
    ]);
    // The start is read only once the credential read is done, so a pid reused during it cannot pass.
    expect(asked.filter((line) => line.startsWith("61965 "))).toStrictEqual([
      "61965 ps eww",
      "61965 ps ww",
      "61965 lsof -a",
      "61965 ps -o",
    ]);
  });
});
