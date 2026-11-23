/**
 * Which plan a live seat is spending, decided from what it was booted on — the pure half of `claude gauge`'s chair
 * mark, over `ps eww` and `lsof -Fn` text shaped exactly as darwin printed it.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import {
  bindBootToProcess,
  chairPlanVerdict,
  parseBootEnv,
  parseLsofFile,
  planForSeatBoot,
} from "../../../claude/seatBoot.js";

const HOME = "/Users/someone/.slopweaver/claude-accounts";

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-three", storeDir: `${HOME}/plan-three` },
  { alias: "plan-five", storeDir: `${HOME}/plan-five` },
];

/** The unbound store every token seat boots against, named by no plan. */
const UNBOUND = `${HOME}/unbound/fresh-supervisor-handoff-9292`;

describe("parseBootEnv", () => {
  const CHAIR = "/Users/someone/.local/bin/claude --session-id a0000032 --model fable";

  it("reads both boot variables out of the environment ps appends to a chair's command line", () => {
    const psLine =
      `${CHAIR} CMUX_WORKSPACE_ID=C237 CLAUDE_SECURESTORAGE_CONFIG_DIR=${UNBOUND} PATH=/usr/bin ` +
      "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3\n";

    expect(parseBootEnv({ commandLine: `${CHAIR}\n`, psLine })).toStrictEqual({ storeDir: UNBOUND, tokenFd: "3" });
  });

  it("keeps a store path holding a space whole, as ps prints it unquoted", () => {
    // MEASURED: `env 'CLAUDE_SECURESTORAGE_CONFIG_DIR=/tmp/a b/store' … node -e …` then `ps eww`.
    const commandLine = "/usr/local/bin/node -e setTimeout(()=>{},4000)";
    const psLine =
      `${commandLine} PATH=/usr/bin:/bin ` +
      "CLAUDE_SECURESTORAGE_CONFIG_DIR=/tmp/a b/store CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 OTHER=x";

    expect(parseBootEnv({ commandLine, psLine })).toStrictEqual({ storeDir: "/tmp/a b/store", tokenFd: "3" });
  });

  it("never reads an assignment-shaped ARGUMENT as the environment", () => {
    // An argument naming a plan store, with the real environment hidden from ps.
    const commandLine = `/usr/local/bin/claude --append-system-prompt CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-three`;

    expect(parseBootEnv({ commandLine, psLine: commandLine })).toBeUndefined();
    expect(parseBootEnv({ commandLine, psLine: `${commandLine} PATH=/usr/bin` })).toStrictEqual({});
  });

  it("keeps a trailing space on the last value, where only the line's newline is ps's own", () => {
    const psLine = `${CHAIR} CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-three \n`;

    expect(parseBootEnv({ commandLine: `${CHAIR}\n`, psLine })).toStrictEqual({ storeDir: `${HOME}/plan-three ` });
  });

  it("names a boot variable the environment declares twice, rather than keeping whichever came last", () => {
    const psLine =
      `${CHAIR} CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-five ` +
      `CLAUDE_SECURESTORAGE_CONFIG_DIR=${HOME}/plan-three`;

    expect(parseBootEnv({ commandLine: CHAIR, psLine })).toStrictEqual({
      duplicated: "CLAUDE_SECURESTORAGE_CONFIG_DIR",
      storeDir: `${HOME}/plan-three`,
    });
  });

  it("answers an empty environment for a process that declares neither variable", () => {
    expect(parseBootEnv({ commandLine: CHAIR, psLine: `${CHAIR} PATH=/usr/bin HOME=/Users/someone` })).toStrictEqual(
      {},
    );
  });

  it("answers undefined when ps showed no environment at all, never an empty one", () => {
    // MEASURED: `/bin/sleep`, a platform binary, printed its bare command under `ps eww`.
    expect(parseBootEnv({ commandLine: "/bin/sleep 4\n", psLine: "/bin/sleep 4\n" })).toBeUndefined();
  });

  it("answers undefined when the eww line does not begin with the command line it was read beside", () => {
    expect(parseBootEnv({ commandLine: CHAIR, psLine: "/usr/bin/other PATH=/usr/bin" })).toBeUndefined();
  });
});

