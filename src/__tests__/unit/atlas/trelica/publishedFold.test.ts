import { describe, expect, it } from "vitest";

import type { TrelicaMethodPublishedDetail } from "../../../../atlas/trelica/model.js";
import { foldTrelicaPublishedDeclaration } from "../../../../atlas/trelica/publishedFold.js";
import type { TrelicaPublishedDocumentSurface } from "../../../../atlas/trelica/publishedSpec.js";

/** One declaration, every list deliberately out of order and carrying a duplicate. */
function declaration(
  over: Partial<TrelicaPublishedDocumentSurface["operations"][number]> = {},
): TrelicaPublishedDocumentSurface["operations"][number] {
  return {
    bodyParams: ["status", "name", "status"],
    document: "people",
    httpMethod: "GET",
    operationId: "listPeople",
    path: "/api/people/v1",
    pathParams: ["personId"],
    queryParams: ["take", "cursor"],
    responseFields: ["name", "id"],
    security: ["oauth2"],
    summary: "List people",
    ...over,
  };
}

/** What an earlier document already declared for the same operation. */
const HELD: TrelicaMethodPublishedDetail = {
  bodyParams: ["email"],
  documents: ["apps"],
  operationId: "listApps",
  pathParams: [],
  queryParams: ["take"],
  responseFields: ["id", "vendorId"],
  security: ["bearerAuth"],
  summary: "List applications",
};

describe("foldTrelicaPublishedDeclaration", () => {
  it("takes a first sighting's own names, each list deduplicated and sorted", () => {
    expect(foldTrelicaPublishedDeclaration({ declaration: declaration(), held: undefined })).toEqual({
      bodyParams: ["name", "status"],
      documents: ["people"],
      operationId: "listPeople",
      pathParams: ["personId"],
      queryParams: ["cursor", "take"],
      responseFields: ["id", "name"],
      security: ["oauth2"],
      summary: "List people",
    });
  });

  it("carries a first sighting's undeclared operationId and summary as null", () => {
    const folded = foldTrelicaPublishedDeclaration({
      declaration: declaration({ operationId: null, summary: null }),
      held: undefined,
    });
    expect(folded.operationId).toBe(null);
    expect(folded.summary).toBe(null);
  });

  it("unions every list with what an earlier document declared, and records both documents", () => {
    expect(foldTrelicaPublishedDeclaration({ declaration: declaration(), held: HELD })).toEqual({
      bodyParams: ["email", "name", "status"],
      documents: ["apps", "people"],
      operationId: "listApps",
      pathParams: ["personId"],
      queryParams: ["cursor", "take"],
      responseFields: ["id", "name", "vendorId"],
      security: ["bearerAuth", "oauth2"],
      summary: "List applications",
    });
  });

  it("lets a later document supply the operationId and summary only where every earlier one declared none", () => {
    const folded = foldTrelicaPublishedDeclaration({
      declaration: declaration(),
      held: { ...HELD, operationId: null, summary: null },
    });
    expect(folded.operationId).toBe("listPeople");
    expect(folded.summary).toBe("List people");
  });

  it("keeps null when neither document declares an operationId or a summary", () => {
    const folded = foldTrelicaPublishedDeclaration({
      declaration: declaration({ operationId: null, summary: null }),
      held: { ...HELD, operationId: null, summary: null },
    });
    expect(folded.operationId).toBe(null);
    expect(folded.summary).toBe(null);
  });

  it("names a document once when the same document declares the operation twice", () => {
    const folded = foldTrelicaPublishedDeclaration({
      declaration: declaration({ document: "apps" }),
      held: HELD,
    });
    expect(folded.documents).toEqual(["apps"]);
  });
});
