/**
 * The worker's own "which visible session am I" record — the one fact the loop's sweep needs to render a
 * dispatched worker's card from its transcript instead of its terminal screen.
 *
 * Round-tripped through a real temp home rather than a fake filesystem: the whole point of the module is
 * that two different processes read and write one file, and generation-binding is a comparison against a
 * dispatch record on the same disk.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../live/turn/dispatchStore.js";
import {
  announceWorkerSession,
  currentGenerationWorkerSession,
  workerSessionPath,
  writeWorkerSession,
} from "../../../../live/turn/workerSessionStore.js";

const ASK = { channel: "C0SYN000009", messageTs: "1789344513.735589", threadTs: "1789344513.735589" };

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const freshHome = () => {
  const home = mkdtempSync(join(tmpdir(), "worker-session-"));
  fixtureDirs.push(home);
  return home;
};

/**
 * Dispatch this ask for real — the record AND the ask-lifecycle event, because
 * `currentGenerationDispatchRecord` binds a record to the log's own current `dispatched` event and a record
 * written without one reads as no dispatch at all.
 */
const dispatchFor = ({ home, leaseExpiresAt }: { home: string; leaseExpiresAt: string }): void => {
  const record = dispatchRecord({ leaseExpiresAt });
  ensureCapturedAskLifecycle({ askIdentity: ASK, home, surface: "channel", userId: "U1" });
  appendAskLifecycleEvent({
    event: {
      ...ASK,
      decision: record.decision,
      kind: "dispatched",
      leaseExpiresAt,
      tier: "fresh-visible-session",
      tsIso: "2026-09-14T00:09:00.000Z",
    },
    home,
  });
  writeDispatchRecord({ home, record });
};

const dispatchRecord = ({ leaseExpiresAt }: { leaseExpiresAt: string }): FreshDispatchRecord => ({
  askPermalink: "https://example.slack.com/archives/C0SYN000009/p1789344513735589",
  briefPath: "/tmp/brief.json",
  channel: ASK.channel,
  decision: {
    confidence: "high",
    needs: [],
    rationale: "a live investigation is needed",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "none",
  },
  dispatchId: "d-1",
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt,
  messageTs: ASK.messageTs,
  schemaVersion: 3,
  session: {
    cwd: "/repo",
    host: "claude-code",
    sessionName: "ask-worker",
    surfaceId: "s-1",
    surfaceRef: "surface:1",
    workspaceId: "w-195",
    workspaceRef: "workspace:195",
  },
  threadTs: ASK.threadTs,
});

describe("workerSessionPath", () => {
  it("keys the file by channel and messageTs, exactly as the dispatch record is keyed", () => {
    expect(workerSessionPath({ askIdentity: ASK, home: "/tmp/state" })).toBe(
      "/tmp/state/live/slack/worker-sessions/C0SYN000009-1789344513.735589.json",
    );
  });
});

describe("announceWorkerSession", () => {
  it("records the worker's host, session id and cwd against the current lease", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    const wrote = announceWorkerSession({
      askIdentity: ASK,
      cwd: "/repo/worktrees/ask-195",
      home,
      nowIso: "2026-09-14T00:10:52.709Z",
      session: { host: "claude-code", id: "sess-abc" },
    });
    expect(wrote).toBe(true);
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toEqual({
      cwd: "/repo/worktrees/ask-195",
      host: "claude-code",
      leaseExpiresAt: "2026-09-14T02:09:00.000Z",
      recordedAtIso: "2026-09-14T00:10:52.709Z",
      sessionId: "sess-abc",
    });
  });

  it("writes nothing for an ask with no dispatch record — an inline turn calls `turn status` too", () => {
    const home = freshHome();
    const wrote = announceWorkerSession({
      askIdentity: ASK,
      cwd: "/repo",
      home,
      nowIso: "2026-09-14T00:10:52.709Z",
      session: { host: "claude-code", id: "sess-abc" },
    });
    expect(wrote).toBe(false);
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toBe(undefined);
  });

  it("writes nothing for an `explicit` host, whose id is a session URL and names no transcript", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    const wrote = announceWorkerSession({
      askIdentity: ASK,
      cwd: "/repo",
      home,
      nowIso: "2026-09-14T00:10:52.709Z",
      session: { host: "explicit", id: "https://example.invalid/session/1" },
    });
    expect(wrote).toBe(false);
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toBe(undefined);
  });

  it("overwrites its own earlier announcement, so a re-seated session is the one the sweep reads", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    for (const id of ["sess-first", "sess-second"]) {
      announceWorkerSession({
        askIdentity: ASK,
        cwd: "/repo",
        home,
        nowIso: "2026-09-14T00:20:00.000Z",
        session: { host: "claude-code", id },
      });
    }
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })!.sessionId).toBe("sess-second");
  });
});

describe("currentGenerationWorkerSession — generation binding", () => {
  it("refuses a record left over from an earlier dispatch of the SAME ask", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    announceWorkerSession({
      askIdentity: ASK,
      cwd: "/repo",
      home,
      nowIso: "2026-09-14T00:10:00.000Z",
      session: { host: "claude-code", id: "sess-old" },
    });
    // The ask is re-dispatched: a new generation, a new lease, and the old worker's record must not be read
    // as this one's — its transcript belongs to a session that is no longer answering this ask.
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T04:30:00.000Z" });
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toBe(undefined);
  });

  it("is undefined when no record was ever written", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toBe(undefined);
  });

  it("is undefined for a file that is not JSON, rather than throwing", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    writeWorkerSession({
      askIdentity: ASK,
      home,
      record: {
        cwd: "/repo",
        host: "claude-code",
        leaseExpiresAt: "2026-09-14T02:09:00.000Z",
        recordedAtIso: "2026-09-14T00:10:00.000Z",
        sessionId: "sess-abc",
      },
    });
    writeFileSync(workerSessionPath({ askIdentity: ASK, home }), "{not json", "utf8");
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toBe(undefined);
  });

  it("is undefined for a record missing its session id", () => {
    const home = freshHome();
    dispatchFor({ home, leaseExpiresAt: "2026-09-14T02:09:00.000Z" });
    writeWorkerSession({
      askIdentity: ASK,
      home,
      record: {
        cwd: "/repo",
        host: "claude-code",
        leaseExpiresAt: "2026-09-14T02:09:00.000Z",
        recordedAtIso: "2026-09-14T00:10:00.000Z",
        sessionId: "sess-abc",
      },
    });
    writeFileSync(
      workerSessionPath({ askIdentity: ASK, home }),
      JSON.stringify({
        cwd: "/repo",
        host: "claude-code",
        leaseExpiresAt: "2026-09-14T02:09:00.000Z",
        recordedAtIso: "2026-09-14T00:10:00.000Z",
        sessionId: "",
      }),
      "utf8",
    );
    expect(currentGenerationWorkerSession({ askIdentity: ASK, home })).toBe(undefined);
  });
});
