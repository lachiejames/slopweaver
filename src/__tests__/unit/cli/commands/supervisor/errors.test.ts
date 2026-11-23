/**
 * The `supervisor` verbs' refusal lines. A flag parser's refusals, a tick draft's source and shape problems,
 * and the tick ledger's own refusals are each a list — two of them under a heading with their entries
 * indented — and the helper must keep giving them back one line each rather than as the joined `message`.
 */
import { describe, expect, it } from "vitest";

import { SupervisorErrors, supervisorErrorLines } from "../../../../../cli/commands/supervisor/errors.js";
import { DERIVE_SUMMARY_HINT } from "../../../../../supervisor/outcomes/summaryMarker.js";

describe("supervisorErrorLines", () => {
  it.each([
    ["flagsRefused", SupervisorErrors.flagsRefused({ reasons: ["first", "second"] })],
    ["draftSourcesRefused", SupervisorErrors.draftSourcesRefused({ reasons: ["first", "second"] })],
  ])("prints each of %s's reasons on its own line", (_name, error) => {
    expect(supervisorErrorLines({ error })).toStrictEqual(["first", "second"]);
  });

  it("prints each --actions/--judgements document that is not an array on its own line", () => {
    expect(
      supervisorErrorLines({
        error: SupervisorErrors.draftInputsNotArrays({ actionsPath: "a.json", judgementsPath: "j.json" }),
      }),
    ).toStrictEqual([
      "--actions a.json is not a JSON array of tick actions",
      "--judgements j.json is not a JSON array of judgements",
    ]);
  });

  it("prints a draft tick-record would refuse as its heading, then each refusal indented", () => {
    expect(
      supervisorErrorLines({ error: SupervisorErrors.draftWouldBeRefused({ refusals: ["first", "second"] }) }),
    ).toStrictEqual(["the draft would be refused by tick-record:", "  first", "  second"]);
  });

  it("prints a document that is not a draft as its heading, then each issue indented", () => {
    expect(
      supervisorErrorLines({ error: SupervisorErrors.notATickDraft({ issues: ["tickId: Required"] }) }),
    ).toStrictEqual(["the draft is not a `supervisor tick-record` draft:", "  tickId: Required"]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(supervisorErrorLines({ error: SupervisorErrors.rowValueMissing() })).toStrictEqual(["--row needs a value"]);
  });

  it("prints an unreadable successor summary as the read's own lines, then the hint", () => {
    const inner = SupervisorErrors.stepFailed({ cause: new Error("ENOENT"), label: "read /s.md" });
    expect(supervisorErrorLines({ error: SupervisorErrors.summaryUnreadable({ inner }) })).toStrictEqual([
      "read /s.md: ENOENT",
      DERIVE_SUMMARY_HINT,
    ]);
  });

  it("prints an unreadable reconciliation as the cause's own message, unprefixed", () => {
    expect(SupervisorErrors.reconciliationUnreadable({ cause: new Error("Unexpected token") }).message).toBe(
      "Unexpected token",
    );
    expect(SupervisorErrors.reconciliationUnreadable({ cause: 3 }).message).toBe(
      "the reconciliation could not be read",
    );
  });
});
