/*
 * A hand step's do-nothing line (`ifIgnored`): built, refused, carried through the register, and read by the same
 * posting rules as the prose beside it. A card says
 * what happens if the owner does nothing and
 * what they might not like about it.
 */
import { describe, expect, it } from "vitest";

import { uncitedNumbers } from "../../../hand/cites.js";
import { commandInProse } from "../../../hand/commandInProse.js";
import { HandStepErrors } from "../../../hand/errors.js";
import { noteFooter } from "../../../hand/note/footer.js";
import { posterProse } from "../../../hand/proseFields.js";
import { conflictingField, parseHandLine } from "../../../hand/row.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { IF_IGNORED_CAP } from "../../../hand/stepConsequence.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DRAFT: HandStepDraft = {
  id: "datadog-monitor-deploy-approval",
  ifIgnored: "the Datadog monitor deploy stays unshipped, so its alerts stay off",
  postedBy: "workspace:5",
  postedIso: "2026-10-05T01:00:00.000Z",
  unblocks: "the Datadog monitor deploy",
  what: "Approve the Datadog monitor deploy on the pull request",
  witness: "slopweaver hand done datadog-monitor-deploy-approval --did approved",
};

/**
 * A step built by the real builder from the draft with a case's changes.
 *
 * @returns the built step
 */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...DRAFT, ...over } }));
}

describe("buildHandStep's do-nothing line", () => {
  it("carries the line it is given, trimmed", () => {
    expect(step({ ifIgnored: "  the alerts stay off  " }).ifIgnored).toBe("the alerts stay off");
  });

  it("leaves the field off a step that carries none", () => {
    expect(Object.keys(step({ ifIgnored: undefined }))).not.toContain("ifIgnored");
  });

  it("refuses an empty line rather than folding it into absence", () => {
    expect(unwrapErr(buildHandStep({ draft: { ...DRAFT, ifIgnored: "  " } }))).toEqual(
      HandStepErrors.invalidField({ field: "ifIgnored", why: "is required and was empty" }),
    );
  });

  it("refuses a line over the cap rather than truncating it", () => {
    const refused = unwrapErr(buildHandStep({ draft: { ...DRAFT, ifIgnored: "a".repeat(IF_IGNORED_CAP + 1) } }));
    expect(refused.message).toContain("is 201 characters and the cap is 200");
  });

  it("refuses a value that is not a sentence", () => {
    const refused = unwrapErr(buildHandStep({ draft: { ...DRAFT, ifIgnored: 3 } }));
    expect(refused).toEqual(expect.objectContaining({ code: "INVALID_FIELD", field: "ifIgnored" }));
  });
});

describe("the register", () => {
  it("reads the line back off a posted row", () => {
    const row = unwrap(parseHandLine({ line: JSON.stringify({ kind: "posted", step: step() }), lineNumber: 1 }));
    expect(row).toEqual({ kind: "posted", step: step() });
  });

  it("names a corrupt line whose do-nothing value is not a sentence", () => {
    const refused = unwrapErr(
      parseHandLine({ line: JSON.stringify({ kind: "posted", step: { ...step(), ifIgnored: 3 } }), lineNumber: 4 }),
    );
    expect(refused.code).toBe("CORRUPT_ROW");
    expect(refused.message).toContain("ifIgnored");
  });

  it("calls two postings that differ only in the line a conflict on it", () => {
    expect(conflictingField({ first: step(), second: step({ ifIgnored: "nothing the owner would miss" }) })).toBe(
      "ifIgnored",
    );
  });
});

describe("the posting rules read it as they read unblocks", () => {
  it("is poster prose beside what and unblocks", () => {
    expect(posterProse({ step: step() }).map(({ field }) => field)).toEqual(["what", "unblocks", "ifIgnored"]);
  });

  it("refuses a command of the owner's inside it", () => {
    const refused = commandInProse({ step: step({ ifIgnored: "nothing ships until claude login is done" }) });
    expect(refused).toEqual(expect.objectContaining({ code: "INVALID_FIELD", field: "ifIgnored" }));
  });

  it("refuses a numbered reference it does not cite", () => {
    const refused = uncitedNumbers({ step: step({ ifIgnored: "#16672 stays unmerged" }) });
    expect(refused!.message).toContain("#16672");
  });
});

describe("noteFooter", () => {
  it("leads on the do-nothing line when the step carries one", () => {
    expect(noteFooter({ step: step() })).toBe(
      "If you do nothing: the Datadog monitor deploy stays unshipped, so its alerts stay off",
    );
  });

  it("falls back to unblocks on a step written before the field existed", () => {
    expect(noteFooter({ step: step({ ifIgnored: undefined }) })).toBe("the Datadog monitor deploy");
  });
});
