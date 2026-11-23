/**
 * The inline-composition preflight `turn brief` prints: the six blocks an answer composed in the briefing
 * session needs, in the order a composer meets them, the pre-review checklist last. Each block's own content is
 * tested beside its own module; this is the witness that all six are still carried, in order, behind one call.
 */
import { describe, expect, it } from "vitest";

import { inventedVisualPreflightLines } from "../../../../admit/inventedVisual.js";
import { realArtifactPreflightLines } from "../../../../admit/realArtifact.js";
import { inlineCompositionPreflightLines } from "../../../../live/turn/briefGuidance.js";
import { firstDraftReviewLines } from "../../../../live/turn/reviewObligations.js";
import { userFacingImpactPreflightLines } from "../../../../live/turn/userFacingImpactGuidance.js";
import { visualEvidencePreflightLines } from "../../../../live/turn/visualEvidenceGuidance.js";
import { answerFormCapLines } from "../../../../outbound/assistant/capGuidance.js";

const QUESTION = "show me the staging dashboard panel for checkout latency";
const IMPACT_QUESTION = "what was the user-facing impact of the checkout errors";

describe("inlineCompositionPreflightLines", () => {
  it("is the cap, visual-evidence, user-facing impact, invented-visual and real-artifact blocks, in that order", () => {
    expect(inlineCompositionPreflightLines({ question: IMPACT_QUESTION })).toEqual([
      ...answerFormCapLines(),
      ...visualEvidencePreflightLines(),
      ...userFacingImpactPreflightLines({ question: IMPACT_QUESTION }),
      ...inventedVisualPreflightLines(),
      ...realArtifactPreflightLines({ question: IMPACT_QUESTION }),
      ...firstDraftReviewLines({ question: IMPACT_QUESTION }),
    ]);
  });

  it("drops the user-facing impact block for a question that is not about it", () => {
    expect(inlineCompositionPreflightLines({ question: QUESTION })).toEqual([
      ...answerFormCapLines(),
      ...visualEvidencePreflightLines(),
      ...inventedVisualPreflightLines(),
      ...realArtifactPreflightLines({ question: QUESTION }),
      ...firstDraftReviewLines({ question: QUESTION }),
    ]);
  });

  it("is never empty, whatever the question", () => {
    expect(inlineCompositionPreflightLines({ question: "" }).length).toBeGreaterThan(0);
  });
});
