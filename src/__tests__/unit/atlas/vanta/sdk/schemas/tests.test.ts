/**
 * The Tests tag's response contract: the page schema whose rows are control tests, and the canonical test
 * schema this module re-exports. Both rows are complete, and every parse is asserted whole.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { vantaControlTestDtoSchema as canonicalTestSchema } from "../../../../../../atlas/vanta/controlEvidenceApiSchemas.js";
import { vantaControlTestDtoSchema, vantaTestsPageSchema } from "../../../../../../atlas/vanta/sdk/schemas/tests.js";

/** What a refusal looked like: the verdict and each issue with its message left out. */
function rejection({ input, schema }: { input: unknown; schema: z.ZodType }): {
  issues: Record<string, unknown>[];
  success: boolean;
} {
  const result = schema.safeParse(input);
  const issues = result.success ? [] : result.error.issues;
  return {
    issues: issues.map((issue) => Object.fromEntries(Object.entries(issue).filter(([key]) => key !== "message"))),
    success: result.success,
  };
}

const PAGE_INFO_MORE_AHEAD = {
  endCursor: "tests-page-ahead-end-cursor",
  hasNextPage: true,
  hasPreviousPage: false,
  startCursor: "tests-page-ahead-start-cursor",
} as const;

const PAGE_INFO_MORE_BEHIND = {
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: true,
  startCursor: "tests-page-behind-start-cursor",
} as const;

/* The third page info: with only the two above, the two cursors are never null in opposite places and the two
   page flags are each other's negation. Here the start cursor is the null one and both flags are set. */
const PAGE_INFO_MIDDLE = {
  endCursor: "tests-page-middle-end-cursor",
  hasNextPage: true,
  hasPreviousPage: true,
  startCursor: null,
} as const;

const TEST_PAUSED = {
  category: "tests-paused-category",
  deactivatedStatusInfo: {
    deactivatedReason: "Paused while the vendor migrates",
    isDeactivated: true,
    lastUpdatedDate: "2081-01-01T01:01:01.001Z",
  },
  description: "Paused test description",
  failureDescription: "Paused test failure description",
  id: "tests-paused-id",
  integrations: ["tests-paused-integration-a", "tests-paused-integration-b"],
  lastTestRunDate: "2082-02-02T02:02:02.002Z",
  latestFlipDate: "2083-03-03T03:03:03.003Z",
  name: "Paused test name",
  owner: {
    displayName: "Tests Paused Owner",
    emailAddress: "tests.paused.owner@example.test",
    id: "tests-paused-owner-id",
  },
  remediationDescription: "Paused test remediation description",
  remediationStatusInfo: {
    itemCount: 3,
    soonestRemediateByDate: "2084-04-04T04:04:04.004Z",
    status: "tests-paused-remediation-status",
  },
  status: "tests-paused-status",
  version: { major: 4, minor: 9 },
} as const;

const TEST_RUNNING = {
  category: "tests-running-category",
  deactivatedStatusInfo: {
    deactivatedReason: null,
    isDeactivated: false,
    lastUpdatedDate: null,
  },
  description: "Running test description",
  failureDescription: "Running test failure description",
  id: "tests-running-id",
  integrations: ["tests-running-integration-only"],
  lastTestRunDate: "2085-05-05T05:05:05.005Z",
  latestFlipDate: null,
  name: "Running test name",
  owner: null,
  remediationDescription: "Running test remediation description",
  remediationStatusInfo: {
    itemCount: 17,
    soonestRemediateByDate: null,
    status: "tests-running-remediation-status",
  },
  status: "tests-running-status",
  version: { major: 12, minor: 2 },
} as const;

