/**
 * `slopweaver session watch` — the parse and refusal path reached BEFORE it opens a subscription (the store's
 * refusals included), the commit of one batch's fold and cursor together, and how `--follow` settles its exit code
 * over a scripted subscription that delivers one event and hangs up.
 *
 * The fold and the report it prints are pure and covered where they live (`cmux/sessionActivity.test.ts`,
 * `sessions/watchReport/`); the plain drain's resuming is `cmux/resumingDrain.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { deferred } from "#lib/deferred.js";

import { DEFAULT_IDLE_MINUTES, foldAndCommit, runSessionWatchOver } from "../../../../../cli/commands/session/watch.js";
import { followEvents, type WatchQuietScheduler } from "../../../../../cli/commands/session/watchFollow.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import type { CmuxEventStatePort } from "../../../../../cmux/eventState/port.js";
import { type CmuxEventHandlers, type CmuxEventStream } from "../../../../../cmux/eventStream.js";
import { type CmuxEvent } from "../../../../../cmux/events.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  memoryCmuxEventStatePort,
  memoryCmuxEventStateStore,
  unavailableCmuxEventStatePort,
} from "../../../../cmuxEventStateFixture.js";

const NOW = "2026-10-31T04:00:00.000Z";

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "watch", ...rest];
}

function event({ seq }: { seq: number }): CmuxEvent {
  return {
    agentSource: undefined,
    category: "agent",
    cwd: "/worktree",
    id: `ev-${String(seq)}`,
    name: "agent.hook.PreToolUse",
    occurredAtIso: "2026-10-25T08:20:00.000Z",
    phase: undefined,
    seq,
    sessionId: "claude-1",
    surfaceId: undefined,
    toolName: "Bash",
    workspaceId: "ws-1",
  };
}

/**
 * An opener that acks, delivers seq 120, then ends the stream — cleanly unless `error` says otherwise — before
 * the quiet timer could report it, so the end itself must flush the pending batch.
 */
function hangsUpAfterOneEvent({
  error,
}: {
  error: "socket" | undefined;
}): (options: { handlers: CmuxEventHandlers }) => CmuxEventStream {
  return ({ handlers }) => {
    handlers.onAck({
      ack: { gap: false, latestSeq: 120, nextSeq: 121, oldestSeq: 100, replayCount: 1, subscriptionId: "sub-1" },
    });
    handlers.onEvent({ event: event({ seq: 120 }) });
    handlers.onEnd({
      error:
        error === undefined
          ? undefined
          : CmuxErrors.socketUnavailable({ detail: "connection reset", socketPath: "/tmp/cmux.sock" }),
    });
    return { close: () => undefined };
  };
}

/**
 * A quiet window the test fires by hand. It holds only the window armed last, a cancel drops that window, and a
 * `fire` with nothing armed throws rather than passing silently.
 */
function manualQuietScheduler(): { readonly schedule: WatchQuietScheduler; readonly fire: () => void } {
  let armed: (() => void) | undefined;
  return {
    fire: () => {
      if (armed === undefined) {
        throw new Error("manualQuietScheduler: fire() with no quiet window armed");
      }
      const onQuiet = armed;
      armed = undefined;
      onQuiet();
    },
    schedule: ({ onQuiet }) => {
      armed = onQuiet;
      return {
        cancel: () => {
          if (armed === onQuiet) {
            armed = undefined;
          }
        },
      };
    },
  };
}

/**
 * Run the verb over a port, never the production one: a test that reached `cmuxEventStatePort()` could reach a
 * real store.
 */
function run({ rest, port = unavailableCmuxEventStatePort() }: { rest: readonly string[]; port?: CmuxEventStatePort }) {
  return runSessionWatchOver({ argv: argv({ rest }), port });
}

