import { describe, expect, it } from "vitest";

import { preWorkerProvenance } from "../../../../../cli/commands/listen/liveCapture.js";
import type { SupervisorSession } from "../../../../../supervisor/session.js";

describe("preWorkerProvenance", () => {
  it("states that it is awaiting a visible session, and names no supervisor, when there is none", () => {
    expect(preWorkerProvenance({ supervisor: undefined })).toEqual({
      modelId: "awaiting a visible supervisor session",
    });
  });

  it("names a Claude Code supervisor by its host label and carries the session itself", () => {
    const supervisor: SupervisorSession = { host: "claude-code", id: "session-abc" };
    expect(preWorkerProvenance({ supervisor })).toEqual({
      modelId: "the supervisor session (Claude Code, in-turn)",
      supervisor: { host: "claude-code", id: "session-abc" },
    });
  });

  it("names a Codex supervisor by its own host label", () => {
    const supervisor: SupervisorSession = { host: "codex", id: "thread-1" };
    expect(preWorkerProvenance({ supervisor })).toEqual({
      modelId: "the supervisor session (Codex, in-turn)",
      supervisor: { host: "codex", id: "thread-1" },
    });
  });
});