describe("parseLsofFile", () => {
  it("takes the path, device and inode off a -FDin listing, the device from lsof's hex", () => {
    // MEASURED against a live pid: `stat -f %d` printed 16777231 for the D0x100000f lsof printed.
    const text = `p38858\nf3\nD0x100000f\ni1395474996\nn${HOME}/plan-five/setup-token\n`;

    expect(parseLsofFile({ text })).toStrictEqual({
      identity: { dev: "16777231", ino: "1395474996" },
      path: `${HOME}/plan-five/setup-token`,
    });
  });

  it("answers undefined for a listing naming no path", () => {
    expect(parseLsofFile({ text: "p38858\nf3\nD0x100000f\ni1395474996\n" })).toBeUndefined();
  });

  it("answers undefined for a listing with a path but no inode, which identifies no file", () => {
    expect(parseLsofFile({ text: `p38858\nf3\nD0x100000f\nn${HOME}/plan-five/setup-token\n` })).toBeUndefined();
  });
});

describe("planForSeatBoot", () => {
  const FIVE_TOKEN = { identity: { dev: "16777231", ino: "500" }, path: `${HOME}/plan-five/setup-token` };
  const PLAN_TOKENS = [
    { alias: "plan-three", identity: { dev: "16777231", ino: "300" } },
    { alias: "plan-five", identity: FIVE_TOKEN.identity },
  ];

  it("names the plan whose setup token is on descriptor 3, over the unbound store beside it", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: PLAN_TOKENS,
        tokenFile: FIVE_TOKEN,
      }),
    ).toStrictEqual({ alias: "plan-five", kind: "token" });
  });

  it("never falls back to the store when a declared descriptor cannot be read", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: `${HOME}/plan-three`, tokenFd: "3" },
        planTokens: PLAN_TOKENS,
        tokenFileUnread: "descriptor 3 was not read: `lsof` could not read it (ENOENT)",
      }),
    ).toStrictEqual({
      kind: "unresolved",
      why: "it declares a setup token on descriptor 3, but descriptor 3 was not read: `lsof` could not read it (ENOENT)",
    });
  });

  it("refuses to name a plan when descriptor 3 holds a file that is no plan's token", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: PLAN_TOKENS,
        tokenFile: { identity: { dev: "16777231", ino: "999" }, path: "/dev/ttys014" },
      }),
    ).toStrictEqual({
      kind: "unresolved",
      why: "descriptor 3 is open on /dev/ttys014, which is no configured plan's CURRENT token — re-minted since this seat booted, or never one",
    });
  });

  it("never reads a seat off-plan once its plan's token is re-minted under it, since a re-mint is a new inode", () => {
    const bootedOn = { identity: { dev: "16777231", ino: "450" }, path: `${HOME}/plan-five/setup-token` };
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: PLAN_TOKENS,
        tokenFile: bootedOn,
      }).kind,
    ).toBe("unresolved");
  });

  it("matches by the file, not the string, so a path spelled another way still names its plan", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: PLAN_TOKENS,
        tokenFile: { identity: FIVE_TOKEN.identity, path: `${HOME}/PLAN-FIVE/setup-token` },
      }),
    ).toStrictEqual({ alias: "plan-five", kind: "token" });
  });

  it("never matches the same inode on another device", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: PLAN_TOKENS,
        tokenFile: { identity: { dev: "16777232", ino: "500" }, path: "/Volumes/other/setup-token" },
      }).kind,
    ).toBe("unresolved");
  });

  it("names no plan when one token file is two plans' token at once", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: [
          { alias: "plan-one", identity: FIVE_TOKEN.identity },
          { alias: "plan-two", identity: FIVE_TOKEN.identity },
        ],
        tokenFile: FIVE_TOKEN,
      }),
    ).toStrictEqual({
      kind: "unresolved",
      why: `descriptor 3 is open on ${HOME}/plan-five/setup-token, which is the token of plan-one and plan-two at once`,
    });
  });

  it("never matches a plan that has no token file", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: [{ alias: "plan-five" }],
        tokenFile: FIVE_TOKEN,
      }).kind,
    ).toBe("unresolved");
  });

  it("names no plan while another plan's token exists but cannot be identified, since it may be the same file", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: UNBOUND, tokenFd: "3" },
        planTokens: [...PLAN_TOKENS, { alias: "plan-two", unread: "EACCES: permission denied" }],
        tokenFile: FIVE_TOKEN,
      }),
    ).toStrictEqual({
      kind: "unresolved",
      why: "descriptor 3 is plan-five's token, but plan-two (EACCES: permission denied) could not be identified, so it may share that file",
    });
  });

  it("refuses a descriptor other than the one every boot line names", () => {
    expect(planForSeatBoot({ accounts: ACCOUNTS, env: { tokenFd: "4" }, planTokens: PLAN_TOKENS })).toStrictEqual({
      kind: "unresolved",
      why: "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=4, not the 3 every boot line this repo builds names",
    });
  });

  it("ignores descriptor 3 in a process that declared no token, and names its plan store", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { storeDir: `${HOME}/plan-three` },
        planTokens: PLAN_TOKENS,
        tokenFile: FIVE_TOKEN,
      }),
    ).toStrictEqual({ alias: "plan-three", kind: "store" });
  });

  it("calls an unbound store with no token signed out, never a fall-through to another plan", () => {
    expect(planForSeatBoot({ accounts: ACCOUNTS, env: { storeDir: UNBOUND }, planTokens: PLAN_TOKENS })).toStrictEqual({
      kind: "off-plan",
      why: `signed out: it declares no setup token descriptor, and its store ${UNBOUND} is no configured plan's`,
    });
  });

  it("compares a store path exactly, so a trailing slash is a different store", () => {
    expect(
      planForSeatBoot({ accounts: ACCOUNTS, env: { storeDir: `${HOME}/plan-three/` }, planTokens: PLAN_TOKENS }).kind,
    ).toBe("off-plan");
  });

  it("names no plan when a boot variable is declared twice, even one that would resolve", () => {
    expect(
      planForSeatBoot({
        accounts: ACCOUNTS,
        env: { duplicated: "CLAUDE_SECURESTORAGE_CONFIG_DIR", storeDir: `${HOME}/plan-three` },
        planTokens: PLAN_TOKENS,
      }),
    ).toStrictEqual({
      kind: "unresolved",
      why: "its environment declares CLAUDE_SECURESTORAGE_CONFIG_DIR more than once, so no one value is what it booted on",
    });
  });

  it("names the default login when neither variable is present", () => {
    expect(planForSeatBoot({ accounts: ACCOUNTS, env: {}, planTokens: PLAN_TOKENS })).toStrictEqual({
      kind: "off-plan",
      why: "it declares no setup token descriptor and no store, so it spends whatever the default login holds",
    });
  });
});

