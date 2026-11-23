import { describe, expect, it } from "vitest";

import {
  conflictingField,
  filterAutonomyActions,
  findAutonomyAction,
  foldAutonomy,
  steerOf,
} from "../../../autonomy/query.js";
import type { AutonomyActionRow, AutonomyRecord, AutonomySteerRow } from "../../../autonomy/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One act, varying only what a test cares about. */
function act({
  actionId = "a-one",
  kind = "press-merge-when-ready",
  subject = "https://github.com/acme/acme-admin/pull/16644",
  doneIso = "2026-09-12T02:06:09Z",
  bySession = "workspace:123",
  why = "obvious",
  witness = "slopweaver github enqueue --pr 16644",
  steer,
}: {
  actionId?: string;
  kind?: string;
  subject?: string;
  doneIso?: string;
  bySession?: string;
  why?: string;
  witness?: string;
  steer?: string;
} = {}): AutonomyActionRow {
  const base: AutonomyActionRow = { actionId, bySession, doneIso, kind, subject, why, witness };
  return steer === undefined ? base : { ...base, steer };
}

/** One steer. */
function steerRow({
  actionId = "a-one",
  steer = "yep",
  steeredIso = "2026-09-12T04:00:00Z",
  bySession = "supervisor",
}: {
  actionId?: string;
  steer?: string;
  steeredIso?: string;
  bySession?: string;
} = {}): AutonomySteerRow {
  return { actionId, bySession, steer, steeredIso };
}

describe("folding the register", () => {
  it("puts the newest act first whatever order the file is in", () => {
    const records: readonly AutonomyRecord[] = [
      act({ actionId: "a-old", doneIso: "2026-09-12T02:06:09Z" }),
      act({ actionId: "a-new", doneIso: "2026-09-12T02:18:27Z" }),
      act({ actionId: "a-mid", doneIso: "2026-09-12T02:15:51Z" }),
    ];
    const folded = unwrap(foldAutonomy({ records }));
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["a-new", "a-mid", "a-old"]);
  });

  it("breaks a tie on the act id, so two reads of one file agree", () => {
    const records: readonly AutonomyRecord[] = [
      act({ actionId: "a-zulu", doneIso: "2026-09-12T02:15:51.000Z" }),
      act({ actionId: "a-alpha", doneIso: "2026-09-12T02:15:51.000Z" }),
    ];
    const folded = unwrap(foldAutonomy({ records }));
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["a-alpha", "a-zulu"]);
  });

  it("folds the owner's latest steer onto the act it names", () => {
    const folded = unwrap(foldAutonomy({ records: [act(), steerRow({ steer: "yep, exactly right" })] }));
    expect(folded[0]!.latestSteer!.steer).toBe("yep, exactly right");
  });

  it("lets a later steer supersede an earlier one, by append order", () => {
    const records: readonly AutonomyRecord[] = [
      act(),
      steerRow({ steer: "first word", steeredIso: "2026-09-12T09:00:00Z" }),
      steerRow({ steer: "second word", steeredIso: "2026-09-12T04:00:00Z" }),
    ];
    const folded = unwrap(foldAutonomy({ records }));
    expect(folded[0]!.latestSteer!.steer).toBe("second word");
  });

  it("drops a steer naming an act the register does not carry", () => {
    const folded = unwrap(foldAutonomy({ records: [act(), steerRow({ actionId: "a-missing" })] }));
    expect(folded.length).toBe(1);
    expect(folded[0]!.latestSteer).toBe(undefined);
  });

  it("folds an identical retry of one act to a single entry", () => {
    const folded = unwrap(foldAutonomy({ records: [act(), act()] }));
    expect(folded.length).toBe(1);
  });

  it("refuses two acts that share an id and disagree, naming the field", () => {
    const error = unwrapErr(
      foldAutonomy({ records: [act(), act({ subject: "https://github.com/acme/acme-admin/pull/99999" })] }),
    );
    expect(error.code).toBe("ACTION_ID_CONFLICT");
    expect(error.message).toContain("subject");
  });

  it("reports an empty register as no acts rather than as a failure", () => {
    expect(unwrap(foldAutonomy({ records: [] })).length).toBe(0);
  });
});

