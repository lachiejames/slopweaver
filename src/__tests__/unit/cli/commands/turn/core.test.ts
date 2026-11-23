/** {@link answerProvenanceLabel} and {@link briefOutPath} — pure: no environment, no filesystem, no dispatch record read here. */
import { describe, expect, it } from "vitest";

import { answerProvenanceLabel, briefOutPath } from "../../../../../cli/commands/turn/core.js";
import { defaultBriefPath } from "../../../../../live/turn/briefStore.js";
import type { SupervisorSession } from "../../../../../supervisor/session.js";

const SUPERVISOR: SupervisorSession = { host: "claude-code", id: "a-session-id" };
const WORKER = { host: "claude-code" as const, workspaceRef: "workspace:218" };

describe("answerProvenanceLabel", () => {
  it("labels a direct answer by the visible host that composed it", () => {
    expect(answerProvenanceLabel({ modelOverride: undefined, supervisor: SUPERVISOR, worker: undefined })).toBe(
      "the supervisor session (Claude Code, in-turn)",
    );
  });

  it("labels a DISPATCHED answer by the worker's own workspace, never by this process's host", () => {
    expect(answerProvenanceLabel({ modelOverride: undefined, supervisor: SUPERVISOR, worker: WORKER })).toBe(
      "the dispatched worker in workspace:218 (Claude Code, in-turn)",
    );
  });

  it("lets an explicit --model win over either, for a caller that knows what produced the answer", () => {
    expect(answerProvenanceLabel({ modelOverride: "claude-opus-5", supervisor: SUPERVISOR, worker: WORKER })).toBe(
      "claude-opus-5",
    );
  });

  it("carries the Codex host through for a worker booted onto it", () => {
    expect(
      answerProvenanceLabel({
        modelOverride: undefined,
        supervisor: SUPERVISOR,
        worker: { host: "codex", workspaceRef: "workspace:219" },
      }),
    ).toBe("the dispatched worker in workspace:219 (Codex, in-turn)");
  });
});

describe("briefOutPath", () => {
  const ASK = { channel: "C0ASK", messageTs: "1790000000.000100", threadTs: "1790000000.000100" };

  it("answers --out when it was given", () => {
    expect(briefOutPath({ askIdentity: ASK, home: "/state", values: { out: "/tmp/brief.json" } })).toBe(
      "/tmp/brief.json",
    );
  });

  it("answers the ask's own default path under the home when --out was not given", () => {
    const path = briefOutPath({ askIdentity: ASK, home: "/state", values: {} });
    expect(path).toBe(defaultBriefPath({ askIdentity: ASK, home: "/state" }));
    expect(path.endsWith("/C0ASK-1790000000.000100.json")).toBe(true);
  });

  it("ignores a boolean --out, which names no path", () => {
    expect(briefOutPath({ askIdentity: ASK, home: "/state", values: { out: true } })).toBe(
      defaultBriefPath({ askIdentity: ASK, home: "/state" }),
    );
  });
});
