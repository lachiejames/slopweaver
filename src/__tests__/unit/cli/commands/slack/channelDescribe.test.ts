import { describe, expect, it } from "vitest";

import type { ChannelCreatePlan } from "../../../../../cli/commands/slack/channelCore.js";
import {
  type ChannelDescribeDeps,
  createdChannelLine,
  describeChannel,
} from "../../../../../cli/commands/slack/channelDescribe.js";

const PLAN: ChannelCreatePlan = {
  actor: "bot",
  duplicateKey: "planned-name",
  inviteUserIds: [],
  isPrivate: false,
  name: "planned-name",
  purpose: "why it exists",
  topic: "what it is about",
};

describe("createdChannelLine", () => {
  it("names the channel Slack settled on", () => {
    const created = { alreadyExisted: false, id: "C0NEW", name: "slack-name" };
    expect(createdChannelLine({ created, plan: PLAN })).toBe("created channel #slack-name (C0NEW)");
  });

  it("names the planned channel when Slack's answer carried no name, and says private when it is", () => {
    const created = { alreadyExisted: false, id: "C0NEW", name: undefined };
    expect(createdChannelLine({ created, plan: { ...PLAN, isPrivate: true } })).toBe(
      "created private channel #planned-name (C0NEW)",
    );
  });
});

describe("describeChannel", () => {
  const created = { alreadyExisted: false, id: "C0NEW", name: "planned-name" };

  it("reports what Slack stored, and what was sent when Slack echoed nothing back", async () => {
    const lines: string[] = [];
    const deps: ChannelDescribeDeps = {
      emit: (line) => lines.push(line),
      setPurpose: async () => "why it exists, as stored",
      setTopic: async () => undefined,
    };
    const failed = await describeChannel({
      created,
      deps,
      home: "/nonexistent/fixture-home",
      plan: PLAN,
      token: "xoxb-test",
    });
    expect(failed).toBe(false);
    expect(lines).toEqual(['purpose: "why it exists, as stored"', 'topic: "what it is about"']);
  });

  it("still sets the topic when the purpose fails, and reports the partial failure", async () => {
    const lines: string[] = [];
    const deps: ChannelDescribeDeps = {
      emit: (line) => lines.push(line),
      setPurpose: () => Promise.reject(new Error("missing_scope")),
      setTopic: async () => "what it is about",
    };
    const failed = await describeChannel({
      created,
      deps,
      home: "/nonexistent/fixture-home",
      plan: PLAN,
      token: "xoxb-test",
    });
    expect(failed).toBe(true);
    expect(lines).toEqual(['topic: "what it is about"']);
  });

  it("touches neither endpoint when the plan names no purpose and no topic", async () => {
    const lines: string[] = [];
    const deps: ChannelDescribeDeps = {
      emit: (line) => lines.push(line),
      setPurpose: () => Promise.reject(new Error("never called")),
      setTopic: () => Promise.reject(new Error("never called")),
    };
    const failed = await describeChannel({
      created,
      deps,
      home: "/nonexistent/fixture-home",
      plan: { ...PLAN, purpose: undefined, topic: undefined },
      token: "xoxb-test",
    });
    expect(failed).toBe(false);
    expect(lines).toEqual([]);
  });
});