describe("which word governs an act", () => {
  it("takes the act's own inline steer when the owner has said nothing since", () => {
    const folded = unwrap(foldAutonomy({ records: [act({ steer: "they had already said this" })] }));
    expect(steerOf({ action: folded[0]! })).toBe("they had already said this");
  });

  it("lets a steer event supersede the inline one", () => {
    const folded = unwrap(
      foldAutonomy({ records: [act({ steer: "the old word" }), steerRow({ steer: "the new word" })] }),
    );
    expect(steerOf({ action: folded[0]! })).toBe("the new word");
  });

  it("is absent when the owner has said nothing at all", () => {
    const folded = unwrap(foldAutonomy({ records: [act()] }));
    expect(steerOf({ action: folded[0]! })).toBe(undefined);
  });
});

describe("conflictingField", () => {
  it("finds nothing between two identical recordings", () => {
    expect(conflictingField({ first: act(), second: act() })).toBe(undefined);
  });

  it("names why, which two sessions could plausibly disagree about", () => {
    expect(conflictingField({ first: act(), second: act({ why: "a different reason" }) })).toBe("why");
  });

  it("names said, which decides the pattern an act joins", () => {
    expect(conflictingField({ first: { ...act(), said: "one line" }, second: { ...act(), said: "one line." } })).toBe(
      "said",
    );
  });
});

describe("filtering acts", () => {
  const records: readonly AutonomyRecord[] = [
    act({ actionId: "a-one", doneIso: "2026-09-12T02:06:09Z", kind: "press-merge-when-ready" }),
    act({
      actionId: "a-two",
      bySession: "policy-dm-renders",
      doneIso: "2026-09-12T02:15:51Z",
      kind: "slack.post.bot.no-fold",
    }),
    act({ actionId: "a-three", doneIso: "2026-09-12T02:18:27Z", kind: "bump-stale-review-ask" }),
    steerRow({ actionId: "a-three", steer: "not that one" }),
  ];
  const actions = unwrap(foldAutonomy({ records }));

  it("returns everything when no facet is given", () => {
    expect(filterAutonomyActions({ actions }).length).toBe(3);
  });

  it("filters by kind", () => {
    const kept = filterAutonomyActions({ actions, kind: "slack.post.bot.no-fold" });
    expect(kept.map((entry) => entry.action.actionId)).toEqual(["a-two"]);
  });

  it("filters by a fragment of the session name", () => {
    const kept = filterAutonomyActions({ actions, bySession: "policy-dm" });
    expect(kept.map((entry) => entry.action.actionId)).toEqual(["a-two"]);
  });

  it("filters by instant, inclusively", () => {
    const kept = filterAutonomyActions({ actions, sinceIso: "2026-09-12T02:15:51Z" });
    expect(kept.map((entry) => entry.action.actionId)).toEqual(["a-three", "a-two"]);
  });

  it("keeps only the acts the owner has not spoken about", () => {
    const kept = filterAutonomyActions({ actions, unsteered: true });
    expect(kept.map((entry) => entry.action.actionId)).toEqual(["a-two", "a-one"]);
  });
});

describe("findAutonomyAction", () => {
  const actions = unwrap(foldAutonomy({ records: [act({ actionId: "a-one" }), act({ actionId: "a-two" })] }));

  it("finds the act a steer would name", () => {
    expect(findAutonomyAction({ actionId: "a-two", actions })!.action.actionId).toBe("a-two");
  });

  it("answers undefined for an id the register does not carry", () => {
    expect(findAutonomyAction({ actionId: "a-missing", actions })).toBe(undefined);
  });
});

describe("a polluted prototype cannot fabricate a word the owner never said", () => {
  // The harm is not the parse, it is what reads the parsed row. A
  // fabricated steer makes `unsteered` report that nothing is waiting on the owner, which is the opposite of
  // what this register exists to answer.
  it("reports an act as unsteered even when Object.prototype carries a steer", () => {
    // Built BEFORE the pollution, on purpose. `act()` destructures an optional `steer` out of its own
    // options object, and destructuring reads the prototype chain — so building it afterwards would give
    // the row a real own steer and test nothing. That hazard is why `steerOf` asks with `Object.hasOwn`.
    const records = [act()];
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["steer"] = "yes, keep merging";
    try {
      const folded = unwrap(foldAutonomy({ records }));
      expect(steerOf({ action: folded[0]! })).toBe(undefined);
      expect(filterAutonomyActions({ actions: folded, unsteered: true }).length).toBe(1);
    } finally {
      delete proto["steer"];
    }
  });

  it("still reports a REAL steer, so the guard cannot be passing by refusing everything", () => {
    const folded = unwrap(foldAutonomy({ records: [act(), steerRow({ steer: "yep, exactly right" })] }));
    expect(steerOf({ action: folded[0]! })).toBe("yep, exactly right");
    expect(filterAutonomyActions({ actions: folded, unsteered: true }).length).toBe(0);
  });
});

