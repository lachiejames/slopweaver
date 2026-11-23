/*
 * The screenshot count on an answer: rule two's FLOOR stays, and there is no ceiling. The owner
 * ruled that no hard size limit applies: sometimes more pictures make sense and sometimes fewer, so the
 * composer judges. The ceiling this file used to bind was two, and it was the
 * count an integration test had proven, never a reader-load judgement.
 *
 * What it holds down is the door quietly regaining a count cap. Both ends are driven through the real
 * `answerImagesSchema` rather than a constant, because what a composer can actually send is the parser's
 * answer. Eleven is the live case — the ISO answer naming eleven controls sends the eleven captures it names,
 * and `integration/slackAssistantWrite.test.ts` holds Slack storing eleven on one answer message.
 */
import { describe, expect, it } from "vitest";

import { answerImagesSchema } from "../../../../outbound/assistant/answerArm.js";
import { SHOWN_ITEMS_MIN_REFS } from "../../../../outbound/assistant/citedAndShown.js";

/** `n` distinct image paths, the shape an answer's `images` carries. */
function shots({ count }: { count: number }): readonly string[] {
  return Array.from({ length: count }, (_, i) => `/tmp/shot-${String(i)}.png`);
}

describe("the screenshot count on an answer", () => {
  it("keeps rule two's floor at three distinct references", () => {
    expect(SHOWN_ITEMS_MIN_REFS).toBe(3);
  });

  it("leaves rule two satisfiable: the ONE screenshot it owes parses", () => {
    expect(answerImagesSchema.safeParse(shots({ count: 1 })).success).toBe(true);
  });

  it("never refuses on count: three, the eleven the ISO answer names, and forty all parse", () => {
    expect(answerImagesSchema.safeParse(shots({ count: 3 })).success).toBe(true);
    expect(answerImagesSchema.safeParse(shots({ count: 11 })).success).toBe(true);
    expect(answerImagesSchema.safeParse(shots({ count: 40 })).success).toBe(true);
  });

  it("still refuses an empty path, the one shape rule the field carries", () => {
    expect(answerImagesSchema.safeParse(["/tmp/a.png", ""]).success).toBe(false);
  });
});
