/*
 * The register's half of the pattern mirror: the REAL fold prints exactly the table's payloads and draws exactly
 * its groups. `site/__tests__/unit/actPatternMirror.test.ts` holds the page to the same table; the table and why
 * it is split are in `../../fixtures/autonomyPatternCases.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  autonomyPatternKeys,
  filterAutonomyActions,
  foldAutonomy,
  groupPatterns,
  ruleOf,
} from "../../../autonomy/query.js";
import type { AutonomyAction, AutonomyRecord } from "../../../autonomy/types.js";
import { unwrap } from "../../../lib/result.js";
import {
  PATTERN_CASES,
  PATTERN_WORD,
  payloadOf,
  SCOPED_ACTS,
  SCOPED_GROUPS,
  SCOPED_PAYLOAD,
  SCOPED_RULE,
  wordedPayloadOf,
} from "../../fixtures/autonomyPatternCases.js";

/** The register's patterns over its own fold, as action ids. */
function registerGroups({ entries }: { entries: readonly AutonomyAction[] }): readonly (readonly string[])[] {
  return groupPatterns({
    items: entries,
    keysOf: (entry) => autonomyPatternKeys({ action: entry.action, rule: ruleOf({ entry }) }),
  }).map((group) => group.map((entry) => entry.action.actionId));
}

describe("the register over the pattern table", () => {
  it("prints each case's payload and draws its groups", () => {
    expect(PATTERN_CASES.length).toBeGreaterThan(0);
    const drawn = PATTERN_CASES.map((patternCase) => {
      const entries = unwrap(foldAutonomy({ records: patternCase.acts.toReversed() }));
      return { groups: registerGroups({ entries }), printed: entries };
    });
    // `toEqual` ignores a key whose value is undefined, as `JSON.stringify` drops it from the printed line.
    expect(drawn.map(({ printed }) => printed)).toEqual(PATTERN_CASES.map(({ acts }) => payloadOf({ acts })));
    expect(drawn.map(({ groups }) => groups)).toEqual(PATTERN_CASES.map(({ groups }) => groups));
  });

  it("prints each case with the owner's word on every pattern's newest act as the worded payload, asking nothing", () => {
    const worded = PATTERN_CASES.map((patternCase) => {
      const steers: readonly AutonomyRecord[] = patternCase.groups.map((group) => ({
        actionId: group[0]!,
        ...PATTERN_WORD,
      }));
      const entries = unwrap(foldAutonomy({ records: [...patternCase.acts.toReversed(), ...steers] }));
      return { asking: filterAutonomyActions({ actions: entries, unsteered: true }).length, printed: entries };
    });
    expect(worded.map(({ printed }) => printed)).toEqual(
      PATTERN_CASES.map((patternCase) => wordedPayloadOf({ patternCase })),
    );
    expect(worded.map(({ asking }) => asking)).toEqual(PATTERN_CASES.map(() => 0));
  });

  it("keeps an act a scoped rule covers apart from a newer act in its sentence the rule does not cover", () => {
    const entries = unwrap(foldAutonomy({ records: [...SCOPED_ACTS.toReversed(), SCOPED_RULE] }));
    expect(entries).toEqual(SCOPED_PAYLOAD);
    expect(registerGroups({ entries })).toEqual(SCOPED_GROUPS);
    expect(filterAutonomyActions({ actions: entries, unsteered: true }).map((entry) => entry.action.actionId)).toEqual([
      "N",
    ]);
  });
});
