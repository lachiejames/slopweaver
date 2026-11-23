/**
 * The data-class rule sorter: the first matching rule decides, no match is `unknown`, an `assess` outcome is
 * stored as `unknown`, and a rules file with any fault refuses whole.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  composeDataClassRules,
  type DataClassFacts,
  type DataClassRule,
  DEFAULT_DATA_CLASS_RULES,
  parseDataClassRules,
  sortDataClass,
  storedDataClass,
} from "../../../store/dataClassRules.js";

/** A public Slack message's facts, with any field overridden. */
const facts = (over: Partial<DataClassFacts> = {}): DataClassFacts => ({
  author: "U0FIXTURE",
  container: "slack/C0FIXTURE",
  kind: "message",
  source: "slack",
  table: "content",
  visibility: "public",
  ...over,
});

const PATH = "/fixture/judgement/data-class-rules.json";

describe("sortDataClass", () => {
  it("leaves a public record no rule names unknown, under the defaults alone", () => {
    expect(sortDataClass({ facts: facts(), rules: DEFAULT_DATA_CLASS_RULES })).toEqual({
      kind: "unknown",
      reason: "no-rule",
    });
  });

  it("sends a private-lane record to assessment under the defaults", () => {
    expect(sortDataClass({ facts: facts({ visibility: "private" }), rules: DEFAULT_DATA_CLASS_RULES })).toEqual({
      kind: "needs-assessment",
      ruleId: "default:private-lane",
    });
  });

  it("sends the owner's captured speech to assessment under the defaults", () => {
    expect(sortDataClass({ facts: facts({ table: "owner_turn" }), rules: DEFAULT_DATA_CLASS_RULES })).toEqual({
      kind: "needs-assessment",
      ruleId: "default:owner-captured-speech",
    });
  });

  it("lets the first matching rule decide, so an installation rule overrides a default", () => {
    const installation: DataClassRule[] = [
      { action: "restricted", id: "install:dm", match: { visibility: ["private"] } },
    ];
    expect(
      sortDataClass({ facts: facts({ visibility: "private" }), rules: composeDataClassRules({ installation }) }),
    ).toEqual({ dataClass: "restricted", kind: "classified", ruleId: "install:dm" });
  });

  it("classes an automated sender internal by rule", () => {
    const rules: DataClassRule[] = [{ action: "internal", id: "install:receipts", match: { author: ["U0FIXTURE"] } }];
    expect(sortDataClass({ facts: facts(), rules })).toEqual({
      dataClass: "internal",
      kind: "classified",
      ruleId: "install:receipts",
    });
  });

  it("requires every named field to match", () => {
    const rules: DataClassRule[] = [
      { action: "public", id: "install:eng", match: { container: ["slack/C0FIXTURE"], kind: ["reply"] } },
    ];
    expect(sortDataClass({ facts: facts(), rules })).toEqual({ kind: "unknown", reason: "no-rule" });
    expect(sortDataClass({ facts: facts({ kind: "reply" }), rules })).toEqual({
      dataClass: "public",
      kind: "classified",
      ruleId: "install:eng",
    });
  });

  it("never matches a null fact against a rule naming that field", () => {
    const rules: DataClassRule[] = [{ action: "public", id: "install:any-author", match: { author: ["U0FIXTURE"] } }];
    expect(sortDataClass({ facts: facts({ author: null }), rules })).toEqual({ kind: "unknown", reason: "no-rule" });
  });
});

describe("storedDataClass", () => {
  it("stores a classified outcome's class", () => {
    expect(storedDataClass({ outcome: { dataClass: "personal", kind: "classified", ruleId: "r" } })).toBe("personal");
  });

  it("stores a record needing assessment as unknown, because no assessment runs yet", () => {
    expect(storedDataClass({ outcome: { kind: "needs-assessment", ruleId: "r" } })).toBe("unknown");
  });

  it("stores an unmatched record as unknown", () => {
    expect(storedDataClass({ outcome: { kind: "unknown", reason: "no-rule" } })).toBe("unknown");
  });
});

