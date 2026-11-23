/**
 * The Controls tag's response contract: the two page schemas, the two mapping responses, and the canonical
 * control schemas this module re-exports. Every row is complete and unique to its kind, and every parse is
 * asserted whole.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { vantaControlDtoSchema as canonicalControlSchema } from "../../../../../../atlas/vanta/apiSchemas.js";
import { vantaControlDetailDtoSchema as canonicalControlDetailSchema } from "../../../../../../atlas/vanta/controlEvidenceApiSchemas.js";
import {
  vantaAddControlDocumentMappingResponseSchema,
  vantaAddControlTestMappingResponseSchema,
  vantaControlDetailDtoSchema,
  vantaControlDocumentsPageSchema,
  vantaControlDtoSchema,
  vantaControlLibraryPageSchema,
} from "../../../../../../atlas/vanta/sdk/schemas/controls.js";

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

/** The paths each refusal names when `row` loses one field at a time, one entry per field in field order. */
function pathsWhenFieldMissing({ row, schema }: { row: Record<string, unknown>; schema: z.ZodType }): unknown[][] {
  return Object.keys(row).map((missing) =>
    rejection({ input: { ...row, [missing]: undefined }, schema }).issues.map((issue) => issue["path"]),
  );
}

/** One copy of `row` for each key in `keys`, each copy with exactly that key null and every other field as it was. */
function rowsWithOneNull({ keys, row }: { keys: readonly string[]; row: Record<string, unknown> }): unknown[] {
  return keys.map((key) => ({ ...row, [key]: null }));
}

const PAGE_INFO_MORE_AHEAD = {
  endCursor: "controls-page-ahead-end-cursor",
  hasNextPage: true,
  hasPreviousPage: false,
  startCursor: "controls-page-ahead-start-cursor",
} as const;

const PAGE_INFO_MORE_BEHIND = {
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: true,
  startCursor: "controls-page-behind-start-cursor",
} as const;

/* The third page info: with only the two above, the two cursors are never null in opposite places and the two
   page flags are each other's negation. Here the start cursor is the null one and both flags are set. */
const PAGE_INFO_MIDDLE = {
  endCursor: "controls-page-middle-end-cursor",
  hasNextPage: true,
  hasPreviousPage: true,
  startCursor: null,
} as const;

const LIBRARY_CONTROL_POPULATED = {
  creationDate: "2041-01-01T01:01:01.001Z",
  customFields: [
    { label: "library-populated-field-a-label", value: "library-populated-field-a-value" },
    {
      label: "library-populated-field-b-label",
      value: ["library-populated-field-b-first", "library-populated-field-b-second"],
    },
  ],
  description: "Library populated control description",
  domains: ["LIBRARY_POPULATED_DOMAIN_A", "LIBRARY_POPULATED_DOMAIN_B"],
  externalId: "library-populated-external-id",
  id: "library-populated-control-id",
  modificationDate: "2042-02-02T02:02:02.002Z",
  name: "Library populated control name",
  owner: {
    displayName: "Library Populated Owner",
    emailAddress: "library.populated.owner@example.test",
    id: "library-populated-owner-id",
  },
  role: "library-populated-role",
  source: "Vanta",
} as const;

const LIBRARY_CONTROL_SPARSE = {
  creationDate: null,
  customFields: [],
  description: "Library sparse control description",
  domains: ["LIBRARY_SPARSE_DOMAIN"],
  externalId: null,
  id: "library-sparse-control-id",
  modificationDate: "2043-03-03T03:03:03.003Z",
  name: "Library sparse control name",
  owner: null,
  role: null,
  source: "Custom",
} as const;

const DOCUMENT_SENSITIVE = {
  category: "Policies",
  description: "Controls document sensitive description",
  id: "controls-document-sensitive-id",
  isSensitive: true,
  ownerId: "controls-document-sensitive-owner-id",
  title: "Controls document sensitive title",
  uploadStatus: "OK",
  uploadStatusDate: "2044-04-04T04:04:04.004Z",
  url: "https://documents.example.test/controls-sensitive",
} as const;

const DOCUMENT_OPEN = {
  category: "Vendors",
  description: "Controls document open description",
  id: "controls-document-open-id",
  isSensitive: false,
  ownerId: null,
  title: "Controls document open title",
  uploadStatus: "Needs update",
  uploadStatusDate: "2045-05-05T05:05:05.005Z",
  url: null,
} as const;

const MAPPED_CONTROL_FOR_DOCUMENT = {
  creationDate: "2046-06-06T06:06:06.006Z",
  customFields: [{ label: "doc-mapping-field-label", value: "doc-mapping-field-value" }],
  description: "Document mapping control description",
  domains: ["DOC_MAPPING_DOMAIN"],
  externalId: "doc-mapping-external-id",
  id: "doc-mapping-control-id",
  modificationDate: "2047-07-07T07:07:07.007Z",
  name: "Document mapping control name",
  owner: {
    displayName: "Document Mapping Owner",
    emailAddress: "doc.mapping.owner@example.test",
    id: "doc-mapping-owner-id",
  },
  role: "doc-mapping-role",
  source: "Custom",
} as const;

