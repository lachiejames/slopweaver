import { describe, expect, it } from "vitest";
import {
  CLAMP_MARKER,
  clampVisible,
  FRESH_SESSION_TURN_STEPS,
  INLINE_TURN_STEPS,
  OWNER_MENTION_KEY,
  SUBAGENT_TURN_STEPS,
  turnChecklist,
  turnStepsForTier,
} from "../../../../live/turn/answer.js";
import { conservationNote } from "../../../../live/turn/failureCoverageNote.js";
import { coverageTable, turnFailureForm } from "../../../../live/turn/failureForm.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import type { InlineRun, UpdateArtifact } from "../../../../outbound/artifact/types.js";
import { renderAssistantMessage } from "../../../../outbound/assistant/answerMessage.js";
import type { CoverageLeg, CoverageManifest } from "../../../../retrieval/coverage.js";

const leg = (over: Partial<CoverageLeg> = {}): CoverageLeg => ({
  detail: "newest record is 0.3d old",
  indexed: 10,
  ingested: 10,
  leg: "github",
  skipped: [],
  state: "ok",
  ...over,
});

const manifest = ({ legs }: { legs: readonly CoverageLeg[] }): CoverageManifest => ({ legs });

/** A synthetic four-step list, so the state-machine tests below stay independent of any production step count. */
const FOUR_STEPS = [
  { id: "a", title: "A" },
  { id: "b", title: "B" },
  { id: "c", title: "C" },
  { id: "d", title: "D" },
];

describe("turnChecklist", () => {
  it("marks finished steps done, the current one running, and the rest pending", () => {
    const steps = turnChecklist({ progress: { completed: 2, details: ["a", "b"] }, steps: FOUR_STEPS });
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "running", "pending"]);
  });

  it("carries a detail clause only on finished steps", () => {
    const steps = turnChecklist({ progress: { completed: 1, details: ['"why?"'] }, steps: FOUR_STEPS });
    expect(steps[0]!.detail).toBe('"why?"');
    expect(steps[1]!.detail).toBe(undefined);
  });

  it("renders every step pending at the start", () => {
    expect(turnChecklist({ progress: { completed: 0 }, steps: FOUR_STEPS }).map((step) => step.state)).toEqual([
      "running",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks the current step FAILED and carries the reason, leaving later steps pending", () => {
    const steps = turnChecklist({
      progress: { completed: 1, failure: "the world model is unreadable" },
      steps: FOUR_STEPS,
    });
    expect(steps[1]!.state).toBe("failed");
    expect(steps[1]!.detail).toBe("the world model is unreadable");
    expect(steps[2]!.state).toBe("pending");
  });

  it("carries a `runningDetail` on the in-flight step, the only step it may appear on", () => {
    const steps = turnChecklist({
      progress: { completed: 1, runningDetail: "reading the corpus for open PRs" },
      steps: FOUR_STEPS,
    });
    expect(steps[1]!.detail).toBe("reading the corpus for open PRs");
    expect(steps[1]!.state).toBe("running");
    expect(steps[0]!.detail).toBe(undefined);
  });

  it("prefers `failure` over a stale `runningDetail` when both are set on the same frame", () => {
    const steps = turnChecklist({
      progress: { completed: 1, failure: "the world model is unreadable", runningDetail: "still investigating" },
      steps: FOUR_STEPS,
    });
    expect(steps[1]!.state).toBe("failed");
    expect(steps[1]!.detail).toBe("the world model is unreadable");
  });

  it("clamps an over-range completed rather than rendering fewer lines than the previous frame", () => {
    const steps = turnChecklist({ progress: { completed: 99 } });
    expect(steps).toHaveLength(INLINE_TURN_STEPS.length);
    expect(steps.map((step) => step.state)).toEqual(["done", "done"]);
  });

  it("clamps a negative completed to the start", () => {
    expect(turnChecklist({ progress: { completed: -3 } })[0]!.state).toBe("running");
  });

  it("keeps step ids stable, so an advance is an edit of the same lines", () => {
    expect(turnChecklist({ progress: { completed: 0 } }).map((step) => step.id)).toEqual(
      turnChecklist({ progress: { completed: 3 } }).map((step) => step.id),
    );
  });

  it("defaults to the inline steps when a caller has not yet decided a tier", () => {
    const steps = turnChecklist({ progress: { completed: 0 } });
    expect(steps.map((step) => step.title)).toEqual(INLINE_TURN_STEPS.map((step) => step.title));
  });

  it("renders a tier's own steps, not the default, when a caller passes them explicitly", () => {
    const steps = turnChecklist({ progress: { completed: 1 }, steps: SUBAGENT_TURN_STEPS });
    expect(steps.map((step) => step.title)).toEqual([
      "Read the question",
      "Investigate with a bounded read-only subagent",
    ]);
    expect(steps.map((step) => step.state)).toEqual(["done", "running"]);
  });
});

