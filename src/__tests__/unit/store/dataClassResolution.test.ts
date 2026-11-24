/**
 * The pure half of `store classify`: which stored rows a page rewrites, the count-only tally, and the strict
 * decoders of what the store reads back.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { DataClass } from "../../../store/dataClass.js";
import { contentDataClassFactsFromFields, ownerTurnDataClassFacts } from "../../../store/dataClassIntake.js";
import {
  type DataClassCandidate,
  type DataClassRowRef,
  dataClassPageDecisions,
  decodeRowCount,
  decodeStoredClassCounts,
  emptySamples,
  emptyTally,
  SAMPLED_DATA_CLASSES,
  tallyPage,
  zeroDataClassCounts,
} from "../../../store/dataClassResolution.js";
import { composeDataClassRules, type DataClassRule } from "../../../store/dataClassRules.js";

/** A stored public Slack content row in the fixture channel, its stored class overridable. */
const contentRow = ({
  id = "c-1",
  stored = null,
  visibility = "public",
}: {
  id?: string;
  stored?: DataClass | null;
  visibility?: "public" | "private";
} = {}): DataClassCandidate => ({
  facts: contentDataClassFactsFromFields({
    author: "U0FIXTURE",
    container: "slack/C0FIXTURE",
    kind: "message",
    source: "slack",
    visibility,
  }),
  ref: { id, table: "content" },
  stored,
});

const DEFAULTS = composeDataClassRules({ installation: [] });
const ENG_PUBLIC: DataClassRule[] = [
  { action: "public", id: "install:eng", match: { container: ["slack/C0FIXTURE"] } },
];

describe("dataClassPageDecisions", () => {
  it("writes an explicit unknown over a row that holds no class", () => {
    const [decision] = dataClassPageDecisions({ page: [contentRow()], rules: DEFAULTS });
    expect(decision!.derived).toBe("unknown");
    expect(decision!.shouldWrite).toBe(true);
  });

  it("leaves a row already holding the class it derives", () => {
    const [decision] = dataClassPageDecisions({ page: [contentRow({ stored: "unknown" })], rules: DEFAULTS });
    expect(decision!.shouldWrite).toBe(false);
  });

  it("widens a row when a rule now classes it, and narrows it back when the rule is gone", () => {
    const widened = dataClassPageDecisions({
      page: [contentRow({ stored: "unknown" })],
      rules: composeDataClassRules({ installation: ENG_PUBLIC }),
    });
    expect(widened.map((one) => [one.derived, one.shouldWrite])).toEqual([["public", true]]);
    const narrowed = dataClassPageDecisions({ page: [contentRow({ stored: "public" })], rules: DEFAULTS });
    expect(narrowed.map((one) => [one.derived, one.shouldWrite])).toEqual([["unknown", true]]);
  });

  it("stores an assess outcome as unknown and keeps the rule that sent it", () => {
    const [decision] = dataClassPageDecisions({ page: [contentRow({ visibility: "private" })], rules: DEFAULTS });
    expect(decision!.derived).toBe("unknown");
    expect(decision!.outcome).toEqual({ kind: "needs-assessment", ruleId: "default:private-lane" });
  });

  it("sends every owner_turn body to the captured-speech default", () => {
    const page: DataClassCandidate[] = [
      { facts: ownerTurnDataClassFacts(), ref: { id: "a".repeat(64), table: "owner_turn" }, stored: null },
    ];
    const [decision] = dataClassPageDecisions({ page, rules: DEFAULTS });
    expect(decision!.outcome).toEqual({ kind: "needs-assessment", ruleId: "default:owner-captured-speech" });
  });
});

describe("tallyPage", () => {
  it("counts scanned, differing and written rows, every derived class and each outcome", () => {
    const tally = emptyTally({ table: "content" });
    const decisions = dataClassPageDecisions({
      page: [
        contentRow(),
        contentRow({ id: "c-2", stored: "unknown" }),
        contentRow({ id: "c-3", visibility: "private" }),
      ],
      rules: DEFAULTS,
    });
    tallyPage({ decisions, sampleCap: 0, samples: undefined, tally, written: 2 });
    expect([tally.scanned, tally.differing, tally.written]).toEqual([3, 2, 2]);
    expect(tally.derived).toEqual({ ...zeroDataClassCounts(), unknown: 3 });
    expect([...tally.outcomes.values()]).toEqual([
      { dataClass: "unknown", kind: "unknown", rows: 2, ruleId: null },
      { dataClass: "unknown", kind: "needs-assessment", rows: 1, ruleId: "default:private-lane" },
    ]);
  });

  it("samples only the most private classes, as table and id alone, up to the cap", () => {
    const samples = emptySamples();
    const decisions = dataClassPageDecisions({
      page: [contentRow(), contentRow({ id: "c-2" }), contentRow({ id: "c-3" })],
      rules: DEFAULTS,
    });
    tallyPage({ decisions, sampleCap: 2, samples, tally: emptyTally({ table: "content" }), written: 0 });
    const expected: DataClassRowRef[] = [
      { id: "c-1", table: "content" },
      { id: "c-2", table: "content" },
    ];
    expect(samples.get("unknown")).toEqual(expected);
    expect([...samples.keys()]).toEqual(SAMPLED_DATA_CLASSES);
  });

  it("never samples a public row", () => {
    const samples = emptySamples();
    const decisions = dataClassPageDecisions({
      page: [contentRow()],
      rules: composeDataClassRules({ installation: ENG_PUBLIC }),
    });
    tallyPage({ decisions, sampleCap: 10, samples, tally: emptyTally({ table: "content" }), written: 0 });
    expect([...samples.values()].flat()).toEqual([]);
    expect(decisions[0]!.derived).toBe("public");
  });
});

describe("decodeStoredClassCounts", () => {
  it("reads every class and the rows holding none, zeroes kept", () => {
    const counts = unwrap(
      decodeStoredClassCounts({
        rows: [
          { dataClass: "unknown", rows: "7" },
          { dataClass: "public", rows: "2" },
          { dataClass: null, rows: "1" },
        ],
      }),
    );
    expect(counts).toEqual({ classes: { ...zeroDataClassCounts(), public: 2, unknown: 7 }, nulls: 1 });
  });

  it("reads an empty table as all zeroes", () => {
    expect(unwrap(decodeStoredClassCounts({ rows: [] }))).toEqual({ classes: zeroDataClassCounts(), nulls: 0 });
  });

  it("refuses a class the vocabulary does not name, without echoing the stored label", () => {
    expect(unwrapErr(decodeStoredClassCounts({ rows: [{ dataClass: "secret", rows: "1" }] }))).toEqual([
      "the store holds a data class the vocabulary does not name",
    ]);
  });

  it("refuses a count that is not a whole number rather than reading it as zero", () => {
    expect(unwrapErr(decodeStoredClassCounts({ rows: [{ dataClass: "public", rows: 3 }] }))).toEqual([
      "the row count of one data class read back as 3, not a whole number",
    ]);
  });
});

describe("decodeRowCount", () => {
  it("reads a count in text", () => {
    expect(unwrap(decodeRowCount({ value: "42", what: "board_row" }))).toBe(42);
  });

  it("refuses an absent or empty count", () => {
    expect(unwrapErr(decodeRowCount({ value: undefined, what: "board_row" }))).toEqual([
      "the row count of board_row read back as undefined, not a whole number",
    ]);
    expect(unwrapErr(decodeRowCount({ value: "", what: "board_row" }))).toEqual([
      "the row count of board_row read back as , not a whole number",
    ]);
  });
});