describe("session watch", () => {
  it("prints usage on --help without opening a subscription", async () => {
    expect(await run({ rest: ["--help"] })).toBe(EXIT_OK);
  });

  it("refuses a --since that is not a whole number, before opening anything", async () => {
    expect(await run({ rest: ["--since", "recent"] })).toBe(EXIT_USAGE);
  });

  it("refuses a negative --idle-minutes, before opening anything", async () => {
    expect(await run({ rest: ["--idle-minutes", "-5"] })).toBe(EXIT_USAGE);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await run({ rest: ["--nope"] })).toBe(EXIT_USAGE);
  });

  it("refuses --reset-state without a --since saying where the fresh fold starts", async () => {
    const store = memoryCmuxEventStateStore();

    expect(await run({ port: memoryCmuxEventStatePort({ store }), rest: ["--reset-state"] })).toBe(EXIT_USAGE);
    expect(store.opened).toBe(0);
  });

  it("refuses --record-reading without --json-report, before the store opens", async () => {
    const store = memoryCmuxEventStateStore();

    expect(await run({ port: memoryCmuxEventStatePort({ store }), rest: ["--record-reading", "sync-now"] })).toBe(
      EXIT_USAGE,
    );
    expect(store.opened).toBe(0);
  });

  it("refuses --record-reading beside --follow, before the store opens", async () => {
    const store = memoryCmuxEventStateStore();

    expect(
      await run({
        port: memoryCmuxEventStatePort({ store }),
        rest: ["--json-report", "--follow", "--record-reading", "sync-now"],
      }),
    ).toBe(EXIT_USAGE);
    expect(store.opened).toBe(0);
  });

  it("exits non-zero, before subscribing, when the store cannot be reached — never falling back to a file", async () => {
    expect(await run({ rest: [] })).toBe(EXIT_ERROR);
  });

  it("refuses a --since the stored fold does not stand at, before subscribing", async () => {
    const store = memoryCmuxEventStateStore();
    store.rows.set("session-watch", { activities: {}, cursorSeq: 90, revision: 2 });

    expect(await run({ port: memoryCmuxEventStatePort({ store }), rest: ["--since", "30"] })).toBe(EXIT_ERROR);
    expect(store.rows.get("session-watch")).toEqual({ activities: {}, cursorSeq: 90, revision: 2 });
  });

  it("declares a default idle window rather than leaving it implicit", () => {
    expect(DEFAULT_IDLE_MINUTES).toBe(10);
  });
});

describe("foldAndCommit", () => {
  const home = "/nonexistent/home-never-read";

  it("commits the fold and its cursor in one revision", async () => {
    const store = memoryCmuxEventStateStore();
    const port = memoryCmuxEventStatePort({ store });

    const committed = unwrap(
      await foldAndCommit({
        batch: { events: [event({ seq: 120 })], highestSeq: 120 },
        home,
        nowIso: NOW,
        port,
        state: { activities: {}, cursorSeq: 100, revision: null },
      }),
    );

    expect([committed.cursorSeq, committed.revision, committed.activities["ws-1"]!.toolCalls]).toEqual([120, 1, 1]);
    expect(store.rows.get("session-watch")!.cursorSeq).toBe(120);
  });

  it("leaves the winner's row untouched when another watcher committed first", async () => {
    const store = memoryCmuxEventStateStore();
    store.rows.set("session-watch", { activities: {}, cursorSeq: 130, revision: 2 });

    const error = unwrapErr(
      await foldAndCommit({
        batch: { events: [event({ seq: 120 })], highestSeq: 120 },
        home,
        nowIso: NOW,
        port: memoryCmuxEventStatePort({ store }),
        state: { activities: {}, cursorSeq: 100, revision: 1 },
      }),
    );

    expect(error.code).toBe("CMUX_EVENT_REVISION_CONFLICT");
    expect(store.rows.get("session-watch")).toEqual({ activities: {}, cursorSeq: 130, revision: 2 });
  });
});

