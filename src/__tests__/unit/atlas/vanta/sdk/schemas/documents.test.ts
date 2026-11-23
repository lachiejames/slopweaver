/**
 * The Documents tag's response contract: the strict document detail (strict like every other DTO), the strict uploaded link, and the three page schemas that choose a control, a
 * link or an uploaded file as their row. Every parse is asserted whole.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { vantaDocumentDtoSchema as canonicalDocumentSchema } from "../../../../../../atlas/vanta/apiSchemas.js";
import {
  vantaDocumentControlsPageSchema,
  vantaDocumentDetailDtoSchema,
  vantaDocumentDtoSchema,
  vantaDocumentFilesPageSchema,
  vantaDocumentLinksPageSchema,
  vantaUploadedLinkDtoSchema,
} from "../../../../../../atlas/vanta/sdk/schemas/documents.js";

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
  endCursor: "documents-page-ahead-end-cursor",
  hasNextPage: true,
  hasPreviousPage: false,
  startCursor: "documents-page-ahead-start-cursor",
} as const;

const PAGE_INFO_MORE_BEHIND = {
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: true,
  startCursor: "documents-page-behind-start-cursor",
} as const;

/* The third page info: with only the two above, the two cursors are never null in opposite places and the two
   page flags are each other's negation. Here the start cursor is the null one and both flags are set. */
const PAGE_INFO_MIDDLE = {
  endCursor: "documents-page-middle-end-cursor",
  hasNextPage: true,
  hasPreviousPage: true,
  startCursor: null,
} as const;

const DETAIL_DEACTIVATED = {
  category: "Policies",
  deactivatedStatus: {
    creationDate: "2061-01-01T01:01:01.001Z",
    expiration: "2062-02-02T02:02:02.002Z",
    isDeactivated: true,
    reason: "Detail deactivated reason text",
  },
  description: "Detail deactivated description",
  id: "detail-deactivated-id",
  isSensitive: false,
  nextRenewalDate: "2063-03-03T03:03:03.003Z",
  note: "Detail deactivated note text",
  ownerId: "detail-deactivated-owner-id",
  reminderWindow: "P1W",
  renewalCadence: "P6M",
  subscribers: ["detail-deactivated-subscriber-a", "detail-deactivated-subscriber-b"],
  title: "Detail deactivated title",
  uploadStatus: "OK",
  uploadStatusDate: "2064-04-04T04:04:04.004Z",
  url: "https://documents.example.test/detail-deactivated",
} as const;

const DETAIL_SENSITIVE = {
  category: "Vendors",
  deactivatedStatus: {
    creationDate: "2065-05-05T05:05:05.005Z",
    expiration: null,
    isDeactivated: false,
    reason: null,
  },
  description: "Detail sensitive description",
  id: "detail-sensitive-id",
  isSensitive: true,
  nextRenewalDate: null,
  note: null,
  ownerId: null,
  reminderWindow: null,
  renewalCadence: "P1Y",
  subscribers: ["detail-sensitive-subscriber-only"],
  title: "Detail sensitive title",
  uploadStatus: "Needs update",
  uploadStatusDate: null,
  url: null,
} as const;

/* With only the two details above, sensitivity and deactivation are each other's negation, and the reminder
   window and cadence never both sit in the values they share. This third detail sets both flags and gives the
   window and the cadence two different values. */
const DETAIL_LAPSED = {
  category: "Custom",
  deactivatedStatus: {
    creationDate: "2081-01-21T21:21:21.021Z",
    expiration: "2082-02-22T22:22:22.022Z",
    isDeactivated: true,
    reason: null,
  },
  description: "Detail lapsed description",
  id: "detail-lapsed-id",
  isSensitive: true,
  nextRenewalDate: null,
  note: "Detail lapsed note text",
  ownerId: "detail-lapsed-owner-id",
  reminderWindow: "P3M",
  renewalCadence: "P2Y",
  subscribers: [],
  title: "Detail lapsed title",
  uploadStatus: "Needs document",
  uploadStatusDate: "2083-03-23T23:23:23.023Z",
  url: null,
} as const;

const LINK_DATED = {
  creationDate: "2066-06-06T06:06:06.006Z",
  description: "Link dated description",
  effectiveDate: "2067-07-07T07:07:07.007Z",
  id: "link-dated-id",
  title: "Link dated title",
  url: "https://links.example.test/dated",
} as const;

const LINK_UNDATED = {
  creationDate: "2068-08-08T08:08:08.008Z",
  description: "Link undated description",
  effectiveDate: null,
  id: "link-undated-id",
  title: "Link undated title",
  url: "https://links.example.test/undated",
} as const;

