/*
 * A hand step cites an HTML document by an address the owner can open, never by its file name (any HTML mentioned in a draft or card gets a citation
 * so it opens in the viewer).
 */
import { describe, expect, it } from "vitest";

import { HandStepErrors } from "../../../hand/errors.js";
import { htmlInProse } from "../../../hand/htmlInProse.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

const VIEWER = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fleavers-access-briefing%2Findex.html&back=%2Fqueue";

const DRAFT: HandStepDraft = {
  id: "leavers-briefing-read",
  postedBy: "workspace:1",
  postedIso: "2026-10-07T01:00:00.000Z",
  row: "leavers-access",
  unblocks: "The leavers group DM can go out with the briefing they have read",
  url: VIEWER,
  what: "Read the leavers access briefing, so the group DM can go out",
  witness: "slopweaver hand done leavers-briefing-read",
};

/** A step built by the real builder from the draft with a case's changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...DRAFT, ...over } }));
}

describe("htmlInProse", () => {
  it("passes a step whose prose names no HTML file, citing the page by --url", () => {
    expect(htmlInProse({ step: step() })).toBe(undefined);
  });

  it("refuses the first field naming one, with the file and the way to cite it", () => {
    expect(htmlInProse({ step: step({ where: "the briefing, leavers-access-briefing.html" }) })).toEqual(
      HandStepErrors.invalidField({
        field: "where",
        why:
          'names the HTML "leavers-access-briefing.html" as a file name, which nothing on the console opens — ' +
          "publish it with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
          "`slopweaver page review-prepare`) and cite the viewer address it prints, " +
          "pass that address as --url, or attach it to the draft so its card carries an Open in the viewer chip",
      }),
    );
  });

  it("is a posting rule", () => {
    const named = step({ where: "the briefing, leavers-access-briefing.html" });
    expect(postingRefusal({ step: named })).toEqual(htmlInProse({ step: named }));
    expect(postingRefusal({ step: step() })).toBe(undefined);
  });
});