describe("turnStepsForTier", () => {
  it("gives the inline tier the two-step context-and-judgement checklist", () => {
    expect(turnStepsForTier({ tier: "inline" })).toBe(INLINE_TURN_STEPS);
  });

  it("gives the read-only-subagent tier two steps that never mention the corpus", () => {
    expect(turnStepsForTier({ tier: "read-only-subagent" })).toBe(SUBAGENT_TURN_STEPS);
    expect(SUBAGENT_TURN_STEPS.map((step) => step.title)).toEqual([
      "Read the question",
      "Investigate with a bounded read-only subagent",
    ]);
  });

  it("gives the fresh-visible-session tier two steps, distinct from the subagent tier's", () => {
    expect(turnStepsForTier({ tier: "fresh-visible-session" })).toBe(FRESH_SESSION_TURN_STEPS);
    expect(FRESH_SESSION_TURN_STEPS.map((step) => step.id)).not.toEqual(SUBAGENT_TURN_STEPS.map((step) => step.id));
  });
});

describe("clampVisible", () => {
  it("returns text that already fits unchanged", () => {
    expect(clampVisible({ cap: 10, text: "short" })).toBe("short");
  });

  it("marks a clamp and never exceeds the cap it was given", () => {
    const out = clampVisible({ cap: 5, text: "abcdefghij" });
    expect(out).toBe(`abcd${CLAMP_MARKER}`);
    expect(out).toHaveLength(5);
  });

  it("returns the empty string for a non-positive cap", () => {
    expect(clampVisible({ cap: 0, text: "abc" })).toBe("");
  });

  it("keeps text of exactly the cap length", () => {
    expect(clampVisible({ cap: 3, text: "abc" })).toBe("abc");
  });

  it("strips a run of 10+ identical box-drawing characters, which Slack wraps unpredictably", () => {
    expect(clampVisible({ cap: 200, text: `before ${"─".repeat(40)} after` })).toBe("before after");
  });

  it("strips a run of 10+ identical ASCII dashes, not only the box-drawing glyph", () => {
    expect(clampVisible({ cap: 200, text: `before ${"-".repeat(15)} after` })).toBe("before after");
  });

  it("leaves a short divider (under 10 characters) alone — not every rule is the defect", () => {
    expect(clampVisible({ cap: 200, text: "-- message 1/3 --" })).toBe("-- message 1/3 --");
  });

  it("strips an internal ask session key, which is operator plumbing and never public", () => {
    expect(clampVisible({ cap: 200, text: "attaching the image ask-C_ASK-1788169792.593579 now" })).toBe(
      "attaching the image now",
    );
  });

  it("strips an internal review session key the same way", () => {
    expect(clampVisible({ cap: 200, text: "packet ready review-C_REVIEW-1788134088.884069 for the reviewer" })).toBe(
      "packet ready for the reviewer",
    );
  });

  it("returns the empty string when the text is nothing but a divider run and a session key", () => {
    expect(clampVisible({ cap: 200, text: `${"─".repeat(40)} ask-C_ASK-1788169792.593579` })).toBe("");
  });

  it("still clamps to the cap after stripping noise", () => {
    const out = clampVisible({ cap: 10, text: `hello ${"─".repeat(30)} world of text` });
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith(CLAMP_MARKER)).toBe(true);
  });
});

