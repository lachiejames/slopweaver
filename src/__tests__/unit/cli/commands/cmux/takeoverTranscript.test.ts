/**
 * Gate (a)'s transcript leg over a REAL temporary projects directory written here and read back by the shipped
 * code — no mocks, and no assumption about the machine's own `~/.claude`. The reader's own chunking, short-read
 * and torn-line behaviour is `../../../transcripts/source.test.ts`'s; this file proves only the leg's mapping
 * from what the reader returns to the four dispositions the gate folds.
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readTranscriptLeg } from "../../../../../cli/commands/cmux/takeoverTranscript.js";
import { CLAUDE_CODE_SESSION_ID_ENV, type VisibleSupervisorSession } from "../../../../../supervisor/session.js";

const SESSION_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CLAUDE: VisibleSupervisorSession = { host: "claude-code", id: SESSION_ID };
const CODEX: VisibleSupervisorSession = { host: "codex", id: SESSION_ID };
const T0 = "2026-10-09T19:53:45.000Z";
const T1 = "2026-10-09T19:59:01.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An empty projects directory, removed after the test. */
function projectsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "takeover-transcript-"));
  fixtureDirs.push(dir);
  return dir;
}

/** One assistant line carrying one `tool_use`, serialised the way Claude Code writes one. */
function assistantLine({ at, tool }: { at: string; tool: string }): string {
  return JSON.stringify({
    message: { content: [{ id: `call-${tool}`, input: {}, name: tool, type: "tool_use" }], role: "assistant" },
    timestamp: at,
    type: "assistant",
  });
}

/** One user line, serialised the way Claude Code writes one. */
function userLine({ at }: { at: string }): string {
  return JSON.stringify({
    message: { content: "go", role: "user" },
    promptSource: "typed",
    timestamp: at,
    type: "user",
  });
}

/** The environment of a process that carries `sessionId`, or none. */
function env({ sessionId }: { sessionId: string | undefined }): NodeJS.ProcessEnv {
  return sessionId === undefined ? {} : { [CLAUDE_CODE_SESSION_ID_ENV]: sessionId };
}

