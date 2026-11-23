import { describe, expect, it } from "vitest";

import { evaluateHookPayload, type HookDecision } from "../../../admit/hookPayload.js";
import { PYTHON_OVERRIDE_ENV } from "../../../admit/pythonInvocation.js";
import { RAW_ESCAPE } from "../../../admit/rawTools.js";

/** A Bash PreToolUse payload for `command`. */
function bash({ command }: { command: string }): { tool_name: string; tool_input: { command: string } } {
  return { tool_input: { command }, tool_name: "Bash" };
}

/** Assert a decision is a block and return its message (throws otherwise — keeps assertions unconditional). */
function blockedMessage({ decision }: { decision: HookDecision }): string {
  if (!decision.block) {
    throw new Error("expected a block decision, got allow");
  }
  return decision.message;
}

describe("evaluateHookPayload", () => {
  it("blocks a raw mutating Bash command with the escape message", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: bash({ command: "gh pr close 1" }),
    });
    expect(decision.block).toBe(true);
    expect(blockedMessage({ decision })).toContain(RAW_ESCAPE);
  });

  it("allows a read-only Bash command", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: bash({ command: "git status" }),
      }),
    ).toEqual({
      block: false,
    });
  });

  it("allows a would-be-blocked command under the escape", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: true,
        payload: bash({ command: "gh pr close 1" }),
      }),
    ).toEqual({
      block: false,
    });
  });

  it("allows a would-be-blocked command under a command-scoped inline escape", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: bash({ command: "SLOPWEAVER_ALLOW_RAW=1 git push" }),
      }),
    ).toEqual({ block: false });
  });

  it("does not treat the wrong inline escape value as armed", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: bash({ command: "SLOPWEAVER_ALLOW_RAW=0 git push" }),
    });
    expect(decision.block).toBe(true);
  });

  it("allows a well-formed non-Bash tool", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: { tool_input: { content: "y", file_path: "/x" }, tool_name: "Write" },
      }),
    ).toEqual({ block: false });
  });

  it("BLOCKS loudly on a malformed (non-object) payload — fail closed, not fail open", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: "not-an-object",
    });
    expect(decision.block).toBe(true);
    expect(blockedMessage({ decision })).toContain("malformed");
  });

  it("BLOCKS loudly on a Bash payload missing its command", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: { tool_input: {}, tool_name: "Bash" },
    });
    expect(decision.block).toBe(true);
    expect(blockedMessage({ decision })).toContain("missing tool_input.command");
  });
});

describe("evaluateHookPayload — the Python policy runs beside the raw one", () => {
  it("blocks a Python invocation the raw classifier deliberately allows", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: bash({ command: "python3 -c 'import urllib.request'" }),
    });
    expect(blockedMessage({ decision })).toContain(`${PYTHON_OVERRIDE_ENV}=1`);
  });

  it("is not waived by the RAW escape, in either direction", () => {
    // `allowRaw` covers reaches, never tool choice; `allowPython` covers tool choice, never reaches.
    expect(
      blockedMessage({
        decision: evaluateHookPayload({
          allowArtifact: false,
          allowPython: false,
          allowRaw: true,
          payload: bash({ command: "python3 -V" }),
        }),
      }),
    ).toContain(`${PYTHON_OVERRIDE_ENV}=1`);
    expect(
      blockedMessage({
        decision: evaluateHookPayload({
          allowArtifact: false,
          allowPython: true,
          allowRaw: false,
          payload: bash({ command: "curl https://example.com" }),
        }),
      }),
    ).toContain(RAW_ESCAPE);
  });

  it("prints BOTH refusals when one command breaks both policies, whichever comes first", () => {
    const first = blockedMessage({
      decision: evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: bash({ command: "python3 -V && curl https://example.com" }),
      }),
    });
    const second = blockedMessage({
      decision: evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: bash({ command: "curl https://example.com && python3 -V" }),
      }),
    });
    expect(first).toContain(RAW_ESCAPE);
    expect(first).toContain(`${PYTHON_OVERRIDE_ENV}=1`);
    expect(second).toContain(RAW_ESCAPE);
    expect(second).toContain(`${PYTHON_OVERRIDE_ENV}=1`);
  });

  it("leaves a later curl blocked when only the Python half is waived", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: true,
      allowRaw: false,
      payload: bash({ command: "python3 -V && curl https://example.com" }),
    });
    const message = blockedMessage({ decision });
    expect(message).toContain(RAW_ESCAPE);
    expect(message).not.toContain(`${PYTHON_OVERRIDE_ENV}=1`);
  });

  it("allows the whole command once the ambient Python hatch is open", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: true,
        allowRaw: false,
        payload: bash({ command: "python3 -V" }),
      }),
    ).toEqual({ block: false });
  });

  it("opens a script through the payload's own cwd, and refuses a Python shebang inside it", () => {
    const seen: { cwd: string | undefined; path: string }[] = [];
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: { ...bash({ command: "./scripts/report" }), cwd: "/tmp/session" },
      readScript: ({ cwd, path }) => {
        seen.push({ cwd, path });
        return "#!/usr/bin/env python3\nprint(1)\n";
      },
    });
    expect(blockedMessage({ decision })).toContain("./scripts/report (#! python3)");
    // Twice: the raw walk opens the script for its own reaches, the Python walk for its interpreter. The two
    // policies are independent by design, and the reader is a cheap bounded read.
    expect(seen).toEqual([
      { cwd: "/tmp/session", path: "./scripts/report" },
      { cwd: "/tmp/session", path: "./scripts/report" },
    ]);
  });
});

