/**
 * The intake read, over a throwaway `~/.claude` and state home laid out exactly as the real ones are: a
 * project directory holding a session transcript, a sessions registry, and a supervisor-pin record.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";
import { findOwnerTurn, readOwnerTurns } from "../../../supervisor/chairTranscript.js";
import { SupervisorCoreErrors, supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { readSupervisorIntake } from "../../../supervisor/intakeRead.js";
import { resolveIntakeScope } from "../../../supervisor/intakeScope.js";

const SESSION = "a0000013-0000-4000-8000-000000000014";
const BOOT = "34a74a0b-1111-4000-8000-000000000001";
const ASK = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";
const RULING = "5b28f7e7-766a-407a-9a15-31a7fe3f3a03";
const MID_TURN = "a0000005-0000-4000-8000-000000000005";
const PEER_MID_TURN = "7a9cc2d0-0e3e-4d1e-9f6e-0a3b64a1c2d3";
const PINNED_AT = "2026-09-02T14:00:00.000Z";
const NOW = "2026-09-02T17:00:00.000Z";

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A `user` line the way Claude Code writes one. */
function userLine({
  uuid,
  timestamp,
  text,
  extra = {},
}: {
  uuid: string;
  timestamp: string;
  text: string;
  extra?: Readonly<Record<string, unknown>>;
}): string {
  return JSON.stringify({
    cwd: "/repo",
    message: { content: [{ text, type: "text" }], role: "user" },
    timestamp,
    type: "user",
    uuid,
    ...extra,
  });
}

/**
 * An `attachment` line the way Claude Code writes a message that arrived MID-TURN — never a `user` line.
 * The shape is copied from a real supervisor transcript; see
 * `src/transcripts/queuedTurn.ts` for the measurement.
 */
function queuedLine({
  uuid,
  timestamp,
  prompt,
  origin,
}: {
  uuid: string;
  timestamp: string;
  prompt: string;
  origin: Readonly<Record<string, unknown>>;
}): string {
  return JSON.stringify({
    attachment: { commandMode: "prompt", origin, prompt, timestamp, type: "queued_command" },
    cwd: "/repo",
    timestamp,
    type: "attachment",
    uuid,
  });
}

/** A throwaway `~/.claude` with one transcript for {@link SESSION}, and an empty sessions registry. */
function claudeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-intake-claude-"));
  scratch.push(home);
  const project = join(home, "projects", "-repo");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(
    join(project, `${SESSION}.jsonl`),
    [
      userLine({ text: "Read the handover doc end to end", timestamp: "2026-09-02T13:46:55.848Z", uuid: BOOT }),
      JSON.stringify({
        message: { content: "on it", role: "assistant" },
        timestamp: "2026-09-02T13:47:00.000Z",
        type: "assistant",
        uuid: "a-1",
      }),
      userLine({
        extra: { toolUseResult: { stdout: "" } },
        text: "",
        timestamp: "2026-09-02T13:48:00.000Z",
        uuid: "t-1",
      }),
      userLine({
        text: ">2. Should fleet findings be asks?\nYes, and ask me first.",
        timestamp: "2026-09-02T15:19:09.343Z",
        uuid: ASK,
      }),
      userLine({
        extra: { promptSource: "queued" },
        text: "why so many open PRs?",
        timestamp: "2026-09-02T15:33:31.518Z",
        uuid: RULING,
      }),
      queuedLine({
        origin: { kind: "human" },
        prompt: "remember i want you to keep capacity maxing",
        timestamp: "2026-09-02T15:40:00.000Z",
        uuid: MID_TURN,
      }),
      queuedLine({
        origin: { kind: "peer", msg_id: "m-1", name: "some-worker", body: "done" },
        prompt: "Another Claude session sent a message: done",
        timestamp: "2026-09-02T15:41:00.000Z",
        uuid: PEER_MID_TURN,
      }),
      "",
    ].join("\n"),
    "utf8",
  );
  return home;
}

/** A throwaway `~/.claude` holding no transcript at all. */
function emptyClaudeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-intake-claude-empty-"));
  scratch.push(home);
  mkdirSync(join(home, "projects"), { recursive: true });
  mkdirSync(join(home, "sessions"), { recursive: true });
  return home;
}

/** A throwaway state home whose chain records {@link SESSION} as a Codex chair, the live pin a Claude one. */
function codexChainHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-intake-codex-chain-"));
  scratch.push(home);
  appendSupervisorLink({
    home,
    link: {
      pinnedAtIso: PINNED_AT,
      session: { host: "codex", id: SESSION },
      source: "pin",
      workspaceId: "W",
      workspaceRef: "w:1",
    },
  });
  writeSupervisorPin({
    home,
    record: { pinnedAtIso: NOW, session: { host: "claude-code", id: BOOT }, workspaceId: "W", workspaceRef: "w:1" },
  });
  return home;
}