describe("session watch --follow", () => {
  it("reports the batch pending when cmux hangs up cleanly, then exits 0", async () => {
    const reported: number[][] = [];
    const code = await followEvents({
      afterSeq: 100,
      onBatch: async ({ batch }) => {
        reported.push(batch.events.map((folded) => folded.seq));
      },
      openStream: hangsUpAfterOneEvent({ error: undefined }),
      quietMs: 60_000,
    });

    expect(reported).toEqual([[120]]);
    expect(code).toBe(EXIT_OK);
  });

  it("still settles, non-zero, when the final report's write fails after a clean hang-up", async () => {
    const code = await followEvents({
      afterSeq: 100,
      onBatch: async () => {
        throw new Error("the store could not write the session-watch state (connection reset)");
      },
      openStream: hangsUpAfterOneEvent({ error: undefined }),
      quietMs: 60_000,
    });

    expect(code).toBe(EXIT_ERROR);
  });

  it("still settles, non-zero, when a quiet-timer report rejects with an Error whose message getter throws", async () => {
    const hostile = Object.defineProperty(new Error("replaced by the getter below"), "message", {
      get: () => {
        throw new Error("message getter failed");
      },
    });
    const code = await followEvents({
      afterSeq: 100,
      onBatch: () => Promise.reject(hostile),
      openStream: ({ handlers }) => {
        handlers.onAck({
          ack: { gap: false, latestSeq: 120, nextSeq: 121, oldestSeq: 100, replayCount: 1, subscriptionId: "sub-1" },
        });
        handlers.onEvent({ event: event({ seq: 120 }) });
        // Ends only after the zero quiet window has flushed the batch, so the rejection lands with nobody awaiting it.
        setTimeout(() => {
          handlers.onEnd({ error: undefined });
        }, 20);
        return { close: () => undefined };
      },
      quietMs: 0,
    });

    expect(code).toBe(EXIT_ERROR);
  });

  it("cuts each batch's cursor with its events, so a batch queued behind a slow commit never runs ahead of its fold", async () => {
    const reported: (readonly [readonly number[], number])[] = [];
    // Every step is sequenced by hand, never by a wall-clock offset: real 5ms and 15ms delivery timers fire in one
    // timers phase under load, and 102 and 103 then fold into one batch — correct batching, a wrong test.
    const quiet = manualQuietScheduler();
    const firstCommitStarted = deferred<undefined>();
    const releaseFirstCommit = deferred<undefined>();
    let stream: CmuxEventHandlers | undefined;
    const following = followEvents({
      afterSeq: 100,
      onBatch: async ({ batch }) => {
        reported.push([batch.events.map((folded) => folded.seq), batch.highestSeq]);
        if (reported.length === 1) {
          // The first commit is slow: 102 arrives while it is pending, and it stays pending until 103 is cut too.
          stream!.onEvent({ event: event({ seq: 102 }) });
          firstCommitStarted.settle({ value: undefined });
          await releaseFirstCommit.promise;
        }
        if (reported.length === 3) {
          stream!.onEnd({ error: undefined });
        }
      },
      openStream: ({ handlers }) => {
        stream = handlers;
        handlers.onAck({
          ack: { gap: false, latestSeq: 103, nextSeq: 104, oldestSeq: 100, replayCount: 0, subscriptionId: "sub-1" },
        });
        handlers.onEvent({ event: event({ seq: 101 }) });
        return { close: () => undefined };
      },
      quietMs: 0,
      scheduleQuiet: quiet.schedule,
    });

    quiet.fire();
    await firstCommitStarted.promise;
    quiet.fire();
    stream!.onEvent({ event: event({ seq: 103 }) });
    quiet.fire();
    releaseFirstCommit.settle({ value: undefined });
    const code = await following;

    expect(reported).toEqual([
      [[101], 101],
      [[102], 102],
      [[103], 103],
    ]);
    expect(code).toBe(EXIT_OK);
  });

  it("exits non-zero when cmux ends the stream with an error, after reporting what it had", async () => {
    const reported: number[][] = [];
    const code = await followEvents({
      afterSeq: 100,
      onBatch: async ({ batch }) => {
        reported.push(batch.events.map((folded) => folded.seq));
      },
      openStream: hangsUpAfterOneEvent({ error: "socket" }),
      quietMs: 60_000,
    });

    expect(reported).toEqual([[120]]);
    expect(code).toBe(EXIT_ERROR);
  });
});
