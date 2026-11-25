/**
 * The cadence's version and auto-compaction reads over injected seams and a throwaway `~/.claude` — plain
 * functions, no mock.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listInstalledExecutables,
  readChairAutoCompactions,
  readChairClaudeCodeVersions,
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
        directory: "/wt/chair",
        location: { kind: "cmux", workspaceId: "WS" },
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

describe("readChairAutoCompactions", () => {
  let claudeHome = "";
  const verdict = { atIso: "", kind: "on-fable", model: "claude-fable-5-2" } as const;
  const chair = {
    kind: "resolved",
    sessions: [
      { pid: 1, sessionId: "s1", verdict },
      { pid: 2, sessionId: "s2", verdict },
    ],
    directory: "/wt/chair",
    location: { kind: "cmux", workspaceId: "WS" },
  } as const;

  /**
   * One boundary record in the shape Claude Code writes, with synthetic values.
   *
   * @param trigger the record's `compactMetadata.trigger`
   * @returns the JSONL line, newline-terminated
   */
  const boundary = ({ trigger }: { trigger: string }): string =>
    `${JSON.stringify({
      compactMetadata: { durationMs: 1000, postTokens: 100, preTokens: 1000, trigger },
      subtype: "compact_boundary",
      type: "system",
      uuid: `b-${trigger}`,
    })}\n`;
  const USER = `${JSON.stringify({ message: { content: "hi", role: "user" }, type: "user" })}\n`;

  /**
   * Write one session's transcript into a project directory.
   *
   * @param dir the project directory under `projects`
   * @param sessionId the transcript's session id
   * @param text the whole file
   */
  const transcript = ({ dir, sessionId, text }: { dir: string; sessionId: string; text: string }): void => {
    mkdirSync(join(claudeHome, "projects", dir), { recursive: true });
    writeFileSync(join(claudeHome, "projects", dir, `${sessionId}.jsonl`), text);
  };

  beforeEach(() => {
    claudeHome = mkdtempSync(join(tmpdir(), "compactions-"));
    mkdirSync(join(claudeHome, "projects"));
  });

  afterEach(() => {
    rmSync(claudeHome, { force: true, recursive: true });
  });

  it("counts only automatic boundaries, and says which session had no transcript", () => {
    transcript({
      dir: "chair",
      sessionId: "s1",
      text: [USER, boundary({ trigger: "auto" }), boundary({ trigger: "manual" }), boundary({ trigger: "auto" })].join(
        "",
      ),
    });

    expect([...readChairAutoCompactions({ claudeHome, read: chair })]).toStrictEqual([
      ["s1", { autoCompactions: 2, kind: "below-trial" }],
      [
        "s2",
        {
          kind: "unmeasured",
          why: "no transcript named s2.jsonl exists under any project directory — the session may never have run here, or it may have aged out of retention",
        },
      ],
    ]);
  });

  it("reaches the trial on a fifth automatic boundary", () => {
    transcript({ dir: "chair", sessionId: "s1", text: boundary({ trigger: "auto" }).repeat(6) });

    expect(readChairAutoCompactions({ claudeHome, read: chair }).get("s1")).toStrictEqual({
      autoCompactionsAtLeast: 5,
      kind: "trial-reached",
    });
  });

  it("walks a session two processes resume once, as one entry", () => {
    transcript({ dir: "chair", sessionId: "s1", text: boundary({ trigger: "auto" }).repeat(3) });
    const resumed = {
      ...chair,
      sessions: [
        { pid: 1, sessionId: "s1", verdict },
        { pid: 2, sessionId: "s1", verdict },
      ],
    };

    expect([...readChairAutoCompactions({ claudeHome, read: resumed })]).toStrictEqual([
      ["s1", { autoCompactions: 3, kind: "below-trial" }],
    ]);
  });

  it("reads a session UNMEASURED when two project directories each hold its transcript", () => {
    transcript({ dir: "chair", sessionId: "s1", text: boundary({ trigger: "auto" }) });
    transcript({ dir: "other", sessionId: "s1", text: boundary({ trigger: "auto" }) });
    const one = { ...chair, sessions: [{ pid: 1, sessionId: "s1", verdict }] };

    const reading = readChairAutoCompactions({ claudeHome, read: one }).get("s1")!;

    expect(reading.kind).toBe("unmeasured");
    expect((reading as { why: string }).why).toContain("2 transcripts are named s1.jsonl");
  });

  it("reads a session UNMEASURED when its transcript path is not a file", () => {
    const path = join(claudeHome, "projects", "chair", "s1.jsonl");
    mkdirSync(path, { recursive: true });
    const one = { ...chair, sessions: [{ pid: 1, sessionId: "s1", verdict }] };

    expect(readChairAutoCompactions({ claudeHome, read: one }).get("s1")).toStrictEqual({
      kind: "unmeasured",
      why: `${path} could not be read (Error: not a regular file)`,
    });
  });

  it("reads a count below the trial UNMEASURED when its transcript could not be read whole", () => {
    // Bytes that are not UTF-8 make the walk report a problem: a count off a partial read cannot vouch for itself.
    mkdirSync(join(claudeHome, "projects", "chair"), { recursive: true });
    writeFileSync(
      join(claudeHome, "projects", "chair", "s1.jsonl"),
      Buffer.concat([Buffer.from(boundary({ trigger: "auto" })), Buffer.from([0xff, 0xfe, 0x0a])]),
    );
    const one = { ...chair, sessions: [{ pid: 1, sessionId: "s1", verdict }] };

    const reading = readChairAutoCompactions({ claudeHome, read: one }).get("s1")!;

    expect(reading.kind).toBe("unmeasured");
    expect((reading as { why: string }).why).toContain("its transcript could not be read whole — invalid UTF-8");
  });

  it("reads nothing for a chair that could not be read", () => {
    expect(
      readChairAutoCompactions({ claudeHome, read: { cause: "no-chair", kind: "unresolved", why: "no pin" } }).size,
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