/** A throwaway state home with a pin naming {@link SESSION}. */
function stateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-intake-home-"));
  scratch.push(home);
  writeSupervisorPin({
    home,
    record: {
      session: { host: "claude-code", id: SESSION },
      pinnedAtIso: PINNED_AT,
      workspaceId: "W",
      workspaceRef: "workspace:49",
    },
  });
  return home;
}

describe("readOwnerTurns", () => {
  it("addresses every human turn and strips the machine traffic", () => {
    const home = claudeHome();

    const turns = unwrap(
      readOwnerTurns({ projectsDir: join(home, "projects"), sessionId: SESSION, sinceIso: undefined }),
    );

    expect(turns.map((turn) => turn.turnUuid)).toEqual([BOOT, ASK, RULING, MID_TURN]);
    expect(turns[1]).toEqual({
      lineNumber: 4,
      pointer: `transcript:${SESSION}#${ASK}`,
      sessionId: SESSION,
      source: "unknown",
      text: ">2. Should fleet findings be asks?\nYes, and ask me first.",
      timestamp: "2026-09-02T15:19:09.343Z",
      turnUuid: ASK,
    });
    expect(turns[2]!.source).toBe("queued");
  });

  it("reads a message the owner sent mid-turn off its attachment line, and leaves a peer's mid-turn message to the traffic read", () => {
    const home = claudeHome();

    const turns = unwrap(
      readOwnerTurns({ projectsDir: join(home, "projects"), sessionId: SESSION, sinceIso: undefined }),
    );

    expect(turns[3]).toEqual({
      lineNumber: 6,
      pointer: `transcript:${SESSION}#${MID_TURN}`,
      sessionId: SESSION,
      source: "queued",
      text: "remember i want you to keep capacity maxing",
      timestamp: "2026-09-02T15:40:00.000Z",
      turnUuid: MID_TURN,
    });
    expect(turns.map((turn) => turn.turnUuid)).not.toContain(PEER_MID_TURN);
  });

  it("applies the floor, so the boot turn before the pin is nobody's ask", () => {
    const home = claudeHome();

    const turns = unwrap(
      readOwnerTurns({ projectsDir: join(home, "projects"), sessionId: SESSION, sinceIso: PINNED_AT }),
    );

    expect(turns.map((turn) => turn.turnUuid)).toEqual([ASK, RULING, MID_TURN]);
  });

  it("says when the session has no transcript", () => {
    const home = claudeHome();

    const result = readOwnerTurns({
      projectsDir: join(home, "projects"),
      sessionId: "00000000-0000-4000-8000-000000000000",
      sinceIso: undefined,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("00000000-0000-4000-8000-000000000000");
  });
});

describe("findOwnerTurn", () => {
  it("finds the turn a pointer names, off its own transcript", () => {
    const home = claudeHome();

    const found = unwrap(
      findOwnerTurn({ pointer: { sessionId: SESSION, turnUuid: ASK }, projectsDir: join(home, "projects") }),
    );

    expect(found.timestamp).toBe("2026-09-02T15:19:09.343Z");
  });

  it("finds a queued ruling whose prompt carried a screenshot, so it can anchor a register row", () => {
    const projectsDir = join(
      import.meta.dirname,
      "..",
      "..",
      "fixtures",
      "transcripts",
      "queued-image-prompt",
      "projects",
    );

    const codeowners = unwrap(
      findOwnerTurn({
        pointer: {
          sessionId: "a0000023-0000-4000-8000-000000000026",
          turnUuid: "113799d8-0cd5-4036-ac7f-94354617a4fa",
        },
        projectsDir,
      }),
    );
    const successor = unwrap(
      findOwnerTurn({
        pointer: {
          sessionId: "a0000078-0000-4000-8000-000000000085",
          turnUuid: "a0000084-0000-4000-8000-000000000091",
        },
        projectsDir,
      }),
    );

    expect([codeowners.source, codeowners.timestamp]).toEqual(["queued", "2026-09-15T20:52:31.300Z"]);
    expect(codeowners.text).toContain("we're not gonna do anything to code owners here");
    expect([successor.source, successor.timestamp]).toEqual(["queued", "2026-09-15T21:04:22.516Z"]);
    expect(successor.text).toContain("pick up from this session transcript");
  });

  it("refuses a pointer naming a uuid that is not an owner turn in that transcript", () => {
    const home = claudeHome();

    const result = findOwnerTurn({
      pointer: { sessionId: SESSION, turnUuid: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      projectsDir: join(home, "projects"),
    });

    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      "names no owner turn in that transcript",
    );
  });
});

describe("resolveIntakeScope", () => {
  it("takes an explicit session whole, with whatever floor the caller gave", () => {
    const scope = unwrap(
      resolveIntakeScope({
        claudeHome: "/nowhere",
        home: "/nowhere",
        sessionId: SESSION,
        sinceIso: "2026-09-02T14:00:00Z",
      }),
    );

    expect(scope).toEqual({ sessionId: SESSION, sinceIso: "2026-09-02T14:00:00Z", source: "explicit" });
  });

  it("says when no pin is recorded, naming the verb that records one", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-intake-nopin-"));
    scratch.push(home);

    const result = resolveIntakeScope({ claudeHome: claudeHome(), home, sessionId: undefined, sinceIso: undefined });

    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      "no supervisor pin is recorded",
    );
  });

  it("refuses a pin naming a session that is not live, rather than reading a predecessor's transcript", () => {
    const result = resolveIntakeScope({
      claudeHome: claudeHome(),
      home: stateHome(),
      sessionId: undefined,
      sinceIso: undefined,
    });

    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("a0000013, which is not live");
  });

  it("refuses PIN_ON_CODEX for a Codex chair — never reading a Claude transcript sharing its id", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-intake-codex-"));
    scratch.push(home);
    writeSupervisorPin({
      home,
      record: {
        pinnedAtIso: PINNED_AT,
        session: { host: "codex", id: SESSION },
        workspaceId: "W",
        workspaceRef: "w:1",
      },
    });

    const result = resolveIntakeScope({ claudeHome: claudeHome(), home, sessionId: undefined, sinceIso: undefined });

    expect(result._unsafeUnwrapErr()).toStrictEqual(SupervisorCoreErrors.pinOnCodex({ sessionId: SESSION }));
    expect(result._unsafeUnwrapErr().message).toBe(
      "the supervisor pin names Codex thread a0000013, and a Codex chair's rollout is not read by this check yet — " +
        "name a Claude session with `--session <id>` to read one transcript",
    );
    const named = resolveIntakeScope({ claudeHome: emptyClaudeHome(), home, sessionId: SESSION, sinceIso: undefined });
    expect(named._unsafeUnwrapErr()).toStrictEqual(SupervisorCoreErrors.sessionIsCodex({ sessionId: SESSION }));
    const other = resolveIntakeScope({ claudeHome: claudeHome(), home, sessionId: "claude-1", sinceIso: undefined });
    expect(other._unsafeUnwrap()).toStrictEqual({ sessionId: "claude-1", sinceIso: undefined, source: "explicit" });
  });

  it("refuses an explicit session a chain link names as a Codex thread when no Claude transcript carries it", () => {
    const home = codexChainHome();

    const named = resolveIntakeScope({ claudeHome: emptyClaudeHome(), home, sessionId: SESSION, sinceIso: undefined });

    expect(named._unsafeUnwrapErr()).toStrictEqual(SupervisorCoreErrors.sessionIsCodex({ sessionId: SESSION }));
    expect(named._unsafeUnwrapErr().message).toBe(
      "session a0000013 is a Codex thread the supervisor pin or chain records, and a Codex chair's rollout is not " +
        "read by this check yet — name a Claude session with `--session <id>`",
    );
  });

  it("reads the Claude session an explicit id names, though a Codex chain link shares that id", () => {
    const home = codexChainHome();

    const named = resolveIntakeScope({ claudeHome: claudeHome(), home, sessionId: SESSION, sinceIso: undefined });

    expect(named._unsafeUnwrap()).toStrictEqual({ sessionId: SESSION, sinceIso: undefined, source: "explicit" });
  });

  it("follows a live pin and floors at the instant it was pinned", () => {
    const claude = claudeHome();
    writeFileSync(
      join(claude, "sessions", "1.json"),
      JSON.stringify({ cwd: "/repo", pid: 1, sessionId: SESSION, startedAt: 1 }),
      "utf8",
    );

    const scope = unwrap(
      resolveIntakeScope({ claudeHome: claude, home: stateHome(), sessionId: undefined, sinceIso: undefined }),
    );

    expect(scope).toEqual({ sessionId: SESSION, sinceIso: PINNED_AT, source: "pin" });
  });
});

