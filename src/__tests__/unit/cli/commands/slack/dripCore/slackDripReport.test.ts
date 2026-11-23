/*
 * `slackDripReport`: discriminated as the drip lane with the exact payloads, a dry run told apart from a run where
 * nothing landed, the media carried both whole and per message, and one parseable document.
 */
import { describe, expect, it } from "vitest";

import { buildSlackDripPlan, slackDripReport } from "../../../../../../cli/commands/slack/dripCore.js";
import { dripArtifact, NO_MENTIONS, options, RESOLUTION } from "./harness.js";

describe("slackDripReport", () => {
  const plan = buildSlackDripPlan({
    artifact: dripArtifact({ texts: ["one", "two"] }),
    intervalMs: 1500,
    mentions: NO_MENTIONS,
    options: options({ texts: ["one", "two"] }),
  });

  it("is discriminated as the drip lane, and carries the exact payloads", () => {
    const report = slackDripReport({
      mentions: RESOLUTION,
      options: options({ texts: ["one", "two"] }),
      outcomes: null,
      plan,
      refusal: null,
    });

    expect(report.lane).toBe("drip");
    expect(report.messages.map((message) => message.payload)).toEqual(plan.messages.map((m) => m.payload));
    expect(report.intervalMs).toBe(1500);
  });

  it("distinguishes a dry run (null outcomes) from a run where nothing landed", () => {
    const dry = slackDripReport({
      mentions: RESOLUTION,
      options: options({ texts: ["one"] }),
      outcomes: null,
      plan,
      refusal: null,
    });
    const failed = slackDripReport({
      mentions: RESOLUTION,
      options: options({ texts: ["one"] }),
      outcomes: [{ error: "x", index: 0, state: "failed" }],
      plan,
      refusal: null,
    });

    expect(dry.outcomes).toBe(null);
    expect(failed.outcomes).toEqual([{ error: "x", index: 0, state: "failed" }]);
  });

  it("carries the media, both as the whole drip's list and on the message that holds it", () => {
    const withMedia = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["one", "two"] }),
      intervalMs: 1500,
      mentions: NO_MENTIONS,
      options: options({ media: ["shot.png"], texts: ["one", "two"] }),
    });

    const report = slackDripReport({
      mentions: RESOLUTION,
      options: options({ media: ["shot.png"], texts: ["one", "two"] }),
      outcomes: null,
      plan: withMedia,
      refusal: null,
    });

    expect(report.media).toEqual(["shot.png"]);
    expect(report.messages.map((message) => message.media)).toEqual([[], ["shot.png"]]);
  });

  it("serialises to one parseable document", () => {
    const report = slackDripReport({
      mentions: RESOLUTION,
      options: options({ texts: ["one"] }),
      outcomes: null,
      plan,
      refusal: null,
    });

    expect(JSON.parse(JSON.stringify(report)).lane).toBe("drip");
  });
});