const MAPPED_DOCUMENT = {
  category: "Logging",
  description: "Mapped document description",
  id: "doc-mapping-document-id",
  isSensitive: false,
  ownerId: "doc-mapping-document-owner-id",
  title: "Mapped document title",
  uploadStatus: "Not relevant",
  uploadStatusDate: "2048-08-08T08:08:08.008Z",
  url: "https://documents.example.test/mapped",
} as const;

const MAPPED_CONTROL_FOR_TEST = {
  creationDate: "2049-09-09T09:09:09.009Z",
  customFields: [
    { label: "test-mapping-field-label", value: ["test-mapping-field-first", "test-mapping-field-second"] },
  ],
  description: "Test mapping control description",
  domains: ["TEST_MAPPING_DOMAIN_A", "TEST_MAPPING_DOMAIN_B"],
  externalId: null,
  id: "test-mapping-control-id",
  modificationDate: null,
  name: "Test mapping control name",
  owner: null,
  role: "test-mapping-role",
  source: "Vanta",
} as const;

const MAPPED_TEST = {
  category: "test-mapping-category",
  deactivatedStatusInfo: {
    deactivatedReason: "Mapped test was paused for a calendar quarter",
    isDeactivated: true,
    lastUpdatedDate: "2051-01-11T11:11:11.011Z",
  },
  description: "Mapped test description",
  failureDescription: "Mapped test failure description",
  id: "test-mapping-test-id",
  integrations: ["test-mapping-integration-a", "test-mapping-integration-b"],
  lastTestRunDate: "2052-02-12T12:12:12.012Z",
  latestFlipDate: "2053-03-13T13:13:13.013Z",
  name: "Mapped test name",
  owner: {
    displayName: "Test Mapping Owner",
    emailAddress: "test.mapping.owner@example.test",
    id: "test-mapping-owner-id",
  },
  remediationDescription: "Mapped test remediation description",
  remediationStatusInfo: {
    itemCount: 6,
    soonestRemediateByDate: "2054-04-14T14:14:14.014Z",
    status: "test-mapping-remediation-status",
  },
  status: "test-mapping-status",
  version: { major: 7, minor: 2 },
} as const;

const CONTROL_DETAIL = {
  creationDate: "2055-05-15T15:15:15.015Z",
  customFields: [{ label: "detail-field-label", value: "detail-field-value" }],
  description: "Control detail description",
  domains: ["DETAIL_DOMAIN_A", "DETAIL_DOMAIN_B"],
  externalId: "detail-external-id",
  id: "control-detail-id",
  modificationDate: "2056-06-16T16:16:16.016Z",
  name: "Control detail name",
  note: "Control detail note text",
  numDocumentsPassing: 3,
  numDocumentsTotal: 8,
  numTestsPassing: 5,
  numTestsTotal: 13,
  owner: {
    displayName: "Control Detail Owner",
    emailAddress: "control.detail.owner@example.test",
    id: "control-detail-owner-id",
  },
  role: "control-detail-role",
  source: "Vanta",
  status: "control-detail-status",
} as const;

describe("vantaControlLibraryPageSchema", () => {
  it("reads a two-control page whole, with its page info and total", () => {
    const page = {
      results: {
        data: [LIBRARY_CONTROL_POPULATED, LIBRARY_CONTROL_SPARSE],
        pageInfo: PAGE_INFO_MORE_AHEAD,
        totalCount: 7101,
      },
    };
    expect(vantaControlLibraryPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a page whose total is omitted and whose page info points the other way, without inventing a total", () => {
    const page = {
      results: { data: [LIBRARY_CONTROL_SPARSE, LIBRARY_CONTROL_POPULATED], pageInfo: PAGE_INFO_MORE_BEHIND },
    };
    expect(vantaControlLibraryPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [LIBRARY_CONTROL_SPARSE], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaControlLibraryPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the control row shape, so a source outside the two refuses at the row's own path", () => {
    expect(
      rejection({
        input: {
          results: {
            data: [LIBRARY_CONTROL_POPULATED, { ...LIBRARY_CONTROL_SPARSE, source: "Imported" }],
            pageInfo: PAGE_INFO_MORE_AHEAD,
          },
        },
        schema: vantaControlLibraryPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["results", "data", 1, "source"], values: ["Vanta", "Custom"] }],
      success: false,
    });
  });

  it("refuses a negative total at the total's path", () => {
    expect(
      rejection({
        input: { results: { data: [], pageInfo: PAGE_INFO_MORE_AHEAD, totalCount: -1 } },
        schema: vantaControlLibraryPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "too_small", inclusive: true, minimum: 0, origin: "number", path: ["results", "totalCount"] }],
      success: false,
    });
  });
});

