/*
 * `recordExactVoicePainPoints`: an exact voice rule finding is written as an actionable pain point naming the rule,
 * without copying the attempted message.
 */
import { describe, expect, it } from "vitest";

import { parsePainPoints, readPainPointsText, recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { freshHome, useFreshHomes } from "../cli/commands/slack/wiring/harness.js";

useFreshHomes();

describe("recordExactVoicePainPoints", () => {
  it("writes actionable rule guidance without copying the attempted message", () => {
    const home = freshHome({ prefix: "drip-pain-" });
    recordExactVoicePainPoints({
      findings: [{ path: "messages[0].runs[0].text", rule: { kind: "phrase", value: "blocked phrase" } }],
      home,
      lane: "as-me",
      tsIso: "2026-08-14T00:00:00.000Z",
    });

    expect(parsePainPoints({ text: readPainPointsText({ home }) })).toEqual([
      {
        fieldPath: "messages[0].runs[0].text",
        kind: "voice",
        lane: "as-me",
        reason: 'authored prose matches the configured phrase voice rule "blocked phrase"',
        tsIso: "2026-08-14T00:00:00.000Z",
      },
    ]);
  });
});
