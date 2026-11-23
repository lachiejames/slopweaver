/**
 * `openSpawnEventWitness` over an injected opener: the subscription it asks for, the bounded oldest-first
 * buffer it keeps, the hang-up it forwards, and the empty witness it degrades to when subscribing throws.
 */
import { describe, expect, it } from "vitest";
import type { CmuxEventHandlers, CmuxEventSubscription } from "../../../cmux/eventStream.js";
import type { CmuxEvent } from "../../../cmux/events.js";
import { type OpenSpawnEventStream, openSpawnEventWitness } from "../../../cmux/spawnWitness.js";

/** What the fake opener was asked for, and how often its stream was closed. */
interface OpenerRecord {
  subscription: CmuxEventSubscription | undefined;
  socketPath: string | undefined;
  handlers: CmuxEventHandlers | undefined;
  closes: number;
}

/**
 * An opener that records its one subscription and hands back a stream counting its hang-ups.
 *
 * @returns the seam and its record
 */
function recordingOpener(): { readonly open: OpenSpawnEventStream; readonly record: OpenerRecord } {
  const record: OpenerRecord = { closes: 0, handlers: undefined, socketPath: undefined, subscription: undefined };
  const open: OpenSpawnEventStream = ({ subscription, handlers, socketPath }) => {
    record.subscription = subscription;
    record.handlers = handlers;
    record.socketPath = socketPath;
    return {
      close: () => {
        record.closes += 1;
      },
    };
  };
  return { open, record };
}

/**
 * One hook frame, distinct by its sequence number.
 *
 * @returns the event
 */
function hookEvent({ seq }: { seq: number }): CmuxEvent {
  return {
    agentSource: "claude",
    category: "agent",
    cwd: "/work/tree",
    id: `event-${String(seq)}`,
    name: "agent.hook.PreToolUse",
    occurredAtIso: "2026-10-13T00:00:00.000Z",
    phase: undefined,
    seq,
    sessionId: "claude-session",
    surfaceId: undefined,
    toolName: "Bash",
    workspaceId: "workspace:1",
  };
}

describe("openSpawnEventWitness", () => {
  it("subscribes to exactly the three witnessed hook names on the socket it was given", () => {
    const opener = recordingOpener();

    openSpawnEventWitness({ openEventStream: opener.open, socketPath: "/tmp/cmux-test.sock" });

    expect(opener.record.subscription).toEqual({
      names: ["agent.hook.SessionStart", "agent.hook.UserPromptSubmit", "agent.hook.PreToolUse"],
    });
    expect(opener.record.socketPath).toBe("/tmp/cmux-test.sock");
  });

  it("forwards no socket path when none was named, leaving the opener to resolve the live one", () => {
    const opener = recordingOpener();

    openSpawnEventWitness({ openEventStream: opener.open });

    expect(opener.record.socketPath).toBe(undefined);
  });

  it("exposes the delivered events oldest first", () => {
    const opener = recordingOpener();
    const witness = openSpawnEventWitness({ openEventStream: opener.open });

    opener.record.handlers!.onEvent({ event: hookEvent({ seq: 7 }) });
    opener.record.handlers!.onEvent({ event: hookEvent({ seq: 3 }) });

    expect(witness.observedEvents().map((event) => event.seq)).toEqual([7, 3]);
  });

  it("keeps only the newest 512 events once a 513th arrives", () => {
    const opener = recordingOpener();
    const witness = openSpawnEventWitness({ openEventStream: opener.open });

    for (let seq = 1; seq <= 513; seq += 1) {
      opener.record.handlers!.onEvent({ event: hookEvent({ seq }) });
    }

    const seqs = witness.observedEvents().map((event) => event.seq);
    expect(seqs.length).toBe(512);
    expect(seqs[0]).toBe(2);
    expect(seqs[511]).toBe(513);
  });

  it("hangs up the stream it opened when closed", () => {
    const opener = recordingOpener();
    const witness = openSpawnEventWitness({ openEventStream: opener.open });

    witness.close();

    expect(opener.record.closes).toBe(1);
  });

  it("degrades to an empty witness whose close is safe when subscribing throws", () => {
    const throwing: OpenSpawnEventStream = () => {
      throw new Error("no socket at that path");
    };

    const witness = openSpawnEventWitness({ openEventStream: throwing });
    witness.close();

    expect(witness.observedEvents()).toEqual([]);
  });
});
