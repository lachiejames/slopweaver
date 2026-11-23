/**
 * The prose a hand step's poster wrote, as words: the tokens, the code span, the placeholder and which fields a
 * monitor card leaves unread.
 */
import { describe, expect, it } from "vitest";

import { isPlaceholder, opensCodeSpan, posterProse, proseTokens, proseWords } from "../../../hand/proseFields.js";
import { buildHandStep, type HandStep, type HandStepDraft, MONITOR_WITNESS } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A step built by the real builder, every prose field set. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "prose-fields-case",
        postedBy: "workspace:1",
        postedIso: "2026-10-02T06:55:34.641Z",
        unblocks: "the pull request's own title",
        url: "https://example.com/the-page",
        what: "Pick a code owner on the pull request",
        where: "the pull request's page",
        witness: "slopweaver hand done prose-fields-case --did picked",
        ...over,
      },
    }),
  );
}

describe("proseWords", () => {
  it("strips quotes, backticks, brackets and a closing stop, keeping case", () => {
    expect(proseWords({ text: "Run `slopweaver secrets set x`, then (Claude) login." })).toEqual([
      "Run",
      "slopweaver",
      "secrets",
      "set",
      "x",
      "then",
      "Claude",
      "login",
    ]);
  });

  it("answers no words for blank text", () => {
    expect(proseWords({ text: "   " })).toEqual([]);
  });
});

describe("opensCodeSpan and isPlaceholder", () => {
  it.each([
    ["`op", true, false],
    ["(`sudo", true, false],
    ["op", false, false],
    ["<name>", false, true],
    ["`<name>`", false, true],
    ["`sudo`", false, false],
    ["`op`,", false, false],
    ["name>", false, false],
  ])("reads %s", (raw, spanned, placeholder) => {
    const [token] = proseTokens({ text: raw });
    expect(opensCodeSpan({ token: token! })).toBe(spanned);
    expect(isPlaceholder({ token: token! })).toBe(placeholder);
  });
});

describe("posterProse", () => {
  it("reads what, where and unblocks off a step a poster wrote", () => {
    expect(posterProse({ step: step() }).map(({ field }) => field)).toEqual(["what", "where", "unblocks"]);
  });

  it("leaves a field the step does not carry", () => {
    expect(posterProse({ step: step({ where: undefined }) }).map(({ field }) => field)).toEqual(["what", "unblocks"]);
  });

  it("skips a monitor card's unblocks, built from a subject's label", () => {
    const card = step({ witness: MONITOR_WITNESS });
    expect(posterProse({ step: card })).toEqual([
      { field: "what", text: "Pick a code owner on the pull request" },
      { field: "where", text: "the pull request's page" },
    ]);
  });
});
