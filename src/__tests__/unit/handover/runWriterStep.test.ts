/** The ownership fold's single step: the writer after one journal line, given the writer before it. */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import type { RunWriter } from "../../../handover/runOwner.js";
import { nextWriter } from "../../../handover/runWriterStep.js";

const CODEX_WRITER: RunWriter = {
  atIso: "2026-10-09T11:00:00.000Z",
  host: "codex",
  pid: 5151,
  sessionId: "shared",
  worktree: "/wt/a-doc",
};

/** A hostless resume carrying its own turn's pid; each case names the session it resumes. */
const RESUMED = {
  atIso: "2026-10-09T12:00:00.000Z",
  attempt: undefined,
  kind: "resumed",
  pid: 7000,
  sessionId: "shared",
} satisfies Extract<RunEvent, { kind: "resumed" }>;

describe("nextWriter", () => {
  it("seats a launch's host, and none for a hostless launch", () => {
    const launched: RunEvent = {
      atIso: "2026-10-09T11:00:00.000Z",
      host: "codex",
      kind: "launched",
      pid: 5151,
      sessionId: "shared",
      worktree: "/wt/a-doc",
    };
    expect(nextWriter({ event: launched, writer: undefined })).toEqual(CODEX_WRITER);
    const hostless: RunEvent = {
      atIso: "2026-10-09T11:00:00.000Z",
      kind: "launched",
      pid: 5151,
      sessionId: "shared",
      worktree: "/wt/a-doc",
    };
    expect(nextWriter({ event: hostless, writer: undefined })).toEqual({
      atIso: "2026-10-09T11:00:00.000Z",
      pid: 5151,
      sessionId: "shared",
      worktree: "/wt/a-doc",
    });
  });

  it("keeps the host across a resume of the same session, with this turn's pid", () => {
    const resumed: RunEvent = { ...RESUMED, sessionId: "shared" };
    expect(nextWriter({ event: resumed, writer: CODEX_WRITER })).toEqual({
      ...CODEX_WRITER,
      atIso: "2026-10-09T12:00:00.000Z",
      pid: 7000,
    });
  });

  it("drops the host when the resumed session is not the writer's — Codex 4d r3", () => {
    const resumed: RunEvent = { ...RESUMED, sessionId: "other" };
    expect(nextWriter({ event: resumed, writer: CODEX_WRITER })).toEqual({
      atIso: "2026-10-09T12:00:00.000Z",
      pid: undefined,
      sessionId: "other",
      worktree: undefined,
    });
  });

  it("clears the writer on its own release, and keeps it on another session's", () => {
    const own: RunEvent = { atIso: "2026-10-09T12:00:00.000Z", kind: "released", sessionId: "shared", why: "done" };
    expect(nextWriter({ event: own, writer: CODEX_WRITER })).toBeUndefined();
    const stale: RunEvent = { ...own, sessionId: "other" };
    expect(nextWriter({ event: stale, writer: CODEX_WRITER })).toEqual(CODEX_WRITER);
  });
});
