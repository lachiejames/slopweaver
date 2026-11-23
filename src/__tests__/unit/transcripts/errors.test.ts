/**
 * The transcript corpus's four failures, built through their factory: an unlistable projects directory, a
 * session two directories both hold, a missing session (with the empty-id case worded as a caller mistake),
 * and an unreadable transcript that keeps its cause.
 */
import { describe, expect, it } from "vitest";

import { TranscriptSourceErrors } from "../../../transcripts/errors.js";

describe("TranscriptSourceErrors", () => {
  it("projectsDirUnreadable is PROJECTS_DIR_UNREADABLE, naming the directory and the cause", () => {
    expect(
      TranscriptSourceErrors.projectsDirUnreadable({ cause: "EACCES: permission denied", dir: "/u/.claude/projects" }),
    ).toEqual({
      code: "PROJECTS_DIR_UNREADABLE",
      dir: "/u/.claude/projects",
      message:
        "/u/.claude/projects could not be listed (EACCES: permission denied) — Claude Code keeps every transcript under it, so nothing here can answer anything",
    });
  });

  it("sessionAmbiguous is SESSION_AMBIGUOUS, counting the copies and listing them in order", () => {
    expect(
      TranscriptSourceErrors.sessionAmbiguous({
        paths: ["/p/a/s1.jsonl", "/p/b/s1.jsonl", "/p/c/s1.jsonl"],
        sessionId: "s1",
      }),
    ).toEqual({
      code: "SESSION_AMBIGUOUS",
      message:
        "3 transcripts are named s1.jsonl (/p/a/s1.jsonl, /p/b/s1.jsonl, /p/c/s1.jsonl), so which one is that session's record is not known",
      paths: ["/p/a/s1.jsonl", "/p/b/s1.jsonl", "/p/c/s1.jsonl"],
      sessionId: "s1",
    });
  });

  it("sessionNotFound is SESSION_NOT_FOUND, worded as a missing id for '' and as a missing file for a real id", () => {
    expect(TranscriptSourceErrors.sessionNotFound({ sessionId: "" })).toEqual({
      code: "SESSION_NOT_FOUND",
      message: "no session id was given, so no transcript can be located",
      sessionId: "",
    });
    expect(TranscriptSourceErrors.sessionNotFound({ sessionId: "session-7" })).toEqual({
      code: "SESSION_NOT_FOUND",
      message:
        "no transcript named session-7.jsonl exists under any project directory — the session may never have run here, or it may have aged out of retention",
      sessionId: "session-7",
    });
  });

  it("transcriptUnreadable is TRANSCRIPT_UNREADABLE, keeping the cause it names", () => {
    const cause = new Error("EISDIR");

    const error = TranscriptSourceErrors.transcriptUnreadable({ cause, path: "/p/a/s1.jsonl" });

    expect(error).toEqual({
      cause,
      code: "TRANSCRIPT_UNREADABLE",
      message: "/p/a/s1.jsonl could not be read (Error: EISDIR)",
      path: "/p/a/s1.jsonl",
    });
    expect(error.cause).toBe(cause);
  });
});