describe("the defaults", () => {
  it("assign no class: every one sends to assessment", () => {
    expect(DEFAULT_DATA_CLASS_RULES.length).toBeGreaterThan(0);
    expect(DEFAULT_DATA_CLASS_RULES.filter((rule) => rule.action !== "assess")).toEqual([]);
  });
});

describe("parseDataClassRules", () => {
  it("reads a valid file's rules in file order, one per assignable class and assess", () => {
    const value = {
      rules: [
        { action: "public", id: "install:eng", match: { container: ["slack/C0FIXTURE"] } },
        { action: "internal", id: "install:receipts", match: { author: ["U0RECEIPTSFIXTURE"] } },
        { action: "personal", id: "install:family", match: { container: ["slack/D0FIXTURE"] } },
        { action: "restricted", id: "install:me", match: { author: ["U0FIXTURE"], source: ["slack"] } },
        { action: "assess", id: "install:mail", match: { source: ["gmail"] } },
      ],
      version: 1,
    };
    const result = parseDataClassRules({ path: PATH, value });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).map((rule) => rule.action)).toEqual([
      "public",
      "internal",
      "personal",
      "restricted",
      "assess",
    ]);
  });

  it("refuses a rule that could only assign unknown", () => {
    const value = { rules: [{ action: "unknown", id: "install:x", match: { source: ["slack"] } }], version: 1 };
    expect(unwrapErr(parseDataClassRules({ path: PATH, value })).code).toBe("DATA_CLASS_RULES_INVALID");
  });

  it("refuses a rule naming no field, which would match every record", () => {
    const value = { rules: [{ action: "public", id: "install:all", match: {} }], version: 1 };
    const error = unwrapErr(parseDataClassRules({ path: PATH, value }));
    expect(error.code).toBe("DATA_CLASS_RULES_INVALID");
    expect(error.message).toContain("rule install:all names no field to match");
  });

  it("refuses an id a default already holds", () => {
    const value = {
      rules: [{ action: "public", id: "default:private-lane", match: { source: ["slack"] } }],
      version: 1,
    };
    const error = unwrapErr(parseDataClassRules({ path: PATH, value }));
    expect(error.message).toContain("rule id default:private-lane is used twice or taken by a default");
  });

  it("refuses an id used twice", () => {
    const rule = { action: "public", id: "install:dup", match: { source: ["slack"] } };
    const error = unwrapErr(parseDataClassRules({ path: PATH, value: { rules: [rule, rule], version: 1 } }));
    expect(error.message).toContain("rule id install:dup is used twice");
  });

  it("refuses an unknown key, an unknown version and an empty accepted list", () => {
    const unknownKey = { rules: [{ action: "public", id: "a", match: { channel: ["x"] } }], version: 1 };
    const wrongVersion = { rules: [], version: 2 };
    const emptyList = { rules: [{ action: "public", id: "a", match: { source: [] } }], version: 1 };
    expect(unwrapErr(parseDataClassRules({ path: PATH, value: unknownKey })).code).toBe("DATA_CLASS_RULES_INVALID");
    expect(unwrapErr(parseDataClassRules({ path: PATH, value: wrongVersion })).code).toBe("DATA_CLASS_RULES_INVALID");
    expect(unwrapErr(parseDataClassRules({ path: PATH, value: emptyList })).code).toBe("DATA_CLASS_RULES_INVALID");
  });

  it("names the path in a refusal", () => {
    const error = unwrapErr(parseDataClassRules({ path: PATH, value: { version: 1 } }));
    expect(error.message).toContain(PATH);
  });
});

describe("composeDataClassRules", () => {
  it("puts the installation's rules before the defaults", () => {
    const installation: DataClassRule[] = [{ action: "public", id: "install:a", match: { source: ["slack"] } }];
    expect(composeDataClassRules({ installation }).map((rule) => rule.id)).toEqual([
      "install:a",
      "default:owner-captured-speech",
      "default:private-lane",
    ]);
  });
});