describe("evaluateHookPayload — the Monitor tool", () => {
  /** A Monitor PreToolUse payload for `command`, with the session `cwd` the harness sends alongside. */
  function monitor({ command }: { command: string }): Record<string, unknown> {
    return { cwd: "/tmp/session", tool_input: { command, description: "x", persistent: true }, tool_name: "Monitor" };
  }

  it("polices a Monitor command exactly like a Bash one", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: monitor({ command: "gh pr checks 1 --watch" }),
    });
    expect(decision.block).toBe(true);
    expect(blockedMessage({ decision })).toContain("slopweaver github checks");
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: monitor({ command: "tail -f app.log" }),
      }),
    ).toEqual({
      block: false,
    });
  });

  it("refuses a Python invocation armed through Monitor, the tool no matcher used to cover", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: monitor({ command: "python3 watch.py" }),
    });
    expect(blockedMessage({ decision })).toContain(`${PYTHON_OVERRIDE_ENV}=1`);
  });

  it("opens the script a Monitor runs, resolving it against the payload's own cwd", () => {
    const seen: { cwd: string | undefined; path: string }[] = [];
    const readScript = ({ cwd, path }: { cwd: string | undefined; path: string }): string | undefined => {
      seen.push({ cwd, path });
      return 'while :; do gh api graphql -f query="$Q"; sleep 20; done';
    };
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: monitor({ command: 'cd "$(git rev-parse --show-toplevel)" && scripts/ship/watch.sh --pr 1' }),
      readScript,
    });
    expect(decision.block).toBe(true);
    expect(blockedMessage({ decision })).toContain("`scripts/ship/watch.sh` — the script shells `gh` internally");
    expect(seen).toEqual([
      { cwd: "/tmp/session", path: "scripts/ship/watch.sh" },
      { cwd: "/tmp/session", path: "scripts/ship/watch.sh" },
    ]);
  });

  it("allows a WebSocket monitor, which runs no shell", () => {
    expect(
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: { tool_input: { description: "x", persistent: true, ws: { url: "wss://x" } }, tool_name: "Monitor" },
      }),
    ).toEqual({ block: false });
  });

  it("BLOCKS loudly on a Monitor payload with neither command nor ws", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: { tool_input: { description: "x" }, tool_name: "Monitor" },
    });
    expect(decision.block).toBe(true);
    expect(blockedMessage({ decision })).toContain("Monitor payload is missing tool_input.command");
  });
});

describe("the reach-grant seam", () => {
  it("passes the payload's own session_id to the grant reader, and admits on a live grant", () => {
    const seen: string[] = [];
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: { ...bash({ command: "twilio api:core:messages:create --to +100" }), session_id: "session-a" },
      readReachGrantState: ({ claudeSessionId, tool }) => {
        seen.push(`${claudeSessionId}:${tool}`);
        return { granted: true, grantsTaken: 1 };
      },
    });
    expect(decision.block).toBe(false);
    expect(seen).toEqual(["session-a:twilio"]);
  });

  it("refuses a production-facing call on a payload carrying NO session_id", () => {
    // A grant is issued to a session, so with nothing to match one against the class refuses — the same
    // safe direction the store takes when the journal is unreadable.
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: true,
      payload: bash({ command: "twilio api:core:messages:create --to +100" }),
      readReachGrantState: () => ({ granted: true, grantsTaken: 9 }),
    });
    expect(blockedMessage({ decision })).toContain("slopweaver session reach-grant --tool twilio");
  });
});
