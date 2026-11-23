/** cmux's event-stream frames, parsed — the ack, the events, and the frames that are neither. */
import { describe, expect, it } from "vitest";

import { normaliseCmuxSessionId, parseAckFrame, parseEventFrame } from "../../../cmux/events.js";

const ACK = JSON.stringify({
  boot_id: "B1",
  filters: { categories: [], names: [] },
  heartbeat_interval_seconds: 15,
  protocol: "cmux-events",
  replay_count: 84,
  resume: { after_seq: 78100, gap: false, latest_seq: 82175, next_seq: 82176, oldest_seq: 78080 },
  subscription_id: "S1",
  type: "ack",
  version: 1,
});

const EVENT = JSON.stringify({
  boot_id: "B1",
  category: "agent",
  id: "B1-78163",
  name: "agent.hook.Stop",
  occurred_at: "2026-08-22T13:23:01.906Z",
  payload: {
    _source: "claude",
    cwd: "/repo/worktrees/a",
    hook_event_name: "Stop",
    phase: "received",
    session_id: "claude-abc",
    tool_name: null,
  },
  seq: 78163,
  surface_id: null,
  type: "event",
  version: 1,
  workspace_id: "W-8D47",
});

/** A synthetic Claude Code session uuid. */
const UUID = "07f92f28-f7e7-4bbc-9845-c9b4ef51d520";

/**
 * A session id in cmux's feed form, both parts unpadded base64url as cmux sends them.
 *
 * @returns `cmux-feed-v1:<source>:<id>`, each part encoded
 */
function feedId({ source, id }: { source: string; id: string }): string {
  return `cmux-feed-v1:${Buffer.from(source).toString("base64url")}:${Buffer.from(id).toString("base64url")}`;
}

describe("normaliseCmuxSessionId", () => {
  it("unwraps the measured shape, a literal claude source and an unpadded uuid", () => {
    expect(
      normaliseCmuxSessionId({ raw: "cmux-feed-v1:Y2xhdWRl:MDdmOTJmMjgtZjdlNy00YmJjLTk4NDUtYzliNGVmNTFkNTIw" }),
    ).toBe(`claude-${UUID}`);
  });

  it("names a codex source's id with its own prefix", () => {
    expect(normaliseCmuxSessionId({ raw: feedId({ id: UUID, source: "codex" }) })).toBe(`codex-${UUID}`);
  });

  it("never prefixes an inner id that already carries its source", () => {
    expect(normaliseCmuxSessionId({ raw: feedId({ id: `claude-${UUID}`, source: "claude" }) })).toBe(`claude-${UUID}`);
  });

  it("reads padded standard base64 as well as unpadded base64url", () => {
    // "ab?" encodes to `YWI/` standard and `YWI_` url-safe; "a" pads to `YQ==`
    expect(normaliseCmuxSessionId({ raw: "cmux-feed-v1:YQ==:YWI/" })).toBe("a-ab?");
    expect(normaliseCmuxSessionId({ raw: "cmux-feed-v1:YQ:YWI_" })).toBe("a-ab?");
  });

  it("passes the older wire forms through unchanged", () => {
    expect(normaliseCmuxSessionId({ raw: `claude-${UUID}` })).toBe(`claude-${UUID}`);
    expect(normaliseCmuxSessionId({ raw: UUID })).toBe(UUID);
  });

  it.each([
    ["a missing id part", "cmux-feed-v1:Y2xhdWRl"],
    ["an extra part", "cmux-feed-v1:Y2xhdWRl:YQ:YQ"],
    ["an empty source", "cmux-feed-v1::YQ"],
    ["a character Node would silently drop", "cmux-feed-v1:Y2xhdWRl$:YQ"],
    ["padding inside a part", "cmux-feed-v1:Y2=xhdWRl:YQ"],
    ["padding a part that needs none", "cmux-feed-v1:Y2xhdWRl==:YQ"],
    ["a body one past a whole group", "cmux-feed-v1:Y2xhdWRlA:YQ"],
    ["trailing bits Node would round away", "cmux-feed-v1:Y2xhdWRl:YR"],
    ["bytes that are not UTF-8", "cmux-feed-v1:Y2xhdWRl:_w"],
  ])("keeps a feed id with %s exactly as sent", (_why, raw) => {
    expect(normaliseCmuxSessionId({ raw })).toBe(raw);
  });
});

describe("parseAckFrame", () => {
  it("reads the resume window out of the ack", () => {
    expect(parseAckFrame({ line: ACK })).toEqual({
      gap: false,
      latestSeq: 82175,
      nextSeq: 82176,
      oldestSeq: 78080,
      replayCount: 84,
      subscriptionId: "S1",
    });
  });

  it("reports the gap flag when the requested cursor had already aged out", () => {
    const line = JSON.stringify({ resume: { gap: true, oldest_seq: 99 }, subscription_id: "S", type: "ack" });

    expect(parseAckFrame({ line })!.gap).toBe(true);
  });

  it("is undefined for an event frame", () => {
    expect(parseAckFrame({ line: EVENT })).toBe(undefined);
  });
});

describe("parseEventFrame", () => {
  it("narrows the fields this repository actually uses", () => {
    expect(parseEventFrame({ line: EVENT })).toEqual({
      agentSource: "claude",
      category: "agent",
      cwd: "/repo/worktrees/a",
      id: "B1-78163",
      name: "agent.hook.Stop",
      occurredAtIso: "2026-08-22T13:23:01.906Z",
      phase: "received",
      seq: 78163,
      sessionId: "claude-abc",
      surfaceId: undefined,
      toolName: undefined,
      workspaceId: "W-8D47",
    });
  });

  it("unwraps cmux's feed-form session id into the claude-<uuid> every reader joins on", () => {
    const line = JSON.stringify({
      id: "e1",
      name: "agent.hook.Stop",
      payload: { _source: "claude", session_id: feedId({ id: UUID, source: "claude" }) },
      seq: 1,
      type: "event",
    });

    expect(parseEventFrame({ line })!.sessionId).toBe(`claude-${UUID}`);
  });

  it("falls back to the payload's own workspace id when the frame's top-level one is absent", () => {
    const line = JSON.stringify({
      id: "e1",
      name: "agent.hook.Stop",
      payload: { workspace_id: "W-from-payload" },
      seq: 1,
      type: "event",
    });

    expect(parseEventFrame({ line })!.workspaceId).toBe("W-from-payload");
  });

  it("is undefined for the ack", () => {
    expect(parseEventFrame({ line: ACK })).toBe(undefined);
  });

  it("is undefined for a frame with no sequence number to order it by", () => {
    expect(parseEventFrame({ line: JSON.stringify({ id: "e", name: "n", type: "event" }) })).toBe(undefined);
  });

  it("is undefined for a line that is not JSON at all", () => {
    expect(parseEventFrame({ line: "keepalive" })).toBe(undefined);
  });
});
