/*
 * The page's half of the pattern mirror: the check-in list draws exactly the table's groups from the lines
 * `autonomy list --json` prints. `src/__tests__/unit/autonomy/patternMirror.test.ts` holds the REAL register to
 * the same table — it prints exactly these payloads and draws exactly these groups — so the page and the register
 * draw one set of patterns. Why the mirror is split in two: `src/__tests__/fixtures/autonomyPatternCases.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  PATTERN_CASES,
  PATTERN_SAID,
  type PatternAct,
  payloadOf,
  SCOPED_GROUPS,
  SCOPED_PAYLOAD,
  wordedPayloadOf,
} from "../../../src/__tests__/fixtures/autonomyPatternCases";
import { readAutonomy } from "../../components/live/readAutonomy";
import { foldActs } from "../../lib/actGroups";
import { standingGroups } from "../../lib/standingRules";

const PR = "https://github.com/acme/acme-admin/pull";

/** One act as the register prints it, at a minute past 01:00 that orders it. */
function act({ id, subject, minute }: { id: string; subject: string; minute: number }): PatternAct {
  return {
    actionId: id,
    bySession: "mirror",
    doneIso: `2026-09-28T01:${String(minute).padStart(2, "0")}:00.000Z`,
    kind: "rebase",
    subject,
    why: "mirror",
    witness: "mirror",
  };
}

/** The page's cards for one payload, as each pattern's action ids, its lead first. */
function pageGroups({ payload }: { payload: readonly object[] }): readonly (readonly string[])[] {
  return foldActs({ acts: readAutonomy(payload)! }).map((group) => [
    group.act.actionId,
    ...group.earlier.map((was) => was.actionId),
  ]);
}

describe("the check-in list over the pattern table", () => {
  it("draws each case's groups, led by the same act, with no word given", () => {
    expect(PATTERN_CASES.length).toBeGreaterThan(0);
    expect(PATTERN_CASES.map(({ acts }) => pageGroups({ payload: payloadOf({ acts }) }))).toEqual(
      PATTERN_CASES.map(({ groups }) => groups),
    );
  });

  it("asks nothing once the owner's word is on every pattern's newest act", () => {
    expect(PATTERN_CASES.map((patternCase) => pageGroups({ payload: wordedPayloadOf({ patternCase }) }))).toEqual(
      PATTERN_CASES.map(() => []),
    );
  });

  it("keeps an act a scoped rule covers off the card of a newer act in its sentence, counted under that rule", () => {
    const acts = readAutonomy(SCOPED_PAYLOAD)!;
    expect(
      [...foldActs({ acts }), ...standingGroups({ acts })].map((group) => [
        group.act.actionId,
        ...group.earlier.map((was) => was.actionId),
      ]),
    ).toEqual(SCOPED_GROUPS);
    expect(standingGroups({ acts }).map((group) => group.act.standing!.classId)).toEqual(["b-rebases"]);
  });
});

describe("what the page's reader refuses to take from a line", () => {
  it("takes a word only off the register's own line, never an inherited one", () => {
    const action = act({ id: "a", minute: 1, subject: `${PR}/1` });
    const fake = "fake approval";
    const inheriting = ({ proto, fields }: { proto: object; fields: object }): object =>
      Object.assign(Object.create(proto) as object, fields);
    const standing = { kinds: "rebase", steer: fake };
    const payload = [
      inheriting({ fields: { action }, proto: { patternSteer: { actionId: "b", steer: fake } } }),
      inheriting({ fields: { action }, proto: { latestSteer: { steer: fake } } }),
      inheriting({ fields: { action }, proto: { classSteer: standing } }),
      { action: inheriting({ fields: action, proto: { steer: fake } }) },
      { action, latestSteer: inheriting({ fields: {}, proto: { steer: fake } }) },
      { action, patternSteer: inheriting({ fields: { actionId: "b" }, proto: { steer: fake } }) },
      { action, classSteer: inheriting({ fields: { kinds: "rebase" }, proto: { steer: fake } }) },
      { action, patternSteer: { actionId: "b", steer: "right call" } },
    ];
    expect(readAutonomy(payload)!.map((row) => row.steer)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "right call",
    ]);
  });

  it("groups only on the register's own sentence, never an inherited one", () => {
    const shared = { said: PATTERN_SAID };
    const payload = [2, 1].map((pull) => ({
      action: Object.assign(
        Object.create(shared) as object,
        act({ id: `a${String(pull)}`, minute: pull, subject: `${PR}/${String(pull)}` }),
      ),
    }));
    const rows = readAutonomy(payload)!;
    expect(rows.map((row) => row.said)).toEqual([undefined, undefined]);
    expect(foldActs({ acts: rows }).map((group) => group.act.actionId)).toEqual(["a2", "a1"]);
  });

  it("refuses a payload out of the register's newest-first order, so an older act never leads a pattern", () => {
    // Older O first, carrying the only word, would have taken newer N's card off the page.
    const older = { ...act({ id: "O", minute: 1, subject: `${PR}/1` }), steer: "approved" };
    const newer = act({ id: "N", minute: 2, subject: `${PR}/1` });
    const undated = { ...newer, doneIso: "not a time" };
    expect(
      [[{ action: newer }, { action: older }], [{ action: older }, { action: newer }], [{ action: undated }]].map(
        (payload) => readAutonomy(payload)?.length,
      ),
    ).toEqual([2, undefined, undefined]);
  });
});
