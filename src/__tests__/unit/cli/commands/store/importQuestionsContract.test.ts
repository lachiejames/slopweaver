/**
 * The PRODUCER half of the `store import-questions --json` contract: what the verb prints, pinned to a golden file
 * the console's reader (`site/components/live/readImportQuestions.ts`) is tested against in
 * `site/__tests__/unit/importQuestionsContract.test.ts`. The two halves live in separate Yarn projects and neither may
 * import the other's graph, so they meet in ONE file, `src/__tests__/fixtures/contract/store-import-questions.json`.
 *
 * The questions cover all three kinds, all four answers, three export parts, a `null` and a string live side, and two
 * batches — each shape the card draws differently. Every id, key and line is synthetic; a batch id is a uuid, as the
 * store mints it.
 *
 * A change to what the verb prints fails here until the golden is re-cut (`yarn vitest run --config
 * config/vitest/unit.ts <this file> --update`), and the re-cut golden fails the site half until the reader draws it.
 */
import { describe, expect, it } from "vitest";

import { importQuestionsReport } from "../../../../../cli/commands/store/importQuestionsRun.js";
import type { UnresolvedImportQuestion } from "../../../../../store/transfer/importAnswers.js";

/** Where both halves read the contract; relative to this file, as `toMatchFileSnapshot` resolves it. */
const GOLDEN = "../../../../fixtures/contract/store-import-questions.json";

const QUESTIONS: readonly UnresolvedImportQuestion[] = [
  {
    actions: ["activate", "leave-inactive"],
    batchId: "00000000-0000-4000-8000-0000000000a1",
    current: null,
    imported: "acme-directive-1: always open a draft pull request for the acme-admin repo",
    key: "acme-directive-1",
    kind: "activation",
    part: "owner-directives",
    questionId: "import-q-00000000000000a1",
    stagedAtIso: "2026-10-30T09:00:00.000Z",
  },
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
    actions: ["keep-current"],
    batchId: "00000000-0000-4000-8000-0000000000b2",
    current: "lesson: acme's widget queue drains in order",
    imported: "lesson: acme's widget queue drains out of order",
    key: "l-0000000000000001",
    kind: "alignment",
    part: "memories",
    questionId: "import-q-00000000000000c3",
    stagedAtIso: "2026-10-31T10:30:00.000Z",
  },
];

describe("store import-questions --json, the contract the console reads", () => {
  it("prints exactly the golden the console's reader is tested against", async () => {
    const report = importQuestionsReport({ observedAtIso: "2026-11-01T08:00:00.000Z", questions: QUESTIONS });

    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot(GOLDEN);
  });

  it("prints every question it was given, in the order the store listed them", () => {
    const report = importQuestionsReport({ observedAtIso: "2026-11-01T08:00:00.000Z", questions: QUESTIONS });

    expect(report.questions.map((question) => question.questionId)).toEqual([
      "import-q-00000000000000a1",
      "import-q-00000000000000b2",
      "import-q-00000000000000c3",
    ]);
  });

  it("prints a measured zero as an empty list, never an absent one", () => {
    expect(importQuestionsReport({ observedAtIso: "2026-11-01T08:00:00.000Z", questions: [] })).toEqual({
      observedAtIso: "2026-11-01T08:00:00.000Z",
      questions: [],
    });
  });
});
