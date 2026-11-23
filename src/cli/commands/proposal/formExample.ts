/**
 * A complete, already-valid `--form`, printed by `proposal draft --form-example`.
 *
 * It exists because a strict schema is only usable if you can see a filled one. The GitHub PR form ships the
 * same escape hatch for the same reason: the alternative is a session guessing at field names and being
 * refused six times, which reads as the tool being broken rather than as the form being strict.
 *
 * Every field is present, including the optional ones, and the content is deliberately about a made-up
 * subject — a form example that quoted a real proposal would be copied verbatim into a real one.
 */
import type { ProposalForm } from "../../../outbound/proposal/types.js";

/** A filled form that passes both the schema and the lint gate. */
export const PROPOSAL_FORM_EXAMPLE: ProposalForm = {
  appendix:
    "The re-runnable command, the file and line permalinks, and the full breakdown live here. Every figure " +
    "above is re-runnable and was cross-checked two ways.",
  data: {
    hero: {
      caption: "the retry column, with the four repeat failures boxed in red",
      sourceText: "the frozen run",
      sourceUrl: "https://example.test/runs/1",
      url: "https://example.test/shots/hero.png",
    },
    intro: "Each row links its own source, so a reader can click through to the thing itself in one hop.",
    rows: [
      {
        point: "Repeat failures in the nightly suite",
        shows: "[4 of the last 30](https://example.test/runs/1) failed twice on the same input",
        sourceText: "the run",
        sourceUrl: "https://example.test/runs/1",
      },
      {
        point: "Time lost to a re-run",
        shows: "each retry costs [about 12 min](https://example.test/runs/2) of wall clock",
        sourceText: "the timing sample",
        sourceUrl: "https://example.test/runs/2",
      },
    ],
  },
  emoji: "🧭",
  fix: {
    body: "Record the seed for every run and replay it on failure, wired in [the runner](https://example.test/code#L20-L44).",
    diagram: {
      code: 'flowchart LR\n  A["run"] --> B{"failed?"}\n  B -->|yes| C["replay with the recorded seed"]',
      language: "mermaid",
    },
    optionsConsidered: [
      {
        cons: "Needs a place to keep the seed",
        option: "Record and replay the seed",
        pros: "Cheap, in-repo",
        recommended: true,
      },
      {
        cons: "Hides the problem rather than finding it",
        option: "Retry three times and move on",
        pros: "One line",
        recommended: false,
      },
    ],
  },
  questions: {
    addressedTo: "whoever owns the nightly suite",
    items: [
      { key: "owner", question: "are you the one who signs this off, or does it go wider?" },
      { key: "scope", question: "should the replay cover the integration lane too, or only unit?" },
    ],
  },
  scope: {
    rows: [
      {
        notYet: "Telling a real bug from an ordering bug",
        solves: "Making a failure reproducible",
        whatItWouldTake: "A human read of each replayed failure",
      },
    ],
    weakestPart:
      "the sample is one week of runs, so a failure that only shows up under load would not appear in it at all.",
  },
  slackTeaser:
    "Nightly failures are hard to chase because they do not reproduce. Short version: record the seed, " +
    "replay it on failure. Doc is linked above with the numbers and what it does not cover. Tell me where I " +
    "have it wrong.",
  title: "Make a nightly failure reproducible before we chase it",
  tldr:
    "Nightly suite failures are hard to act on because nobody can reproduce them, so each one costs a " +
    "morning of guessing and usually ends in a retry. Before anyone rewrites a test on a hunch, I want a " +
    "failure to be replayable on demand. Putting this up to get it shot at, so tell me where I have it wrong.",
};
