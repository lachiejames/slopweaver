/**
 * Both pass prompts tell Codex it cannot open a window (`codex/prompt.ts` `NO_DESKTOP_APP_LINE`): a review pass that
 * ran a stock Electron put two crash alerts in front of the owner mid-call.
 */
import { describe, expect, it } from "vitest";

import { passProfile } from "../../../codex/profiles.js";
import { buildPlanPrompt, buildReviewPrompt, NO_DESKTOP_APP_LINE } from "../../../codex/prompt.js";

describe("NO_DESKTOP_APP_LINE", () => {
  it("names Electron, a browser and open, and says why", () => {
    expect(NO_DESKTOP_APP_LINE).toBe(
      "This pass runs on the owner's Mac inside a sandbox that cannot open a window. Never launch a desktop app " +
        "(including Electron, a browser, or `open`): it aborts and puts a crash alert in front of the owner. Reason from " +
        "source and documentation instead.",
    );
  });
});

// The line sits straight after the pass's own title and purpose, ahead of every word of task: a review property
// reading "launch Electron to test this" once came BEFORE it.
describe("the pass prompts", () => {
  it("a plan prompt carries the line straight after its purpose, before its task", () => {
    const lines = buildPlanPrompt({
      profile: passProfile({ pass: "p2" }),
      repoRoot: "/repo",
      task: "plan the thing",
    }).split("\n");

    expect(lines.indexOf(NO_DESKTOP_APP_LINE)).toBe(4);
    expect(lines[2]).toBe(`PURPOSE: ${passProfile({ pass: "p2" }).purpose}`);
    expect(lines.indexOf("plan the thing")).toBeGreaterThan(4);
  });

  it("a review prompt carries the line straight after its purpose, before the property it attacks", () => {
    const lines = buildReviewPrompt({
      diffBytes: 10,
      diffPath: "/scratch/review-packet.md",
      diffSha256: "abc",
      profile: passProfile({ pass: "r1" }),
      property: { id: "r1-01", statement: "Launch Electron to test this property" },
      repoRoot: "/repo",
    }).split("\n");

    expect(lines.indexOf(NO_DESKTOP_APP_LINE)).toBe(4);
    expect(lines[2]).toBe(`PURPOSE: ${passProfile({ pass: "r1" }).purpose}`);
    expect(lines.indexOf("Attack ONE property. Ignore everything else.")).toBe(6);
    expect(lines.indexOf("PROPERTY ID: r1-01")).toBe(8);
    expect(lines.indexOf("PROPERTY: Launch Electron to test this property")).toBe(9);
  });
});