describe("conservationNote", () => {
  it("states the law holds when every leg balances", () => {
    expect(conservationNote({ coverage: manifest({ legs: [leg()] }) })).toBe(
      "Conservation holds on every leg: ingested = indexed + skipped.",
    );
  });

  it("names the breach when records are unaccounted for", () => {
    const note = conservationNote({ coverage: manifest({ legs: [leg({ indexed: 3, ingested: 10 })] }) });
    expect(note).toContain("BREACHED");
    expect(note).toContain("github");
  });
});

describe("coverageTable", () => {
  it("renders one row per leg with the state and the indexed count", () => {
    const table = coverageTable({
      coverage: manifest({
        legs: [leg(), leg({ detail: "no records on disk", indexed: 0, ingested: 0, leg: "gold", state: "absent" })],
      }),
    });
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]![0]![0]).toEqual({ text: "gold", type: "text" });
    expect(table.rows[1]![1]![0]).toEqual({ text: "absent", type: "text" });
  });

  it("shows skipped records as a deduction rather than hiding them", () => {
    const table = coverageTable({
      coverage: manifest({ legs: [leg({ indexed: 9, ingested: 10, skipped: [{ count: 1, reason: "superseded" }] })] }),
    });
    expect(table.rows[0]![2]![0]).toEqual({ text: "9 (−1)", type: "text" });
  });

  it("REPORTS legs beyond Slack's row cap instead of dropping them", () => {
    const many = Array.from({ length: 14 }, (_, index) => leg({ leg: `leg-${String(index)}` }));
    const table = coverageTable({ coverage: manifest({ legs: many }) });
    expect(table.rows).toHaveLength(10);
    expect(table.rows[9]![0]![0]).toEqual({ text: "+5 more", type: "text" });
  });
});

describe("turnFailureForm", () => {
  const build = (coverage?: CoverageManifest) =>
    turnFailureForm({
      cause: "broke",
      modelId: "claude -p",
      question: "what did we decide?",
      reason: "the world model could not be read",
      ...(coverage === undefined ? {} : { coverage }),
    });

  it("produces a form its own schema accepts", () => {
    expect(updateArtifactSchema.safeParse(build().artifact).success).toBe(true);
  });

  it("says it could not answer, and why", () => {
    const card = build();
    expect(card.artifact.tldr).toBe('Something broke while I was answering "what did we decide?". Nothing was posted.');
    const first = card.artifact.detail[0]!;
    expect(first).toEqual({
      runs: [
        {
          text: "The turn stopped before it could answer. the world model could not be read",
          type: "text",
        },
      ],
      type: "paragraph",
    });
  });

  it("carries no citations, because it grounded in nothing", () => {
    expect(build().artifact.citations).toEqual([]);
  });

  it("says the world model was never read when a BROKEN turn has no coverage", () => {
    const bullets = build().artifact.detail.find((block) => block.type === "bullets");
    const texts = bullets!.items.flat().map((run) => (run.type === "text" ? run.text : ""));
    expect(texts).toContain("The world model was never read, so there is no coverage to report.");
  });

  it("does NOT claim the world model went unread on a refusal that carries no manifest", () => {
    // MEASURED on `C0SYN000001/1790048248.995219`: a door refusal printed the never-read line on a card for
    // an answer standing on four compliance controls read live three times. A refusal never carries a
    // manifest — `coverageOfFailure` only recovers one from a `TurnQueryFailure` — so the absence proved
    // nothing about what the turn read.
    const refused = turnFailureForm({
      cause: "unproven",
      modelId: "claude -p",
      question: "how overdue is the pen test report?",
      reason: 'body.runs[32] matches the configured word voice rule "genuinely" for the bot lane',
    });
    const bullets = refused.artifact.detail.find((block) => block.type === "bullets");
    const texts = bullets!.items.flat().map((run) => (run.type === "text" ? run.text : ""));
    expect(texts).toContain("The answer was composed, but no coverage manifest is available for this refusal.");
    expect(texts).not.toContain("The world model was never read, so there is no coverage to report.");
  });

  it("still reports a refusal's own coverage when a manifest IS in hand", () => {
    const refused = turnFailureForm({
      cause: "unproven",
      coverage: manifest({ legs: [leg()] }),
      modelId: "claude -p",
      question: "how overdue is the pen test report?",
      reason: "a gate said no",
    });
    const bullets = refused.artifact.detail.find((block) => block.type === "bullets");
    const texts = bullets!.items.flat().map((run) => (run.type === "text" ? run.text : ""));
    expect(texts).not.toContain("The answer was composed, but no coverage manifest is available for this refusal.");
    expect(refused.artifact.detail.filter((block) => block.type === "table")).toHaveLength(1);
  });

  it("carries whatever coverage was established before the failure", () => {
    expect(build(manifest({ legs: [leg()] })).artifact.detail.filter((block) => block.type === "table")).toHaveLength(
      1,
    );
  });
});

