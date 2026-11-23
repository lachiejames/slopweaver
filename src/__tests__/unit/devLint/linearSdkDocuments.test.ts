/**
 * The linear-sdk-documents gate's criterion: a hand-written Linear GraphQL operation whose root field the
 * pinned `@linear/sdk` bundle already ships a document for.
 *
 * The negative cases carry the weight here, because the gate ships with no exemption marker: a shape it
 * wrongly flags has no escape hatch at all, and the two operations the SDK genuinely cannot express have to
 * pass on the criterion itself rather than on a list.
 */
import { describe, expect, it } from "vitest";

import { isScannablePath, scanLinearSdkDocuments } from "../../../devLint/linearSdkDocuments.js";

/** The document map the real gate derives from the SDK bundle, reduced to what these cases need. */
const SDK_DOCUMENTS: ReadonlyMap<string, string> = new Map([
  ["issues", "IssuesDocument"],
  ["comments", "CommentsDocument"],
  ["organization", "OrganizationDocument"],
]);

/** Scan a snippet as a Linear source file, returning `line:rootField` for each hit. */
function hits({ content }: { content: string }): readonly string[] {
  return scanLinearSdkDocuments({
    content,
    path: "src/corpus/linear/example.ts",
    sdkDocuments: SDK_DOCUMENTS,
  }).map((hit) => `${String(hit.line)}`);
}

describe("scanLinearSdkDocuments", () => {
  it("flags a hand-written query whose root field the SDK ships a document for", () => {
    expect(
      hits({ content: "const Q = `query Issues($first: Int!) { issues(first: $first) { nodes { id } } }`;\n" }),
    ).toEqual(["1"]);
  });

  it("flags a plain string literal as readily as a template literal", () => {
    expect(hits({ content: 'const Q = "query Comments { comments { nodes { id } } }";\n' })).toEqual(["1"]);
  });

  it("flags a template with substitutions, so interpolating a selection is not an escape hatch", () => {
    expect(hits({ content: "const Q = `query Issues { issues { nodes { ${FIELDS} } } }`;\n" })).toEqual(["1"]);
  });

  it("names the SDK document that replaces the hand-written one", () => {
    const found = scanLinearSdkDocuments({
      content: "const Q = `query Issues { issues { nodes { id } } }`;\n",
      path: "src/corpus/linear/example.ts",
      sdkDocuments: SDK_DOCUMENTS,
    });
    expect(found[0]!.message).toContain("LinearDocument.IssuesDocument");
  });

  it("leaves an introspection query alone — `__schema` is meta-schema, so no document can exist for it", () => {
    expect(hits({ content: "const Q = `query Introspect { __schema { types { name } } }`;\n" })).toEqual([]);
  });

  it("leaves a root field the SDK ships no document for alone, which is how `oauthApplications` passes", () => {
    expect(hits({ content: "const Q = `query Apps { oauthApplications { id name } }`;\n" })).toEqual([]);
  });

  it("leaves a mutation alone when its root field is outside the bundle", () => {
    expect(hits({ content: "const M = `mutation Nope { somethingLinearNeverShipped { success } }`;\n" })).toEqual([]);
  });

  it("reads no GraphQL out of a comment, because it walks the AST rather than the text", () => {
    expect(hits({ content: "// query Issues { issues { nodes { id } } }\nconst x = 1;\n" })).toEqual([]);
  });

  it("lets a marked, reasoned exception through — the one cost-driven history document", () => {
    const content = [
      "// linear-sdk-documents-exempt: Issue_HistoryDocument costs 4,442 points per issue, 125M for this workspace",
      "const HISTORY = `query Issues { issues { nodes { id history { nodes { id } } } } }`;",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("refuses a BARE marker, because the reason is the whole point of the exception", () => {
    const content = [
      "// linear-sdk-documents-exempt:",
      "const Q = `query Issues { issues { nodes { id } } }`;",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual(["2"]);
  });

  it("refuses a marker that is not on the line directly above, so distance is not an escape hatch", () => {
    const content = [
      "// linear-sdk-documents-exempt: a real reason, but two lines up",
      "",
      "const Q = `query Issues { issues { nodes { id } } }`;",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual(["3"]);
  });

  it("refuses a marker written in a string rather than a comment, so quoting it exempts nothing", () => {
    const content = [
      'const doc = "linear-sdk-documents-exempt: not a comment";',
      "const Q = `query Issues { issues { nodes { id } } }`;",
      "",
    ].join("\n");
    expect(hits({ content })).toEqual(["2"]);
  });

  it("ignores a non-Linear path, so a GitHub document sharing a root field name is never refused", () => {
    const found = scanLinearSdkDocuments({
      content: "const Q = `query Org { organization(login: $login) { id } }`;\n",
      path: "src/corpus/github/members.ts",
      sdkDocuments: SDK_DOCUMENTS,
    });
    expect(found).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the Linear source trees", () => {
    expect(isScannablePath({ path: "src/corpus/linear/queries.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/atlas/linear/settings.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/connect/linear.ts" })).toBe(true);
  });

  it("skips the test tree, where a GraphQL fixture is parsed rather than sent", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/atlas/linear/graphqlDocument.test.ts" })).toBe(false);
  });

  it("skips non-Linear source, and its own files", () => {
    expect(isScannablePath({ path: "src/corpus/github/threads.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/linearSdkDocuments.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/linearSdkDocuments.entry.ts" })).toBe(false);
  });
});
