/*
 * `parseAnswerArm` scans the Details fold too: a bare reference carried only by a blind spot or an unlinked
 * evidence label is refused at that field's own path, and a label carrying its own url is left alone. It moved
 * here when `parseAnswerArm.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import { NO_CONTEXT } from "./harness.js";

describe("parseAnswerArm — the Details fold is in scope", () => {
  /* Each case here has its OWN mutation, because the two halves of the fold rule pull in opposite
     directions and one mutation cannot witness both. The two refusal cases redden when the scan is unwired
     from the form — replace `...groundingProse({ grounding: answer.grounding })` in `answerForm.ts` with
     `...[]` and re-run this file. The url-carrying case cannot: it asserts an Ok, so a removed refusal
     leaves it green. It reddens when `groundingRefs.ts` stops SKIPPING a line that carries its own url —
     force that `if (line.url === undefined)` branch taken and re-run. Before this block, the first mutation
     left the whole file green.  */
  const CLEAN: Readonly<Record<string, string | undefined>> = {};

  /** An answer whose body names nothing, so every reference a case declares sits in the fold alone. */
  function foldAnswer({
    blindSpots = [],
    read = [],
  }: {
    blindSpots?: readonly string[];
    read?: readonly unknown[];
  } = {}): unknown {
    const couldNotSee =
      blindSpots.length === 0 ? { blindSpots: [], reason: "no live check needed" } : { blindSpots: [...blindSpots] };
    return {
      body: [{ runs: [{ text: "the pool exhausted at 09:12", type: "text" }], type: "paragraph" }],
      citations: [],
      grounding: {
        evidence: { consultedEmpty: [], couldNotSee, premiseChecks: [], read },
        kind: "conversation",
        provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
        reason: "context and judgement alone were sufficient",
      },
      images: [],
      index: [],
      kind: "answer",
      lead: "the staging pool exhausted",
    };
  }

  it("REFUSES a bare reference carried ONLY by a blind spot, naming that field's own path", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: CLEAN,
      raw: foldAnswer({ blindSpots: ["the revert acme/widget#11398 was never read"] }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("grounding.evidence.couldNotSee.blindSpots.0");
    expect(errors[0]).toContain("renders to the reader as plain text here");
    expect(errors[0]).toContain("nowhere to put a link");
  });

  it("tells an UNLINKED evidence label to fill in its own url rather than move the reference", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: CLEAN,
      raw: foldAnswer({ read: [{ label: "acme/widget#10919 and its revert" }] }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("grounding.evidence.read.0.label");
    expect(errors[0]).toContain("carries its own `url` field");
  });

  it("leaves that same label alone once it carries a url, because the label IS the link text", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: NO_CONTEXT,
        env: CLEAN,
        raw: foldAnswer({
          read: [{ label: "acme/widget#10919 and its revert", url: "https://github.com/acme/widget/pull/10919" }],
        }),
      }),
    );
    expect(answer.grounding.evidence.read).toEqual([
      { label: "acme/widget#10919 and its revert", url: "https://github.com/acme/widget/pull/10919" },
    ]);
  });
});