const FILE_ATTRIBUTED = {
  creationDate: "2069-09-09T09:09:09.009Z",
  deletionDate: "2070-10-10T10:10:10.010Z",
  description: "Document upload attributed description",
  effectiveDate: "2071-11-11T11:11:11.011Z",
  fileName: "document-upload-attributed.pdf",
  id: "document-upload-attributed-id",
  mimeType: "application/pdf",
  title: "Document upload attributed title",
  updatedDate: "2072-12-12T12:12:12.012Z",
  uploadedBy: { id: "document-upload-attributed-actor-id", type: "USER" },
  url: "https://uploads.example.test/attributed",
} as const;

const FILE_ANONYMOUS = {
  creationDate: "2073-01-13T13:13:13.013Z",
  deletionDate: null,
  description: null,
  effectiveDate: null,
  fileName: null,
  id: "document-upload-anonymous-id",
  mimeType: "image/png",
  title: "Document upload anonymous title",
  updatedDate: "2074-02-14T14:14:14.014Z",
  uploadedBy: null,
  url: "https://uploads.example.test/anonymous",
} as const;

const MAPPED_CONTROL_FIRST = {
  creationDate: "2075-03-15T15:15:15.015Z",
  customFields: [{ label: "document-controls-first-field-label", value: "document-controls-first-field-value" }],
  description: "Document controls first description",
  domains: ["DOCUMENT_CONTROLS_FIRST_DOMAIN"],
  externalId: "document-controls-first-external-id",
  id: "document-controls-first-id",
  modificationDate: "2076-04-16T16:16:16.016Z",
  name: "Document controls first name",
  owner: {
    displayName: "Document Controls First Owner",
    emailAddress: "document.controls.first@example.test",
    id: "document-controls-first-owner-id",
  },
  role: "document-controls-first-role",
  source: "Vanta",
} as const;

const MAPPED_CONTROL_SECOND = {
  creationDate: null,
  customFields: [
    {
      label: "document-controls-second-field-label",
      value: ["document-controls-second-a", "document-controls-second-b"],
    },
  ],
  description: "Document controls second description",
  domains: ["DOCUMENT_CONTROLS_SECOND_DOMAIN_A", "DOCUMENT_CONTROLS_SECOND_DOMAIN_B"],
  externalId: null,
  id: "document-controls-second-id",
  modificationDate: null,
  name: "Document controls second name",
  owner: null,
  role: null,
  source: "Custom",
} as const;

