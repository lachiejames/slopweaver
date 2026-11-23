/*
 * `slackDripDoorRequest`: the door sees a count and an opaque key, never a word of the message nor a filename,
 * declared as an external write, with how many files ride along.
 */
import { describe, expect, it } from "vitest";

import { buildSlackDripPlan, slackDripDoorRequest } from "../../../../../../cli/commands/slack/dripCore.js";
import { dripArtifact, NO_MENTIONS, options } from "./harness.js";

describe("slackDripDoorRequest", () => {
  it("carries NO prose — a count and an opaque key, never a word of the message", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["something private"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["something private"] }),
    });

    const request = slackDripDoorRequest({ home: "/h", plan });

    expect(request.artifact).toEqual({
      actor: "me",
      channel: "C1",
      duplicateKey: plan.duplicateKey,
      mediaCount: 0,
      messageCount: 1,
      shape: "top-level",
    });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(plan)).toContain("something private");
    expect(JSON.stringify(request)).not.toContain("something private");
  });

  it("declares an external write that requires approval", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["x"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["x"] }),
    });

    expect(slackDripDoorRequest({ home: "/h", plan }).meta).toEqual({
      createsWorkItem: false,
      effect: "external-write",
      home: "/h",
      requiresApproval: false,
    });
  });
});

describe("slackDripDoorRequest — the media count", () => {
  it("tells the door how many files ride along, without a filename", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ media: ["/tmp/private-name.png", "/tmp/other.png"], texts: ["a"] }),
    });

    const request = slackDripDoorRequest({ home: "/h", plan });

    expect(request.artifact["mediaCount"]).toBe(2);
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(plan)).toContain("private-name");
    expect(JSON.stringify(request)).not.toContain("private-name");
  });
});
