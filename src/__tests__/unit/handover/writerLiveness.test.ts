import { describe, expect, it } from "vitest";

import type { RunWriter } from "../../../handover/runOwner.js";
import { classifyWriterLiveness } from "../../../handover/writerLiveness.js";
import { measured, unmeasurable } from "../../../measurement/status.js";

const AT = "2026-08-20T00:00:00.000Z";

/** A writer fixture; host and pid are what the classifier branches on, so each test names both explicitly. */
function writer({ host, pid }: { host?: RunWriter["host"]; pid: number | undefined }): RunWriter {
  const base = { atIso: AT, pid, sessionId: "session-one", worktree: "/wt" };
  return host === undefined ? base : { ...base, host };
}

/** A pid probe that must never be consulted — failing loudly beats silently passing the wrong branch. */
function neverPid(): boolean {
  throw new Error("processAlive consulted for a host-labelled writer");
}

/** A registry that must never be consulted. */
function neverRegistry(): never {
  throw new Error("sessionLive consulted for a non-Claude writer");
}

/** A Codex open-file scan that must never be consulted. */
function neverCodex(): never {
  throw new Error("codexThread consulted for a non-Codex writer");
}

describe("classifyWriterLiveness", () => {
  it("proves a Claude Code writer live only from a known-live session verdict", () => {
    const verdict = classifyWriterLiveness({
      codexThread: neverCodex,
      processAlive: neverPid,
      sessionLive: () => measured({ value: true }),
      writer: writer({ host: "claude-code", pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "live" });
  });

  it("proves a Claude Code writer dead only from a known-dead session verdict", () => {
    const verdict = classifyWriterLiveness({
      codexThread: neverCodex,
      processAlive: neverPid,
      sessionLive: () => measured({ value: false }),
      writer: writer({ host: "claude-code", pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "dead" });
  });

  it("keeps a Claude Code writer unknown when the registry is unmeasurable, carrying the reason", () => {
    const verdict = classifyWriterLiveness({
      codexThread: neverCodex,
      processAlive: neverPid,
      sessionLive: () => unmeasurable<boolean>({ why: "3 registry file(s) would not decode" }),
      writer: writer({ host: "claude-code", pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "unknown", why: "3 registry file(s) would not decode" });
  });

  it("proves a Codex writer live when a Codex process holds its thread open, consulting neither pid nor registry", () => {
    const asked: string[] = [];
    const verdict = classifyWriterLiveness({
      codexThread: ({ threadId }) => {
        asked.push(threadId);
        return { kind: "live", path: "/Users/acme/.codex/thread-writer-locks/session-one.lock", pid: 77 };
      },
      processAlive: neverPid,
      sessionLive: neverRegistry,
      writer: writer({ host: "codex", pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "live" });
    expect(asked).toEqual(["session-one"]);
  });

  it("keeps a Codex writer unknown, never dead, when no Codex process holds its thread, carrying why", () => {
    const verdict = classifyWriterLiveness({
      codexThread: () => ({ kind: "not-observed", why: "no Codex process holds this thread's rollout" }),
      processAlive: neverPid,
      sessionLive: neverRegistry,
      writer: writer({ host: "codex", pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "unknown", why: "no Codex process holds this thread's rollout" });
  });

  it("uses a dead pid only for a hostless legacy writer", () => {
    const verdict = classifyWriterLiveness({
      codexThread: neverCodex,
      processAlive: () => false,
      sessionLive: neverRegistry,
      writer: writer({ host: undefined, pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "dead" });
  });

  it("keeps a hostless writer unknown when its pid is alive", () => {
    const verdict = classifyWriterLiveness({
      codexThread: neverCodex,
      processAlive: () => true,
      sessionLive: neverRegistry,
      writer: writer({ host: undefined, pid: 4242 }),
    });

    expect(verdict).toEqual({ kind: "unknown", why: "the journal predates host-labelled ownership" });
  });

  it("keeps a hostless writer unknown when it recorded no pid at all", () => {
    const verdict = classifyWriterLiveness({
      codexThread: neverCodex,
      processAlive: neverPid,
      sessionLive: neverRegistry,
      writer: writer({ host: undefined, pid: undefined }),
    });

    expect(verdict).toEqual({ kind: "unknown", why: "the journal predates host-labelled ownership" });
  });
});
