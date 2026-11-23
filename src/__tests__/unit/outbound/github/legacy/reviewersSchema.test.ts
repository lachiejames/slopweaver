import { describe, expect, it } from "vitest";

import { reviewersSchema } from "../../../../../outbound/github/legacy/reviewersSchema.js";
import { stampedBodySchema } from "../../../../../outbound/github/legacy/schema.js";
import { MINIMAL_BODY } from "./fixtures.js";

const ALICE = { look: { files: ["src/a.ts"], kind: "files" }, standsInFor: [], who: ["@alice"] } as const;
const BOB = { look: { files: ["src/b.ts"], kind: "files" }, standsInFor: [], who: ["@bob"] } as const;
const REST = { look: { kind: "rest" }, standsInFor: [], who: ["@carol"] } as const;

const messagesOf = ({ rows }: { rows: unknown }): readonly string[] =>
  reviewersSchema.safeParse(rows).error!.issues.map((issue) => issue.message);

describe("reviewersSchema", () => {
  it("accepts two file rows and one trailing everything-else row", () => {
    expect(reviewersSchema.safeParse([ALICE, BOB, REST]).success).toBe(true);
  });

  it("refuses a table of one row", () => {
    expect(messagesOf({ rows: [ALICE] })[0]).toContain("needs two rows at least");
  });

  it("refuses an everything-else row that is not last", () => {
    expect(messagesOf({ rows: [REST, ALICE] })).toEqual(["the everything-else row comes last, and there is only one"]);
  });

  it("refuses a file on two rows", () => {
    const other = { ...BOB, look: { files: ["src/a.ts"], kind: "files" } };
    expect(messagesOf({ rows: [ALICE, other] })).toEqual(["a file sits on two reviewer rows: src/a.ts"]);
  });

  it("refuses two rows tagging the same reviewers in another case", () => {
    const same = { ...BOB, who: ["@ALICE"] };
    expect(messagesOf({ rows: [ALICE, same] })).toEqual([
      "two reviewer rows tag the same reviewers; merge them into one row",
    ]);
  });

  it("refuses a row standing a token in for itself", () => {
    const self = { ...BOB, standsInFor: ["@bob"] };
    expect(messagesOf({ rows: [ALICE, self] })).toEqual(["a reviewer row stands a token in for itself"]);
  });

  it("refuses a token that is not a GitHub mention", () => {
    const bad = { ...BOB, who: ["bob"] };
    expect(messagesOf({ rows: [ALICE, bad] })[0]).toContain("must be a GitHub @login or @org/team");
  });

  it("says exactly how a token must be spelled", () => {
    const named = { ...BOB, who: ["Bob"] };
    expect(messagesOf({ rows: [named, REST] })).toEqual([
      "must be a GitHub @login or @org/team, as CODEOWNERS spells it",
    ]);
  });

  it("applies the table rules inside a whole stamped body", () => {
    const decoded = stampedBodySchema.safeParse({ ...MINIMAL_BODY, reviewers: [REST, ALICE] });
    expect(decoded.error!.issues.map((issue) => issue.message)).toEqual([
      "the everything-else row comes last, and there is only one",
    ]);
  });

  it("refuses more than ten rows", () => {
    const rows = Array.from({ length: 11 }, (_, n) => ({
      look: { files: [`src/f${String(n)}.ts`], kind: "files" },
      standsInFor: [],
      who: [`@user${String(n)}`],
    }));
    expect(reviewersSchema.safeParse(rows).success).toBe(false);
    expect(reviewersSchema.safeParse(rows.slice(0, 10)).success).toBe(true);
  });
});