describe("chairPlanVerdict", () => {
  it("marks the plan when the one chair session names it", () => {
    const chair = chairPlanVerdict({
      sessions: [{ pid: 38858, plan: { alias: "plan-five", kind: "token" }, sessionId: "a0000032" }],
    });

    expect(chair.active).toBe("plan-five");
    expect(chair.lines).toStrictEqual([
      "chair: session a0000032 (pid 38858) spends plan-five, booted on its setup token on descriptor 3",
    ]);
  });

  it("marks a plan two tabs agree on, whichever credential each booted on", () => {
    const chair = chairPlanVerdict({
      sessions: [
        { pid: 1, plan: { alias: "plan-five", kind: "token" }, sessionId: "a" },
        { pid: 2, plan: { alias: "plan-five", kind: "store" }, sessionId: "b" },
      ],
    });

    expect(chair.active).toBe("plan-five");
    expect(chair.lines[1]).toBe("chair: session b (pid 2) spends plan-five, booted on its own store, no token");
  });

  it("marks nothing when two tabs are on two plans, names both, and says why nothing is marked", () => {
    const chair = chairPlanVerdict({
      sessions: [
        { pid: 1, plan: { alias: "plan-five", kind: "token" }, sessionId: "a" },
        { pid: 2, plan: { alias: "plan-three", kind: "token" }, sessionId: "b" },
      ],
    });

    expect(chair.active).toBeUndefined();
    expect(chair.lines).toStrictEqual([
      "chair: session a (pid 1) spends plan-five, booted on its setup token on descriptor 3",
      "chair: session b (pid 2) spends plan-three, booted on its setup token on descriptor 3",
      "chair plan UNREAD — its 2 sessions spend different plans (plan-five, plan-three)",
    ]);
  });

  it("marks nothing when one tab reads and another does not, so the readable one cannot mask it", () => {
    const chair = chairPlanVerdict({
      sessions: [
        { pid: 1, plan: { alias: "plan-five", kind: "token" }, sessionId: "a" },
        { pid: 2, plan: { kind: "unresolved", why: "its environment is not visible to `ps`" }, sessionId: "b" },
      ],
    });

    expect(chair.active).toBeUndefined();
    expect(chair.lines[1]).toBe("chair: session b (pid 2) plan UNREAD — its environment is not visible to `ps`");
  });

  it("marks nothing when a tab is off every plan, and says so apart from an unread one", () => {
    const why = "it declares no setup token descriptor and no store, so it spends whatever the default login holds";
    const chair = chairPlanVerdict({
      sessions: [
        { pid: 1, plan: { alias: "plan-five", kind: "token" }, sessionId: "a" },
        { pid: 2, plan: { kind: "off-plan", why }, sessionId: "b" },
      ],
    });

    expect(chair.active).toBeUndefined();
    expect(chair.lines[1]).toBe(`chair: session b (pid 2) is OFF every configured plan — ${why}`);
  });

  it("says an empty chair out loud rather than printing nothing", () => {
    expect(chairPlanVerdict({ sessions: [] })).toStrictEqual({
      lines: ["chair plan UNREAD — no Claude session is live in the pinned supervisor workspace"],
      sessions: [],
    });
  });

  it("says why the chair itself could not be read", () => {
    expect(chairPlanVerdict({ sessions: [], unread: "cmux could not be reached (ENOENT)" })).toStrictEqual({
      lines: ["chair plan UNREAD — cmux could not be reached (ENOENT)"],
      sessions: [],
      unread: "cmux could not be reached (ENOENT)",
    });
  });
});

