/**
 * The hand-written Linear organization query exists to select six fields and NOT the SDK fragment's
 * `authSettings`. The exact text is the positive witness: any added field, `authSettings` included, reddens.
 */
import { parse, visit } from "graphql";
import { describe, expect, it } from "vitest";

import { ORGANIZATION_QUERY } from "../../../../corpus/linear/organization.js";

describe("ORGANIZATION_QUERY", () => {
  it("is exactly the LinearOrganization query over the six fields the source lanes read", () => {
    expect(ORGANIZATION_QUERY).toBe(
      "query LinearOrganization {\n  organization { id name urlKey userCount samlEnabled allowedFileUploadContentTypes }\n}",
    );
  });

  it("parses as GraphQL selecting the organization root and exactly those six fields, in order", () => {
    const fields: string[] = [];
    visit(parse(ORGANIZATION_QUERY), {
      Field: (node) => {
        fields.push(node.name.value);
      },
    });

    expect(fields).toEqual([
      "organization",
      "id",
      "name",
      "urlKey",
      "userCount",
      "samlEnabled",
      "allowedFileUploadContentTypes",
    ]);
  });
});
