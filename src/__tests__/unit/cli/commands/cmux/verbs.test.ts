/**
 * The cmux noun's newer verbs — `list`, `events`, `processes`, `send`, `stop`, `strands`, `submit`.
 *
 * Every case here is a parse, a usage line, a refusal or a pure render reached BEFORE the verb touches a live
 * cmux: the same boundary `run.test.ts` draws for `spawn`/`close`. The socket and binary paths are proven
 * live, in the doc's own proof section, not faked here.
 */
import { describe, expect, it } from "vitest";

import { renderEventLine, runCmuxEventsOver } from "../../../../../cli/commands/cmux/events.js";
import { runCmuxList } from "../../../../../cli/commands/cmux/list.js";
import { renderProcessTree, runCmuxProcesses } from "../../../../../cli/commands/cmux/processes.js";
import { runCmuxSend } from "../../../../../cli/commands/cmux/send.js";
import { runCmuxStop } from "../../../../../cli/commands/cmux/stop.js";
import { runCmuxStrands } from "../../../../../cli/commands/cmux/strands.js";
import { runCmuxSubmit } from "../../../../../cli/commands/cmux/submit.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unavailableCmuxEventStatePort } from "../../../../cmuxEventStateFixture.js";

// deleted-with-code: runCmuxTodo, runCmuxStatus, parseTodoSetArgument

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "cmux", verb, ...rest];
}

describe("cmux list", () => {
  it("prints usage on --help without opening a socket", async () => {
    expect(await runCmuxList(argv({ rest: ["--help"], verb: "list" }))).toBe(EXIT_OK);
  });
});

describe("cmux events", () => {
  // Never the production port: a test that reached `cmuxEventStatePort()` could reach a real store.
  const events = ({ rest }: { rest: readonly string[] }): Promise<number> =>
    runCmuxEventsOver({ argv: argv({ rest, verb: "events" }), port: unavailableCmuxEventStatePort() });

  it("prints usage on --help without opening a subscription", async () => {
    expect(await events({ rest: ["--help"] })).toBe(EXIT_OK);
  });

  it("refuses a --since that is not a whole number, before opening anything", async () => {
    expect(await events({ rest: ["--since", "recent"] })).toBe(EXIT_USAGE);
  });

  it("refuses a --limit that is not a whole number, before opening anything", async () => {
    expect(await events({ rest: ["--limit", "-3"] })).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await events({ rest: ["--nope"] })).toBe(EXIT_USAGE);
  });

  it("exits non-zero, before subscribing, when the store holding its cursor cannot be reached", async () => {
    expect(await events({ rest: [] })).toBe(EXIT_ERROR);
  });
});

describe("cmux stop", () => {
  it("prints usage on --help without opening a socket", async () => {
    expect(await runCmuxStop(argv({ rest: ["--help"], verb: "stop" }))).toBe(EXIT_OK);
  });

  it("refuses when no seat is named, rather than guessing which peer to interrupt", async () => {
    expect(await runCmuxStop(argv({ rest: [], verb: "stop" }))).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before it reaches a peer", async () => {
    expect(await runCmuxStop(argv({ rest: ["workspace:15", "--pause"], verb: "stop" }))).toBe(EXIT_USAGE);
  });
});

