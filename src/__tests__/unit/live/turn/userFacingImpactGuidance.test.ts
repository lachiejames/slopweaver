/** User-facing impact: the keyword table, the composer's pre-flight and the reviewer's clause. */
import { describe, expect, it } from "vitest";

import {
  reviewImageClauseLines,
  USER_FACING_IMPACT_KEYWORDS,
  userFacingImpactPreflightLines,
  userFacingImpactReviewLines,
} from "../../../../live/turn/userFacingImpactGuidance.js";
import { visualEvidenceReviewLines } from "../../../../live/turn/visualEvidenceGuidance.js";

/** An ask of the shape this rule exists for, naming user-facing impact once among other words. */
const IMPACT_ASK = "make the setup remember this, since the Acme team will ask for user-facing impact a lot";

const EXPECTED_PREFLIGHT = [
  "USER-FACING IMPACT — this ask is about what a CUSTOMER SAW, so lead with their screen:",
  "  1. The lead evidence is the customer app's own session replay, paused on the visible error UI and",
  "     photographed fullscreen with the replay timestamp in frame, plus a labelled link to that replay.",
  "  2. Find it copy-first: grep the client code for the error text the UI renders, search RUM actions and",
  "     views in the CUSTOMER app for that text, and open the replay at the matching action's own timestamp.",
  "     `browser open` the replay, `browser read` for the fullscreen control, `browser act --do click` to",
  "     press it (it photographs the result), then `browser image-record` before it goes in `images`.",
  "  3. Staff or internal-app replays, RUM error counts, log panels and graphs may corroborate BELOW the",
  "     customer frame. They never lead: none of them is what the customer saw.",
  "  4. If the failure was silent and no customer saw an error state, say so plainly. That IS the answer;",
  "     never substitute an internal screenshot for a customer one that does not exist.",
  "  5. Count people, not events: distinct sessions, or distinct customers where identity is proven.",
  "  Method and a worked example: skills/loop-bot/reference/user-facing-impact.md.",
];

const EXPECTED_REVIEW = [
  "## 1b-i. A user-facing impact ask is answered with the CUSTOMER's screen",
  "",
  "This question asks what a customer saw. When you open the attached images (section 1c), check whether at",
  "least one shows the customer app itself at the visible error state, normally a replay frame of their",
  "session. Staff or admin sessions, RUM counts, log panels and graphs corroborate; they do not show what the",
  "customer saw.",
  "",
  "If the answer claims visible customer impact and every attached image is an internal surface, record that",
  "as a `high`-impact `unsupported` claim and mark the verdict `broken`. An answer that says plainly the",
  "failure was silent to the customer owes no customer screenshot, and section 1b's ceiling still governs an",
  "answer with no images at all.",
  "",
];

describe("USER_FACING_IMPACT_KEYWORDS", () => {
  it("is the seven narrow phrases, in order", () => {
    expect(USER_FACING_IMPACT_KEYWORDS).toEqual([
      "user-facing",
      "user facing",
      "customer-facing",
      "customer impact",
      "user impact",
      "what did the user see",
      "what did users see",
    ]);
  });
});

describe("userFacingImpactPreflightLines", () => {
  it("prints the whole block for an impact ask", () => {
    expect(userFacingImpactPreflightLines({ question: IMPACT_ASK })).toEqual(EXPECTED_PREFLIGHT);
  });

  it.each(USER_FACING_IMPACT_KEYWORDS.map((keyword) => [keyword]))("prints the same block for %s", (keyword) => {
    expect(userFacingImpactPreflightLines({ question: `so ${keyword} here?` })).toEqual(EXPECTED_PREFLIGHT);
  });

  it("matches regardless of case", () => {
    expect(userFacingImpactPreflightLines({ question: "What was the Customer Impact of the outage" })).toEqual(
      EXPECTED_PREFLIGHT,
    );
  });

  it.each([
    ["only customer", "which customer reported the checkout bug"],
    ["only impact", "what is the impact of bumping zod"],
    ["only customer", "find the customer's last booking"],
    ["an internal impact ask", "what was the staff impact of the ops dashboard outage"],
    ["an unrelated ask", "what did we decide about retention"],
    ["a phrase that only starts a longer word", "what did users seem to prefer in the survey"],
    ["a phrase running into a non-ASCII letter", "what is the user impacté"],
    ["a long s that only case-folds to s", "what was the uſer impact of the outage"],
  ])("prints nothing for %s", (_label, question) => {
    expect(userFacingImpactPreflightLines({ question })).toEqual([]);
  });
});

describe("userFacingImpactReviewLines", () => {
  it("prints the whole clause for an impact ask", () => {
    expect(userFacingImpactReviewLines({ question: IMPACT_ASK })).toEqual(EXPECTED_REVIEW);
  });

  it("prints nothing for an unrelated ask", () => {
    expect(userFacingImpactReviewLines({ question: "what did we decide about retention" })).toEqual([]);
  });
});

describe("reviewImageClauseLines", () => {
  it("is 1b then the user-facing impact clause for an impact ask", () => {
    expect(reviewImageClauseLines({ question: IMPACT_ASK })).toEqual([
      ...visualEvidenceReviewLines(),
      ...EXPECTED_REVIEW,
    ]);
  });

  it("is 1b alone, unchanged, for any other ask", () => {
    expect(reviewImageClauseLines({ question: "what did we decide about retention" })).toEqual(
      visualEvidenceReviewLines(),
    );
  });
});
