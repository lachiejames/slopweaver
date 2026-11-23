import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseReflectGradeOptions, REFLECT_GRADE_FLAG_SPEC } from "../../../../../cli/commands/reflect/gradeCore.js";
import { reflectGradeCommand } from "../../../../../cli/commands/reflect/gradeRun.js";
import { REFLECT_GRADE_USAGE } from "../../../../../cli/commands/reflect/usage.js";
import { unwrap } from "../../../../../lib/result.js";

// Every fixture home this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("parseReflectGradeOptions", () => {
  it("takes the id then the one word, and nothing else is required", () => {
    expect(unwrap(parseReflectGradeOptions({ rest: ["abc123def456", "drop"] }))).toStrictEqual({
      grade: "drop",
      id: "abc123def456",
      json: false,
    });
  });

  it("takes every flag its usage line advertises", () => {
    const rest = ["abc123def456", "keep", "--why", "worth it", "--closed-by", "#740", "--home", "/h", "--json"];
    expect(unwrap(parseReflectGradeOptions({ rest }))).toStrictEqual({
      closedBy: "#740",
      grade: "keep",
      home: "/h",
      id: "abc123def456",
      json: true,
      why: "worth it",
    });
  });

  it("refuses a word outside keep, adjust and drop", () => {
    const parsed = parseReflectGradeOptions({ rest: ["abc123def456", "maybe"] });
    expect(parsed._unsafeUnwrapErr()).toStrictEqual(["the grade is one word: keep, adjust, drop"]);
  });

  it("refuses a missing id", () => {
    expect(parseReflectGradeOptions({ rest: [] })._unsafeUnwrapErr()[0]).toContain("a finding id is required");
  });

  it("refuses an unquoted why that spilled into extra positionals", () => {
    const parsed = parseReflectGradeOptions({ rest: ["abc123def456", "drop", "already", "covered"] });
    expect(parsed._unsafeUnwrapErr()[0]).toContain("one finding and one word at a time");
  });

  it("advertises exactly the flags it parses", () => {
    const advertised = [...REFLECT_GRADE_USAGE.matchAll(/--([a-z-]+)/g)].map((match) => match[1]!).toSorted();
    const parsed = [...REFLECT_GRADE_FLAG_SPEC.boolean, ...REFLECT_GRADE_FLAG_SPEC.value].toSorted();
    expect(advertised).toStrictEqual(parsed);
  });
});

describe("the reflect grade command module", () => {
  it("answers --help with its usage line and no side effect", () => {
    expect(reflectGradeCommand(["node", "slopweaver", "reflect", "grade", "--help"])).toBe(0);
  });

  it("refuses a bad word before reading anything", () => {
    expect(reflectGradeCommand(["node", "slopweaver", "reflect", "grade", "abc123def456", "maybe"])).toBe(2);
  });

  it("exits 1 for an id an empty home has never seen", () => {
    const home = mkdtempSync(join(tmpdir(), "reflect-grade-cli-"));
    fixtureDirs.push(home);
    const argv = ["node", "slopweaver", "reflect", "grade", "abc123def456", "keep", "--home", home];
    expect(reflectGradeCommand(argv)).toBe(1);
  });
});
