/**
 * The in-thread tag a blocked turn posts: it names the owner first, says what they have to do, promises the resume,
 * and reads as a high bar being held rather than as a bot falling over.
 */
import { describe, expect, it } from "vitest";
import { OWNER_MENTION_KEY } from "../../../../live/turn/answer.js";
import { turnBlockedForm } from "../../../../live/turn/blockedForm.js";
import type { InlineRun } from "../../../../outbound/artifact/types.js";

const WHAT = "sign in to Google Cloud locally so the monitor can deploy.";
const QUESTION = "hey can you deploy the p99 latency monitor for checkout?";

/** Every word of a card, above the fold and below it, as one lower-cased string. */
function allText({ card }: { card: ReturnType<typeof turnBlockedForm> }): string {
  const index = card.artifact.index.flatMap((line) => line.map((run) => runText({ run }))).join(" ");
  const detail = JSON.stringify(card.artifact.detail);
  return `${card.artifact.tldr} ${index} ${detail}`.toLowerCase();
}

/** One inline run's own text, or the empty string for a run that carries none (a mention). */
function runText({ run }: { run: InlineRun }): string {
  return "text" in run ? run.text : "";
}

describe("the blocked card", () => {
  it("leads with a sentence saying the turn is still going, not that it stopped", () => {
    const card = turnBlockedForm({
      modelId: "opus",
      need: "sign-in",
      ownerMention: OWNER_MENTION_KEY,
      question: QUESTION,
      what: WHAT,
    });
    expect(card.artifact.tldr).toBe(`Still on "${QUESTION}". One step needs the owner before I can finish it.`);
    expect(card.clamped).toEqual([]);
  });

  it("tags the owner FIRST, above the fold, with what the step actually needs", () => {
    const card = turnBlockedForm({
      modelId: "opus",
      need: "sign-in",
      ownerMention: OWNER_MENTION_KEY,
      question: QUESTION,
      what: WHAT,
    });
    expect(card.artifact.index[0]![0]).toEqual({ person: OWNER_MENTION_KEY, type: "mention" });
    expect(runText({ run: card.artifact.index[0]![1]! })).toBe(` — this needs a sign-in only they can do: ${WHAT}`);
    expect(runText({ run: card.artifact.index[1]![0]! })).toBe(
      "Everything else is done; I pick this up again the moment they have.",
    );
  });

  it("words a risky step as an approval the owner gives rather than a sign-in", () => {
    const card = turnBlockedForm({
      modelId: "opus",
      need: "risky-approval",
      ownerMention: OWNER_MENTION_KEY,
      question: QUESTION,
      what: "say go on deploying this to production.",
    });
    expect(runText({ run: card.artifact.index[0]![1]! })).toBe(
      " — this one is risky enough that they approve it before I do it: say go on deploying this to production.",
    );
  });

  it("words an unruled ask as one the owner approves because no general ruling covers it, never as a refusal", () => {
    const card = turnBlockedForm({
      modelId: "opus",
      need: "ruling",
      ownerMention: OWNER_MENTION_KEY,
      question: QUESTION,
      what: "approve deploying the p99 latency monitor for checkout.",
    });
    expect(card.artifact.index[0]![0]).toEqual({ person: OWNER_MENTION_KEY, type: "mention" });
    expect(runText({ run: card.artifact.index[0]![1]! })).toBe(
      " — they haven't made a general ruling on this yet, bringing them in to approve this one: " +
        "approve deploying the p99 latency monitor for checkout.",
    );
    expect(allText({ card }).includes("refus")).toBe(false);
  });

  it("never reads as a failure and never states a time", () => {
    const text = allText({
      card: turnBlockedForm({
        modelId: "opus",
        need: "sign-in",
        ownerMention: OWNER_MENTION_KEY,
        question: QUESTION,
        what: WHAT,
      }),
    });
    for (const word of ["failed", "error", "sorry", "unable", "broken", "shortly", "soon", "by tomorrow"]) {
      expect(text.includes(word)).toBe(false);
    }
    expect(text.includes("there is no clock on this")).toBe(true);
  });

  it("writes no tag line at all when no owner is configured, and says so in the fold", () => {
    const card = turnBlockedForm({ modelId: "opus", need: "sign-in", question: QUESTION, what: WHAT });
    expect(card.artifact.index[0]!.every((run) => run.type !== "mention")).toBe(true);
    expect(runText({ run: card.artifact.index[0]![0]! })).toBe(
      `Waiting on the owner — this needs a sign-in only they can do: ${WHAT}`,
    );
    expect(allText({ card }).includes("nobody was tagged")).toBe(true);
  });

  it("shortens the question rather than the clause that says the turn is waiting", () => {
    const card = turnBlockedForm({
      modelId: "opus",
      need: "other",
      ownerMention: OWNER_MENTION_KEY,
      question: "q".repeat(400),
      what: WHAT,
    });
    expect(card.clamped).toEqual(["tldr"]);
    expect(card.artifact.tldr.endsWith('". One step needs the owner before I can finish it.')).toBe(true);
  });
});
