/**
 * Clamping card text without splitting a person tag — `live/turn/taskLabel.ts`'s `tagSafeCut`, and the two
 * clamps that use it. A split tag is a fragment `./cardNames.ts` cannot name.
 */
import { describe, expect, it } from "vitest";

import { dispatchedCardFrame, firstCardFrame } from "../../../../live/listen/capture.js";
import { CLAMP_MARKER, clampVisible } from "../../../../live/turn/answer.js";
import { tagSafeCut, turnTaskLabel } from "../../../../live/turn/taskLabel.js";
import { scanRawMarkup } from "../../../../outbound/artifact/typedRuns.js";
import type { TodoStep } from "../../../../outbound/assistant/todoBlock.js";
import { renderTurnMessage } from "../../../../outbound/assistant/turnMessage.js";
import { typedRunsOnlyViolations } from "../../../../outbound/slack/typedRunsOnly.js";
import type { TurnChrome } from "../../../../outbound/slack/types.js";

describe("tagSafeCut", () => {
  it("moves a cut that lands inside a normalised tag back to the tag's start", () => {
    expect(tagSafeCut({ at: 8, text: "ask @(U0SYN000003) now" })).toBe(4);
  });

  it("moves a cut that lands inside a bare tag back to the tag's start", () => {
    expect(tagSafeCut({ at: 8, text: "ask @U0SYN000003 now" })).toBe(4);
  });

  it("leaves a cut on a tag's own edges, or in text that tags nobody, where it was", () => {
    expect(tagSafeCut({ at: 4, text: "ask @(U0SYN000003) now" })).toBe(4);
    expect(tagSafeCut({ at: 18, text: "ask @(U0SYN000003) now" })).toBe(18);
    expect(tagSafeCut({ at: 3, text: "nobody here" })).toBe(3);
  });
});

describe("turnTaskLabel", () => {
  it("drops a tag the 48-character clamp would split, rather than leaving `@(U0SY…`", () => {
    const question = `@(U0SYN000005) add these two to the list, and answer @(U0SYN000003)'s question`;
    expect(turnTaskLabel({ question })).toBe("answering: add these two to the list, and answer …");
  });

  it("keeps a head that fits whole, tag included", () => {
    expect(turnTaskLabel({ question: "@(U0SYN000005) ask @(U0SYN000003)" })).toBe("answering: ask @(U0SYN000003)");
  });
});

describe("clampVisible over a person tag", () => {
  it("cuts before a tag the cap would split, and still marks the clamp", () => {
    expect(clampVisible({ cap: 12, text: "ask @(U0SYN000003) about it" })).toBe(`ask ${CLAMP_MARKER}`);
  });
});

/**
 * A question opening with a long Slack link — the ask `C0SYN000001`/`1790222247.843029` measured,
 * whose label clamped to `• close <https://linear.app/acme/issue/HELP-…` and was refused on the wire.
 */
const LONG_LINK_QUESTION =
  "@(U0SYN000005) • close <https://linear.app/acme/issue/HELP-2878/vanta-remediate-cloudflare-ip-access-rules-enabled-for-no-active|HELP-2878> • the Acme audit needs files to upload properly inside of Vanta";

const CHROME: TurnChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "test_turn_v1",
};

/** The wire guard's verdict on a card carrying `frame`, rendered exactly as the checklist post renders it. */
function wireViolations({ frame }: { frame: { steps: readonly TodoStep[]; task: string } }): readonly string[] {
  const payload = renderTurnMessage({
    asOfEpochSeconds: 1790222248,
    asOfFallback: "just now",
    chrome: CHROME,
    modelId: "claude",
    steps: frame.steps,
    task: frame.task,
    turnId: "turn-1",
  });
  return typedRunsOnlyViolations({ payload });
}

describe("turnTaskLabel over a question opening with a long Slack link", () => {
  it("rewrites the link to its own label before clamping, so no URL is cut", () => {
    expect(turnTaskLabel({ question: LONG_LINK_QUESTION })).toBe(
      "answering: • close HELP-2878 • the Acme audit needs files …",
    );
  });

  it("drops the scheme of an unlabelled link, so the clamp leaves no URL behind", () => {
    const question = "@(U0SYN000005) <https://linear.app/acme/issue/HELP-2878/vanta-remediate-cloudflare> close it";
    expect(turnTaskLabel({ question })).toBe("answering: linear.app/acme/issue/HELP-2878/vanta-remediate…");
  });

  it("drops the scheme of a bare URL too", () => {
    const question = "https://linear.app/acme/issue/HELP-2878/vanta-remediate-cloudflare close it";
    expect(turnTaskLabel({ question })).toBe("answering: linear.app/acme/issue/HELP-2878/vanta-remediate…");
  });

  it("rewrites a link whose own label is a URL, rather than leaving that URL in the label", () => {
    expect(turnTaskLabel({ question: "<https://a.test|https://b.test>" })).toBe("answering: b.test");
  });

  it("rewrites a URL the clamp exposed from inside an unrecognised angle form", () => {
    const question = "<x https://example.com/abcdefghijklmnopqrstuvwxyz0123456789>";
    expect(turnTaskLabel({ question })).toBe("answering: <x example.com/abcdefghijklmnopqrstuvwx…");
  });

  it("rewrites a token that only parses as a URL once the clamp truncated it", () => {
    const question = `mailto://example.com${"a".repeat(27)}\\x`;
    expect(scanRawMarkup({ text: question })).toEqual([]);
    expect(scanRawMarkup({ text: turnTaskLabel({ question }) })).toEqual([]);
  });

  it("puts the capture-time checklist on the wire, where the clamped raw link was refused", () => {
    expect(wireViolations({ frame: firstCardFrame({ question: LONG_LINK_QUESTION }) })).toEqual([]);
  });

  it("puts the dispatch card on the wire too", () => {
    expect(wireViolations({ frame: dispatchedCardFrame({ question: LONG_LINK_QUESTION, timeline: [] }) })).toEqual([]);
  });

  it("is the label, not the steps, the guard refused before the rewrite", () => {
    const frame = firstCardFrame({ question: LONG_LINK_QUESTION });
    const unrewritten = `answering: ${"• close <https://linear.app/acme/issue/HELP-2878/x|HELP-2878>".slice(0, 47)}…`;
    expect(wireViolations({ frame: { ...frame, task: unrewritten } })).toHaveLength(1);
  });
});
