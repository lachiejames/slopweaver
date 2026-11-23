/**
 * `BeliefErrors`: the proposal queue's only error constructors. Each test is named for the code it builds and
 * pins that code as a literal beside the whole returned record and its exact message.
 */
import { describe, expect, it } from "vitest";

import { BeliefErrors } from "../../../../knowledge/voice/errors.js";

describe("BeliefErrors", () => {
  it("batchUnreadable builds BATCH_UNREADABLE naming the path, the reason and the re-run command", () => {
    const error = BeliefErrors.batchUnreadable({ path: "/work/voice-batch.json", why: "ENOENT" });

    expect(error.code).toBe("BATCH_UNREADABLE");
    expect(error).toEqual({
      code: "BATCH_UNREADABLE",
      message:
        "could not read the voice batch at /work/voice-batch.json — ENOENT. Re-run `slopweaver knowledge voice --out <path>`",
      path: "/work/voice-batch.json",
    });
  });

  it("unitNotInBatch builds UNIT_NOT_IN_BATCH naming the missing unit", () => {
    const error = BeliefErrors.unitNotInBatch({ unitId: "unit-7f3a" });

    expect(error.code).toBe("UNIT_NOT_IN_BATCH");
    expect(error).toEqual({
      code: "UNIT_NOT_IN_BATCH",
      message:
        "the batch carries no unit unit-7f3a. A proposal is only ever made against a unit in the batch it was " +
        "read from, so the quote can be checked against their actual words",
      unitId: "unit-7f3a",
    });
  });

  it("unitTampered builds UNIT_TAMPERED telling the reader to re-run the scan", () => {
    const error = BeliefErrors.unitTampered({ unitId: "unit-7f3a" });

    expect(error.code).toBe("UNIT_TAMPERED");
    expect(error).toEqual({
      code: "UNIT_TAMPERED",
      message:
        "unit unit-7f3a in the batch no longer hashes to its own id, so its text was edited after the scan " +
        "wrote it. Re-run the scan rather than repairing the file",
      unitId: "unit-7f3a",
    });
  });

  it("quoteNotFound builds QUOTE_NOT_FOUND naming the unit the quote was checked against", () => {
    const error = BeliefErrors.quoteNotFound({ unitId: "unit-7f3a" });

    expect(error.code).toBe("QUOTE_NOT_FOUND");
    expect(error).toEqual({
      code: "QUOTE_NOT_FOUND",
      message:
        "the quote does not occur in unit unit-7f3a's text. A proposal cites THEIR words verbatim, so a quote " +
        "that has been tidied, re-spaced or paraphrased is refused rather than recorded",
      unitId: "unit-7f3a",
    });
  });

  it("field builds PROPOSAL_FIELD whose message is the field name followed by the reason", () => {
    const error = BeliefErrors.field({ field: "claim", why: "is empty" });

    expect(error.code).toBe("PROPOSAL_FIELD");
    expect(error).toEqual({ code: "PROPOSAL_FIELD", field: "claim", message: "claim is empty" });
  });

  it("corrupt builds PROPOSAL_CORRUPT carrying the line number", () => {
    const error = BeliefErrors.corrupt({ lineNumber: 42 });

    expect(error.code).toBe("PROPOSAL_CORRUPT");
    expect(error).toEqual({
      code: "PROPOSAL_CORRUPT",
      lineNumber: 42,
      message: "line 42 of the proposal queue is not a decodable row",
    });
  });

  it("queueUnreadable builds QUEUE_UNREADABLE keeping the very cause object it was given", () => {
    const cause = new Error("EACCES: permission denied");
    const error = BeliefErrors.queueUnreadable({ cause, path: "/home/.slopweaver/proposals.jsonl" });

    expect(error.code).toBe("QUEUE_UNREADABLE");
    expect(error.cause).toBe(cause);
    expect(error).toEqual({
      cause,
      code: "QUEUE_UNREADABLE",
      message:
        "could not read the proposal queue at /home/.slopweaver/proposals.jsonl — refusing rather than reporting it empty",
      path: "/home/.slopweaver/proposals.jsonl",
    });
  });

  it("proposalNotOpen builds PROPOSAL_NOT_OPEN saying an ANSWERED proposal was already answered", () => {
    const error = BeliefErrors.proposalNotOpen({ answered: true, proposalId: "prop-19" });

    expect(error.code).toBe("PROPOSAL_NOT_OPEN");
    expect(error).toEqual({
      code: "PROPOSAL_NOT_OPEN",
      message:
        "proposal prop-19 has already been answered. They may change their mind — propose the claim again and " +
        "answer that, rather than overwriting what they said before",
      proposalId: "prop-19",
    });
  });

  it("proposalNotOpen builds PROPOSAL_NOT_OPEN saying an UNANSWERED miss is not in the queue at all", () => {
    const error = BeliefErrors.proposalNotOpen({ answered: false, proposalId: "prop-19" });

    expect(error.code).toBe("PROPOSAL_NOT_OPEN");
    expect(error).toEqual({
      code: "PROPOSAL_NOT_OPEN",
      message:
        "the queue holds no proposed belief prop-19. Read the block they are looking at, or run " +
        "`slopweaver knowledge propose` first — an answer is only ever recorded against a real proposal",
      proposalId: "prop-19",
    });
  });
});
