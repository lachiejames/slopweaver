/**
 * The ruling register's pure core: a row's strict shape, the projection that derives what is current, and the plan
 * that refuses a ruling while an earlier one in its category stands undisposed. Synthetic words only.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  parseRulingLine,
  planRulingRecord,
  projectRulings,
  type RulingProjection,
  type RulingRecord,
  type RulingRecordInput,
  renderRulingLine,
  withRuling,
} from "../../../ruling/registry.js";

const FILE = "/synthetic/rulings.jsonl";

/** A row with every required field, overridable per test. */
function row(over: Partial<RulingRecord> = {}): RulingRecord {
  return {
    category: "landing",
    decidedOn: "2026-01-05",
    id: "ruling-aaaaaaaaaaaa",
    origin: { kind: "record" },
    recordedIso: "2026-01-05T10:00:00.000Z",
    replaces: [],
    schemaVersion: 1,
    words: "two review passes, no third",
    ...over,
  };
}

/** A record input, overridable per test. */
function input(over: Partial<RulingRecordInput> = {}): RulingRecordInput {
  return {
    alongside: false,
    category: "landing",
    decidedOn: "2026-01-06",
    id: "ruling-bbbbbbbbbbbb",
    newCategory: false,
    origin: { kind: "record" },
    recordedIso: "2026-01-06T10:00:00.000Z",
    replaces: [],
    words: "one review pass is enough",
    ...over,
  };
}

/** The projection of some rows, which must be consistent. */
function projected({ rows }: { rows: readonly RulingRecord[] }): RulingProjection {
  return unwrap(projectRulings({ file: FILE, rows }));
}

describe("parseRulingLine and renderRulingLine", () => {
  it("round-trips a row byte for byte, words with line breaks, tabs, markup and a clock time untouched", () => {
    const words = "  keep it\n\tas said: <b>&</b> at 07:30Z  ";
    const record = row({
      anchor: "talk:00000000-0000-4000-8000-000000000000",
      context: "on page acme, call one",
      words,
    });
    const line = renderRulingLine({ record });
    const parsed = unwrap(parseRulingLine({ file: FILE, line, lineNumber: 1 }));
    expect(parsed).toStrictEqual(record);
    expect(parsed.words).toBe(words);
  });

  it("refuses an unknown field, naming the file and line", () => {
    const line = JSON.stringify({ ...row(), extra: 1 });
    const error = unwrapErr(parseRulingLine({ file: FILE, line, lineNumber: 7 }));
    expect(error.code).toBe("REGISTER_MALFORMED");
    expect(error.message).toContain(`${FILE}:7`);
  });

  it("refuses a date that is shaped right but is not a calendar day", () => {
    const line = JSON.stringify(row({ decidedOn: "2026-02-30" }));
    const error = unwrapErr(parseRulingLine({ file: FILE, line, lineNumber: 1 }));
    expect(error.code).toBe("REGISTER_MALFORMED");
    expect(error.message).toContain("decidedOn");
  });

  it("refuses words that are only whitespace", () => {
    const line = JSON.stringify(row({ words: " \n\t" }));
    expect(unwrapErr(parseRulingLine({ file: FILE, line, lineNumber: 1 })).message).toContain("words are empty");
  });

  it("refuses a line that is not JSON", () => {
    expect(unwrapErr(parseRulingLine({ file: FILE, line: "{", lineNumber: 2 })).code).toBe("REGISTER_MALFORMED");
  });
});

describe("projectRulings", () => {
  it("reads an empty register as no rulings and no categories", () => {
    const projection = projected({ rows: [] });
    expect(projection.current).toStrictEqual([]);
    expect(projection.categories).toStrictEqual([]);
  });

  it("derives current as every ruling no later row replaced, and maps each replaced id to its replacer", () => {
    const first = row({ id: "ruling-aaaaaaaaaaaa" });
    const second = row({ category: "privacy", id: "ruling-bbbbbbbbbbbb" });
    const third = row({ id: "ruling-cccccccccccc", replaces: ["ruling-aaaaaaaaaaaa"] });
    const projection = projected({ rows: [first, second, third] });
    expect(projection.current.map((each) => each.id)).toStrictEqual(["ruling-bbbbbbbbbbbb", "ruling-cccccccccccc"]);
    expect([...projection.replacedBy]).toStrictEqual([["ruling-aaaaaaaaaaaa", "ruling-cccccccccccc"]]);
    expect(projection.categories).toStrictEqual(["landing", "privacy"]);
  });

  it("refuses a duplicate id at the line it repeats on", () => {
    const error = unwrapErr(projectRulings({ file: FILE, rows: [row(), row()] }));
    expect(error.message).toContain(`${FILE}:2`);
    expect(error.message).toContain("appears twice");
  });

  it("refuses a row replacing an id no earlier row holds", () => {
    const rows = [row({ replaces: ["ruling-ffffffffffff"] })];
    expect(unwrapErr(projectRulings({ file: FILE, rows })).message).toContain("which no earlier row holds");
  });

  it("refuses a second replacement of one ruling", () => {
    const rows = [
      row(),
      row({ id: "ruling-bbbbbbbbbbbb", replaces: ["ruling-aaaaaaaaaaaa"] }),
      row({ id: "ruling-cccccccccccc", replaces: ["ruling-aaaaaaaaaaaa"] }),
    ];
    expect(unwrapErr(projectRulings({ file: FILE, rows })).message).toContain("already replaced");
  });

  it("refuses a duplicate seed key", () => {
    const seedKey = `seed-v1:${"a".repeat(64)}`;
    const origin = { file: "/synthetic/state.md", kind: "seed", line: 3, seedKey } as const;
    const rows = [row({ origin }), row({ id: "ruling-bbbbbbbbbbbb", origin })];
    expect(unwrapErr(projectRulings({ file: FILE, rows })).message).toContain("seed key");
  });
});

