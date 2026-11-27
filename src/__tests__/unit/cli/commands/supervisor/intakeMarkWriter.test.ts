import { describe, expect, it } from "vitest";

import { markWriter } from "../../../../../cli/commands/supervisor/intakeMarkRun.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../../../../../supervisor/session.js";

describe("markWriter", () => {
  it("stamps the visible session by host: a Codex thread as Codex, a Claude session as Claude", () => {
    expect(
      [{ [CODEX_THREAD_ID_ENV]: "t-1" }, { [CLAUDE_CODE_SESSION_ID_ENV]: "c-1" }].map((env) => markWriter({ env })),
    ).toStrictEqual([
      { host: "codex", id: "t-1" },
      { host: "claude-code", id: "c-1" },
    ]);
  });

  it("stamps the Claude session from a process carrying both, as every mark did before a chair could be Codex", () => {
    expect(markWriter({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: "c-1", [CODEX_THREAD_ID_ENV]: "t-1" } })).toStrictEqual({
      host: "claude-code",
      id: "c-1",
    });
  });

  it("stamps nobody outside a visible session, and nobody for an id the ledger reader would refuse", () => {
    expect([{}, { [CODEX_THREAD_ID_ENV]: "../x" }].map((env) => markWriter({ env }))).toStrictEqual([
      undefined,
      undefined,
    ]);
  });
});
