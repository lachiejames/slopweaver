/**
 * The cadence's version reads over injected seams and a throwaway `~/.claude` — plain functions, no mock.
 */
import {
  chmodSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listInstalledExecutables,
  readChairClaudeCodeVersions,
  readChairContextFill,
  readClaudeCodeVersions,
} from "../../../supervisor/chairCadenceRead.js";

describe("readClaudeCodeVersions", () => {
  it("reads what a fresh boot runs and the newest install, independently", () => {
    expect(
      readClaudeCodeVersions({
        deps: { listInstalled: () => ["2.1.281", "2.1.283", "2.1.280"], runVersion: () => "2.1.283 (Claude Code)\n" },
      }),
    ).toStrictEqual({
      boots: { kind: "measured", version: "2.1.283" },
      newestInstalled: { kind: "measured", version: "2.1.283" },
    });
  });

  it("reports each failure on its own half, never substituting one reading for the other", () => {
    const readings = readClaudeCodeVersions({
      deps: {
        listInstalled: () => {
          throw new Error("ENOENT");
        },
        runVersion: () => "2.1.282 (Claude Code)",
      },
    });

    expect(readings).toStrictEqual({
      boots: { kind: "measured", version: "2.1.282" },
      newestInstalled: {
        kind: "unmeasured",
        why: "Claude Code's versions directory could not be listed (Error: ENOENT)",
      },
    });
  });

  it("is unmeasured on a failed command, and on a directory holding no version", () => {
    const readings = readClaudeCodeVersions({
      deps: {
        listInstalled: () => [".DS_Store"],
        runVersion: () => {
          throw new Error("spawnSync claude ETIMEDOUT");
        },
      },
    });

    expect(readings).toStrictEqual({
      boots: { kind: "unmeasured", why: "`claude --version` failed (Error: spawnSync claude ETIMEDOUT)" },
      newestInstalled: { kind: "unmeasured", why: "Claude Code's versions directory holds no version" },
    });
  });
});

