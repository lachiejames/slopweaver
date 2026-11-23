/*
 * The four detail shapes an entity may carry, read through the one union a channel entity parses its
 * `detail` with: each shape is accepted on its own required keys, and the live record's withholding is a
 * literal the union refuses to see flipped.
 */
import { describe, expect, it } from "vitest";

import { googleAdminEntityDetailSchema } from "../../../../atlas/googleAdmin/entityDetail.js";

const OPERATION = {
  api: "directory",
  baseUrl: "https://admin.googleapis.com/",
  description: null,
  disposition: "entity",
  dispositionBecause: null,
  document: "admin.directory_v1",
  exclusionReason: null,
  id: "directory.users.list",
  method: "GET",
  paging: "page-token",
  parameters: ["customer", "pageToken"],
  parametersRequired: [],
  path: "admin/directory/v1/users",
  requestSchema: null,
  responseFields: ["users", "nextPageToken"],
  responseSchema: "Users",
  scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
  supportsMediaUpload: false,
};

const RECORD_SHAPE = { fields: ["id", "primaryEmail"], schemaName: "User", sourceOperation: "directory.users.list" };

const PAGE = { route: "/ac/users", settledUrl: "https://admin.google.com/ac/users", title: null };

const LIVE_RECORD = { fields: ["id", "primaryEmail"], operation: "directory.users.list", withheldValues: true };

describe("googleAdminEntityDetailSchema", () => {
  it("accepts one valid value of each of the four detail shapes", () => {
    expect(
      [OPERATION, RECORD_SHAPE, PAGE, LIVE_RECORD].map(
        (detail) => googleAdminEntityDetailSchema.safeParse(detail).success,
      ),
    ).toStrictEqual([true, true, true, true]);
  });

  it("refuses a live record that claims to carry its values", () => {
    expect(googleAdminEntityDetailSchema.safeParse({ ...LIVE_RECORD, withheldValues: false }).success).toBe(false);
  });

  it("refuses a declared record shape with no fields", () => {
    expect(googleAdminEntityDetailSchema.safeParse({ ...RECORD_SHAPE, fields: [] }).success).toBe(false);
  });
});