describe("vantaControlDocumentsPageSchema", () => {
  it("reads a two-document page whole, the sensitive one first", () => {
    const page = {
      results: { data: [DOCUMENT_SENSITIVE, DOCUMENT_OPEN], pageInfo: PAGE_INFO_MORE_BEHIND, totalCount: 2 },
    };
    expect(vantaControlDocumentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same two documents the other way round with the other page info", () => {
    const page = {
      results: { data: [DOCUMENT_OPEN, DOCUMENT_SENSITIVE], pageInfo: PAGE_INFO_MORE_AHEAD },
    };
    expect(vantaControlDocumentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the document row shape, so a category outside the list refuses at the row's own path", () => {
    expect(
      rejection({
        input: {
          results: {
            data: [{ ...DOCUMENT_OPEN, category: "Snacks" }],
            pageInfo: PAGE_INFO_MORE_AHEAD,
          },
        },
        schema: vantaControlDocumentsPageSchema,
      }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["results", "data", 0, "category"],
          values: [
            "Accounts access",
            "Account security",
            "Account setup",
            "Computers",
            "Custom",
            "Data storage",
            "Employees",
            "Infrastructure",
            "IT",
            "Logging",
            "Monitoring alerts",
            "People",
            "Policies",
            "Risk analysis",
            "Software development",
            "CSPM alert management",
            "Vendors",
            "Vulnerability management",
          ],
        },
      ],
      success: false,
    });
  });

  it("reads a document with exactly one of its three nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({ keys: ["ownerId", "uploadStatusDate", "url"], row: DOCUMENT_SENSITIVE });
    const page = { results: { data: rows, pageInfo: PAGE_INFO_MORE_AHEAD } };
    expect(rows.length).toBe(3);
    expect(vantaControlDocumentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("requires every one of a document's nine fields, each missing one refusing at its own path", () => {
    const fields = Object.keys(DOCUMENT_SENSITIVE);
    const outcomes = fields.map((missing) =>
      rejection({
        input: {
          results: { data: [{ ...DOCUMENT_SENSITIVE, [missing]: undefined }], pageInfo: PAGE_INFO_MORE_AHEAD },
        },
        schema: vantaControlDocumentsPageSchema,
      }).issues.map((issue) => issue["path"]),
    );
    expect(fields.length).toBe(9);
    expect(outcomes).toStrictEqual(fields.map((field) => [["results", "data", 0, field]]));
  });

  it("refuses a control row, because this page's rows are documents", () => {
    const outcome = rejection({
      input: { results: { data: [LIBRARY_CONTROL_SPARSE], pageInfo: PAGE_INFO_MORE_AHEAD } },
      schema: vantaControlDocumentsPageSchema,
    });
    expect({
      sites: outcome.issues.map((issue) => `${String(issue["code"])} ${String(issue["path"])}`),
      success: outcome.success,
    }).toStrictEqual({
      sites: [
        "invalid_value results,data,0,category",
        "invalid_type results,data,0,isSensitive",
        "invalid_type results,data,0,ownerId",
        "invalid_type results,data,0,title",
        "invalid_value results,data,0,uploadStatus",
        "invalid_type results,data,0,uploadStatusDate",
        "invalid_type results,data,0,url",
        "unrecognized_keys results,data,0",
      ],
      success: false,
    });
  });
});

describe("vantaAddControlDocumentMappingResponseSchema", () => {
  it("reads the control and the document it was mapped to, each whole", () => {
    const response = { control: MAPPED_CONTROL_FOR_DOCUMENT, document: MAPPED_DOCUMENT };
    expect(vantaAddControlDocumentMappingResponseSchema.parse(response)).toStrictEqual(response);
  });

  it("refuses a key it does not know, naming it", () => {
    expect(
      rejection({
        input: { control: MAPPED_CONTROL_FOR_DOCUMENT, document: MAPPED_DOCUMENT, mapping: "doc-mapping-extra" },
        schema: vantaAddControlDocumentMappingResponseSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["mapping"], path: [] }],
      success: false,
    });
  });

  it("refuses a test where the document belongs, at the missing document and the unknown test", () => {
    expect(
      rejection({
        input: { control: MAPPED_CONTROL_FOR_DOCUMENT, test: MAPPED_TEST },
        schema: vantaAddControlDocumentMappingResponseSchema,
      }),
    ).toStrictEqual({
      issues: [
        { code: "invalid_type", expected: "object", path: ["document"] },
        { code: "unrecognized_keys", keys: ["test"], path: [] },
      ],
      success: false,
    });
  });
});

describe("vantaAddControlTestMappingResponseSchema", () => {
  it("reads the control and the test it was mapped to, each whole", () => {
    const response = { control: MAPPED_CONTROL_FOR_TEST, test: MAPPED_TEST };
    expect(vantaAddControlTestMappingResponseSchema.parse(response)).toStrictEqual(response);
  });

  it("refuses a key it does not know, naming it", () => {
    expect(
      rejection({
        input: { control: MAPPED_CONTROL_FOR_TEST, mapping: "test-mapping-extra", test: MAPPED_TEST },
        schema: vantaAddControlTestMappingResponseSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["mapping"], path: [] }],
      success: false,
    });
  });

  it("refuses a document where the test belongs, at the missing test and the unknown document", () => {
    expect(
      rejection({
        input: { control: MAPPED_CONTROL_FOR_TEST, document: MAPPED_DOCUMENT },
        schema: vantaAddControlTestMappingResponseSchema,
      }),
    ).toStrictEqual({
      issues: [
        { code: "invalid_type", expected: "object", path: ["test"] },
        { code: "unrecognized_keys", keys: ["document"], path: [] },
      ],
      success: false,
    });
  });

  it("reads a test with exactly one of its five nullable fields null at a time, each whole", () => {
    const tests = [
      { ...MAPPED_TEST, latestFlipDate: null },
      { ...MAPPED_TEST, owner: null },
      { ...MAPPED_TEST, deactivatedStatusInfo: { ...MAPPED_TEST.deactivatedStatusInfo, deactivatedReason: null } },
      { ...MAPPED_TEST, deactivatedStatusInfo: { ...MAPPED_TEST.deactivatedStatusInfo, lastUpdatedDate: null } },
      { ...MAPPED_TEST, remediationStatusInfo: { ...MAPPED_TEST.remediationStatusInfo, soonestRemediateByDate: null } },
    ];
    const responses = tests.map((test) => ({ control: MAPPED_CONTROL_FOR_TEST, test }));
    expect(responses.map((response) => vantaAddControlTestMappingResponseSchema.parse(response))).toStrictEqual(
      responses,
    );
  });

  it("refuses a test whose nested version has no minor, at that path", () => {
    expect(
      rejection({
        input: { control: MAPPED_CONTROL_FOR_TEST, test: { ...MAPPED_TEST, version: { major: 7 } } },
        schema: vantaAddControlTestMappingResponseSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "number", path: ["test", "version", "minor"] }],
      success: false,
    });
  });
});