/**
 * The measured shape of a real admit-door refusal, with every internal token the fold is allowed to carry
 * and the card FACE must not: the door's own name, its finding code, and the draft claim it quoted back.
 *
 * Taken from a recorded ending, re-skinned — the claim text is synthetic, because the real
 * one quoted a private codebase's identifiers and this is a public repository.
 */
const DOOR_REASON =
  "refused by the admit door, nothing sent — the admit door refused to post the turn's answer — " +
  'ANSWER_CLAIM_UNRESOLVED: 1 high-impact claim(s) are not supported: "the rollout finished last night" — ' +
  "support the claim from evidence, or remove it from the answer";

/** Every token in {@link DOOR_REASON} that names machinery rather than an outcome a colleague can act on. */
const INTERNAL_TOKENS = [
  "admit door",
  "ANSWER_CLAIM_UNRESOLVED",
  "high-impact claim",
  "the rollout finished last night",
  "nothing sent",
];

/** One inline run flattened to what a reader sees — a mention by its identity key, so a tag cannot hide. */
const runText = ({ run }: { run: InlineRun }): string => {
  switch (run.type) {
    case "text":
      return run.text;
    case "mention":
      return `@${run.person}`;
    case "group":
      return `@${run.handle}`;
    case "link":
      return run.label;
    case "broadcast":
      return `@${run.range}`;
    case "citation":
      return run.citationId;
  }
};

/** The card FACE, flattened: the tl;dr plus every above-the-fold index line, mentions included by key. */
const faceText = ({ artifact }: { artifact: UpdateArtifact }): string =>
  [artifact.tldr, ...artifact.index.flat().map((run) => runText({ run }))].join(" ");

/** The card FOLD, flattened to the prose a reader gets after expanding. */
const foldText = ({ artifact }: { artifact: UpdateArtifact }): string =>
  artifact.detail
    .flatMap((block) => (block.type === "paragraph" ? block.runs : []))
    .map((run) => (run.type === "text" ? run.text : ""))
    .join(" ");

