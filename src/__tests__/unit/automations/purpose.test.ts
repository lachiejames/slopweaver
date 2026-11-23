/**
 * What each scheduled ask is for, derived from its kind and argv and never its id — and the registries it names
 * stay total, so a new atlas or kind cannot land as a card that does not say what it is.
 */
import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../atlas/registry.js";
import { atlasPlatformOf, CORPUS_PURPOSES, purposeOf } from "../../../automations/purpose.js";
import { ATLAS_NAMES, KIND_PURPOSES, VERB_PURPOSES } from "../../../automations/purposeNames.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { RECIPE_KINDS } from "../../../live/automation/kinds.js";

/** Every sentence a registry declares, so the voice checks read them all at once. */
const DECLARED_SENTENCES = [
  ...Object.values(KIND_PURPOSES).map((purpose) => purpose.forWhat),
  ...Object.values(VERB_PURPOSES).map((purpose) => purpose.forWhat),
  ...Object.values(CORPUS_PURPOSES).map((purpose) => purpose.forWhat),
];

const definition = (over: Partial<RecipeDefinition>): RecipeDefinition => ({
  cadence: "0 */4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "verb-run",
  onMissed: "backfill",
  params: {},
  recipeId: "some-install-id",
  schemaVersion: 1,
  ...over,
});

const NO_QUESTIONS = new Map<string, string>();

describe("the purpose registries", () => {
  it("name every atlas this build registers", () => {
    const platforms = atlasPlatforms();
    expect(platforms.length).toBeGreaterThan(0);
    expect(platforms.filter((platform) => ATLAS_NAMES[platform] === undefined)).toEqual([]);
  });

  it("say what every recipe kind this build registers is, and nothing it does not register", () => {
    expect(RECIPE_KINDS.length).toBeGreaterThan(0);
    expect(Object.keys(KIND_PURPOSES).toSorted()).toEqual(RECIPE_KINDS.map((kind) => kind.kind).toSorted());
  });

  it("declare every purpose as ONE sentence, never a kind's engineering summary", () => {
    expect(DECLARED_SENTENCES.length).toBeGreaterThan(0);
    const notOneSentence = DECLARED_SENTENCES.filter((sentence) => !/^[A-Z][^.?!]*[.?!]$/u.test(sentence));
    const summaries = new Set(RECIPE_KINDS.map((kind) => kind.summary.toLowerCase()));
    expect(notOneSentence).toEqual([]);
    expect(DECLARED_SENTENCES.filter((sentence) => summaries.has(sentence.slice(0, -1).toLowerCase()))).toEqual([]);
  });
});

describe("purposeOf", () => {
  it("reads a corpus resync by its --source, never by its id", () => {
    const linear = definition({
      kind: "resync",
      params: { argv: ["recipe", "resync", "--source", "linear"] },
      recipeId: "resync-corpus-linear",
    });

    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: linear })).toEqual(CORPUS_PURPOSES.linear);
  });

  it("reads an atlas resync by its --atlas, saying the lead clause of the atlas's own question", () => {
    const xero = definition({ kind: "resync", params: { argv: ["recipe", "resync", "--atlas", "xero"] } });
    const atlasQuestions = new Map([["xero", "what can be reached in Xero — every operation, every page"]]);

    expect(atlasPlatformOf({ definition: xero })).toBe("xero");
    expect(purposeOf({ atlasQuestions, definition: xero })).toEqual({
      forWhat: "Keeps the Xero atlas current, so the bot can answer what can be reached in Xero.",
      meanwhile: null,
      name: "Xero atlas refresh",
      whenBroken: "Answers about Xero come from the copy it published at its last good refresh.",
    });
  });

  it("says what a resync is when its atlas descriptor question did not load, rather than nothing", () => {
    const xero = definition({ kind: "resync", params: { argv: ["recipe", "resync", "--atlas", "xero"] } });
    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: xero })).toEqual({
      ...KIND_PURPOSES.resync,
      meanwhile: null,
    });
  });

  it("reads vulnerability-fix topup as the one Dependabot security top-up, whatever flags its row carries", () => {
    const bare = definition({ params: { argv: ["vulnerability-fix", "topup"] } });
    const capped = definition({ params: { argv: ["vulnerability-fix", "topup", "--target", "5"] } });

    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: bare })).toEqual({
      forWhat:
        "Raises a batch of fix pull requests for the open Dependabot security alerts nobody is fixing yet, opening a visible session per batch.",
      meanwhile: null,
      name: "Security fix top-up",
      whenBroken: "No new batch of security fixes is opened.",
    });
    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: capped })!.name).toBe("Security fix top-up");
  });

  it("reads an investigation by its question's first sentence, and any other kind by its own sentence", () => {
    const investigate = definition({
      kind: "investigate",
      params: { question: "Why is IT help busy? Look at HELP." },
    });
    const batch = definition({ kind: "error-tracking-batch" });

    expect([
      purposeOf({ atlasQuestions: NO_QUESTIONS, definition: investigate }),
      purposeOf({ atlasQuestions: NO_QUESTIONS, definition: batch }),
    ]).toEqual([
      { forWhat: "Why is IT help busy?", meanwhile: null, name: "Scheduled investigation", whenBroken: null },
      {
        forWhat: "Opens a session you can watch that raises fix pull requests for the top Error Tracking issues.",
        meanwhile: null,
        name: "Error tracking batch",
        whenBroken: null,
      },
    ]);
  });

  it("says what the fleet ceiling report gives the owner, never the kind's engineering summary", () => {
    const ceiling = definition({ kind: "fleet-ceiling-report", params: { days: 7 } });
    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: ceiling })!.forWhat).toBe(
      "Tells you each morning whether the fleet left Claude plan capacity unused, and asks you on the Queue when more could have run.",
    );
  });

  it("names the hourly meeting prep by its verb", () => {
    const prep = definition({ params: { argv: ["calendar", "prep-due"] }, recipeId: "meeting-prep-hourly" });
    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: prep })).toEqual({
      forWhat: "Puts each meeting you will talk in on the board, for a session to brief before it starts.",
      meanwhile: null,
      name: "Meeting prep",
      whenBroken: "You walk into a meeting with no brief.",
    });
  });

  it("names the command a verb run it has no sentence for runs, rather than inventing what it is for", () => {
    const unknown = definition({ params: { argv: ["some", "verb"] } });
    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: unknown })).toEqual({
      forWhat: "Runs `slopweaver some verb` on a schedule.",
      meanwhile: null,
      name: "Scheduled command",
      whenBroken: null,
    });
  });

  it("answers null only for a kind this build does not register", () => {
    const retired = definition({ kind: "retired-kind" });
    expect(purposeOf({ atlasQuestions: NO_QUESTIONS, definition: retired })).toBe(null);
  });
});
