import { describe, expect, it } from "vitest";

import {
  readBashExecution,
  readBashSessionCommand,
  readBashToolCommand,
  readShellSessionCommand,
} from "../../../admit/bashToolCommandPayload.js";

/** A stdin reader that answers one fixed payload — the injected seam, not a mock. */
function stdinOf({ text }: { text: string }): () => Promise<string> {
  return () => Promise.resolve(text);
}

/** A stdin reader whose read fails, the way a closed pipe does. */
function failingStdin(): () => Promise<string> {
  return () => Promise.reject(new Error("stdin closed before the payload arrived"));
}

/** One payload serialised the way Claude Code writes it to a hook's stdin. */
function payloadOf({ payload }: { payload: unknown }): () => Promise<string> {
  return stdinOf({ text: JSON.stringify(payload) });
}

/**
 * Every shape the three readers share a refusal for, each one otherwise well-formed so it pins exactly one
 * condition. The outer `cwd` and `session_id` are both present, so the only thing wrong is the named break.
 */
function sharedRefusals(): readonly (() => Promise<string>)[] {
  const outer = { cwd: "/shared/outer-cwd", session_id: "shared-outer-session" };
  const input = { command: "echo shared-refusal-command" };
  return [
    failingStdin(),
    stdinOf({ text: '{"tool_name": "Bash", "tool_input": ' }),
    stdinOf({ text: "42" }),
    stdinOf({ text: '"Bash"' }),
    stdinOf({ text: "null" }),
    payloadOf({ payload: [{ ...outer, tool_input: input, tool_name: "Bash" }] }),
    payloadOf({ payload: { ...outer, tool_input: input, tool_name: "bash" } }),
    payloadOf({ payload: { ...outer, tool_input: input, tool_name: "Bash " } }),
    payloadOf({ payload: { ...outer, tool_input: input } }),
    payloadOf({ payload: { ...outer, tool_input: "echo shared-refusal-command", tool_name: "Bash" } }),
    payloadOf({ payload: { ...outer, tool_input: null, tool_name: "Bash" } }),
    payloadOf({ payload: { ...outer, tool_input: [input], tool_name: "Bash" } }),
    payloadOf({ payload: { ...outer, command: "echo outer-command-decoy", tool_input: {}, tool_name: "Bash" } }),
    payloadOf({ payload: { ...outer, tool_input: { command: 7 }, tool_name: "Bash" } }),
  ];
}

describe("readBashToolCommand", () => {
  it("returns the tool input's command and the payload's own cwd, never a sibling decoy", async () => {
    const readStdin = payloadOf({
      payload: {
        command: "echo outer-command-decoy",
        cwd: "/work/cwd-reader-sentinel",
        session_id: "cwd-reader-session-decoy",
        tool_input: {
          command: "echo cwd-reader-command",
          cwd: "/decoy/tool-input-cwd",
          session_id: "tool-input-session-decoy",
        },
        tool_name: "Bash",
      },
    });

    expect(await readBashToolCommand({ readStdin })).toStrictEqual({
      command: "echo cwd-reader-command",
      cwd: "/work/cwd-reader-sentinel",
    });
  });

  it("keeps an empty command and an empty cwd as themselves, never a non-empty decoy", async () => {
    const readStdin = payloadOf({
      payload: {
        command: "echo empty-outer-command-decoy",
        cwd: "",
        tool_input: { command: "", cwd: "/decoy/empty-inner-cwd" },
        tool_name: "Bash",
      },
    });

    expect(await readBashToolCommand({ readStdin })).toStrictEqual({ command: "", cwd: "" });
  });

  it("fails open on every malformed, non-Bash, commandless or cwd-less payload", async () => {
    const cases = [
      ...sharedRefusals(),
      payloadOf({
        payload: {
          session_id: "cwd-missing-session",
          tool_input: { command: "echo cwd-missing", cwd: "/decoy/inner-cwd" },
          tool_name: "Bash",
        },
      }),
      payloadOf({
        payload: {
          cwd: 404,
          session_id: "cwd-numeric-session",
          tool_input: { command: "echo cwd-numeric" },
          tool_name: "Bash",
        },
      }),
    ];

    const results = await Promise.all(cases.map((readStdin) => readBashToolCommand({ readStdin })));

    expect(results).toStrictEqual(cases.map(() => undefined));
    expect(results.length).toBe(16);
  });
});

describe("readBashSessionCommand", () => {
  it("returns the tool input's command and the payload's own session id, never the cwd", async () => {
    const readStdin = payloadOf({
      payload: {
        command: "echo outer-command-decoy",
        cwd: "/work/session-reader-cwd-decoy",
        session_id: "session-reader-sentinel",
        tool_input: {
          command: "echo session-reader-command",
          cwd: "/decoy/tool-input-cwd",
          session_id: "tool-input-session-decoy",
        },
        tool_name: "Bash",
      },
    });

    expect(await readBashSessionCommand({ readStdin })).toStrictEqual({
      command: "echo session-reader-command",
      sessionId: "session-reader-sentinel",
    });
  });

  it("keeps an empty command and an empty session id as themselves, never a non-empty decoy", async () => {
    const readStdin = payloadOf({
      payload: {
        command: "echo empty-outer-session-command-decoy",
        session_id: "",
        tool_input: { command: "", session_id: "empty-inner-session-decoy" },
        tool_name: "Bash",
      },
    });

    expect(await readBashSessionCommand({ readStdin })).toStrictEqual({ command: "", sessionId: "" });
  });

  it("fails open on every malformed, non-Bash, commandless or session-less payload", async () => {
    const cases = [
      ...sharedRefusals(),
      payloadOf({
        payload: {
          cwd: "/work/session-missing-cwd",
          sessionId: "camel-case-session-decoy",
          tool_input: { command: "echo session-missing", session_id: "inner-session-decoy" },
          tool_name: "Bash",
        },
      }),
      payloadOf({
        payload: {
          cwd: "/work/session-numeric-cwd",
          session_id: 31,
          tool_input: { command: "echo session-numeric" },
          tool_name: "Bash",
        },
      }),
    ];

    const results = await Promise.all(cases.map((readStdin) => readBashSessionCommand({ readStdin })));

    expect(results).toStrictEqual(cases.map(() => undefined));
    expect(results.length).toBe(16);
  });
});