describe("readChairClaudeCodeVersions", () => {
  let claudeHome = "";

  beforeEach(() => {
    claudeHome = mkdtempSync(join(tmpdir(), "cadence-"));
    mkdirSync(join(claudeHome, "projects", "chair"), { recursive: true });
    writeFileSync(
      join(claudeHome, "projects", "chair", "s1.jsonl"),
      `${JSON.stringify({ type: "user", version: "2.1.280" })}\n`,
    );
  });

  afterEach(() => {
    rmSync(claudeHome, { force: true, recursive: true });
  });

  it("reads each chair session's transcript, and says which one had none", () => {
    const readings = readChairClaudeCodeVersions({
      claudeHome,
      read: {
        kind: "resolved",
        sessions: [
          { pid: 1, sessionId: "s1", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
          { pid: 2, sessionId: "s2", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
        ],
        workspaceCwd: "/wt/chair",
        workspaceId: "WS",
      },
    });

    expect([...readings]).toStrictEqual([
      ["s1", { kind: "measured", version: "2.1.280" }],
      ["s2", { kind: "unmeasured", why: "no transcript was found for this session" }],
    ]);
  });

  it("reads nothing for a chair that could not be read", () => {
    expect(
      readChairClaudeCodeVersions({ claudeHome, read: { cause: "no-chair", kind: "unresolved", why: "no pin" } }).size,
    ).toBe(0);
  });
});

describe("readChairContextFill", () => {
  let claudeHome = "";
  /** A boot long before any run of this test writes its settings file. */
  const PAST_BOOT_MS = Date.UTC(2021, 0, 1);
  const chair = {
    kind: "resolved",
    sessions: [
      { pid: 1, sessionId: "s1", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
      { pid: 2, sessionId: "s2", verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } },
    ],
    workspaceCwd: "/wt/chair",
    workspaceId: "WS",
  } as const;

  beforeEach(() => {
    claudeHome = mkdtempSync(join(tmpdir(), "context-"));
    mkdirSync(join(claudeHome, "projects", "chair"), { recursive: true });
    const turn = {
      message: {
        id: "msg_1",
        model: "claude-fable-5-1",
        usage: {
          cache_creation_input_tokens: 10_000,
          cache_read_input_tokens: 150_000,
          input_tokens: 2_000,
          output_tokens: 500,
        },
      },
      type: "assistant",
    };
    // A transcript whose ONLY line is the turn: read from byte 0, it must not be dropped as a fragment.
    writeFileSync(join(claudeHome, "projects", "chair", "s1.jsonl"), `${JSON.stringify(turn)}\n`);
    mkdirSync(join(claudeHome, "sessions"));
  });

  afterEach(() => {
    rmSync(claudeHome, { force: true, recursive: true });
  });

  const settingsPath = (): string => join(claudeHome, "settings.json");

  /**
   * Write both sessions' registry files.
   *
   * @param bootMs the boot instant each records, epoch milliseconds
   */
  const writeRegistry = ({ bootMs }: { bootMs: number }): void => {
    for (const { pid, sessionId } of chair.sessions) {
      writeFileSync(
        join(claudeHome, "sessions", `${String(pid)}.json`),
        JSON.stringify({ cwd: "/wt/chair", pid, sessionId, startedAt: bootMs }),
      );
    }
  };

  /**
   * Write the settings file, then the registry dating both sessions' boot a second after it last changed — the
   * file's own ctime is the real clock, so a boot fixed in advance could not be ordered against it.
   */
  const settingsThenBoot = (): void => {
    writeFileSync(settingsPath(), JSON.stringify({ autoCompactWindow: 300_000 }));
    const { ctimeMs, mtimeMs } = statSync(settingsPath());
    writeRegistry({ bootMs: Math.max(ctimeMs, mtimeMs) + 1000 });
  };

  const CHANGED_SINCE_BOOT =
    "Claude Code's settings changed after this session booted, so the window it runs may not be the one the file now names";

  it("reads each session's newest depth against the settings' window, and says which had no transcript", () => {
    settingsThenBoot();

    expect([...readChairContextFill({ claudeHome, read: chair })]).toStrictEqual([
      ["s1", { depthTokens: 162_000, kind: "measured", windowTokens: 300_000 }],
      ["s2", { kind: "unmeasured", why: "no transcript file exists for this session id yet" }],
    ]);
  });

  it("reads a session UNMEASURED when its settings changed after it booted — a running chair keeps its boot window", () => {
    writeRegistry({ bootMs: PAST_BOOT_MS });
    writeFileSync(settingsPath(), JSON.stringify({ autoCompactWindow: 100_000 }));

    expect([...readChairContextFill({ claudeHome, read: chair })]).toStrictEqual([
      ["s1", { kind: "unmeasured", why: CHANGED_SINCE_BOOT }],
      ["s2", { kind: "unmeasured", why: CHANGED_SINCE_BOOT }],
    ]);
  });

  it("is not fooled by an mtime put back before the boot — the change still moved ctime", () => {
    writeRegistry({ bootMs: PAST_BOOT_MS });
    writeFileSync(settingsPath(), JSON.stringify({ autoCompactWindow: 100_000 }));
    const backdated = new Date(PAST_BOOT_MS - 60_000);
    utimesSync(settingsPath(), backdated, backdated);

    expect(readChairContextFill({ claudeHome, read: chair }).get("s1")).toStrictEqual({
      kind: "unmeasured",
      why: CHANGED_SINCE_BOOT,
    });
  });

  it("reads a symlinked settings file re-pointed after boot UNMEASURED, though its new target is older", () => {
    const older = join(claudeHome, "settings.small.json");
    writeFileSync(older, JSON.stringify({ autoCompactWindow: 100_000 }));
    const { ctimeMs, mtimeMs } = statSync(older);
    const bootMs = Math.max(ctimeMs, mtimeMs) + 1000;
    writeRegistry({ bootMs });
    symlinkSync(older, settingsPath());
    // Only the LINK moved after the boot: the target's own times still predate it.
    const relinked = new Date(bootMs + 60_000);
    lutimesSync(settingsPath(), relinked, relinked);

    expect(readChairContextFill({ claudeHome, read: chair }).get("s1")).toStrictEqual({
      kind: "unmeasured",
      why: CHANGED_SINCE_BOOT,
    });
  });

  it("never reads a settings path that is not a regular file — a FIFO there would block the tick", () => {
    // A directory takes the same not-a-regular-file branch a FIFO does, with no process spawned to make one.
    mkdirSync(settingsPath());
    writeRegistry({ bootMs: PAST_BOOT_MS });
    const why = "Claude Code's settings file is not a regular file, so it is not read";

    expect([...readChairContextFill({ claudeHome, read: chair })]).toStrictEqual([
      ["s1", { kind: "unmeasured", why }],
      ["s2", { kind: "unmeasured", why }],
    ]);
  });

  it("never reads a settings file on another filesystem than the registry — main never reads that mount", () => {
    // The two sides swapped: the settings file stays put and the registry moves to devfs, another filesystem on the
    // Linux runner and on macOS alike (whose APFS volumes report one device id), holding no `*.json` to scan.
    writeFileSync(settingsPath(), JSON.stringify({ autoCompactWindow: 300_000 }));
    rmSync(join(claudeHome, "sessions"), { recursive: true });
    symlinkSync("/dev", join(claudeHome, "sessions"));
    expect(statSync(join(claudeHome, "sessions")).dev).not.toBe(statSync(settingsPath()).dev);
    const why = "Claude Code's settings file is on another filesystem than its session registry, so it is not read";

    expect([...readChairContextFill({ claudeHome, read: chair })]).toStrictEqual([
      ["s1", { kind: "unmeasured", why }],
      ["s2", { kind: "unmeasured", why }],
    ]);
  });

  it.each([
    { name: "the fresh process first", pids: [1, 2] },
    { name: "the stale process first", pids: [2, 1] },
  ])("keeps one process's measurement of a session two processes resume, $name", ({ pids }) => {
    writeFileSync(settingsPath(), JSON.stringify({ autoCompactWindow: 300_000 }));
    const { ctimeMs, mtimeMs } = statSync(settingsPath());
    // Process 1 booted after the settings last changed; process 2 before, so only process 1's window is known.
    const boots = new Map([
      [1, Math.max(ctimeMs, mtimeMs) + 1000],
      [2, PAST_BOOT_MS],
    ]);
    for (const [pid, startedAt] of boots) {
      writeFileSync(
        join(claudeHome, "sessions", `${String(pid)}.json`),
        JSON.stringify({ cwd: "/wt/chair", pid, sessionId: "s1", startedAt }),
      );
    }
    const verdict = { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } as const;
    const resumed = { ...chair, sessions: pids.map((pid) => ({ pid, sessionId: "s1", verdict })) };

    expect([...readChairContextFill({ claudeHome, read: resumed })]).toStrictEqual([
      ["s1", { depthTokens: 162_000, kind: "measured", windowTokens: 300_000 }],
    ]);
  });

  it("reads a session UNMEASURED when the registry holds no file for its pid, so its boot is unknown", () => {
    settingsThenBoot();
    rmSync(join(claudeHome, "sessions", "1.json"));

    expect(readChairContextFill({ claudeHome, read: chair }).get("s1")).toStrictEqual({
      kind: "unmeasured",
      why: "the Claude session registry holds no file for its pid, so its boot is unknown",
    });
  });

  it("reads every session UNMEASURED when the settings file is absent", () => {
    const settings = join(claudeHome, "settings.json");
    const why = `Claude Code's settings file could not be read (Error: ENOENT: no such file or directory, open '${settings}')`;

    expect([...readChairContextFill({ claudeHome, read: chair })]).toStrictEqual([
      ["s1", { kind: "unmeasured", why }],
      ["s2", { kind: "unmeasured", why }],
    ]);
  });

  it("reads nothing for a chair that could not be read", () => {
    expect(
      readChairContextFill({ claudeHome, read: { cause: "no-chair", kind: "unresolved", why: "no pin" } }).size,
    ).toBe(0);
  });
});

describe("listInstalledExecutables", () => {
  it("lists only runnable files, never a dangling link or a stray non-executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "versions-"));
    try {
      writeFileSync(join(dir, "2.1.283"), "#!/bin/sh\n");
      chmodSync(join(dir, "2.1.283"), 0o755);
      writeFileSync(join(dir, "9.9.9"), "");
      symlinkSync(join(dir, "missing"), join(dir, "9.9.10"));
      mkdirSync(join(dir, "9.9.11"));

      expect(listInstalledExecutables({ dir })).toStrictEqual(["2.1.283"]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