describe("readSupervisorIntake", () => {
  it("reports the unavailable reason instead of a zero when the pin cannot be followed", () => {
    const report = readSupervisorIntake({
      claudeHome: claudeHome(),
      docs: [],
      home: stateHome(),
      marks: [],
      nowIso: NOW,
      sessionId: undefined,
      sinceIso: undefined,
    });

    expect(report.kind).toBe("unavailable");
    expect((report as { readonly why: string }).why).toContain("not live");
  });

  it("sets an explicit session's turns against the board and the ledger", () => {
    const report = readSupervisorIntake({
      claudeHome: claudeHome(),
      docs: [],
      home: stateHome(),
      marks: [
        {
          byClaudeSessionId: SESSION,
          kind: "card",
          markedAtIso: NOW,
          pointer: `transcript:${SESSION}#${RULING}`,
          witness: "Why so many open?",
        },
      ],
      nowIso: NOW,
      sessionId: SESSION,
      sinceIso: PINNED_AT,
    });

    expect(report.kind).toBe("read");
    const finding = (
      report as {
        readonly finding: {
          readonly unwitnessed: readonly { readonly turnUuid: string }[];
          readonly witnessed: number;
        };
      }
    ).finding;
    // The mid-turn attachment counts exactly as a typed turn does: nothing witnesses it, so it is reported.
    expect(finding.unwitnessed.map((turn) => turn.turnUuid)).toEqual([ASK, MID_TURN]);
    expect(finding.witnessed).toBe(1);
  });
});