describe("foldAutonomy ordering below the millisecond", () => {
  /** Two acts inside one millisecond, whose ids sort the opposite way to their instants. */
  function microsecondPair(): readonly AutonomyRecord[] {
    return [
      act({ actionId: "aa", doneIso: "2026-09-12T02:06:09.000001Z" }),
      act({ actionId: "zz", doneIso: "2026-09-12T02:06:09.000999Z" }),
    ];
  }

  it("puts the later act first even when Date.parse reads both as the same instant", () => {
    const folded = unwrap(foldAutonomy({ records: microsecondPair() }));
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["zz", "aa"]);
  });

  it("compares fractional digits by value, not by their spelling", () => {
    const folded = unwrap(
      foldAutonomy({
        records: [
          act({ actionId: "aa", doneIso: "2026-09-12T02:06:09.0001Z" }),
          act({ actionId: "zz", doneIso: "2026-09-12T02:06:09.000999Z" }),
        ],
      }),
    );
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["zz", "aa"]);
  });

  it("still falls back to the id when two acts share an instant exactly", () => {
    const folded = unwrap(
      foldAutonomy({
        records: [
          act({ actionId: "zz", doneIso: "2026-09-12T02:06:09.000Z" }),
          act({ actionId: "aa", doneIso: "2026-09-12T02:06:09.000Z" }),
        ],
      }),
    );
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["aa", "zz"]);
  });
});

describe("foldAutonomy ordering below any precision a clock offers", () => {
  it("orders instants that differ only in their tenth fractional digit", () => {
    const folded = unwrap(
      foldAutonomy({
        records: [
          act({ actionId: "aa", doneIso: "2026-09-12T02:06:09.0000000001Z" }),
          act({ actionId: "zz", doneIso: "2026-09-12T02:06:09.0000000002Z" }),
        ],
      }),
    );
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["zz", "aa"]);
  });

  it("pads the shorter tail rather than comparing digit counts", () => {
    const folded = unwrap(
      foldAutonomy({
        records: [
          act({ actionId: "aa", doneIso: "2026-09-12T02:06:09.0009999999Z" }),
          act({ actionId: "zz", doneIso: "2026-09-12T02:06:09.001Z" }),
        ],
      }),
    );
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["zz", "aa"]);
  });
});

describe("conflictingField on two spellings of one instant", () => {
  it("does not call a retry a conflict when the zone offset differs but the moment does not", () => {
    const folded = unwrap(
      foldAutonomy({
        records: [
          act({ actionId: "a-one", doneIso: "2026-09-12T02:06:09Z" }),
          act({ actionId: "a-one", doneIso: "2026-09-12T12:06:09+10:00" }),
        ],
      }),
    );
    expect(folded.map((entry) => entry.action.actionId)).toEqual(["a-one"]);
  });

  it("treats an absent fraction and an explicit zero fraction as the same instant", () => {
    expect(
      conflictingField({
        first: act({ doneIso: "2026-09-12T02:06:09Z" }),
        second: act({ doneIso: "2026-09-12T02:06:09.000Z" }),
      }),
    ).toBeUndefined();
  });

  it("still names doneIso when the two rows really do describe different moments", () => {
    expect(
      conflictingField({
        first: act({ doneIso: "2026-09-12T02:06:09.000001Z" }),
        second: act({ doneIso: "2026-09-12T02:06:09.000002Z" }),
      }),
    ).toBe("doneIso");
  });
});

describe("conflictingField compares whether a field is THERE, not only its value", () => {
  it("names steer when one act carries it and the other does not, however the value compares", () => {
    // Built before the pollution and held, because `act`'s own destructured defaults read the prototype too.
    const without = act();
    const carrying = { ...act(), steer: "yes, keep merging" };
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["steer"] = "yes, keep merging";
    try {
      expect(conflictingField({ first: without, second: carrying })).toBe("steer");
    } finally {
      delete proto["steer"];
    }
  });

  it("names run when one act names a board row and the other does not", () => {
    expect(conflictingField({ first: act(), second: { ...act(), run: "some-run-slug" } })).toBe("run");
  });
});
