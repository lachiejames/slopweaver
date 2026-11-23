/**
 * The review-ask shape gate, held down by the ask it was written for: the re-cut to Sadie for
 * an acme/acme-admin pull request (draft `sd-d7c6c283`), copied from the draft register as it was parked —
 * a one-bullet list, opening on the ask, calling a comment-only change a review. Beside it, the shape the owner
 * described: context first, one sentence, a tick.
 */
import { describe, expect, it } from "vitest";

import type { AsMeArtifact, DripInlineRun } from "../../../../outbound/artifact/types.js";
import { isDirectReviewAsk, reviewAskShapeRefusal } from "../../../../outbound/slack/reviewAskShape.js";

/** Sadie's member id, the DM the ask was parked for. */
const SADIE = "U0SYN000008";

const PR_URL = "https://github.com/acme/acme-admin/pull/17945";

const PR: DripInlineRun = {
  label: "test(ABC-1): say why the nightly export task is still seeded #17945",
  type: "link",
  url: PR_URL,
};

/** The form `sd-d7c6c283` parked, verbatim. */
const SADIE_ASK: AsMeArtifact = {
  bullets: [[PR, { text: ", a comment-only change, acme-eng only", type: "text" }]],
  kind: "one-list",
  lead: [{ text: "hey, could I grab a review on this one when you get a sec? no rush", type: "text" }],
  trailing: [[{ text: "CI and coderabbit are green", type: "text" }]],
};

/** The shape the owner described: the work first, then the pull request, asking for a tick. */
const HIS_SHAPE: AsMeArtifact = {
  kind: "one-card",
  lines: [
    {
      runs: [
        {
          text: "hey, a suggestion on the nightly export work only came in after its PR merged",
          type: "text",
        },
      ],
    },
    {
      runs: [
        { text: "so I'm raising it as a follow-up in ", type: "text" },
        PR,
        { text: ", just fixing up some inaccurate comments, looking for a tick, not a review", type: "text" },
      ],
    },
  ],
};

describe("isDirectReviewAsk", () => {
  it("reads Sadie's ask as a DM review ask", () => {
    expect(isDirectReviewAsk({ artifact: SADIE_ASK, channel: SADIE })).toBe(true);
  });

  it("reads the same words in a channel as no DM review ask, so a roster post is left alone", () => {
    expect(isDirectReviewAsk({ artifact: SADIE_ASK, channel: "C0SYN000006" })).toBe(false);
  });

  it("never reads 'review' out of a pull request's own title", () => {
    const titled: AsMeArtifact = {
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "heads up, this merged: ", type: "text" },
            { label: "review the seeded task", type: "link", url: PR_URL },
          ],
        },
      ],
    };

    expect(isDirectReviewAsk({ artifact: titled, channel: SADIE })).toBe(false);
  });

  it("reads a thank-you for a review, or a review the owner left, as no review ask", () => {
    const said = ({ text }: { text: string }): AsMeArtifact => ({
      kind: "drip",
      messages: [{ runs: [{ text, type: "text" }, PR] }],
    });

    expect(isDirectReviewAsk({ artifact: said({ text: "thanks heaps for the review on " }), channel: SADIE })).toBe(
      false,
    );
    expect(isDirectReviewAsk({ artifact: said({ text: "I left a review on " }), channel: SADIE })).toBe(false);
    expect(isDirectReviewAsk({ artifact: said({ text: "pls review " }), channel: SADIE })).toBe(true);
  });

  it("reads a question about a review, or an offer to give one, as no review ask", () => {
    const said = ({ text }: { text: string }): AsMeArtifact => ({
      kind: "drip",
      messages: [{ runs: [{ text, type: "text" }, PR] }],
    });

    expect(isDirectReviewAsk({ artifact: said({ text: "did you get a review on " }), channel: SADIE })).toBe(false);
    expect(isDirectReviewAsk({ artifact: said({ text: "happy to review it again, " }), channel: SADIE })).toBe(false);
    expect(isDirectReviewAsk({ artifact: said({ text: "could I get your review on " }), channel: SADIE })).toBe(true);
    expect(isDirectReviewAsk({ artifact: said({ text: "keen for a quick tick on " }), channel: SADIE })).toBe(true);
    expect(isDirectReviewAsk({ artifact: said({ text: "can you ticket this up from " }), channel: SADIE })).toBe(false);
  });

  it("reads a DM asking for a review with no pull request link as no review ask", () => {
    const unlinked: AsMeArtifact = {
      kind: "drip",
      messages: [{ runs: [{ text: "could I grab a review on the doc?", type: "text" }] }],
    };

    expect(isDirectReviewAsk({ artifact: unlinked, channel: SADIE })).toBe(false);
  });
});

describe("reviewAskShapeRefusal", () => {
  it("refuses Sadie's ask on all three shapes when the reviewer is declared new", () => {
    const lines = reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: SADIE, enabled: true, reviewer: "new" });

    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("a list of ONE dot point");
    expect(lines[1]).toContain("asks for a TICK, not a review");
    expect(lines[2]).toContain("opens on the ask");
  });

  it("passes the shape the owner described for a reviewer new to the conversation", () => {
    expect(reviewAskShapeRefusal({ artifact: HIS_SHAPE, channel: SADIE, enabled: true, reviewer: "new" })).toEqual([]);
  });

  it("lets an in-thread reviewer's ask open on the ask", () => {
    const bare: AsMeArtifact = {
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "hey, could I grab a review on ", type: "text" },
            PR,
            { text: " when you get a sec?", type: "text" },
          ],
        },
      ],
    };

    expect(reviewAskShapeRefusal({ artifact: bare, channel: SADIE, enabled: true, reviewer: "in-thread" })).toEqual([]);
    expect(reviewAskShapeRefusal({ artifact: bare, channel: SADIE, enabled: true, reviewer: "new" }).length).toBe(1);
  });

  it("refuses an undeclared recording by naming the flag, and the voice hatch does not lift that", () => {
    const lines = reviewAskShapeRefusal({
      artifact: HIS_SHAPE,
      channel: SADIE,
      enabled: false,
      reviewer: "undeclared",
    });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("`--reviewer in-thread` or `--reviewer new`");
  });

  it("passes a message declared not-an-ask, the honest way past a false read", () => {
    expect(
      reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: SADIE, enabled: true, reviewer: "not-an-ask" }),
    ).toEqual([]);
  });

  it("lifts the three shape rules when the voice hatch is open", () => {
    expect(reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: SADIE, enabled: false, reviewer: "new" })).toEqual([]);
  });

  it("never refuses a release of bytes the owner already approved, even the ask it was written for", () => {
    expect(reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: SADIE, enabled: true, reviewer: "approved" })).toEqual(
      [],
    );
  });

  it("still holds a direct post to the one-bullet and tick rules, owing no declaration", () => {
    const lines = reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: SADIE, enabled: true, reviewer: undefined });

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("a list of ONE dot point");
    expect(lines[1]).toContain("asks for a TICK, not a review");
  });

  it("leaves a one-bullet roster in a channel alone", () => {
    expect(
      reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: "C0SYN000006", enabled: true, reviewer: "undeclared" }),
    ).toEqual([]);
  });

  it("names the journalled hatch on every shape refusal", () => {
    const lines = reviewAskShapeRefusal({ artifact: SADIE_ASK, channel: SADIE, enabled: true, reviewer: "new" });

    expect(lines.length).toBe(3);
    expect(
      lines.filter(
        (line) =>
          !line.includes('slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>"'),
      ),
    ).toEqual([]);
  });
});
