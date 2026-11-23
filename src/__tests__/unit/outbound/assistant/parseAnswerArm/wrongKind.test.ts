/*
 * `parseAnswerArm` refuses a file declaring any string `kind` but `answer` by name, with where that content
 * goes, rather than as the schema's pile of missing-field issues around one literal mismatch.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import { VALID_ANSWER_CONVERSATION } from "../answerForm/fixtures.js";
import { NO_CONTEXT } from "./harness.js";

describe("parseAnswerArm — a non-answer kind is refused by name", () => {
  it.each(["plan", "drip", "as-me"])("refuses a %s form with one message naming the as-me lane", (kind) => {
    const parsed = parseAnswerArm({ context: NO_CONTEXT, env: {}, raw: { kind, messages: [] } });

    expect(unwrapErr(parsed)).toEqual([
      `the answer file is a \`${kind}\` form — only \`kind: "answer"\` is accepted here; a post under the owner's own name goes through \`slack post --as me\`'s own forms`,
    ]);
  });

  it("leaves an answer form to the schema", () => {
    const parsed = parseAnswerArm({ context: NO_CONTEXT, env: {}, raw: VALID_ANSWER_CONVERSATION });

    expect(unwrap(parsed).lead).toBe(VALID_ANSWER_CONVERSATION.lead);
  });
});