describe("vantaTestsPageSchema", () => {
  it("reads a two-test page whole, the paused one first, with its page info and total", () => {
    const page = {
      results: { data: [TEST_PAUSED, TEST_RUNNING], pageInfo: PAGE_INFO_MORE_AHEAD, totalCount: 4101 },
    };
    expect(vantaTestsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same tests the other way round with the other page info, without inventing a total", () => {
    const page = {
      results: { data: [TEST_RUNNING, TEST_PAUSED], pageInfo: PAGE_INFO_MORE_BEHIND },
    };
    expect(vantaTestsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [TEST_RUNNING], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaTestsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a test with exactly one of its five nullable fields null at a time, each whole", () => {
    const rows = [
      { ...TEST_PAUSED, latestFlipDate: null },
      { ...TEST_PAUSED, owner: null },
      { ...TEST_PAUSED, deactivatedStatusInfo: { ...TEST_PAUSED.deactivatedStatusInfo, deactivatedReason: null } },
      { ...TEST_PAUSED, deactivatedStatusInfo: { ...TEST_PAUSED.deactivatedStatusInfo, lastUpdatedDate: null } },
      { ...TEST_PAUSED, remediationStatusInfo: { ...TEST_PAUSED.remediationStatusInfo, soonestRemediateByDate: null } },
    ];
    const page = { results: { data: rows, pageInfo: PAGE_INFO_MORE_AHEAD } };
    expect(vantaTestsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads an empty page", () => {
    const page = { results: { data: [], pageInfo: PAGE_INFO_MORE_BEHIND, totalCount: 0 } };
    expect(vantaTestsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("refuses a row carrying a key it does not know, at the row's own path", () => {
    expect(
      rejection({
        input: {
          results: {
            data: [TEST_PAUSED, { ...TEST_RUNNING, framework: "tests-extra-framework" }],
            pageInfo: PAGE_INFO_MORE_AHEAD,
          },
        },
        schema: vantaTestsPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["framework"], path: ["results", "data", 1] }],
      success: false,
    });
  });

  it("refuses a row whose nested version has no minor, at that path", () => {
    expect(
      rejection({
        input: {
          results: { data: [{ ...TEST_PAUSED, version: { major: 4 } }], pageInfo: PAGE_INFO_MORE_AHEAD },
        },
        schema: vantaTestsPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "number", path: ["results", "data", 0, "version", "minor"] }],
      success: false,
    });
  });

  it("requires every one of a test's fourteen fields, each missing one refusing at its own path", () => {
    const outcomes = Object.keys(TEST_RUNNING).map((missing) =>
      rejection({
        input: { results: { data: [{ ...TEST_RUNNING, [missing]: undefined }], pageInfo: PAGE_INFO_MORE_AHEAD } },
        schema: vantaTestsPageSchema,
      }),
    );
    expect(outcomes.map((outcome) => outcome.success)).toStrictEqual(Array.from({ length: 14 }, () => false));
    expect(outcomes.map((outcome) => outcome.issues.map((issue) => issue["path"]))).toStrictEqual(
      [
        "category",
        "deactivatedStatusInfo",
        "description",
        "failureDescription",
        "id",
        "integrations",
        "lastTestRunDate",
        "latestFlipDate",
        "name",
        "owner",
        "remediationDescription",
        "remediationStatusInfo",
        "status",
        "version",
      ].map((field) => [["results", "data", 0, field]]),
    );
  });

  it("requires each field of the four nested objects a test carries, refusing at the nested path", () => {
    const nestedKeys = ["deactivatedStatusInfo", "remediationStatusInfo", "version", "owner"] as const;
    const outcomes = nestedKeys.map((key) =>
      Object.keys(TEST_PAUSED[key]).map((missing) =>
        rejection({
          input: { ...TEST_PAUSED, [key]: { ...TEST_PAUSED[key], [missing]: undefined } },
          schema: vantaControlTestDtoSchema,
        }).issues.map((issue) => issue["path"]),
      ),
    );
    expect(outcomes).toStrictEqual([
      [
        [["deactivatedStatusInfo", "deactivatedReason"]],
        [["deactivatedStatusInfo", "isDeactivated"]],
        [["deactivatedStatusInfo", "lastUpdatedDate"]],
      ],
      [
        [["remediationStatusInfo", "itemCount"]],
        [["remediationStatusInfo", "soonestRemediateByDate"]],
        [["remediationStatusInfo", "status"]],
      ],
      [[["version", "major"]], [["version", "minor"]]],
      [[["owner", "displayName"]], [["owner", "emailAddress"]], [["owner", "id"]]],
    ]);
  });

  it("refuses a last run that is not an ISO instant, at that path", () => {
    const outcome = rejection({
      input: {
        results: { data: [{ ...TEST_RUNNING, lastTestRunDate: "this morning" }], pageInfo: PAGE_INFO_MORE_AHEAD },
      },
      schema: vantaTestsPageSchema,
    });
    expect(outcome.issues.map((issue) => ({ code: issue["code"], path: issue["path"] }))).toStrictEqual([
      { code: "invalid_format", path: ["results", "data", 0, "lastTestRunDate"] },
    ]);
  });

  it("refuses a null last run, because only the flip date may be null", () => {
    expect(
      rejection({
        input: { results: { data: [{ ...TEST_RUNNING, lastTestRunDate: null }], pageInfo: PAGE_INFO_MORE_AHEAD } },
        schema: vantaTestsPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["results", "data", 0, "lastTestRunDate"] }],
      success: false,
    });
  });
});

describe("the canonical test schema this module re-exports", () => {
  it("is the schema itself, not a copy", () => {
    expect(vantaControlTestDtoSchema).toBe(canonicalTestSchema);
  });

  it("reads a paused test whole through the re-export", () => {
    expect(vantaControlTestDtoSchema.parse(TEST_PAUSED)).toStrictEqual(TEST_PAUSED);
  });

  it("reads a running test whole through the re-export", () => {
    expect(vantaControlTestDtoSchema.parse(TEST_RUNNING)).toStrictEqual(TEST_RUNNING);
  });
});
