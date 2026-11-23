/**
 * The pure judgements behind `handover tag`: reading a request, reducing it against what a row holds, and deciding
 * whether a guarded value is new to the board.
 */
import { describe, expect, it } from "vitest";

import { RowTagErrors } from "../../../handover/rowTagErrors.js";
import { type RowTag, TAG_KEYS, type TagKeySpec } from "../../../handover/rowTags.js";
import {
  boardValues,
  effectiveTagChange,
  guardedKeys,
  newValueProblems,
  parseTagRequest,
  type TagRequest,
} from "../../../handover/tagWrite.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ONE_VALUED = new Set(TAG_KEYS.filter((spec) => spec.cardinality === "one").map((spec) => spec.key));
const GUARDED = guardedKeys({ specs: TAG_KEYS });

/** A declared tag. */
function declared({ key, value }: { key: string; value: string }): RowTag {
  return { key, source: "declared", value };
}

/** A request parsed from CLI-shaped input, which must parse. */
function request({
  assignments = [],
  drops,
  newValues,
}: {
  assignments?: readonly string[];
  drops?: string;
  newValues?: string;
}): TagRequest {
  return unwrap(parseTagRequest({ assignments, drops, newValues }));
}

describe("parseTagRequest", () => {
  it("reads assignments, comma-separated drops and acknowledgements", () => {
    expect(
      request({
        assignments: ["platform=slack", "workstream=iso-certification"],
        drops: "impact,pr=lachiejames/slopweaver#1",
        newValues: "workstream=iso-certification",
      }),
    ).toEqual({
      drop: ["impact", "pr=lachiejames/slopweaver#1"],
      newValues: [{ key: "workstream", value: "iso-certification" }],
      set: [
        { key: "platform", value: "slack" },
        { key: "workstream", value: "iso-certification" },
      ],
    });
  });

  it("refuses a request that sets and drops nothing, so a caller's empty interpolation is never a success", () => {
    expect(unwrapErr(parseTagRequest({ assignments: [], drops: undefined, newValues: undefined }))).toEqual([
      "a tagged event must set or drop at least one tag",
    ]);
  });

  it("refuses an acknowledgement with nothing set, the same way", () => {
    expect(
      unwrapErr(parseTagRequest({ assignments: [], drops: undefined, newValues: "workstream=iso-certification" })),
    ).toEqual(["a tagged event must set or drop at least one tag"]);
  });

  it("refuses the same assignment twice, rather than recording more than the write did", () => {
    expect(
      unwrapErr(
        parseTagRequest({ assignments: ["workstream=a", "workstream=a"], drops: undefined, newValues: undefined }),
      ),
    ).toEqual([RowTagErrors.repeated({ text: "workstream=a" }).message]);
  });

  it("refuses the same drop twice", () => {
    expect(unwrapErr(parseTagRequest({ assignments: [], drops: "impact,impact", newValues: undefined }))).toEqual([
      RowTagErrors.repeated({ text: "--drop impact" }).message,
    ]);
  });

  it("refuses the whole request when one part is misspelt, naming the nearest key", () => {
    expect(
      unwrapErr(
        parseTagRequest({ assignments: ["platfrom=slack", "impact=high"], drops: undefined, newValues: undefined }),
      ),
    ).toEqual([RowTagErrors.unknownKey({ key: "platfrom", known: "", nearest: "platform" }).message]);
  });

  it("refuses a value holding the list separator, for every key", () => {
    expect(
      unwrapErr(parseTagRequest({ assignments: ["pr=a/b#1,a/b#2"], drops: undefined, newValues: undefined })),
    ).toEqual([RowTagErrors.separatorInValue({ key: "pr", separator: "," }).message]);
  });
});

describe("effectiveTagChange", () => {
  it("appends only what the row does not already hold, and reports the rest as satisfied", () => {
    const change = effectiveTagChange({
      held: [declared({ key: "platform", value: "slack" }), declared({ key: "workstream", value: "a" })],
      oneValued: ONE_VALUED,
      request: request({ assignments: ["platform=slack", "workstream=a", "workstream=b"], drops: "impact" }),
    });
    expect(change).toEqual({
      drop: [],
      satisfied: ["platform=slack", "workstream=a", "--drop impact"],
      set: [{ key: "workstream", value: "b" }],
    });
  });

  it("re-writes a one-valued key held ambiguously, since writing it is what settles it", () => {
    const change = effectiveTagChange({
      held: [declared({ key: "impact", value: "high" }), { key: "impact", source: "unrecognised", value: "low" }],
      oneValued: ONE_VALUED,
      request: request({ assignments: ["impact=high"] }),
    });
    expect(change.set).toEqual([{ key: "impact", value: "high" }]);
  });

  it("drops a key whose only value is unrecognised — a filter still sees it", () => {
    const change = effectiveTagChange({
      held: [{ key: "legacy", source: "unrecognised", value: "x" }, declared({ key: "workstream", value: "a" })],
      oneValued: ONE_VALUED,
      request: request({ drops: "workstream=a,workstream=b" }),
    });
    expect(change).toEqual({ drop: ["workstream=a"], satisfied: ["--drop workstream=b"], set: [] });
  });
});

