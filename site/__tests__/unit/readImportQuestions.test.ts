/*
 * The import-question register's reader, all or nothing: one question that will not read refuses the whole reading,
 * since a dropped question is an answer the owner was never asked for and a restore waits on every one.
 */

import { describe, expect, it } from "vitest";

import { readImportQuestions } from "../../components/live/readImportQuestions";

const AT = "2026-11-01T08:00:00.000Z";

/** A staged activation, as `store import-questions --json` publishes it. */
const ACTIVATION: Readonly<Record<string, unknown>> = {
  actions: ["activate", "leave-inactive"],
  batchId: "00000000-0000-4000-8000-0000000000a1",
  current: null,
  imported: "acme-directive-1: always open a draft pull request for the acme-admin repo",
  key: "acme-directive-1",
  kind: "activation",
  part: "owner-directives",
  questionId: "import-q-00000000000000a1",
  stagedAtIso: "2026-10-30T09:00:00.000Z",
};

/** A staged conflict with a live row. */
const CONFLICT: Readonly<Record<string, unknown>> = {
  actions: ["keep-current", "take-imported"],
  batchId: "00000000-0000-4000-8000-0000000000b2",
  current: "acme-ask-7: review ABC-1 before Friday",
  imported: "acme-ask-7: review ABC-1 before Thursday",
  key: "acme-ask-7",
  kind: "conflict",
  part: "standing-asks",
  questionId: "import-q-00000000000000b2",
  stagedAtIso: "2026-10-31T10:30:00.000Z",
};

/** The document carrying `questions`, stamped at `AT`. */
function documentOf({ questions }: { questions: readonly unknown[] }): Record<string, unknown> {
  return { observedAtIso: AT, questions };
}

describe("readImportQuestions", () => {
  it("reads an activation and a conflict whole, in the order published", () => {
    expect(readImportQuestions(documentOf({ questions: [CONFLICT, ACTIVATION] }))).toEqual({
      questions: [
        {
          actions: ["keep-current", "take-imported"],
          batchId: "00000000-0000-4000-8000-0000000000b2",
          current: "acme-ask-7: review ABC-1 before Friday",
          imported: "acme-ask-7: review ABC-1 before Thursday",
          key: "acme-ask-7",
          kind: "conflict",
          part: "standing-asks",
          questionId: "import-q-00000000000000b2",
          stagedAtIso: "2026-10-31T10:30:00.000Z",
        },
        {
          actions: ["activate", "leave-inactive"],
          batchId: "00000000-0000-4000-8000-0000000000a1",
          current: undefined,
          imported: "acme-directive-1: always open a draft pull request for the acme-admin repo",
          key: "acme-directive-1",
          kind: "activation",
          part: "owner-directives",
          questionId: "import-q-00000000000000a1",
          stagedAtIso: "2026-10-30T09:00:00.000Z",
        },
      ],
    });
  });

  it("refuses the whole reading when one question beside a good one will not read", () => {
    const malformed = { ...CONFLICT, key: undefined, questionId: "import-q-00000000000000c3" };
    expect(readImportQuestions(documentOf({ questions: [ACTIVATION] }))!.questions.length).toBe(1);
    expect(readImportQuestions(documentOf({ questions: [ACTIVATION, malformed] }))).toBe(undefined);
  });

  it("refuses two questions under one id", () => {
    const twin = { ...CONFLICT, questionId: ACTIVATION["questionId"] };
    expect(readImportQuestions(documentOf({ questions: [ACTIVATION, twin] }))).toBe(undefined);
  });

  it("refuses an activation that carries a live side", () => {
    expect(readImportQuestions(documentOf({ questions: [{ ...ACTIVATION, current: "a live row" }] }))).toBe(undefined);
  });

  it.each([null, "", undefined])("refuses a conflict whose live side is %j", (current) => {
    expect(readImportQuestions(documentOf({ questions: [{ ...CONFLICT, current }] }))).toBe(undefined);
  });

  it.each([
    ["missing one", ["keep-current"]],
    ["carrying an extra", ["keep-current", "take-imported", "activate"]],
    ["reordered", ["take-imported", "keep-current"]],
    ["the other kind's", ["activate", "leave-inactive"]],
    ["absent", undefined],
  ])("refuses a conflict whose answers are %s", (_, actions) => {
    expect(readImportQuestions(documentOf({ questions: [{ ...CONFLICT, actions }] }))).toBe(undefined);
  });

  it.each([
    ["a staging instant that is not one", { ...CONFLICT, stagedAtIso: "yesterday" }],
    ["an unknown part", { ...CONFLICT, part: "secrets" }],
    ["an unknown kind", { ...CONFLICT, kind: "merge" }],
    ["a question id of the wrong shape", { ...CONFLICT, questionId: "import-q-XYZ" }],
    ["no batch", { ...CONFLICT, batchId: undefined }],
    ["no imported line", { ...CONFLICT, imported: undefined }],
  ])("refuses a question with %s", (_, question) => {
    expect(readImportQuestions(documentOf({ questions: [question] }))).toBe(undefined);
  });

  it("refuses a document whose own instant will not read, or that carries no question list", () => {
    expect(readImportQuestions({ observedAtIso: "now", questions: [] })).toBe(undefined);
    expect(readImportQuestions({ questions: [] })).toBe(undefined);
    expect(readImportQuestions({ observedAtIso: AT })).toBe(undefined);
    expect(readImportQuestions([])).toBe(undefined);
  });

  it("reads an alignment with its live line and its one answer", () => {
    const alignment = { ...CONFLICT, actions: ["keep-current"], kind: "alignment", part: "memories" };
    const read = readImportQuestions(documentOf({ questions: [alignment] }))!.questions[0];
    expect([read.kind, read.part, read.current, read.actions]).toEqual([
      "alignment",
      "memories",
      "acme-ask-7: review ABC-1 before Friday",
      ["keep-current"],
    ]);
  });

  it.each([
    ["offering the conflict's answers", { actions: ["keep-current", "take-imported"] }],
    ["carrying no live side", { actions: ["keep-current"], current: null }],
  ])("refuses an alignment %s", (_, over) => {
    const alignment = { ...CONFLICT, kind: "alignment", ...over };
    expect(readImportQuestions(documentOf({ questions: [alignment] }))).toBe(undefined);
  });

  it("reads an empty list as a measured zero", () => {
    expect(readImportQuestions(documentOf({ questions: [] }))).toEqual({ questions: [] });
  });
});
