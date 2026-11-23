/**
 * The Vanta write surface's wire contract: the three enums `createDocument` sends, the strict uploader
 * identity, and the uploaded-file DTO `uploadEvidence` answers with. Every parse is asserted whole, so a
 * schema reading the wrong key for a field fails on the value, not only on the shape.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  vantaDocumentCadenceSchema,
  vantaDocumentReminderWindowSchema,
  vantaDocumentTimeSensitivitySchema,
  vantaUploadedFileActorSchema,
  vantaUploadedFileDtoSchema,
} from "../../../../atlas/vanta/writeApiSchemas.js";

/** What a refusal looked like: the verdict and each issue with its message and regex pattern left out. */
function rejection({ input, schema }: { input: unknown; schema: z.ZodType }): {
  issues: Record<string, unknown>[];
  success: boolean;
} {
  const result = schema.safeParse(input);
  const issues = result.success ? [] : result.error.issues;
  return {
    issues: issues.map((issue) =>
      Object.fromEntries(Object.entries(issue).filter(([key]) => key !== "message" && key !== "pattern")),
    ),
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

const FILE_WITH_EVERYTHING = {
  creationDate: "2031-01-11T01:11:11.111Z",
  deletionDate: "2032-02-12T02:12:12.222Z",
  description: "A populated upload with every nullable field present",
  effectiveDate: "2033-03-13T03:13:13.333Z",
  fileName: "write-file-with-everything.pdf",
  id: "write-file-with-everything-id",
  mimeType: "application/pdf",
  title: "Write file with everything",
  updatedDate: "2034-04-14T04:14:14.444Z",
  uploadedBy: { id: "write-actor-user-id", type: "USER" },
  url: "https://files.example.test/write-with-everything",
} as const;

const FILE_WITH_NOTHING = {
  creationDate: "2035-05-15T05:15:15.555Z",
  deletionDate: null,
  description: null,
  effectiveDate: null,
  fileName: null,
  id: "write-file-with-nothing-id",
  mimeType: "text/plain",
  title: "Write file with nothing",
  updatedDate: "2036-06-16T06:16:16.666Z",
  uploadedBy: { id: "write-actor-application-id", type: "APPLICATION" },
  url: "https://files.example.test/write-with-nothing",
} as const;

describe("vantaDocumentTimeSensitivitySchema", () => {
  it("accepts exactly the two documented values, returned unchanged and in order", () => {
    const parsed = ["MOST_RECENT", "DURING_AUDIT_WINDOW"].map((value) =>
      vantaDocumentTimeSensitivitySchema.parse(value),
    );
    expect(parsed).toStrictEqual(["MOST_RECENT", "DURING_AUDIT_WINDOW"]);
  });

  it("refuses a close but undocumented value, naming the two it accepts", () => {
    expect(rejection({ input: "MOST_RECENTLY", schema: vantaDocumentTimeSensitivitySchema })).toStrictEqual({
      issues: [{ code: "invalid_value", path: [], values: ["MOST_RECENT", "DURING_AUDIT_WINDOW"] }],
      success: false,
    });
  });
});

describe("vantaDocumentCadenceSchema", () => {
  it("accepts exactly the eight documented durations, returned unchanged and in order", () => {
    const parsed = ["P0D", "P1D", "P1W", "P1M", "P3M", "P6M", "P1Y", "P2Y"].map((value) =>
      vantaDocumentCadenceSchema.parse(value),
    );
    expect(parsed).toStrictEqual(["P0D", "P1D", "P1W", "P1M", "P3M", "P6M", "P1Y", "P2Y"]);
  });

  it("refuses a duration outside the list, naming all eight it accepts", () => {
    expect(rejection({ input: "P5Y", schema: vantaDocumentCadenceSchema })).toStrictEqual({
      issues: [{ code: "invalid_value", path: [], values: ["P0D", "P1D", "P1W", "P1M", "P3M", "P6M", "P1Y", "P2Y"] }],
      success: false,
    });
  });
});

describe("vantaDocumentReminderWindowSchema", () => {
  it("accepts exactly the five documented durations, returned unchanged and in order", () => {
    const parsed = ["P0D", "P1D", "P1W", "P1M", "P3M"].map((value) => vantaDocumentReminderWindowSchema.parse(value));
    expect(parsed).toStrictEqual(["P0D", "P1D", "P1W", "P1M", "P3M"]);
  });

  it("refuses a cadence-only duration, because the window is a shorter list", () => {
    expect(rejection({ input: "P6M", schema: vantaDocumentReminderWindowSchema })).toStrictEqual({
      issues: [{ code: "invalid_value", path: [], values: ["P0D", "P1D", "P1W", "P1M", "P3M"] }],
      success: false,
    });
  });
});

describe("vantaUploadedFileActorSchema", () => {
  it("reads a user whole", () => {
    expect(vantaUploadedFileActorSchema.parse({ id: "actor-user-1-id", type: "USER" })).toStrictEqual({
      id: "actor-user-1-id",
      type: "USER",
    });
  });

  it("reads an application whole", () => {
    expect(vantaUploadedFileActorSchema.parse({ id: "actor-application-2-id", type: "APPLICATION" })).toStrictEqual({
      id: "actor-application-2-id",
      type: "APPLICATION",
    });
  });

  it("refuses an actor kind Vanta does not document", () => {
    expect(
      rejection({ input: { id: "actor-3-id", type: "SERVICE" }, schema: vantaUploadedFileActorSchema }),
    ).toStrictEqual({
      issues: [{ code: "invalid_value", path: ["type"], values: ["USER", "APPLICATION"] }],
      success: false,
    });
  });

  it("refuses a key it does not know, naming it", () => {
    expect(
      rejection({
        input: { displayName: "actor-4-display", id: "actor-4-id", type: "USER" },
        schema: vantaUploadedFileActorSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["displayName"], path: [] }],
      success: false,
    });
  });
});

describe("vantaUploadedFileDtoSchema", () => {
  it("reads a file with every nullable field populated and a user uploader, whole", () => {
    expect(vantaUploadedFileDtoSchema.parse(FILE_WITH_EVERYTHING)).toStrictEqual(FILE_WITH_EVERYTHING);
  });

  it("reads a file with every nullable field null and an application uploader, whole", () => {
    expect(vantaUploadedFileDtoSchema.parse(FILE_WITH_NOTHING)).toStrictEqual(FILE_WITH_NOTHING);
  });

  it("reads a file whose uploader is null", () => {
    const orphan = { ...FILE_WITH_EVERYTHING, id: "write-file-orphan-id", uploadedBy: null };
    expect(vantaUploadedFileDtoSchema.parse(orphan)).toStrictEqual(orphan);
  });

  it("reads a file with exactly one of its five nullable fields null at a time, each whole", () => {
    const rows = rowsWithOneNull({
      keys: ["deletionDate", "description", "effectiveDate", "fileName", "uploadedBy"],
      row: FILE_WITH_EVERYTHING,
    });
    expect(rows.length).toBe(5);
    expect(rows.map((row) => vantaUploadedFileDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("requires every one of its eleven fields, each missing one refusing at its own path", () => {
    expect(Object.keys(FILE_WITH_EVERYTHING).length).toBe(11);
    expect(pathsWhenFieldMissing({ row: FILE_WITH_EVERYTHING, schema: vantaUploadedFileDtoSchema })).toStrictEqual(
      Object.keys(FILE_WITH_EVERYTHING).map((field) => [[field]]),
    );
  });

  it("requires both of the uploader's fields, each missing one refusing at its own path", () => {
    expect(
      pathsWhenFieldMissing({ row: FILE_WITH_EVERYTHING.uploadedBy, schema: vantaUploadedFileActorSchema }),
    ).toStrictEqual([[["id"]], [["type"]]]);
  });

  it("refuses a creation date that is not an ISO instant, at its own path", () => {
    expect(
      rejection({
        input: { ...FILE_WITH_EVERYTHING, creationDate: "2037-07-17" },
        schema: vantaUploadedFileDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_format", format: "datetime", origin: "string", path: ["creationDate"] }],
      success: false,
    });
  });

  it("refuses an updated date that is not an ISO instant, at its own path", () => {
    expect(
      rejection({
        input: { ...FILE_WITH_NOTHING, updatedDate: "yesterday" },
        schema: vantaUploadedFileDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_format", format: "datetime", origin: "string", path: ["updatedDate"] }],
      success: false,
    });
  });

  it("refuses a deletion date that is not an ISO instant, at its own path", () => {
    expect(
      rejection({
        input: { ...FILE_WITH_EVERYTHING, deletionDate: "2038-08-18 08:18:18" },
        schema: vantaUploadedFileDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_format", format: "datetime", origin: "string", path: ["deletionDate"] }],
      success: false,
    });
  });

  it("refuses an effective date that is not an ISO instant, at its own path", () => {
    expect(
      rejection({
        input: { ...FILE_WITH_EVERYTHING, effectiveDate: "next week" },
        schema: vantaUploadedFileDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "invalid_format", format: "datetime", origin: "string", path: ["effectiveDate"] }],
      success: false,
    });
  });

  it("refuses a top-level key it does not know, naming it", () => {
    expect(
      rejection({
        input: { ...FILE_WITH_NOTHING, checksum: "write-file-checksum-value" },
        schema: vantaUploadedFileDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["checksum"], path: [] }],
      success: false,
    });
  });

  it("refuses an uploader carrying a key it does not know, at the uploader's own path", () => {
    expect(
      rejection({
        input: { ...FILE_WITH_EVERYTHING, uploadedBy: { id: "write-actor-extra-id", role: "ADMIN", type: "USER" } },
        schema: vantaUploadedFileDtoSchema,
      }),
    ).toStrictEqual({
      issues: [{ code: "unrecognized_keys", keys: ["role"], path: ["uploadedBy"] }],
      success: false,
    });
  });
});