describe("bindBootToProcess", () => {
  const plan = { alias: "plan-one", kind: "token" } as const;
  const procStart = "Sun Sep 27 00:58:16 2026";

  it("keeps the plan when the pid still holds the process its registry names", () => {
    expect(
      bindBootToProcess({ observedStart: { text: "Sun Sep 27 00:58:16 2026   \n" }, plan, procStart }),
    ).toStrictEqual(plan);
  });

  it("reads a stale registry over a reused pid as another process's credential, never this session's", () => {
    expect(bindBootToProcess({ observedStart: { text: "Sun Sep 27 02:43:09 2026\n" }, plan, procStart })).toStrictEqual(
      {
        kind: "unresolved",
        why: "the process at its pid started Sun Sep 27 02:43:09 2026, not Sun Sep 27 00:58:16 2026 as its registry says, so the credential read is another process's",
      },
    );
  });

  it("binds nothing when the registry records no process start", () => {
    expect(bindBootToProcess({ observedStart: { text: procStart }, plan, procStart: undefined })).toStrictEqual({
      kind: "unresolved",
      why: "its registry file records no process start, so the credential read cannot be bound to its process",
    });
  });

  it("binds nothing when both start values are empty, never letting two blanks agree", () => {
    expect(bindBootToProcess({ observedStart: { text: "\n" }, plan, procStart: "" })).toStrictEqual({
      kind: "unresolved",
      why: "its registry file records no process start, so the credential read cannot be bound to its process",
    });
  });

  it("binds nothing when `ps` prints no start for the pid", () => {
    expect(bindBootToProcess({ observedStart: { text: "   \n" }, plan, procStart })).toStrictEqual({
      kind: "unresolved",
      why: "`ps` printed no process start for its pid, so the credential read is unbound",
    });
  });

  it("binds nothing when the live process start could not be read", () => {
    expect(
      bindBootToProcess({ observedStart: { why: "`ps` could not read it (exit 1)" }, plan, procStart }),
    ).toStrictEqual({
      kind: "unresolved",
      why: "its process start was not read, so the credential read is unbound: `ps` could not read it (exit 1)",
    });
  });

  it("binds an off-plan reading like a plan, so a stranger's default login is never this session's", () => {
    const offPlan = { kind: "off-plan", why: "it spends whatever the default login holds" } as const;

    expect(bindBootToProcess({ observedStart: { text: procStart }, plan: offPlan, procStart })).toStrictEqual(offPlan);
    expect(
      bindBootToProcess({ observedStart: { text: "Sun Sep 27 02:43:09 2026" }, plan: offPlan, procStart }).kind,
    ).toBe("unresolved");
  });

  it("passes an already-unresolved read through with its own reason", () => {
    const unresolved = { kind: "unresolved", why: "its environment was not read: gone" } as const;

    expect(bindBootToProcess({ observedStart: { text: "anything" }, plan: unresolved, procStart })).toStrictEqual(
      unresolved,
    );
  });
});