describe("qualityBarCard", () => {
  const barCard = (over: { ownerMention?: string } = {}) =>
    turnFailureForm({
      cause: "unproven",
      modelId: "claude -p",
      ownerMention: OWNER_MENTION_KEY,
      question: "did the migration finish?",
      reason: DOOR_REASON,
      ...over,
    }).artifact;

  it("leads with the bar that was not met, never with a malfunction", () => {
    expect(barCard().tldr).toBe('I had an answer to "did the migration finish?" but it did not clear the bar to post.');
  });

  it("states the standard above the fold, so the withholding reads as the bar working", () => {
    expect(barCard().index[0]).toEqual([
      { text: "Nothing goes out unproven — when this bot answers, the evidence is behind it.", type: "text" },
    ]);
  });

  it("tags the owner above the fold, so watchers see a human was pulled in", () => {
    expect(barCard().index[1]).toEqual([
      { person: OWNER_MENTION_KEY, type: "mention" },
      { text: " is tagged in to sort out what was missing and get you the answer.", type: "text" },
    ]);
  });

  it("keeps every internal identifier off the card face", () => {
    const face = faceText({ artifact: barCard() });
    expect(INTERNAL_TOKENS.filter((token) => face.includes(token))).toEqual([]);
  });

  it("keeps the technical truth in the fold, whole and verbatim", () => {
    expect(foldText({ artifact: barCard() })).toContain(DOOR_REASON);
  });

  it("says the answer was composed and then refused, not that the turn stopped short", () => {
    expect(barCard().detail[0]).toEqual({
      runs: [
        { text: `The answer was composed and then refused before it could be sent. ${DOOR_REASON}`, type: "text" },
      ],
      type: "paragraph",
    });
  });

  it("writes no tag at all when no owner is configured, rather than one nothing resolves", () => {
    const card = turnFailureForm({
      cause: "unproven",
      modelId: "claude -p",
      question: "did the migration finish?",
      reason: DOOR_REASON,
    }).artifact;
    expect(card.index).toEqual([
      [{ text: "Nothing goes out unproven — when this bot answers, the evidence is behind it.", type: "text" }],
    ]);
  });

  it("names the missing owner in the fold, where an operator will see it", () => {
    const card = turnFailureForm({
      cause: "unproven",
      modelId: "claude -p",
      question: "did the migration finish?",
      reason: DOOR_REASON,
    }).artifact;
    const bullets = card.detail.find((block) => block.type === "bullets");
    const texts = bullets!.items.flat().map((run) => (run.type === "text" ? run.text : ""));
    expect(texts).toContain("Nobody was tagged — no `slackBot.ownerUserId` is configured in profile.json.");
  });

  it("produces a form its own schema accepts, mention and all", () => {
    expect(updateArtifactSchema.safeParse(barCard()).success).toBe(true);
  });

  /**
   * The seam that, broken, costs the most: `resolveMention` THROWS on a person no map resolves, and a
   * failure notice that throws while rendering is silence in a thread where somebody asked a question. So
   * this renders the real card through the real renderer with the one map the poster builds, and asserts a
   * genuine Slack `user` element came out — a plain-text `@owner` would notify nobody.
   */
  it("renders the owner tag as a real Slack user element, not text that looks like one", () => {
    const payload = renderAssistantMessage({
      artifact: updateArtifactSchema.parse(barCard()),
      chrome: {
        authorEmoji: ":robot_face:",
        authorLabel: "test-bot",
        bannerColor: "#ABCDEF",
        detailLabel: "*Details*",
        metadataEventType: "test_card_v1",
      },
      mentions: { groups: new Map(), people: new Map([[OWNER_MENTION_KEY, "U_fake_owner"]]) },
    });
    expect(JSON.stringify(payload)).toContain('{"type":"user","user_id":"U_fake_owner"}');
  });

  it("keeps the clause a reader needs when the question is too long to fit the lead", () => {
    const card = turnFailureForm({
      cause: "unproven",
      modelId: "claude -p",
      ownerMention: OWNER_MENTION_KEY,
      question: "q".repeat(400),
      reason: DOOR_REASON,
    });
    expect(card.artifact.tldr.endsWith('" but it did not clear the bar to post.')).toBe(true);
    expect(card.artifact.tldr.length).toBe(180);
    expect(card.clamped).toEqual(["tldr"]);
  });

  describe("a break wears a different face, and an equally honest one", () => {
    const brokeCard = () =>
      turnFailureForm({
        cause: "broke",
        modelId: "claude -p",
        ownerMention: OWNER_MENTION_KEY,
        question: "did the migration finish?",
        reason: "this turn failed — the world model could not be read",
      }).artifact;

    it("never claims a bar was applied to an answer that was never composed", () => {
      expect(faceText({ artifact: brokeCard() })).not.toContain("unproven");
    });

    it("says something broke, and still tags the owner", () => {
      expect(brokeCard().tldr).toBe(
        'Something broke while I was answering "did the migration finish?". Nothing was posted.',
      );
      expect(brokeCard().index).toEqual([
        [
          { person: OWNER_MENTION_KEY, type: "mention" },
          { text: " is tagged in to look at what broke and get you the answer.", type: "text" },
        ],
      ]);
    });
  });
});