describe("guardedKeys", () => {
  it("guards workstream, substream and area in today's registry", () => {
    expect([...GUARDED]).toEqual(["workstream", "substream", "area"]);
  });

  it("reads the flag off any spec, so a key that opts in is guarded with no code naming it", () => {
    const team: TagKeySpec = {
      cardinality: "many",
      key: "team",
      meaning: "a synthetic second guarded key",
      newValueNeedsFlag: true,
      source: "declared",
      values: { kind: "pattern", pattern: /^[a-z]+$/u, shape: "a word" },
    };
    const guarded = guardedKeys({ specs: [...TAG_KEYS, team] });
    expect([...guarded]).toEqual(["workstream", "substream", "area", "team"]);
    expect(
      boardValues({
        guarded,
        rows: [[declared({ key: "team", value: "billing" })], [declared({ key: "workstream", value: "a" })]],
      }),
    ).toEqual(
      new Map([
        ["workstream", new Set(["a"])],
        ["substream", new Set()],
        ["area", new Set()],
        ["team", new Set(["billing"])],
      ]),
    );
  });
});

describe("boardValues", () => {
  it("counts declared values only — an unrecognised spelling is no precedent", () => {
    expect(
      boardValues({
        guarded: GUARDED,
        rows: [
          [declared({ key: "workstream", value: "a" }), { key: "workstream", source: "unrecognised", value: "B" }],
        ],
      }),
    ).toEqual(
      new Map([
        ["workstream", new Set(["a"])],
        ["substream", new Set()],
        ["area", new Set()],
      ]),
    );
  });
});

describe("newValueProblems", () => {
  const existing = new Map([["workstream", new Set(["iso-certification", "hiring"])]]);

  /** Judge one request against the board above. */
  function judge({ input, unreadableJournals = 0 }: { input: TagRequest; unreadableJournals?: number }) {
    const change = effectiveTagChange({ held: [], oneValued: ONE_VALUED, request: input });
    return newValueProblems({ change, existing, guarded: GUARDED, request: input, unreadableJournals });
  }

  it("lets an existing value through with nothing to acknowledge", () => {
    expect(judge({ input: request({ assignments: ["workstream=hiring"] }) })).toEqual({ problems: [], redundant: [] });
  });

  it("refuses a new value unacknowledged, naming the nearest existing spelling", () => {
    expect(judge({ input: request({ assignments: ["workstream=iso-certificaton"] }) }).problems).toEqual([
      "workstream=iso-certificaton is new — no row on the board carries it — did you mean iso-certification?; pass --new-value workstream=iso-certificaton if it is meant",
    ]);
  });

  it("says how many journals it could not read, so the refusal never claims certainty", () => {
    expect(judge({ input: request({ assignments: ["workstream=payroll"] }), unreadableJournals: 2 }).problems).toEqual([
      "workstream=payroll is new — no row on the board carries it (2 row journal(s) could not be read, so it may exist there); pass --new-value workstream=payroll if it is meant",
    ]);
  });

  it("lets a new value through when --new-value names it", () => {
    expect(judge({ input: request({ assignments: ["workstream=payroll"], newValues: "workstream=payroll" }) })).toEqual(
      { problems: [], redundant: [] },
    );
  });

  it("accepts an acknowledgement that is no longer new as redundant, so a retry is never refused", () => {
    expect(judge({ input: request({ assignments: ["workstream=hiring"], newValues: "workstream=hiring" }) })).toEqual({
      problems: [],
      redundant: ["workstream=hiring"],
    });
  });

  it("refuses an acknowledgement on a key that guards nothing, and one naming a pair not set", () => {
    expect(
      judge({
        input: request({
          assignments: ["impact=high", "workstream=hiring"],
          newValues: "impact=high,workstream=payroll",
        }),
      }).problems,
    ).toEqual([
      "--new-value impact=high: impact takes any valid value, so there is nothing to acknowledge",
      "--new-value workstream=payroll names a value this write does not set",
    ]);
  });
});
