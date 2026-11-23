/**
 * The vendor finding DTO and its page: every risk status, an open or closed remediation, any one nullable field
 * null, all seven fields required, and a refusal at the exact path for each value outside its set.
 */
import { describe, expect, it } from "vitest";

import {
  vantaVendorFindingDtoSchema,
  vantaVendorFindingsPageSchema,
} from "../../../../../../../atlas/vanta/sdk/schemas/vendors.js";
import {
  FINDING_ACCEPTED,
  FINDING_OPEN,
  PAGE_INFO_MIDDLE,
  PAGE_INFO_MORE_AHEAD,
  PAGE_INFO_MORE_BEHIND,
} from "./fixtures.js";
import { pathsWhenFieldMissing, rejection, rowsWithOneNull } from "./probes.js";

describe("vantaVendorFindingDtoSchema", () => {
  it("reads an open remediation finding with its document and review, whole", () => {
    expect(vantaVendorFindingDtoSchema.parse(FINDING_OPEN)).toStrictEqual(FINDING_OPEN);
  });

  it("reads an accepted finding with no remediation, document or review, whole", () => {
    expect(vantaVendorFindingDtoSchema.parse(FINDING_ACCEPTED)).toStrictEqual(FINDING_ACCEPTED);
  });

  it("reads each of the three risk statuses and returns them in order", () => {
    const statuses = ["ACCEPT", "REMEDIATE", "NONE"].map(
      (riskStatus) => vantaVendorFindingDtoSchema.parse({ ...FINDING_ACCEPTED, riskStatus }).riskStatus,
    );
    expect(statuses).toStrictEqual(["ACCEPT", "REMEDIATE", "NONE"]);
  });

  it("reads a closed remediation with no notes, whole", () => {
    const closed = { ...FINDING_OPEN, remediation: { requirementNotes: null, state: "CLOSED" } } as const;
    expect(vantaVendorFindingDtoSchema.parse(closed)).toStrictEqual(closed);
  });

  it("reads a finding with exactly one of its three nullable top-level fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({ keys: ["documentId", "remediation", "securityReviewId"], row: FINDING_OPEN });
    expect(rows.length).toBe(3);
    expect(rows.map((row) => vantaVendorFindingDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("requires every one of its seven fields, each missing one refusing at its own path", () => {
    expect(Object.keys(FINDING_OPEN).length).toBe(7);
    expect(pathsWhenFieldMissing({ row: FINDING_OPEN, schema: vantaVendorFindingDtoSchema })).toStrictEqual(
      Object.keys(FINDING_OPEN).map((field) => [[field]]),
    );
  });

  it("refuses a risk status outside the three, naming them", () => {
    expect(
      rejection({ input: { ...FINDING_ACCEPTED, riskStatus: "ESCALATE" }, schema: vantaVendorFindingDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["riskStatus"], values: ["ACCEPT", "REMEDIATE", "NONE"] }],
      success: false,
    });
  });

  it("refuses a remediation state outside open and closed, at that path", () => {
    expect(
      rejection({
        input: { ...FINDING_OPEN, remediation: { ...FINDING_OPEN.remediation, state: "STALLED" } },
        schema: vantaVendorFindingDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["remediation", "state"], values: ["OPEN", "CLOSED"] }],
      success: false,
    });
  });

  it("refuses a key the remediation does not know, at the remediation's path", () => {
    expect(
      rejection({
        input: { ...FINDING_OPEN, remediation: { ...FINDING_OPEN.remediation, dueDate: "finding-remediation-extra" } },
        schema: vantaVendorFindingDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["dueDate"], path: ["remediation"] }],
      success: false,
    });
  });
});

describe("vantaVendorFindingsPageSchema", () => {
  it("reads a two-finding page whole, with its page info and total", () => {
    const page = {
      results: { data: [FINDING_OPEN, FINDING_ACCEPTED], pageInfo: PAGE_INFO_MORE_BEHIND, totalCount: 8101 },
    };
    expect(vantaVendorFindingsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same findings the other way round with the other page info", () => {
    const page = {
      results: { data: [FINDING_ACCEPTED, FINDING_OPEN], pageInfo: PAGE_INFO_MORE_AHEAD },
    };
    expect(vantaVendorFindingsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [FINDING_ACCEPTED], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaVendorFindingsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the finding row shape, so a risk status outside the three refuses at the row's path", () => {
    expect(
      rejection({
        input: {
          results: { data: [{ ...FINDING_OPEN, riskStatus: "IGNORE" }], pageInfo: PAGE_INFO_MORE_AHEAD },
        },
        schema: vantaVendorFindingsPageSchema,
      }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["results", "data", 0, "riskStatus"],
          values: ["ACCEPT", "REMEDIATE", "NONE"],
        },
      ],
      success: false,
    });
  });
});
