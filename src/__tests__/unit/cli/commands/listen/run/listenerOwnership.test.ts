/**
 * Who owns a listener: a visible Claude Code or Codex session, the durable follow-plus-queue capture shape, or
 * nobody, in which case it is refused.
 */
import { describe, expect, it } from "vitest";

import { listenerOwnership } from "../../../../../../cli/commands/listen/listenerOwnership.js";

describe("listenerOwnership", () => {
  it("uses the active Codex session for an ordinary one-shot listener", () => {
    expect(
      listenerOwnership({
        detection: { kind: "active", session: { host: "codex", id: "thread-1" } },
        follow: false,
        queuePath: undefined,
      }),
    ).toEqual({ kind: "supervised", session: { host: "codex", id: "thread-1" } });
  });

  it("allows exactly the durable follow-plus-queue shape without a session", () => {
    expect(
      listenerOwnership({ detection: { kind: "missing" }, follow: true, queuePath: "/tmp/mentions.jsonl" }),
    ).toEqual({
      kind: "capture-only",
      reason:
        "neither CLAUDE_CODE_SESSION_ID nor CODEX_THREAD_ID is set, so no visible supervisor session was found. Start this command inside Claude Code or Codex.",
    });
  });

  it("refuses a sessionless follow listener with no durable queue", () => {
    expect(listenerOwnership({ detection: { kind: "missing" }, follow: true, queuePath: undefined }).kind).toBe(
      "refuse",
    );
  });

  it("refuses a sessionless one-shot even when a queue path was supplied", () => {
    expect(
      listenerOwnership({ detection: { kind: "missing" }, follow: false, queuePath: "/tmp/mentions.jsonl" }).kind,
    ).toBe("refuse");
  });

  it("refuses an ambiguous pair of hosts even for the durable queue shape", () => {
    expect(
      listenerOwnership({
        detection: {
          kind: "ambiguous",
          sessions: [
            { host: "claude-code", id: "session-1" },
            { host: "codex", id: "thread-1" },
          ],
        },
        follow: true,
        queuePath: "/tmp/mentions.jsonl",
      }).kind,
    ).toBe("refuse");
  });
});