describe("planRulingRecord", () => {
  it("files a ruling in a new category only when asked for by name", () => {
    const projection = projected({ rows: [] });
    expect(unwrapErr(planRulingRecord({ input: input(), projection })).code).toBe("CATEGORY_UNKNOWN");
    const plan = unwrap(planRulingRecord({ input: input({ newCategory: true }), projection }));
    expect(plan.record.category).toBe("landing");
    expect(plan.beside).toStrictEqual([]);
  });

  it("refuses --new-category for a category a row already uses", () => {
    const projection = projected({ rows: [row()] });
    const error = unwrapErr(planRulingRecord({ input: input({ newCategory: true }), projection }));
    expect(error.code).toBe("CATEGORY_EXISTS");
  });

  it("refuses a category that is not a kebab slug", () => {
    const error = unwrapErr(
      planRulingRecord({ input: input({ category: "Landing Rules" }), projection: projected({ rows: [] }) }),
    );
    expect(error.code).toBe("CATEGORY_INVALID");
  });

  it("refuses while a current same-category ruling stands undisposed, naming it", () => {
    const projection = projected({ rows: [row()] });
    const error = unwrapErr(planRulingRecord({ input: input(), projection }));
    expect(error.code).toBe("UNDISPOSED");
    expect(error.message).toContain("ruling-aaaaaaaaaaaa");
  });

  it("files a replacement, reading it beside the ruling it replaces", () => {
    const projection = projected({ rows: [row()] });
    const plan = unwrap(planRulingRecord({ input: input({ replaces: ["ruling-aaaaaaaaaaaa"] }), projection }));
    expect(plan.record.replaces).toStrictEqual(["ruling-aaaaaaaaaaaa"]);
    expect(plan.beside.map((each) => each.id)).toStrictEqual(["ruling-aaaaaaaaaaaa"]);
  });

  it("files a ruling alongside the current ones when told they do not conflict", () => {
    const projection = projected({ rows: [row()] });
    const plan = unwrap(planRulingRecord({ input: input({ alongside: true }), projection }));
    expect(plan.record.replaces).toStrictEqual([]);
    expect(plan.beside.map((each) => each.id)).toStrictEqual(["ruling-aaaaaaaaaaaa"]);
  });

  it("does not count a current ruling in another category as beside it", () => {
    const projection = projected({ rows: [row({ category: "privacy" }), row({ id: "ruling-cccccccccccc" })] });
    const plan = unwrap(planRulingRecord({ input: input({ replaces: ["ruling-cccccccccccc"] }), projection }));
    expect(plan.beside.map((each) => each.id)).toStrictEqual(["ruling-cccccccccccc"]);
  });

  it("refuses to replace a ruling that is no longer current", () => {
    const projection = projected({
      rows: [row(), row({ id: "ruling-cccccccccccc", replaces: ["ruling-aaaaaaaaaaaa"] })],
    });
    const error = unwrapErr(
      planRulingRecord({ input: input({ alongside: true, replaces: ["ruling-aaaaaaaaaaaa"] }), projection }),
    );
    expect(error.code).toBe("REPLACES_NOT_CURRENT");
  });

  it("refuses a decision date that is not a calendar day, and empty words", () => {
    const projection = projected({ rows: [] });
    const date = unwrapErr(
      planRulingRecord({ input: input({ decidedOn: "2026-13-01", newCategory: true }), projection }),
    );
    expect(date.code).toBe("DATE_INVALID");
    const words = unwrapErr(planRulingRecord({ input: input({ newCategory: true, words: "  " }), projection }));
    expect(words.code).toBe("WORDS_EMPTY");
  });
});

describe("withRuling", () => {
  it("moves a replaced ruling out of current and adds the new category", () => {
    const before = projected({ rows: [row()] });
    const after = withRuling({
      projection: before,
      record: row({ category: "privacy", id: "ruling-bbbbbbbbbbbb", replaces: ["ruling-aaaaaaaaaaaa"] }),
    });
    expect(after.current.map((each) => each.id)).toStrictEqual(["ruling-bbbbbbbbbbbb"]);
    expect(after.categories).toStrictEqual(["landing", "privacy"]);
    expect(after.replacedBy.get("ruling-aaaaaaaaaaaa")).toBe("ruling-bbbbbbbbbbbb");
  });
});
