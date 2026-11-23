/**
 * The session registry decode and the transcript title read:
 *
 *  - a registry file is read in the shape Claude Code actually writes, and one with no pid is refused, since
 *    liveness could never be asked of it;
 *  - a headless session publishes no status for its whole life, so an absent status is the empty string,
 *    never an invented one;
 *  - the title is the NEWEST one a transcript carries.
 */
import { describe, expect, it } from "vitest";
import { newestAiTitle, parseSessionFile } from "../../../sessions/liveSessions.js";

describe("parseSessionFile", () => {
  it("reads the shape the registry actually writes", () => {
    const parsed = parseSessionFile({
      text: JSON.stringify({
        cwd: "/a/b/a-repo",
        entrypoint: "cli",
        kind: "interactive",
        name: "a-repo-a1",
        pid: 4242,
        sessionId: "s-1",
        startedAt: 1000,
        status: "busy",
      }),
    });

    expect(parsed).toEqual({
      cwd: "/a/b/a-repo",
      entrypoint: "cli",
      kind: "interactive",
      name: "a-repo-a1",
      pid: 4242,
      sessionId: "s-1",
      startedAtMs: 1000,
      status: "busy",
    });
  });

  it("carries the process start the registry records, which binds its pid to this session", () => {
    const parsed = parseSessionFile({
      text: JSON.stringify({ pid: 61965, procStart: "Sun Sep 27 00:58:16 2026", sessionId: "s-1" }),
    });

    expect(parsed).toStrictEqual({
      cwd: "",
      entrypoint: "",
      kind: "",
      name: "",
      pid: 61965,
      procStart: "Sun Sep 27 00:58:16 2026",
      sessionId: "s-1",
      startedAtMs: 0,
      status: "",
    });
  });

  it("REFUSES a record with no pid, because liveness could never be asked of it", () => {
    expect(parseSessionFile({ text: JSON.stringify({ sessionId: "s-1" }) })).toBe(
      "the session registry file records no pid, so liveness could never be asked",
    );
  });

  it("refuses text that is not JSON", () => {
    expect(parseSessionFile({ text: "not json" })).toBe("the session registry file is not readable JSON");
  });

  it("reports an absent status as the empty string rather than inventing one", () => {
    const parsed = parseSessionFile({ text: JSON.stringify({ pid: 1, status: null }) });
    if (typeof parsed === "string") {
      throw new Error(`expected a parsed SessionRecord, got refusal: ${parsed}`);
    }
    expect(parsed.status).toBe("");
  });
});

describe("newestAiTitle", () => {
  it("takes the LAST title, because a session re-titles itself as its subject moves", () => {
    const text = [
      '{"type":"ai-title","aiTitle":"An older subject","sessionId":"s"}',
      '{"type":"assistant","message":{}}',
      '{"type":"ai-title","aiTitle":"What it is about now","sessionId":"s"}',
    ].join("\n");

    expect(newestAiTitle({ text })).toBe("What it is about now");
  });

  it("returns undefined when the transcript carries no title", () => {
    expect(newestAiTitle({ text: '{"type":"assistant"}' })).toBeUndefined();
  });

  it("decodes an escaped quote in a title", () => {
    expect(newestAiTitle({ text: '{"type":"ai-title","aiTitle":"A \\"quoted\\" thing","sessionId":"s"}' })).toBe(
      'A "quoted" thing',
    );
  });
});
