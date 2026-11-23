/**
 * `ProposalErrors` and `proposalErrorLines` — the typed failures `slopweaver proposal`'s parsers author, and
 * the one-line-per-problem printing every runner does with them.
 */
import { describe, expect, it } from "vitest";

import { ProposalErrors, proposalErrorLines } from "../../../../../cli/commands/proposal/errors.js";

describe("ProposalErrors", () => {
  it("names the flag and the unreadable value in a date refusal", () => {
    const error = ProposalErrors.dateInvalid({ name: "at", raw: "yesterday" });

    expect(error).toEqual({
      code: "DATE_INVALID",
      message: '--at "yesterday" is not a readable ISO-8601 timestamp',
      name: "at",
      raw: "yesterday",
    });
  });

  it("says which feedback kinds need a permalink, joined in reading order", () => {
    const error = ProposalErrors.feedbackLocationRequired({ kinds: ["question", "pushback"] });

    expect(error.code).toBe("FEEDBACK_LOCATION_REQUIRED");
    expect(error.message).toBe(
      "--where <permalink> is required for question and pushback — answering it means going back to where it was raised",
    );
  });

  it("quotes the decision outcome it did not recognise", () => {
    const error = ProposalErrors.decisionOutcomeUnknown({ outcome: "maybe" });

    expect(error.message).toBe('"maybe" is not a decision outcome — it is approved or rejected');
  });

  it("states the ceiling a sync limit must stay under", () => {
    const error = ProposalErrors.syncLimitInvalid({ max: 50 });

    expect(error).toEqual({ code: "SYNC_LIMIT_INVALID", max: 50, message: "--limit must be an integer from 1 to 50" });
  });

  it("carries the parser's own detail when the form is not JSON", () => {
    const error = ProposalErrors.formNotJson({ detail: "Unexpected token } in JSON" });

    expect(error.message).toBe("the form is not valid JSON: Unexpected token } in JSON");
  });

  it("uses the usage block itself as the message when only the usage applies", () => {
    const error = ProposalErrors.usage({ usage: "usage: slopweaver proposal lint <draft.md>" });

    expect(error).toEqual({
      code: "USAGE",
      message: "usage: slopweaver proposal lint <draft.md>",
      usage: "usage: slopweaver proposal lint <draft.md>",
    });
  });
});

describe("proposalErrorLines", () => {
  it("prints the missing-field sentence and then the usage, each on its own line", () => {
    const error = ProposalErrors.feedbackFieldsRequired({ usage: "usage: slopweaver proposal feedback" });

    expect(proposalErrorLines({ error })).toEqual([
      "--kind, --who and --what are all required",
      "usage: slopweaver proposal feedback",
    ]);
    expect(error.message).toBe("--kind, --who and --what are all required; usage: slopweaver proposal feedback");
  });

  it("prints an answer's missing fields ahead of its usage", () => {
    const error = ProposalErrors.answerFieldsRequired({ usage: "usage: slopweaver proposal answer-feedback" });

    expect(proposalErrorLines({ error })).toEqual([
      "--id and --how are both required",
      "usage: slopweaver proposal answer-feedback",
    ]);
  });

  it("gives every form issue its own line", () => {
    const error = ProposalErrors.formInvalid({ reasons: ["title: Required", "sections: Expected array"] });

    expect(proposalErrorLines({ error })).toEqual(["title: Required", "sections: Expected array"]);
  });

  it("passes a flag parser's lines through unchanged", () => {
    const error = ProposalErrors.flagsInvalid({ reasons: ["unknown flag: --nope"] });

    expect(proposalErrorLines({ error })).toEqual(["unknown flag: --nope"]);
  });

  it("prints a single-sentence failure as its message", () => {
    const error = ProposalErrors.whyRequired();

    expect(proposalErrorLines({ error })).toEqual(['--why "<reason>" is required']);
  });
});
