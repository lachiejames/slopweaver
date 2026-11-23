/**
 * {@link judgeReseatConfirmation} — the read-back that once journalled `reseated` over a tab that had dropped to zsh
 *: a confirmation now needs a live in-tab record under a new pid, the intended
 * id, and a Claude composer.
 */
import { describe, expect, it } from "vitest";

import type { ComposerProbe } from "../../../cmux/composerProbe.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { judgeReseatConfirmation } from "../../../sessions/reseatConfirmation.js";

const SESSION = "68f60302-1c1e-4a0e-9a57-0c1b1f2e3d4c";
const FRESH = "0b7d2a51-7a0b-4f43-9a0e-1f7a2c3d4e5f";
const COMPOSER: ComposerProbe = { kind: "read", reading: { kind: "placeholder", text: 'Try "fix lint errors"' } };
const ZSH: ComposerProbe = { kind: "read", reading: { kind: "unreadable", reason: "no composer prompt row" } };

/** One live registry record. */
function live({ pid, sessionId }: { pid: number; sessionId: string }): SessionRecord {
  return {
    cwd: "/wt/seat",
    entrypoint: "cli",
    kind: "interactive",
    name: "s",
    pid,
    sessionId,
    startedAtMs: 0,
    status: "idle",
  };
}

describe("judgeReseatConfirmation", () => {
  it("confirms a resume on the intended id, live in the tab under a new pid, at a composer", () => {
    expect(
      judgeReseatConfirmation({
        composer: COMPOSER,
        inTab: [live({ pid: 501, sessionId: SESSION })],
        intended: { kind: "resume", sessionId: SESSION },
        missingConversationSeen: false,
        priorPids: new Set([393]),
      }),
    ).toEqual({ kind: "resumed", pid: 501, sessionId: SESSION });
  });

  it("never confirms over a surface with no composer — the zsh prompt the old read-back called reseated", () => {
    expect(
      judgeReseatConfirmation({
        composer: ZSH,
        inTab: [live({ pid: 501, sessionId: SESSION })],
        intended: { kind: "resume", sessionId: SESSION },
        missingConversationSeen: false,
        priorPids: new Set(),
      }),
    ).toEqual({ kind: "not-confirmed", reason: "no Claude composer is on the surface yet" });
  });

  it("never takes the prior pid, nor another id, for the relaunch", () => {
    expect(
      judgeReseatConfirmation({
        composer: COMPOSER,
        inTab: [live({ pid: 393, sessionId: SESSION }), live({ pid: 502, sessionId: FRESH })],
        intended: { kind: "resume", sessionId: SESSION },
        missingConversationSeen: false,
        priorPids: new Set([393]),
      }).kind,
    ).toBe("not-confirmed");
  });

  it("confirms a fresh launch on whatever new id stands in the tab", () => {
    expect(
      judgeReseatConfirmation({
        composer: COMPOSER,
        inTab: [live({ pid: 502, sessionId: FRESH })],
        intended: { kind: "fresh" },
        missingConversationSeen: false,
        priorPids: new Set([393]),
      }),
    ).toEqual({ kind: "fresh", pid: 502, sessionId: FRESH });
  });

  it("answers missing-conversation the moment a new line of it appears, whatever else stands", () => {
    expect(
      judgeReseatConfirmation({
        composer: COMPOSER,
        inTab: [live({ pid: 501, sessionId: SESSION })],
        intended: { kind: "resume", sessionId: SESSION },
        missingConversationSeen: true,
        priorPids: new Set(),
      }),
    ).toEqual({ kind: "missing-conversation" });
  });
});