describe("vantaDocumentDetailDtoSchema", () => {
  it("reads a deactivated, non-sensitive document with every nullable field populated, whole", () => {
    expect(vantaDocumentDetailDtoSchema.parse(DETAIL_DEACTIVATED)).toStrictEqual(DETAIL_DEACTIVATED);
  });

  it("reads a sensitive, active document with every nullable field null, whole", () => {
    expect(vantaDocumentDetailDtoSchema.parse(DETAIL_SENSITIVE)).toStrictEqual(DETAIL_SENSITIVE);
  });

  it("reads a sensitive, deactivated document with a different window and cadence, whole", () => {
    expect(vantaDocumentDetailDtoSchema.parse(DETAIL_LAPSED)).toStrictEqual(DETAIL_LAPSED);
  });

  it("reads a document with exactly one of its eight nullable fields null at a time, each whole", () => {
    const rows = [
      ...rowsWithOneNull({
        keys: ["nextRenewalDate", "note", "ownerId", "reminderWindow", "uploadStatusDate", "url"],
        row: DETAIL_DEACTIVATED,
      }),
      { ...DETAIL_DEACTIVATED, deactivatedStatus: { ...DETAIL_DEACTIVATED.deactivatedStatus, expiration: null } },
      { ...DETAIL_DEACTIVATED, deactivatedStatus: { ...DETAIL_DEACTIVATED.deactivatedStatus, reason: null } },
    ];
    expect(rows.length).toBe(8);
    expect(rows.map((row) => vantaDocumentDetailDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("refuses a field Vanta added by name, strict like every other DTO, never stripping it", () => {
    expect(
      rejection({
        input: { ...DETAIL_SENSITIVE, addedByVantaLater: "detail-extra-field-value" },
        schema: vantaDocumentDetailDtoSchema,
      }),
    ).toStrictEqual({ issues: [{ code: "unrecognized_keys", keys: ["addedByVantaLater"], path: [] }], success: false });
  });

  it("requires every one of its fifteen fields, each missing one refusing at its own path", () => {
    expect(Object.keys(DETAIL_DEACTIVATED).length).toBe(15);
    expect(pathsWhenFieldMissing({ row: DETAIL_DEACTIVATED, schema: vantaDocumentDetailDtoSchema })).toStrictEqual(
      Object.keys(DETAIL_DEACTIVATED).map((field) => [[field]]),
    );
  });

  it("requires every one of the deactivation block's four fields, each missing one refusing at its own path", () => {
    const block = DETAIL_DEACTIVATED.deactivatedStatus;
    const outcomes = Object.keys(block).map((missing) =>
      rejection({
        input: { ...DETAIL_DEACTIVATED, deactivatedStatus: { ...block, [missing]: undefined } },
        schema: vantaDocumentDetailDtoSchema,
      }).issues.map((issue) => issue["path"]),
    );
    expect(outcomes).toStrictEqual([
      [["deactivatedStatus", "creationDate"]],
      [["deactivatedStatus", "expiration"]],
      [["deactivatedStatus", "isDeactivated"]],
      [["deactivatedStatus", "reason"]],
    ]);
  });

  it("refuses a key the deactivation block does not know, because that nested object IS strict", () => {
    expect(
      rejection({
        input: {
          ...DETAIL_DEACTIVATED,
          deactivatedStatus: { ...DETAIL_DEACTIVATED.deactivatedStatus, deactivatedBy: "detail-nested-extra" },
        },
        schema: vantaDocumentDetailDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["deactivatedBy"], path: ["deactivatedStatus"] }],
      success: false,
    });
  });

  it("refuses a renewal cadence outside the eight, at the cadence's path", () => {
    expect(
      rejection({ input: { ...DETAIL_SENSITIVE, renewalCadence: "P5D" }, schema: vantaDocumentDetailDtoSchema }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["renewalCadence"],
          values: ["P0D", "P1D", "P1W", "P1M", "P3M", "P6M", "P1Y", "P2Y"],
        },
      ],
      success: false,
    });
  });

  it("refuses a null renewal cadence, because only the reminder window may be null", () => {
    expect(
      rejection({ input: { ...DETAIL_DEACTIVATED, renewalCadence: null }, schema: vantaDocumentDetailDtoSchema }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["renewalCadence"],
          values: ["P0D", "P1D", "P1W", "P1M", "P3M", "P6M", "P1Y", "P2Y"],
        },
      ],
      success: false,
    });
  });

  it("refuses a reminder window outside the five, at the window's path", () => {
    expect(
      rejection({ input: { ...DETAIL_DEACTIVATED, reminderWindow: "P6M" }, schema: vantaDocumentDetailDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["reminderWindow"], values: ["P0D", "P1D", "P1W", "P1M", "P3M"] }],
      success: false,
    });
  });

  it("refuses an upload status outside the four, at the status' path", () => {
    expect(
      rejection({ input: { ...DETAIL_SENSITIVE, uploadStatus: "Pending" }, schema: vantaDocumentDetailDtoSchema }),
    ).toStrictEqual({
      issues: [
        {
          code: "invalid_value",
          path: ["uploadStatus"],
          values: ["Needs document", "Needs update", "Not relevant", "OK"],
        },
      ],
      success: false,
    });
  });

  it("refuses a category outside the list, at the category's path", () => {
    const outcome = rejection({
      input: { ...DETAIL_DEACTIVATED, category: "Snacks" },
      schema: vantaDocumentDetailDtoSchema,
    });
    expect(outcome.issues.map((issue) => ({ code: issue["code"], path: issue["path"] }))).toStrictEqual([
      { code: "invalid_value", path: ["category"] },
    ]);
  });
});

describe("vantaUploadedLinkDtoSchema", () => {
  it("reads a link with an effective date, whole", () => {
    expect(vantaUploadedLinkDtoSchema.parse(LINK_DATED)).toStrictEqual(LINK_DATED);
  });

  it("reads a link without one, whole", () => {
    expect(vantaUploadedLinkDtoSchema.parse(LINK_UNDATED)).toStrictEqual(LINK_UNDATED);
  });

  it("refuses a key it does not know, naming it", () => {
    expect(
      rejection({ input: { ...LINK_DATED, createdBy: "link-extra-creator" }, schema: vantaUploadedLinkDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["createdBy"], path: [] }],
      success: false,
    });
  });

  it("requires every one of its six fields, each missing one refusing at its own path", () => {
    expect(Object.keys(LINK_DATED).length).toBe(6);
    expect(pathsWhenFieldMissing({ row: LINK_DATED, schema: vantaUploadedLinkDtoSchema })).toStrictEqual(
      Object.keys(LINK_DATED).map((field) => [[field]]),
    );
  });

  it("refuses a link with no description, at that path", () => {
    expect(
      rejection({ input: { ...LINK_UNDATED, description: undefined }, schema: vantaUploadedLinkDtoSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["description"] }],
      success: false,
    });
  });
});

