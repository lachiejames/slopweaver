import { describe, expect, it } from "vitest";

import { armCommandLine, listenerArgs } from "../../../../../live/listen/supervise/arm.js";

describe("listenerArgs", () => {
  it("carries the heartbeat, the channel scope, the thread-reply channels, the queue and the home, in that order", () => {
    expect(
      listenerArgs({
        armId: "arm-7",
        home: "/tmp/home",
        queuePath: "/tmp/queue.jsonl",
        scope: { channels: ["C111", "C222"], kind: "channels" },
        threadReplyChannels: ["C111", "C333"],
      }),
    ).toEqual([
      "listen",
      "--follow",
      "--heartbeat",
      "arm-7",
      "--channels",
      "C111,C222",
      "--thread-replies",
      "C111,C333",
      "--queue",
      "/tmp/queue.jsonl",
      "--home",
      "/tmp/home",
    ]);
  });

  it("is listen, --follow and the heartbeat for an unscoped arm with no queue, home or thread-reply channel", () => {
    expect(
      listenerArgs({
        armId: "arm-7",
        home: undefined,
        queuePath: undefined,
        scope: { kind: "all" },
        threadReplyChannels: [],
      }),
    ).toEqual(["listen", "--follow", "--heartbeat", "arm-7"]);
  });

  it("carries a DM-only scope as --dm-only after the listen, --follow and heartbeat arguments", () => {
    expect(
      listenerArgs({
        armId: "arm-7",
        home: undefined,
        queuePath: undefined,
        scope: { kind: "dm-only" },
        threadReplyChannels: [],
      }),
    ).toEqual(["listen", "--follow", "--heartbeat", "arm-7", "--dm-only"]);
  });
});

describe("armCommandLine", () => {
  const ARM = {
    args: ["listen", "--follow", "--heartbeat", "arm-7"],
    command: "slopweaver",
    logPath: "/tmp/arms/arm-7/listener.log",
    mentionsPath: "/tmp/arms/arm-7/mentions.jsonl",
  };

  it("emits the bare invocation in the foreground", () => {
    expect(armCommandLine({ ...ARM, background: false })).toBe("slopweaver listen --follow --heartbeat arm-7");
  });

  it("backgrounds with a bare &, stdout and stderr to two separate files, after creating the log directory", () => {
    expect(armCommandLine({ ...ARM, background: true })).toBe(
      "mkdir -p /tmp/arms/arm-7 && slopweaver listen --follow --heartbeat arm-7 >> /tmp/arms/arm-7/mentions.jsonl 2> /tmp/arms/arm-7/listener.log &",
    );
  });
});