describe("readShellSessionCommand", () => {
  it("reads a command Monitor's shell line and session id exactly as it reads a Bash call's", async () => {
    const monitor = payloadOf({
      payload: {
        session_id: "monitor-session-sentinel",
        tool_input: { command: "tail -f /tmp/deploy.log", timeout_ms: 60_000 },
        tool_name: "Monitor",
      },
    });
    const bash = payloadOf({
      payload: { session_id: "bash-session-sentinel", tool_input: { command: "ls" }, tool_name: "Bash" },
    });

    expect(await readShellSessionCommand({ readStdin: monitor })).toStrictEqual({
      command: "tail -f /tmp/deploy.log",
      sessionId: "monitor-session-sentinel",
    });
    expect(await readShellSessionCommand({ readStdin: bash })).toStrictEqual({
      command: "ls",
      sessionId: "bash-session-sentinel",
    });
  });

  it("releases a WebSocket Monitor, another tool, and every shared malformed shape", async () => {
    const cases = [
      ...sharedRefusals(),
      payloadOf({
        payload: { session_id: "ws-session", tool_input: { url: "wss://example.test/feed" }, tool_name: "Monitor" },
      }),
      payloadOf({
        payload: { session_id: "artifact-session", tool_input: { command: "ls" }, tool_name: "Artifact" },
      }),
    ];

    const results = await Promise.all(cases.map((readStdin) => readShellSessionCommand({ readStdin })));

    expect(results).toStrictEqual(cases.map(() => undefined));
    expect(results.length).toBe(16);
  });
});

describe("readBashExecution", () => {
  it("reads a background call and its finite timeout from the tool input, not the outer payload", async () => {
    const readStdin = payloadOf({
      payload: {
        run_in_background: false,
        timeout: 111,
        tool_input: {
          command: "sleep background-with-timeout",
          run_in_background: true,
          timeout: 120000,
          timeout_ms: 222,
        },
        tool_name: "Bash",
      },
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "sleep background-with-timeout",
      runInBackground: true,
      timeoutMs: 120000,
    });
  });

  it("reads an omitted background flag and timeout as a foreground call with no timeout", async () => {
    const readStdin = payloadOf({
      payload: {
        run_in_background: true,
        timeout: 333,
        tool_input: { command: "echo foreground-omitted", timeoutMs: 444 },
        tool_name: "Bash",
      },
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "echo foreground-omitted",
      runInBackground: false,
      timeoutMs: undefined,
    });
  });

  it("keeps an empty command as itself, never the outer payload's non-empty decoy", async () => {
    const readStdin = payloadOf({
      payload: {
        command: "echo empty-outer-execution-decoy",
        tool_input: { command: "", run_in_background: true, timeout: 555 },
        tool_name: "Bash",
      },
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "",
      runInBackground: true,
      timeoutMs: 555,
    });
  });

  it("reads an explicit false background flag as foreground and keeps its timeout", async () => {
    const readStdin = payloadOf({
      payload: {
        tool_input: { command: "echo foreground-explicit", run_in_background: false, timeout: 5000 },
        tool_name: "Bash",
      },
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "echo foreground-explicit",
      runInBackground: false,
      timeoutMs: 5000,
    });
  });

  it("reads a truthy non-boolean background flag as foreground", async () => {
    const readStdin = payloadOf({
      payload: {
        tool_input: { command: "echo truthy-flag", run_in_background: "true", timeout: 7000 },
        tool_name: "Bash",
      },
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "echo truthy-flag",
      runInBackground: false,
      timeoutMs: 7000,
    });
  });

  it("reads a string timeout as absent", async () => {
    const readStdin = payloadOf({
      payload: {
        tool_input: { command: "echo string-timeout", run_in_background: true, timeout: "600000" },
        tool_name: "Bash",
      },
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "echo string-timeout",
      runInBackground: true,
      timeoutMs: undefined,
    });
  });

  it("reads a timeout JSON parses to Infinity as absent", async () => {
    const readStdin = stdinOf({
      text: '{"tool_name": "Bash", "tool_input": {"command": "echo infinite-timeout", "run_in_background": true, "timeout": 1e400}}',
    });

    expect(await readBashExecution({ readStdin })).toStrictEqual({
      command: "echo infinite-timeout",
      runInBackground: true,
      timeoutMs: undefined,
    });
  });

  it("fails open on every malformed, non-Bash or commandless payload", async () => {
    const results = await Promise.all(sharedRefusals().map((readStdin) => readBashExecution({ readStdin })));

    expect(results).toStrictEqual(sharedRefusals().map(() => undefined));
    expect(results.length).toBe(14);
  });
});
