/**
 * The vendor assessment DTO and its page: every status, decision and owner shape it reads whole, every field it
 * requires, and each refusal at the exact path it names.
 */
import { describe, expect, it } from "vitest";

import {
  vantaVendorAssessmentDtoSchema,
  vantaVendorAssessmentsPageSchema,
} from "../../../../../../../atlas/vanta/sdk/schemas/vendors.js";
import {
  ASSESSMENT_DECIDED,
  ASSESSMENT_PENDING,
  PAGE_INFO_MIDDLE,
  PAGE_INFO_MORE_AHEAD,
  PAGE_INFO_MORE_BEHIND,
} from "./fixtures.js";
import { pathsWhenFieldMissing, rejection, rowsWithOneNestedNull, rowsWithOneNull } from "./probes.js";

describe("vantaVendorAssessmentDtoSchema", () => {
  it("reads a completed, approved assessment with a user owner, whole", () => {
    expect(vantaVendorAssessmentDtoSchema.parse(ASSESSMENT_DECIDED)).toStrictEqual(ASSESSMENT_DECIDED);
  });

  it("reads an in-progress assessment with no decision and no owner, whole", () => {
    expect(vantaVendorAssessmentDtoSchema.parse(ASSESSMENT_PENDING)).toStrictEqual(ASSESSMENT_PENDING);
  });

  it("reads each of the three assessment statuses and returns them in order", () => {
    const statuses = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].map(
      (status) => vantaVendorAssessmentDtoSchema.parse({ ...ASSESSMENT_PENDING, status }).status,
    );
    expect(statuses).toStrictEqual(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);
  });

  it("reads each of the three decision statuses and a null decision comment, and returns them in order", () => {
    const decisions = ["APPROVED", "NOT_APPROVED", "CONDITIONALLY_APPROVED"].map(
      (status) =>
        vantaVendorAssessmentDtoSchema.parse({
          ...ASSESSMENT_DECIDED,
          decision: { comments: null, lastUpdatedAt: "2109-09-09T09:09:09.009Z", status },
        }).decision,
    );
    expect(decisions).toStrictEqual([
      { comments: null, lastUpdatedAt: "2109-09-09T09:09:09.009Z", status: "APPROVED" },
      { comments: null, lastUpdatedAt: "2109-09-09T09:09:09.009Z", status: "NOT_APPROVED" },
      { comments: null, lastUpdatedAt: "2109-09-09T09:09:09.009Z", status: "CONDITIONALLY_APPROVED" },
    ]);
  });

  it("reads a team owner with a null name and email", () => {
    const owner = { displayName: null, email: null, id: "assessment-team-owner-id", type: "TEAM" } as const;
    expect(vantaVendorAssessmentDtoSchema.parse({ ...ASSESSMENT_PENDING, owner })).toStrictEqual({
      ...ASSESSMENT_PENDING,
      owner,
    });
  });

  it("reads an assessment with exactly one of its eleven nullable fields null at a time, each whole", () => {
    const rows = [
      ...rowsWithOneNull({
        keys: ["completedByUserId", "completionDate", "decision", "dueDate", "overrideDueDate", "owner", "startDate"],
        row: ASSESSMENT_DECIDED,
      }),
      ...rowsWithOneNestedNull({
        key: "assessmentType",
        keys: ["description"],
        nested: ASSESSMENT_DECIDED.assessmentType,
        row: ASSESSMENT_DECIDED,
      }),
      ...rowsWithOneNestedNull({
        key: "decision",
        keys: ["comments"],
        nested: ASSESSMENT_DECIDED.decision,
        row: ASSESSMENT_DECIDED,
      }),
      ...rowsWithOneNestedNull({
        key: "owner",
        keys: ["displayName", "email"],
        nested: ASSESSMENT_DECIDED.owner,
        row: ASSESSMENT_DECIDED,
      }),
    ];
    expect(rows.length).toBe(11);
    expect(rows.map((row) => vantaVendorAssessmentDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("requires every one of its twelve fields, each missing one refusing at its own path", () => {
    expect(Object.keys(ASSESSMENT_DECIDED).length).toBe(12);
    expect(pathsWhenFieldMissing({ row: ASSESSMENT_DECIDED, schema: vantaVendorAssessmentDtoSchema })).toStrictEqual(
      Object.keys(ASSESSMENT_DECIDED).map((field) => [[field]]),
    );
  });

  it("reads the audience Vanta started sending on some assessments, whole", () => {
    const row = { ...ASSESSMENT_DECIDED, audience: "EXTERNAL" };
    expect(vantaVendorAssessmentDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("refuses an audience that is not a string, at that path", () => {
    expect(
      rejection({ input: { ...ASSESSMENT_PENDING, audience: null }, schema: vantaVendorAssessmentDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["audience"] }],
      success: false,
    });
  });

  it("still refuses a key the assessment itself does not know, at the row's own path", () => {
    expect(
      rejection({
        input: { ...ASSESSMENT_PENDING, audienceLabel: "External" },
        schema: vantaVendorAssessmentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["audienceLabel"], path: [] }],
      success: false,
    });
  });

  it("refuses a status outside the three, naming them", () => {
    expect(
      rejection({ input: { ...ASSESSMENT_PENDING, status: "DONE" }, schema: vantaVendorAssessmentDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["status"], values: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] }],
      success: false,
    });
  });

  it("refuses a decision status outside the three, at that path", () => {
    expect(
      rejection({
        input: { ...ASSESSMENT_DECIDED, decision: { ...ASSESSMENT_DECIDED.decision, status: "MAYBE" } },
        schema: vantaVendorAssessmentDtoSchema,
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

  it("refuses an owner type outside user and team, at that path", () => {
    expect(
      rejection({
        input: { ...ASSESSMENT_DECIDED, owner: { ...ASSESSMENT_DECIDED.owner, type: "ROBOT" } },
        schema: vantaVendorAssessmentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["owner", "type"], values: ["USER", "TEAM"] }],
      success: false,
    });
  });

  it("refuses a key the owner does not know, at the owner's path", () => {
    expect(
      rejection({
        input: {
          ...ASSESSMENT_DECIDED,
          owner: { ...ASSESSMENT_DECIDED.owner, emailAddress: "assessment-owner-extra" },
        },
        schema: vantaVendorAssessmentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["emailAddress"], path: ["owner"] }],
      success: false,
    });
  });

  it("refuses a key the decision does not know, at the decision's path", () => {
    expect(
      rejection({
        input: {
          ...ASSESSMENT_DECIDED,
          decision: { ...ASSESSMENT_DECIDED.decision, decidedBy: "assessment-decision-extra" },
        },
        schema: vantaVendorAssessmentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["decidedBy"], path: ["decision"] }],
      success: false,
    });
  });

  it("refuses a key the assessment type does not know, at the type's path", () => {
    expect(
      rejection({
        input: {
          ...ASSESSMENT_PENDING,
          assessmentType: { ...ASSESSMENT_PENDING.assessmentType, version: "assessment-type-extra" },
        },
        schema: vantaVendorAssessmentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["version"], path: ["assessmentType"] }],
      success: false,
    });
  });
});

describe("vantaVendorAssessmentsPageSchema", () => {
  it("reads a two-assessment page whole, with its page info and total", () => {
    const page = {
      results: {
        data: [ASSESSMENT_DECIDED, ASSESSMENT_PENDING],
        pageInfo: PAGE_INFO_MORE_AHEAD,
        totalCount: 5101,
      },
    };
    expect(vantaVendorAssessmentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same assessments the other way round with the other page info", () => {
    const page = {
      results: { data: [ASSESSMENT_PENDING, ASSESSMENT_DECIDED], pageInfo: PAGE_INFO_MORE_BEHIND },
    };
    expect(vantaVendorAssessmentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [ASSESSMENT_PENDING], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaVendorAssessmentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a page where one row carries an audience and one does not, the mix the live sync returned", () => {
    const page = {
      results: {
        data: [{ ...ASSESSMENT_DECIDED, audience: "EXTERNAL" }, ASSESSMENT_PENDING],
        pageInfo: PAGE_INFO_MIDDLE,
      },
    };
    expect(vantaVendorAssessmentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the assessment row shape, so a status outside the three refuses at the row's path", () => {
    expect(
      rejection({
        input: {
          results: {
            data: [ASSESSMENT_DECIDED, { ...ASSESSMENT_PENDING, status: "STALLED" }],
            pageInfo: PAGE_INFO_MORE_AHEAD,
          },
        },
        schema: vantaVendorAssessmentsPageSchema,
      }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["results", "data", 1, "status"],
          values: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"],
        },
      ],
      success: false,
    });
  });
});