describe("renderEventLine", () => {
  it("leads with the sequence number a caller resumes from", () => {
    expect(
      renderEventLine({
        event: {
          agentSource: undefined,
          category: "agent",
          cwd: undefined,
          id: "e1",
          name: "agent.hook.Stop",
          occurredAtIso: "2026-08-23T00:00:00.000Z",
          phase: "received",
          seq: 42,
          sessionId: undefined,
          surfaceId: undefined,
          toolName: undefined,
          workspaceId: "W1",
        },
      }),
    ).toBe("42\t2026-08-23T00:00:00.000Z\tagent.hook.Stop\tW1");
  });

  it("says so plainly when an event names no workspace", () => {
    expect(
      renderEventLine({
        event: {
          agentSource: undefined,
          category: "sidebar",
          cwd: undefined,
          id: "e2",
          name: "sidebar.metadata.updated",
          occurredAtIso: "2026-08-23T00:00:00.000Z",
          phase: undefined,
          seq: 43,
          sessionId: undefined,
          surfaceId: undefined,
          toolName: undefined,
          workspaceId: undefined,
        },
      }),
    ).toContain("(no workspace)");
  });

  it("prints the whole line for a workspace-less event, its tool name trailing", () => {
    expect(
      renderEventLine({
        event: {
          agentSource: undefined,
          category: "agent",
          cwd: undefined,
          id: "e3",
          name: "agent.hook.PreToolUse",
          occurredAtIso: "2026-08-23T00:00:00.000Z",
          phase: undefined,
          seq: 44,
          sessionId: undefined,
          surfaceId: undefined,
          toolName: "Bash",
          workspaceId: undefined,
        },
      }),
    ).toBe("44\t2026-08-23T00:00:00.000Z\tagent.hook.PreToolUse\t(no workspace)\tBash");
  });
});

describe("cmux send", () => {
  it("prints usage on --help without opening a socket", async () => {
    expect(await runCmuxSend(argv({ rest: ["--help"], verb: "send" }))).toBe(EXIT_OK);
  });

  it("requires both a workspace and something to send", async () => {
    expect(await runCmuxSend(argv({ rest: ["--workspace", "workspace:1"], verb: "send" }))).toBe(EXIT_USAGE);
    expect(await runCmuxSend(argv({ rest: ["hello"], verb: "send" }))).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await runCmuxSend(argv({ rest: ["hello", "--nope"], verb: "send" }))).toBe(EXIT_USAGE);
  });
});

describe("cmux submit", () => {
  it("prints usage on --help without opening a socket", async () => {
    expect(await runCmuxSubmit(argv({ rest: ["--help"], verb: "submit" }))).toBe(EXIT_OK);
  });

  it("requires a workspace — there is no focused-surface fallback here, by design", async () => {
    // A bare `surface.send_key` with no target presses Enter on whatever is FOCUSED, which during a spawn is
    // the supervisor's own session. Refusing without `--workspace` is what keeps that impossible.
    expect(await runCmuxSubmit(argv({ rest: [], verb: "submit" }))).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await runCmuxSubmit(argv({ rest: ["--workspace", "workspace:1", "--nope"], verb: "submit" }))).toBe(
      EXIT_USAGE,
    );
  });
});

describe("cmux processes", () => {
  it("prints usage on --help", async () => {
    expect(await runCmuxProcesses(argv({ rest: ["--help"], verb: "processes" }))).toBe(EXIT_OK);
  });

  it("requires a workspace to inspect", async () => {
    expect(await runCmuxProcesses(argv({ rest: [], verb: "processes" }))).toBe(EXIT_USAGE);
  });
});

describe("renderProcessTree", () => {
  it("indents each child under its parent", () => {
    expect(
      renderProcessTree({
        processes: [{ children: [{ children: [], name: "claude", pid: 2 }], name: "zsh", pid: 1 }],
      }),
    ).toEqual(["1\tzsh", "  2\tclaude"]);
  });

  it("renders nothing for an empty tree", () => {
    expect(renderProcessTree({ processes: [] })).toEqual([]);
  });
});

describe("cmux strands", () => {
  it("prints usage on --help without opening a socket", async () => {
    expect(await runCmuxStrands(argv({ rest: ["--help"], verb: "strands" }))).toBe(EXIT_OK);
  });

  it("rejects an unknown flag before its act phase, so a typo never sweeps the fleet blind", async () => {
    expect(await runCmuxStrands(argv({ rest: ["--presss"], verb: "strands" }))).toBe(EXIT_USAGE);
  });
});
