/**
 * Shared reading-order fixtures: a MINIMAL body (every optional section off) and a FULL one (every optional
 * section on, graded gold), each composed from named parts so a test can switch one section at a time.
 */
import type {
  BeforeAfter,
  Claim,
  ClickThrough,
  Content,
  FailsOnMain,
  GoldAnchor,
  PrForm,
  ProofBlock,
  ProofItem,
  PrTarget,
  Review,
  RiskItem,
  StampedPrBody,
} from "../../../../../outbound/github/legacy/types.js";

/**
 * Plain-text content, the common case.
 *
 * @param text the words of the single text run
 * @returns one text run
 */
export function t({ text }: { text: string }): Content {
  return [{ kind: "text", text }];
}

/** The routing a whole form carries; the gold anchor's commit link points into `o/r`. */
export const TARGET: PrTarget = { base: "main", head: "reading-order", owner: "o", repo: "r" };

/** A checked P4 item: the minimal body's only risk. */
const P4_CHECKED: RiskItem = {
  check: { check: t({ text: "the golden bytes" }), kind: "checked" },
  impact: "low",
  likelihood: "low",
  priority: 4,
  reach: t({ text: "this test" }),
  worst: t({ text: "A badge reads wrong" }),
};

/** A checked P1 item. */
const P1_CHECKED: RiskItem = {
  check: { check: t({ text: "the round-trip test" }), kind: "checked" },
  impact: "high",
  likelihood: "low",
  priority: 1,
  reach: t({ text: "every reviewer" }),
  worst: t({ text: "A body parses into the wrong form" }),
};

/** An unchecked P3 item. */
export const P3_UNCHECKED: RiskItem = {
  check: { kind: "unchecked", why: t({ text: "no live body read" }) },
  impact: "low",
  likelihood: "medium",
  priority: 3,
  reach: t({ text: "old pull requests" }),
  worst: t({ text: "An old body is misread" }),
};

/** The minimal body: an unevidenced problem, no claims, no review, nothing optional. */
export const MINIMAL_BODY: StampedPrBody = {
  change: t({ text: "Render the body in reading order." }),
  claims: [],
  origin: [{ kind: "link", text: "DEVX-1", url: "https://linear.app/acme/issue/DEVX-1" }],
  problem: t({ text: "A reviewer meets the table before the risk." }),
  problemSeen: { kind: "unevidenced" },
  risk: { blastRadius: t({ text: "This test only." }), items: [P4_CHECKED], line: t({ text: "One fixture item." }) },
  whereToLook: [[{ kind: "code", text: "src/a.ts" }]],
  writtenOn: "2026-10-01",
};

/** A Before-and-after table whose fix evidence is a screenshot — gold's media. */
export const BEFORE_AFTER: BeforeAfter = {
  fix: {
    evidence: [
      {
        alt: "the badge row",
        kind: "image",
        url: "https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      },
    ],
    where: t({ text: "this branch" }),
  },
  problem: {
    evidence: [{ kind: "link", text: "the old body", url: "https://github.com/o/r/pull/1" }],
    where: t({ text: "pull request 1" }),
  },
};

/** A command that fails on the base and passes here — gold's other media. */
export const FAILS_ON_MAIN: FailsOnMain = { command: "yarn vitest run render.test.ts", mainSha: "f933abaa5" };

/** A click-through taken on the gold anchor's commit, its destination a screenshot. */
export const CLICK_THROUGH: ClickThrough = {
  commit: "9f3c1de",
  control: [
    { kind: "text", text: "the " },
    { kind: "strong", text: "Open" },
    { kind: "text", text: " button" },
  ],
  destination: [
    { kind: "text", text: "the pull request page " },
    {
      alt: "the opened page",
      kind: "image",
      url: "https://github.com/user-attachments/assets/1c7b2d3f-4e5a-4b6c-9d7e-8f9a0b1c2d3e",
    },
  ],
};

/** One proven claim. */
export const PROVEN: Claim = {
  claim: t({ text: "The body parses back." }),
  proof: { evidence: [{ kind: "code", text: "yarn vitest run parse.test.ts" }], kind: "proven" },
};

/** One gap. */
const GAP: Claim = {
  claim: t({ text: "Old bodies convert." }),
  proof: { kind: "gap", why: t({ text: "no live body was converted" }) },
};

/** The gold anchor, commit plus patch id. */
const GOLD_ANCHOR: GoldAnchor = { commit: "9f3c1de", patchId: "5e1877358e8c58c6bdc46b92483800474b4b1b32" };

/** A gold review. */
export const GOLD_REVIEW: Review = { grade: "gold", reviewer: "codex", why: "the golden bytes match" };

/** The Longer notes' one paragraph. */
export const NOTES: readonly ProofBlock[] = [{ content: t({ text: "Golden bytes pin the layout." }), kind: "para" }];

/** The Proof section: one sized screenshot and one at its natural width. */
export const PROOF: readonly ProofItem[] = [
  {
    caption: t({ text: "The badge row on a narrow window." }),
    image: {
      alt: "the badge row at 600 pixels",
      kind: "image",
      url: "https://github.com/user-attachments/assets/2d8c3e4a-5f6b-4c7d-8e9f-0a1b2c3d4e5f",
      width: 600,
    },
  },
  {
    caption: [
      { kind: "text", text: "The " },
      { kind: "code", text: "--pull" },
      { kind: "text", text: " file." },
    ],
    image: {
      alt: "the pulled file",
      kind: "image",
      url: "https://github.com/user-attachments/assets/3e9d4f5b-6a7c-4d8e-9f0a-1b2c3d4e5f6a",
    },
  },
];

/** The full body: every optional section on, two ranked risks, a seen problem, graded gold. */
export const FULL_BODY: StampedPrBody = {
  ...MINIMAL_BODY,
  beforeAfter: BEFORE_AFTER,
  claims: [PROVEN, GAP],
  failsOnMain: FAILS_ON_MAIN,
  goldAnchor: GOLD_ANCHOR,
  notes: NOTES,
  problemSeen: { kind: "seen", on: "2026-09-20" },
  proof: PROOF,
  review: GOLD_REVIEW,
  risk: {
    blastRadius: t({ text: "Every pull request body." }),
    items: [P1_CHECKED, P3_UNCHECKED],
    line: t({ text: "Two fixture items." }),
  },
  whyApproach: [t({ text: "Derive every badge." })],
};

/**
 * A whole form around a stamped body.
 *
 * @param body the stamped body the form carries
 * @returns the form with the fixture title, target and draft state
 */
export function formOf({ body }: { body: StampedPrBody }): PrForm {
  return { ...body, draft: true, target: TARGET, title: "Render pull-request bodies in reading order" };
}
