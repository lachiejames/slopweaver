import { describe, expect, it } from "vitest";

import { readGeminiAiStudioSurface } from "../../../../atlas/geminiAiStudio/specRead.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { discoveryFixture, discoveryFixtureText } from "./discoveryFixture.js";

/** One row out of a read surface, by its version-independent provider id. */
function rowFor({ text, version, providerId }: { text: string; version: string; providerId: string }) {
  const surface = unwrap(readGeminiAiStudioSurface({ text, version }));
  return surface.rows.find((row) => row.providerId === providerId)!;
}

describe("readGeminiAiStudioSurface", () => {
  it("reads every operation across nested resources, and counts them by HTTP method", () => {
    const surface = unwrap(
      readGeminiAiStudioSurface({ text: discoveryFixtureText({ version: "v1beta" }), version: "v1beta" }),
    );
    expect(surface.rows.length).toBe(6);
    expect(surface.census.operationCount).toBe(6);
    expect(surface.census.methodCounts["get"]).toBe(5);
    expect(surface.census.methodCounts["post"]).toBe(1);
    expect(surface.census.rootCount).toBe(4);
    expect(surface.census.schemaCount).toBe(5);
    expect(surface.census.revision).toBe("20260904");
    expect(surface.unknownRoots).toEqual([]);
  });

  it("names a nested operation by its whole resource path, so two kinds cannot collide", () => {
    const row = rowFor({
      providerId: "models.operations.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(row.kind).toBe("models");
    expect(row.operationId).toBe("generativelanguage.models.operations.list");
  });

  it("strips the version segment from the path, so three versions fold to one shape", () => {
    const beta = rowFor({
      providerId: "models.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    const stable = rowFor({ providerId: "models.list", text: discoveryFixtureText({ version: "v1" }), version: "v1" });
    expect(beta.pathShape).toBe("/models");
    expect(stable.pathShape).toBe("/models");
  });

  it("keeps a method's own query parameters and drops the document's global ones", () => {
    const row = rowFor({
      providerId: "models.operations.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(row.queryParams).toEqual(["filter", "pageSize"]);
    expect(row.pathParams).toEqual(["name"]);
  });

  it("resolves the declared response schema one $ref deep into its field names", () => {
    const row = rowFor({
      providerId: "models.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(row.responseSchema).toBe("ListModelsResponse");
    expect(row.responseFields).toEqual(["models", "nextPageToken"]);
  });

  it("holds no response field for an operation declaring no response schema", () => {
    const row = rowFor({
      providerId: "media.download",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(row.responseSchema).toBe(null);
    expect(row.responseFields).toEqual([]);
  });

  it("holds empty parameter and scope lists for a method declaring no parameters, order or scopes", () => {
    const row = rowFor({
      providerId: "generatedFiles.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(row.pathParams).toEqual([]);
    expect(row.queryParams).toEqual([]);
    expect(row.scopes).toEqual([]);
  });

  it("keeps the scopes a method declares, sorted", () => {
    const row = rowFor({
      providerId: "models.operations.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(row.scopes).toEqual(["https://www.googleapis.com/auth/generative-language"]);
  });

  it("reads a document declaring no global parameters and no resources as no operations at all", () => {
    const document = discoveryFixture({ version: "v1beta" });
    delete document["parameters"];
    delete document["resources"];
    const surface = unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" }));
    expect(surface.rows).toEqual([]);
    expect(surface.census.operationCount).toBe(0);
    expect(surface.census.methodCounts).toEqual({});
    expect(surface.census.rootCount).toBe(0);
  });

  it("walks through a resource that declares only nested resources and no methods of its own", () => {
    const document = discoveryFixture({ version: "v1beta" });
    // oxlint-disable-next-line no-unsafe-type-assertion
    const models = (document["resources"] as Record<string, { methods?: unknown }>)["models"]!;
    delete models.methods;
    const surface = unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" }));
    const modelRows = surface.rows.filter((row) => row.kind === "models").map((row) => row.providerId);
    expect(modelRows).toEqual(["models.operations.list"]);
    expect(surface.census.operationCount).toBe(4);
  });

  it("keeps only the first line of a description, and null when there is none", () => {
    const listed = rowFor({
      providerId: "models.operations.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    const silent = rowFor({
      providerId: "generatedFiles.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(listed.summary).toBe("Lists operations that match the specified filter.");
    expect(silent.summary).toBe(null);
  });

  it("classes each operation with the rule that decided it", () => {
    const generate = rowFor({
      providerId: "models.generateContent",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    const generated = rowFor({
      providerId: "generatedFiles.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    const files = rowFor({
      providerId: "files.list",
      text: discoveryFixtureText({ version: "v1beta" }),
      version: "v1beta",
    });
    expect(generate.disposition).toBe("excluded");
    expect(generate.dispositionRuleId).toBe("mutation-or-inference-excluded");
    expect(generated.disposition).toBe("voluminous");
    expect(generated.dispositionRuleId).toBe("generated-file-stream-voluminous");
    expect(files.disposition).toBe("reachable");
    expect(files.dispositionRuleId).toBe("configuration-reachable");
  });

  it("reports a resource root this build has no kind for, rather than dropping it", () => {
    const document = discoveryFixture({ version: "v1beta" });
    const resources = document["resources"] as Record<string, unknown>;
    resources["quantumPrompts"] = {
      methods: {
        list: { httpMethod: "GET", id: "generativelanguage.quantumPrompts.list", path: "v1beta/quantumPrompts" },
      },
    };
    const surface = unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" }));
    expect(surface.unknownRoots).toEqual(["quantumPrompts"]);
    expect(surface.census.rootCount).toBe(5);
    expect(surface.rows.length).toBe(6);
  });

  it("refuses bytes that are not JSON at all", () => {
    const result = readGeminiAiStudioSurface({ text: "<html>sign in to continue</html>", version: "v1beta" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("not parseable JSON");
  });

  it("refuses a document that does not announce itself as a discovery description", () => {
    const document = discoveryFixture({ version: "v1beta" });
    document["kind"] = "discovery#somethingElse";
    const result = readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("does not match the envelope this atlas requires");
  });

  it("refuses a document for a different Google service", () => {
    const document = discoveryFixture({ version: "v1beta" });
    document["name"] = "aiplatform";
    const result = readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("does not match the envelope this atlas requires");
  });

  it("refuses a revision that is not the eight-digit stamp every discovery document carries", () => {
    const result = readGeminiAiStudioSurface({
      text: discoveryFixtureText({ revision: "whenever", version: "v1beta" }),
      version: "v1beta",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("does not match the envelope this atlas requires");
  });

  it("refuses a document served for one version that declares itself another", () => {
    const result = readGeminiAiStudioSurface({ text: discoveryFixtureText({ version: "v1" }), version: "v1beta" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("declares itself version v1");
  });

  it("refuses a document pointing at an origin this atlas does not read", () => {
    const document = discoveryFixture({ version: "v1beta" });
    document["rootUrl"] = "https://generativelanguage.example.com/";
    const result = readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("declares rootUrl https://generativelanguage.example.com/");
  });
});

describe("readGeminiAiStudioSurface's refusals, each line exactly as the CLI prints it", () => {
  it("prints the version mismatch and why nothing was published as two lines", () => {
    const result = readGeminiAiStudioSurface({ text: discoveryFixtureText({ version: "v1" }), version: "v1beta" });
    expect(unwrapErr(result)).toEqual([
      "the document served for version v1beta declares itself version v1",
      "nothing was published — a version segment that answers a different document is a routing change, not a vendor update",
    ]);
  });

  it("prints the foreign rootUrl against the one origin this atlas reads", () => {
    const document = discoveryFixture({ version: "v1beta" });
    document["rootUrl"] = "https://generativelanguage.example.com/";
    const result = readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" });
    expect(unwrapErr(result)).toEqual([
      "the Gemini v1beta discovery document declares rootUrl https://generativelanguage.example.com/, not https://generativelanguage.googleapis.com/",
      "nothing was published — this atlas reads exactly one origin and refuses a document pointing anywhere else",
    ]);
  });

  it("prints the envelope refusal and then each schema issue on its own line", () => {
    const document = discoveryFixture({ version: "v1beta" });
    document["kind"] = "discovery#somethingElse";
    const lines = unwrapErr(readGeminiAiStudioSurface({ text: JSON.stringify(document), version: "v1beta" }));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "the Gemini v1beta discovery document does not match the envelope this atlas requires, so nothing was published",
    );
    expect(lines[1]).toContain("kind");
  });
});
