import { describe, expect, it } from "vitest";

import { readPeerTraffic } from "../../../transcripts/peerTraffic.js";

const ORIGIN = {
  body: "240-4 messages 1 and 2 are sent",
  from: "uds:/tmp/cc-socks/71383.sock",
  kind: "peer",
  msg_id: "0210a013-bfe7-4bd3-8e4a-d86a4f7bf279",
  name: "policy-dm-renders-with-no-show-more-a-no-07",
};

const NOTHING = { inbound: undefined, results: [], sends: [] };

describe("readPeerTraffic", () => {
  it("reads a peer message delivered directly as a user line", () => {
    const line = JSON.stringify({
      message: { content: "Another Claude session sent a message:\n<cross-session-message>", role: "user" },
      origin: ORIGIN,
      timestamp: "2026-09-12T02:16:23.150Z",
      type: "user",
      uuid: "536c284f-632c-4b7e-8464-db39d74603c4",
    });

    expect(readPeerTraffic({ line, lineNumber: 946 })).toEqual({
      inbound: {
        body: "240-4 messages 1 and 2 are sent",
        delivery: "direct",
        lineNumber: 946,
        msgId: "0210a013-bfe7-4bd3-8e4a-d86a4f7bf279",
        senderName: "policy-dm-renders-with-no-show-more-a-no-07",
        timestamp: "2026-09-12T02:16:23.150Z",
        uuid: "536c284f-632c-4b7e-8464-db39d74603c4",
      },
      results: [],
      sends: [],
    });
  });

  it("reads a peer message queued mid-turn as a queued_command attachment", () => {
    const line = JSON.stringify({
      attachment: { commandMode: "prompt", origin: ORIGIN, prompt: "<cross-session-message>", type: "queued_command" },
      timestamp: "2026-09-12T00:56:42.768Z",
      type: "attachment",
      uuid: "57385673-e34d-49a3-840e-f4e79d38ad58",
    });

    const traffic = readPeerTraffic({ line, lineNumber: 152 });

    expect(traffic.inbound!.delivery).toBe("queued");
    expect(traffic.inbound!.uuid).toBe("57385673-e34d-49a3-840e-f4e79d38ad58");
    expect(traffic.inbound!.senderName).toBe("policy-dm-renders-with-no-show-more-a-no-07");
  });

  it("reads every SendMessage call with its id and its address whole, and ignores other tools", () => {
    const line = JSON.stringify({
      message: {
        content: [
          {
            id: "t1",
            input: { message: "hi", to: "fresh-supervisor-handoff-9239-8a [0fe911]" },
            name: "SendMessage",
            type: "tool_use",
          },
          { id: "t2", input: { command: "ls" }, name: "Bash", type: "tool_use" },
        ],
        role: "assistant",
      },
      timestamp: "2026-09-12T01:00:00.000Z",
      type: "assistant",
      uuid: "a-1",
    });

    expect(readPeerTraffic({ line, lineNumber: 3 })).toEqual({
      inbound: undefined,
      results: [],
      sends: [
        { timestamp: "2026-09-12T01:00:00.000Z", to: "fresh-supervisor-handoff-9239-8a [0fe911]", toolUseId: "t1" },
      ],
    });
  });

  it("reads a result's delivered msg_id joined to the call it answers, failed ones included", () => {
    const line = ({ success }: { success: boolean }): string =>
      JSON.stringify({
        message: { content: [{ content: "{}", tool_use_id: "t1", type: "tool_result" }], role: "user" },
        toolUseResult: { msg_id: "ab8b332e-a2c2-4de5-9ba0-b6a382f498a8", success },
        type: "user",
        uuid: "r-1",
      });

    expect(readPeerTraffic({ line: line({ success: true }), lineNumber: 4 }).results).toEqual([
      { msgId: "ab8b332e-a2c2-4de5-9ba0-b6a382f498a8", success: true, toolUseId: "t1" },
    ]);
    expect(readPeerTraffic({ line: line({ success: false }), lineNumber: 5 }).results).toEqual([
      { msgId: "ab8b332e-a2c2-4de5-9ba0-b6a382f498a8", success: false, toolUseId: "t1" },
    ]);
  });

  it("reads a successful result that named no delivered id, which the substring gate must still admit", () => {
    const line = JSON.stringify({
      message: { content: [{ content: "{}", tool_use_id: "t1", type: "tool_result" }], role: "user" },
      toolUseResult: { success: true },
      type: "user",
      uuid: "r-3",
    });

    expect(readPeerTraffic({ line, lineNumber: 7 }).results).toEqual([{ msgId: "", success: true, toolUseId: "t1" }]);
  });

  it("reads no result from a msg_id with no tool_result block to join it to", () => {
    const line = JSON.stringify({ toolUseResult: { msg_id: "m", success: true }, type: "user", uuid: "r-2" });

    expect(readPeerTraffic({ line, lineNumber: 6 })).toEqual(NOTHING);
  });

  it("refuses a peer origin with no msg_id, a non-peer origin, and a line that will not parse", () => {
    const noId = JSON.stringify({ origin: { ...ORIGIN, msg_id: "" }, type: "user", uuid: "u" });
    const human = JSON.stringify({ origin: { kind: "human" }, peer: "x", type: "user", uuid: "u" });

    expect(readPeerTraffic({ line: noId, lineNumber: 1 }).inbound).toBeUndefined();
    expect(readPeerTraffic({ line: human, lineNumber: 2 }).inbound).toBeUndefined();
    expect(readPeerTraffic({ line: '{"type":"user","origin":{"kind":"peer"', lineNumber: 3 })).toEqual(NOTHING);
  });
});