describe("readTranscriptLeg", () => {
  it("calls a Codex chair's leg unread without listing a directory, even when a Claude transcript would witness", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));
    writeFileSync(
      join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`),
      `${assistantLine({ at: T1, tool: "ScheduleWakeup" })}\n`,
    );

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CODEX, projectsDir: projects })).toEqual({
      kind: "unread",
      why: "a Codex chair's rollout carries no Claude Code ScheduleWakeup record, so only the hook-event leg can witness its sweep",
    });
  });

  it("calls an absent session id unread", () => {
    expect(
      readTranscriptLeg({ env: env({ sessionId: undefined }), session: CLAUDE, projectsDir: projectsDir() }),
    ).toEqual({
      kind: "unread",
      why: "this process carries no CLAUDE_CODE_SESSION_ID",
    });
  });

  it("calls a blank session id unread", () => {
    expect(readTranscriptLeg({ env: env({ sessionId: "   " }), session: CLAUDE, projectsDir: projectsDir() })).toEqual({
      kind: "unread",
      why: "this process carries no CLAUDE_CODE_SESSION_ID",
    });
  });

  it("calls a session id that is not a bare name unread, before any directory is listed", () => {
    expect(
      readTranscriptLeg({ env: env({ sessionId: "../../outside" }), session: CLAUDE, projectsDir: projectsDir() }),
    ).toEqual({
      kind: "unread",
      why: 'CLAUDE_CODE_SESSION_ID "../../outside" is not a bare session id, so no transcript is looked up',
    });
  });

  it("calls a whitespace-padded session id unread, never trimming it into a bare one", () => {
    expect(
      readTranscriptLeg({
        env: env({ sessionId: ` ${SESSION_ID} ` }),
        session: CLAUDE,
        projectsDir: projectsDir(),
      }),
    ).toEqual({
      kind: "unread",
      why: `CLAUDE_CODE_SESSION_ID " ${SESSION_ID} " is not a bare session id, so no transcript is looked up`,
    });
  });

  it("calls the leg unread when the environment names a session other than the one the takeover detected", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));
    const other = "bbbbbbbb-0000-0000-0000-000000000002";
    writeFileSync(
      join(projects, "-repo-alpha", `${other}.jsonl`),
      `${assistantLine({ at: T1, tool: "ScheduleWakeup" })}\n`,
      "utf8",
    );

    expect(readTranscriptLeg({ env: env({ sessionId: other }), projectsDir: projects, session: CLAUDE })).toEqual({
      kind: "unread",
      why: `CLAUDE_CODE_SESSION_ID is not the session ${SESSION_ID} the takeover detected`,
    });
  });

  it("calls a symbolic link unread, even when the file it points at would witness", () => {
    const projects = projectsDir();
    const outside = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));
    writeFileSync(join(outside, "other.jsonl"), `${assistantLine({ at: T1, tool: "ScheduleWakeup" })}\n`);
    symlinkSync(join(outside, "other.jsonl"), join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`));

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "unread",
      why: `${join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`)} resolves to ${realpathSync(join(outside, "other.jsonl"))} through a symbolic link, so it is not this session's own transcript`,
    });
  });

  it("calls a project directory that is itself a symbolic link unread", () => {
    const projects = projectsDir();
    const outside = projectsDir();
    writeFileSync(join(outside, `${SESSION_ID}.jsonl`), `${assistantLine({ at: T1, tool: "ScheduleWakeup" })}\n`);
    symlinkSync(outside, join(projects, "-repo-alpha"));

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "unread",
      why: `${join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`)} resolves to ${realpathSync(join(outside, `${SESSION_ID}.jsonl`))} through a symbolic link, so it is not this session's own transcript`,
    });
  });

  it("reads a transcript under a projects directory that is itself reached through a symbolic link", () => {
    const real = projectsDir();
    const alias = join(projectsDir(), "alias");
    symlinkSync(real, alias);
    mkdirSync(join(real, "-repo-alpha"));
    writeFileSync(
      join(real, "-repo-alpha", `${SESSION_ID}.jsonl`),
      `${userLine({ at: T0 })}\n${assistantLine({ at: T1, tool: "ScheduleWakeup" })}\n`,
    );

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: alias })).toEqual({
      kind: "witnessed",
      lineNumber: 2,
    });
  });

  it("calls a missing transcript unread", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "unread",
      why: `no transcript named ${SESSION_ID}.jsonl exists under any project directory — the session may never have run here, or it may have aged out of retention`,
    });
  });

  it("calls duplicate transcripts ambiguous and unread", () => {
    const projects = projectsDir();
    for (const project of ["-repo-alpha", "-repo-beta"]) {
      mkdirSync(join(projects, project));
      writeFileSync(join(projects, project, `${SESSION_ID}.jsonl`), `${userLine({ at: T0 })}\n`);
    }

    // The finder lists the project directories in the order the filesystem returns them, so the expected
    // message is built from that same listing rather than from a guessed order.
    const paths = readdirSync(projects).map((project) => join(projects, project, `${SESSION_ID}.jsonl`));

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "unread",
      why: `2 transcripts are named ${SESSION_ID}.jsonl (${paths.join(", ")}), so which one is that session's record is not known`,
    });
  });

  it("calls a non-regular transcript unreadable", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`), { recursive: true });

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "unread",
      why: `${join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`)} could not be read (Error: not a regular file)`,
    });
  });

  it("returns the witnessing transcript line", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));
    writeFileSync(
      join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`),
      `${userLine({ at: T0 })}\n${assistantLine({ at: T1, tool: "ScheduleWakeup" })}\n${assistantLine({ at: T1, tool: "Bash" })}\n`,
    );

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "witnessed",
      lineNumber: 2,
    });
  });

  it("returns a clean no after consuming a readable transcript", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));
    writeFileSync(
      join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`),
      `${userLine({ at: T0 })}\n${assistantLine({ at: T1, tool: "Bash" })}\n`,
    );

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "no-tool-use",
    });
  });

  it("skips an undecoded line, so a torn tail neither witnesses nor spoils a clean no", () => {
    const projects = projectsDir();
    mkdirSync(join(projects, "-repo-alpha"));
    writeFileSync(
      join(projects, "-repo-alpha", `${SESSION_ID}.jsonl`),
      `${userLine({ at: T0 })}\n${assistantLine({ at: T1, tool: "Bash" })}\n{"type":"assistant","mess`,
    );

    expect(readTranscriptLeg({ env: env({ sessionId: SESSION_ID }), session: CLAUDE, projectsDir: projects })).toEqual({
      kind: "no-tool-use",
    });
  });
});
