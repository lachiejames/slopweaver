/*
 * The CONSUMER half of the `store import-questions --json` contract: the console's reader draws every question of the
 * golden the verb's own test pins (`src/__tests__/unit/cli/commands/store/importQuestionsContract.test.ts`). The golden
 * is READ, never imported: `site/` is its own Yarn project, and its CI job installs nothing the verb's graph needs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readImportQuestions } from "../../components/live/readImportQuestions";

/** The golden the producer test writes. */
const GOLDEN = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/contract/store-import-questions.json", import.meta.url),
);

describe("the console reads every question store import-questions --json prints", () => {
  const reading = readImportQuestions(JSON.parse(readFileSync(GOLDEN, "utf8")));

  it("reads the register whole, in the order the verb printed it", () => {
    expect(reading!.questions.map((question) => [question.questionId, question.kind, question.part])).toEqual([
      ["import-q-00000000000000a1", "activation", "owner-directives"],
      ["import-q-00000000000000b2", "conflict", "standing-asks"],
      ["import-q-00000000000000c3", "alignment", "memories"],
    ]);
  });

  it("reads an activation's absent live side as undefined, and a conflict's and an alignment's as its line", () => {
    expect(reading!.questions.map((question) => question.current)).toEqual([
      undefined,
      "acme-ask-7: review ABC-1 before Friday",
      "lesson: acme's widget queue drains in order",
    ]);
  });

  it("reads exactly the answers each kind takes, in the verb's order", () => {
    expect(reading!.questions.map((question) => question.actions)).toEqual([
      ["activate", "leave-inactive"],
      ["keep-current", "take-imported"],
      ["keep-current"],
    ]);
  });

  it("carries each question's batch, key, imported line and staging instant", () => {
    expect(
      reading!.questions.map((question) => [question.batchId, question.key, question.imported, question.stagedAtIso]),
    ).toEqual([
      [
        "00000000-0000-4000-8000-0000000000a1",
        "acme-directive-1",
        "acme-directive-1: always open a draft pull request for the acme-admin repo",
        "2026-10-30T09:00:00.000Z",
      ],
      [
        "00000000-0000-4000-8000-0000000000b2",
        "acme-ask-7",
        "acme-ask-7: review ABC-1 before Thursday",
        "2026-10-31T10:30:00.000Z",
      ],
      [
        "00000000-0000-4000-8000-0000000000b2",
        "l-0000000000000001",
        "lesson: acme's widget queue drains out of order",
        "2026-10-31T10:30:00.000Z",
      ],
    ]);
  });
});
