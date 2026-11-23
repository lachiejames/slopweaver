/**
 * `StoreImportErrors`: each refusal staging or resolving an import can meet carries its own code, the fields a caller
 * branches on, and a message that names what to do next.
 */
import { describe, expect, it } from "vitest";

import { StoreImportErrors } from "../../../../store/transfer/importErrors.js";

const QUESTION = "import-q-00000000000000aa";

describe("StoreImportErrors", () => {
  it("names the allowed answers when an answer is outside its question's vocabulary", () => {
    const error = StoreImportErrors.actionInvalid({
      action: "activate",
      allowed: ["keep-current", "take-imported"],
      questionId: QUESTION,
    });
    expect([error.code, error.action, error.allowed]).toEqual([
      "IMPORT_ACTION_INVALID",
      "activate",
      ["keep-current", "take-imported"],
    ]);
    expect(error.message).toBe(`${QUESTION} takes keep-current or take-imported, not activate`);
  });

  it("names the recorded answer and the refused one when an answer would change", () => {
    const error = StoreImportErrors.alreadyResolved({
      questionId: QUESTION,
      recorded: "leave-inactive",
      requested: "activate",
    });
    expect([error.code, error.recorded, error.requested]).toEqual([
      "IMPORT_QUESTION_ALREADY_RESOLVED",
      "leave-inactive",
      "activate",
    ]);
    expect(error.message).toBe(
      `${QUESTION} is already answered leave-inactive; an answer is never changed, so activate was not recorded`,
    );
  });

  it("names both digests when the approval no longer matches the plan", () => {
    const error = StoreImportErrors.approvalMismatch({ approved: "sha256:aa", planned: "sha256:bb" });
    expect([error.code, error.approved, error.planned]).toEqual(["IMPORT_APPROVAL_MISMATCH", "sha256:aa", "sha256:bb"]);
    expect(error.message).toContain("the export plans to sha256:bb now, not the approved sha256:aa");
  });

  it("points at the open-question list when no staged question carries the id", () => {
    const error = StoreImportErrors.notStaged({ questionId: QUESTION });
    expect([error.code, error.questionId]).toEqual(["IMPORT_QUESTION_NOT_STAGED", QUESTION]);
    expect(error.message).toBe(
      `no staged import question is ${QUESTION}; \`store import-questions\` lists the open ones`,
    );
  });

  it("names the batch, its digest and the difference when a batch holds the digest but not the export", () => {
    const error = StoreImportErrors.batchMismatch({
      batchId: "00000000-0000-0000-0000-000000000001",
      contentDigest: "sha256:aa",
      difference: "it holds 0 rows that are not the export's 3",
    });
    expect([error.code, error.batchId, error.contentDigest]).toEqual([
      "IMPORT_BATCH_MISMATCH",
      "00000000-0000-0000-0000-000000000001",
      "sha256:aa",
    ]);
    expect(error.message).toBe(
      "batch 00000000-0000-0000-0000-000000000001 already holds sha256:aa but not what this export stages " +
        "(it holds 0 rows that are not the export's 3); nothing was staged and the batch was not trusted",
    );
  });

  it("names every staging trigger a store lacks, and the verb that installs them", () => {
    const error = StoreImportErrors.guardsMissing({
      missing: ["trg_store_import_item_unchanged", "trg_store_import_item_no_truncate"],
    });
    expect([error.code, error.missing]).toEqual([
      "IMPORT_GUARDS_MISSING",
      ["trg_store_import_item_unchanged", "trg_store_import_item_no_truncate"],
    ]);
    expect(error.message).toBe(
      "the store lacks 2 always-enabled import guard trigger(s) (trg_store_import_item_unchanged, " +
        "trg_store_import_item_no_truncate), as an apply that never finished leaves it; none of the import's rows was written — " +
        "`slopweaver store push` installs them",
    );
  });

  it("names the row a question asks about when the reading never carried it", () => {
    const error = StoreImportErrors.stageInconsistent({
      key: "acme-rule",
      part: "owner-directives",
      questionId: QUESTION,
    });
    expect([error.code, error.part, error.key]).toEqual(["IMPORT_STAGE_INCONSISTENT", "owner-directives", "acme-rule"]);
    expect(error.message).toBe(
      `${QUESTION} asks about owner-directives acme-rule, which the export's reading does not carry; nothing was staged`,
    );
  });

  it("names both comparison versions when a plan was made under another one", () => {
    const error = StoreImportErrors.planStale({ currentVersion: 1, planVersion: 2 });
    expect([error.code, error.planVersion]).toEqual(["IMPORT_PLAN_STALE", 2]);
    expect(error.message).toBe(
      "the plan was made under comparison version 2, and this build compares by version 1; nothing was staged — " +
        "plan the export again with this build and approve that digest",
    );
  });

  it("says a question was staged before versions were recorded, or under which one, and that it must be restaged", () => {
    const unrecorded = StoreImportErrors.questionStale({
      currentVersion: 1,
      questionId: QUESTION,
      stagedVersion: null,
    });
    const other = StoreImportErrors.questionStale({ currentVersion: 1, questionId: QUESTION, stagedVersion: 2 });
    expect([unrecorded.code, unrecorded.stagedVersion, other.stagedVersion]).toEqual([
      "IMPORT_QUESTION_STALE",
      null,
      2,
    ]);
    expect([unrecorded.message, other.message]).toEqual([
      `${QUESTION} was staged before batches recorded their comparison version, and this build compares by version 1; ` +
        "it is not a question this build would ask, so no answer was recorded — the export has to be staged again",
      `${QUESTION} was staged under comparison version 2, and this build compares by version 1; ` +
        "it is not a question this build would ask, so no answer was recorded — the export has to be staged again",
    ]);
  });
});
