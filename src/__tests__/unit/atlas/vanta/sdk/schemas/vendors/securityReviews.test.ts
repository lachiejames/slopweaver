/**
 * The vendor security review DTO and its page: a review reads whole with any one nullable field null, requires all
 * twelve fields, and refuses an assessment's status or a decision carrying comments.
 */
import { describe, expect, it } from "vitest";

import {
  vantaSecurityReviewDtoSchema,
  vantaSecurityReviewsPageSchema,
} from "../../../../../../../atlas/vanta/sdk/schemas/vendors.js";
import {
  PAGE_INFO_MIDDLE,
  PAGE_INFO_MORE_AHEAD,
  PAGE_INFO_MORE_BEHIND,
  REVIEW_TEAM_OWNED,
  REVIEW_UNDECIDED,
} from "./fixtures.js";
import { pathsWhenFieldMissing, rejection, rowsWithOneNestedNull, rowsWithOneNull } from "./probes.js";

describe("vantaSecurityReviewDtoSchema", () => {
  it("reads a team-owned, conditionally approved review, whole", () => {
    expect(vantaSecurityReviewDtoSchema.parse(REVIEW_TEAM_OWNED)).toStrictEqual(REVIEW_TEAM_OWNED);
  });

  it("reads an undecided review with a nameless user owner, whole", () => {
    expect(vantaSecurityReviewDtoSchema.parse(REVIEW_UNDECIDED)).toStrictEqual(REVIEW_UNDECIDED);
  });

  it("reads a review with exactly one of its twelve nullable fields null at a time, each whole", () => {
    const rows = [
      ...rowsWithOneNull({
        keys: [
          "comments",
          "completedByUserId",
          "completionDate",
          "decision",
          "decisionNotes",
          "dueDate",
          "overrideDueDate",
          "owner",
          "startDate",
        ],
        row: REVIEW_TEAM_OWNED,
      }),
      ...rowsWithOneNestedNull({
        key: "assessmentType",
        keys: ["description"],
        nested: REVIEW_TEAM_OWNED.assessmentType,
        row: REVIEW_TEAM_OWNED,
      }),
      ...rowsWithOneNestedNull({
        key: "owner",
        keys: ["displayName", "email"],
        nested: REVIEW_TEAM_OWNED.owner,
        row: REVIEW_TEAM_OWNED,
      }),
    ];
    expect(rows.length).toBe(12);
    expect(rows.map((row) => vantaSecurityReviewDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("requires every one of its twelve fields, each missing one refusing at its own path", () => {
    expect(Object.keys(REVIEW_TEAM_OWNED).length).toBe(12);
    expect(pathsWhenFieldMissing({ row: REVIEW_TEAM_OWNED, schema: vantaSecurityReviewDtoSchema })).toStrictEqual(
      Object.keys(REVIEW_TEAM_OWNED).map((field) => [[field]]),
    );
  });

  it("refuses a decision carrying comments, because a review's decision has only a date and a status", () => {
    expect(
      rejection({
        input: { ...REVIEW_TEAM_OWNED, decision: { ...REVIEW_TEAM_OWNED.decision, comments: "review-decision-extra" } },
        schema: vantaSecurityReviewDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["comments"], path: ["decision"] }],
      success: false,
    });
  });

  it("refuses a status field, because a review carries none", () => {
    expect(
      rejection({ input: { ...REVIEW_UNDECIDED, status: "COMPLETED" }, schema: vantaSecurityReviewDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["status"], path: [] }],
      success: false,
    });
  });

  it("refuses a decision status outside the three, at that path", () => {
    expect(
      rejection({
        input: { ...REVIEW_TEAM_OWNED, decision: { ...REVIEW_TEAM_OWNED.decision, status: "DEFERRED" } },
        schema: vantaSecurityReviewDtoSchema,
      }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["decision", "status"],
          values: ["APPROVED", "NOT_APPROVED", "CONDITIONALLY_APPROVED"],
        },
      ],
      success: false,
    });
  });
});

describe("vantaSecurityReviewsPageSchema", () => {
  it("reads a two-review page whole, with its page info and total", () => {
    const page = {
      results: { data: [REVIEW_TEAM_OWNED, REVIEW_UNDECIDED], pageInfo: PAGE_INFO_MORE_BEHIND, totalCount: 6101 },
    };
    expect(vantaSecurityReviewsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same reviews the other way round with the other page info", () => {
    const page = {
      results: { data: [REVIEW_UNDECIDED, REVIEW_TEAM_OWNED], pageInfo: PAGE_INFO_MORE_AHEAD },
    };
    expect(vantaSecurityReviewsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [REVIEW_UNDECIDED], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaSecurityReviewsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("refuses a row carrying an assessment's status, because this page's rows are reviews", () => {
    expect(
      rejection({
        input: { results: { data: [{ ...REVIEW_UNDECIDED, status: "COMPLETED" }], pageInfo: PAGE_INFO_MORE_AHEAD } },
        schema: vantaSecurityReviewsPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["status"], path: ["results", "data", 0] }],
      success: false,
    });
  });
});