describe("the canonical schemas this module re-exports", () => {
  it("re-exports the control schema itself, not a copy", () => {
    expect(vantaControlDtoSchema).toBe(canonicalControlSchema);
  });

  it("re-exports the control detail schema itself, not a copy", () => {
    expect(vantaControlDetailDtoSchema).toBe(canonicalControlDetailSchema);
  });

  it("reads a control detail whole through the re-export, all four counts in their own places", () => {
    expect(vantaControlDetailDtoSchema.parse(CONTROL_DETAIL)).toStrictEqual(CONTROL_DETAIL);
  });

  it("reads a control with exactly one of its five nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: ["creationDate", "externalId", "modificationDate", "owner", "role"],
      row: LIBRARY_CONTROL_POPULATED,
    });
    expect(rows.length).toBe(5);
    expect(rows.map((row) => vantaControlDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("reads a control detail with exactly one of its six nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: ["creationDate", "externalId", "modificationDate", "note", "owner", "role"],
      row: CONTROL_DETAIL,
    });
    expect(rows.length).toBe(6);
    expect(rows.map((row) => vantaControlDetailDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("requires every one of a control's eleven fields but role, each missing one refusing at its own path", () => {
    expect(Object.keys(LIBRARY_CONTROL_POPULATED).length).toBe(11);
    expect(pathsWhenFieldMissing({ row: LIBRARY_CONTROL_POPULATED, schema: vantaControlDtoSchema })).toStrictEqual(
      Object.values({
        ...Object.fromEntries(Object.keys(LIBRARY_CONTROL_POPULATED).map((field) => [field, [[field]]])),
        role: [],
      }),
    );
  });

  it("requires every one of a control detail's seventeen fields but role, each missing one refusing at its own path", () => {
    expect(Object.keys(CONTROL_DETAIL).length).toBe(17);
    expect(pathsWhenFieldMissing({ row: CONTROL_DETAIL, schema: vantaControlDetailDtoSchema })).toStrictEqual(
      Object.values({
        ...Object.fromEntries(Object.keys(CONTROL_DETAIL).map((field) => [field, [[field]]])),
        role: [],
      }),
    );
  });

  it("reads a control whole through the re-export", () => {
    expect(vantaControlDtoSchema.parse(MAPPED_CONTROL_FOR_DOCUMENT)).toStrictEqual(MAPPED_CONTROL_FOR_DOCUMENT);
  });
});