describe("vantaDocumentControlsPageSchema", () => {
  it("reads a two-control page whole, with its page info and total", () => {
    const page = {
      results: {
        data: [MAPPED_CONTROL_FIRST, MAPPED_CONTROL_SECOND],
        pageInfo: PAGE_INFO_MORE_AHEAD,
        totalCount: 8101,
      },
    };
    expect(vantaDocumentControlsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same controls the other way round with the other page info", () => {
    const page = {
      results: { data: [MAPPED_CONTROL_SECOND, MAPPED_CONTROL_FIRST], pageInfo: PAGE_INFO_MORE_BEHIND },
    };
    expect(vantaDocumentControlsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [MAPPED_CONTROL_SECOND], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaDocumentControlsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a control with exactly one of its five nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: ["creationDate", "externalId", "modificationDate", "owner", "role"],
      row: MAPPED_CONTROL_FIRST,
    });
    const page = { results: { data: rows, pageInfo: PAGE_INFO_MORE_AHEAD } };
    expect(rows.length).toBe(5);
    expect(vantaDocumentControlsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the control row shape, so a source outside the two refuses at the row's path", () => {
    expect(
      rejection({
        input: {
          results: { data: [{ ...MAPPED_CONTROL_FIRST, source: "Imported" }], pageInfo: PAGE_INFO_MORE_AHEAD },
        },
        schema: vantaDocumentControlsPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["results", "data", 0, "source"], values: ["Vanta", "Custom"] }],
      success: false,
    });
  });
});

describe("vantaDocumentLinksPageSchema", () => {
  it("reads a two-link page whole, with its page info and total", () => {
    const page = {
      results: { data: [LINK_DATED, LINK_UNDATED], pageInfo: PAGE_INFO_MORE_BEHIND, totalCount: 2 },
    };
    expect(vantaDocumentLinksPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [LINK_UNDATED], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaDocumentLinksPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the strict link row shape, so a row carrying a key it does not know refuses at the row's path", () => {
    expect(
      rejection({
        input: {
          results: {
            data: [LINK_DATED, { ...LINK_UNDATED, category: "links-page-extra" }],
            pageInfo: PAGE_INFO_MORE_AHEAD,
          },
        },
        schema: vantaDocumentLinksPageSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["category"], path: ["results", "data", 1] }],
      success: false,
    });
  });
});

describe("vantaDocumentFilesPageSchema", () => {
  it("reads a two-file page whole, with its page info and total", () => {
    const page = {
      results: { data: [FILE_ATTRIBUTED, FILE_ANONYMOUS], pageInfo: PAGE_INFO_MORE_AHEAD, totalCount: 9101 },
    };
    expect(vantaDocumentFilesPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same files the other way round with the other page info", () => {
    const page = {
      results: { data: [FILE_ANONYMOUS, FILE_ATTRIBUTED], pageInfo: PAGE_INFO_MORE_BEHIND },
    };
    expect(vantaDocumentFilesPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [FILE_ANONYMOUS], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaDocumentFilesPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a file with exactly one of its five nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: ["deletionDate", "description", "effectiveDate", "fileName", "uploadedBy"],
      row: FILE_ATTRIBUTED,
    });
    const page = { results: { data: rows, pageInfo: PAGE_INFO_MORE_AHEAD } };
    expect(rows.length).toBe(5);
    expect(vantaDocumentFilesPageSchema.parse(page)).toStrictEqual(page);
  });

  it("chooses the uploaded-file row shape, so an updated date that is not an instant refuses at the row's path", () => {
    expect(
      rejection({
        input: {
          results: { data: [{ ...FILE_ANONYMOUS, updatedDate: "last friday" }], pageInfo: PAGE_INFO_MORE_AHEAD },
        },
        schema: vantaDocumentFilesPageSchema,
      }).issues.map((issue) => ({ code: issue["code"], format: issue["format"], path: issue["path"] })),
    ).toStrictEqual([{ code: "invalid_format", format: "datetime", path: ["results", "data", 0, "updatedDate"] }]);
  });
});

describe("the canonical document schema this module re-exports", () => {
  it("is the schema itself, not a copy", () => {
    expect(vantaDocumentDtoSchema).toBe(canonicalDocumentSchema);
  });
});
