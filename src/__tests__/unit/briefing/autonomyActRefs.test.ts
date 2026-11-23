import { describe, expect, it } from "vitest";

import type { AutonomyAction, AutonomyActionRow } from "../../../autonomy/types.js";
import { bareReferenceErrors, standingWordReferenceErrors } from "../../../briefing/autonomyActRefs.js";
import { plainTextRefsOf } from "../../../briefing/bareRef.js";

const SUBJECT = "https://github.com/acme/acme-admin/pull/9876";

/** One act on the incident's subject, with `over` replacing any field. */
function act(over: Partial<AutonomyActionRow>): AutonomyAction {
  const action: AutonomyActionRow = {
    actionId: "9876-rerun",
    bySession: "workspace:1 demo",
    doneIso: "2026-10-02T01:20:00Z",
    kind: "rerun-failed-ci",
    subject: SUBJECT,
    why: "Nx Cloud was down",
    witness: "slopweaver github rerun -> attempt 2",
    ...over,
  };
  return { action, classSteer: undefined, latestSteer: undefined, patternSteer: undefined };
}

describe("bareReferenceErrors", () => {
  it("refuses the incident's five-digit reference against a four-digit subject", () => {
    const errors = bareReferenceErrors({ entry: act({ why: "Nx Cloud was re-enabled (#18273)" }) });

    expect(errors.map((error) => error.code)).toEqual(["BARE_REFERENCE"]);
    expect(errors[0]!.reason).toContain('"#18273"');
  });

  it("passes an act whose every reference the render links", () => {
    expect(bareReferenceErrors({ entry: act({ said: "see acme/acme-admin#18273", why: "follows #9871" }) })).toEqual(
      [],
    );
  });
});

describe("standingWordReferenceErrors", () => {
  it("refuses a bare reference with no act's links behind it, and passes one written in full", () => {
    expect(standingWordReferenceErrors({ word: "fine, after #16640" }).map((error) => error.code)).toEqual([
      "BARE_REFERENCE",
    ]);
    expect(standingWordReferenceErrors({ word: "fine, after acme/acme-admin#16640" })).toEqual([]);
  });
});

describe("plainTextRefsOf", () => {
  it("reads a fragment with its links removed whole, and keeps a reference the fragment's links resolve", () => {
    const html = '<p><a href="https://github.com/o/r/pull/50">#50</a>#51 and <code>#52</code></p>';

    expect(plainTextRefsOf({ html })).toEqual([{ raw: "#51", refusal: undefined, where: "the page header" }]);
  });
});
