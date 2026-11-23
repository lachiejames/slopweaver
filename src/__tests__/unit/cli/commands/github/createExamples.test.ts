import { describe, expect, it } from "vitest";

import { printedExample } from "../../../../../cli/commands/github/createExamples.js";
import { renderAuthoringFile } from "../../../../../outbound/github/authoringFile.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { prVoiceBriefLines } from "../../../../../outbound/github/voiceBrief.js";

const BRIEF_THEN_BLANK: readonly string[] = [...prVoiceBriefLines({}), ""];

const FORM_EXPLANATION =
  'a complete, valid --form (inline runs use kind "text"|"strong"|"em"|"code"|"link"; a proof slot is ' +
  '{"kind":"reason",...} or {"kind":"screenshot",...} with an image hosted by `slopweaver github attach`; ' +
  "the badges are derived, never written):";

const FILE_EXPLANATION =
  "a complete, valid --file (a markdown+frontmatter authoring file, the human-editable alternative to --form's JSON):";

/** The form example: the brief, then the explanation and the example, and no review, since none is published. */
const FORM_EXAMPLE_LINES: readonly string[] = [
  ...BRIEF_THEN_BLANK,
  FORM_EXPLANATION,
  JSON.stringify(EXAMPLE_PR_FORM, null, 2),
];

const FILE_EXAMPLE_LINES: readonly string[] = [
  ...BRIEF_THEN_BLANK,
  FILE_EXPLANATION,
  renderAuthoringFile({ form: EXAMPLE_PR_FORM }),
];

/** Run printedExample with a capturing sink. */
function run({ formExample, fileExample }: { formExample: boolean; fileExample: boolean }): {
  readonly printed: boolean;
  readonly lines: readonly string[];
} {
  const lines: string[] = [];
  const printed = printedExample({
    args: { fileExample, formExample },
    deps: {
      out: ({ line }) => {
        lines.push(line);
      },
    },
  });
  return { lines, printed };
}

describe("printedExample", () => {
  it("prints the voice brief and the form example for --form-example alone", () => {
    expect(run({ fileExample: false, formExample: true })).toEqual({ lines: FORM_EXAMPLE_LINES, printed: true });
  });

  it("prints the voice brief and the authoring file for --file-example alone", () => {
    expect(run({ fileExample: true, formExample: false })).toEqual({ lines: FILE_EXAMPLE_LINES, printed: true });
  });

  it("gives the form example precedence when both flags are given", () => {
    expect(run({ fileExample: true, formExample: true })).toEqual({ lines: FORM_EXAMPLE_LINES, printed: true });
  });

  it("prints nothing and reports false when neither flag is given", () => {
    expect(run({ fileExample: false, formExample: false })).toEqual({ lines: [], printed: false });
  });

  it("keeps the two examples distinguishable", () => {
    expect(FORM_EXAMPLE_LINES).not.toEqual(FILE_EXAMPLE_LINES);
  });
});
