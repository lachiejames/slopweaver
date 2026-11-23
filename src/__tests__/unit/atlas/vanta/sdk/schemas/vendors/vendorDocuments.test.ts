/**
 * The vendor document DTO and its page: a user or application uploader, a missing one, any one nullable field null,
 * all eleven fields required, and the refusals for an unknown key, a bad uploader or a date-only instant.
 */
import { describe, expect, it } from "vitest";

import {
  vantaVendorDocumentDtoSchema,
  vantaVendorDocumentsPageSchema,
} from "../../../../../../../atlas/vanta/sdk/schemas/vendors.js";
import {
  PAGE_INFO_MIDDLE,
  PAGE_INFO_MORE_AHEAD,
  PAGE_INFO_MORE_BEHIND,
  VENDOR_DOCUMENT_BY_APPLICATION,
  VENDOR_DOCUMENT_BY_USER,
} from "./fixtures.js";
import { pathsWhenFieldMissing, rejection, rowsWithOneNull } from "./probes.js";

describe("vantaVendorDocumentDtoSchema", () => {
  it("reads a document uploaded by a user with every nullable field populated, whole", () => {
    expect(vantaVendorDocumentDtoSchema.parse(VENDOR_DOCUMENT_BY_USER)).toStrictEqual(VENDOR_DOCUMENT_BY_USER);
  });

  it("reads a document uploaded by an application with every nullable field null, whole", () => {
    expect(vantaVendorDocumentDtoSchema.parse(VENDOR_DOCUMENT_BY_APPLICATION)).toStrictEqual(
      VENDOR_DOCUMENT_BY_APPLICATION,
    );
  });

  it("reads a document with no uploader", () => {
    const anonymous = { ...VENDOR_DOCUMENT_BY_USER, id: "vendor-document-anonymous-id", uploadedBy: null };
    expect(vantaVendorDocumentDtoSchema.parse(anonymous)).toStrictEqual(anonymous);
  });

  it("reads a document with exactly one of its four nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: ["deletionDate", "description", "fileName", "uploadedBy"],
      row: VENDOR_DOCUMENT_BY_USER,
    });
    expect(rows.length).toBe(4);
    expect(rows.map((row) => vantaVendorDocumentDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("requires every one of its eleven fields, each missing one refusing at its own path", () => {
    expect(Object.keys(VENDOR_DOCUMENT_BY_USER).length).toBe(11);
    expect(pathsWhenFieldMissing({ row: VENDOR_DOCUMENT_BY_USER, schema: vantaVendorDocumentDtoSchema })).toStrictEqual(
      Object.keys(VENDOR_DOCUMENT_BY_USER).map((field) => [[field]]),
    );
  });

  it("refuses an effective date, because a vendor document carries none", () => {
    expect(
      rejection({
        input: { ...VENDOR_DOCUMENT_BY_APPLICATION, effectiveDate: "2126-06-26T18:18:18.026Z" },
        schema: vantaVendorDocumentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["effectiveDate"], path: [] }],
      success: false,
    });
  });

  it("refuses a document with no type, at that path", () => {
    expect(
      rejection({
        input: { ...VENDOR_DOCUMENT_BY_USER, type: undefined },
        schema: vantaVendorDocumentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_type", expected: "string", path: ["type"] }],
      success: false,
    });
  });

  it("refuses an uploader carrying a key it does not know, at the uploader's path", () => {
    expect(
      rejection({
        input: {
          ...VENDOR_DOCUMENT_BY_USER,
          uploadedBy: { ...VENDOR_DOCUMENT_BY_USER.uploadedBy, displayName: "vendor-document-uploader-extra" },
        },
        schema: vantaVendorDocumentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["displayName"], path: ["uploadedBy"] }],
      success: false,
    });
  });

  it("refuses an uploader kind outside user and application, at that path", () => {
    expect(
      rejection({
        input: { ...VENDOR_DOCUMENT_BY_USER, uploadedBy: { id: "vendor-document-team-actor-id", type: "TEAM" } },
        schema: vantaVendorDocumentDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["uploadedBy", "type"], values: ["USER", "APPLICATION"] }],
      success: false,
    });
  });

  it("refuses an updated date that is not an ISO instant, at that path", () => {
    const outcome = rejection({
      input: { ...VENDOR_DOCUMENT_BY_USER, updatedDate: "2127-07-27" },
      schema: vantaVendorDocumentDtoSchema,
    });
    expect(outcome.issues).toStrictEqual([
      { code: "invalid_format", format: "datetime", origin: "string", path: ["updatedDate"] },
    ]);
  });
});

describe("vantaVendorDocumentsPageSchema", () => {
  it("reads a two-document page whole, with its page info and total", () => {
    const page = {
      results: {
        data: [VENDOR_DOCUMENT_BY_USER, VENDOR_DOCUMENT_BY_APPLICATION],
        pageInfo: PAGE_INFO_MORE_AHEAD,
        totalCount: 7101,
      },
    };
    expect(vantaVendorDocumentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads the same documents the other way round with the other page info", () => {
    const page = {
      results: { data: [VENDOR_DOCUMENT_BY_APPLICATION, VENDOR_DOCUMENT_BY_USER], pageInfo: PAGE_INFO_MORE_BEHIND },
    };
    expect(vantaVendorDocumentsPageSchema.parse(page)).toStrictEqual(page);
  });

  it("reads a middle page with a null start cursor and both page flags set, whole", () => {
    const page = { results: { data: [VENDOR_DOCUMENT_BY_APPLICATION], pageInfo: PAGE_INFO_MIDDLE, totalCount: 1 } };
    expect(vantaVendorDocumentsPageSchema.parse(page)).toStrictEqual(page);
  });
});
