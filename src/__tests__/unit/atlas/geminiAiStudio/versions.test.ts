import { describe, expect, it } from "vitest";

import {
  type GeminiAiStudioOperationRow,
  readGeminiAiStudioSurface,
} from "../../../../atlas/geminiAiStudio/specRead.js";
import { foldGeminiAiStudioVersions } from "../../../../atlas/geminiAiStudio/versions.js";
import { unwrap } from "../../../../lib/result.js";

import { discoveryFixture, discoveryFixtureText } from "./discoveryFixture.js";

/** Every row three published versions of the fixture declare, in the order the versions are read. */
function rowsAcrossVersions({
  withNestedOperationsIn = ["v1", "v1alpha", "v1beta"],
}: {
  withNestedOperationsIn?: readonly string[];
} = {}): readonly GeminiAiStudioOperationRow[] {
  return ["v1", "v1alpha", "v1beta"].flatMap(
    (version) =>
      unwrap(
        readGeminiAiStudioSurface({
          text: discoveryFixtureText({ version, withNestedOperations: withNestedOperationsIn.includes(version) }),
          version,
        }),
      ).rows,
  );
}

describe("foldGeminiAiStudioVersions", () => {
  it("folds the same operation's three versions into one row carrying all three", () => {
    const folded = foldGeminiAiStudioVersions({ rows: rowsAcrossVersions() });
    expect(folded.operations.length).toBe(6);
    const models = folded.operations.find((operation) => operation.providerId === "models.list")!;
    expect(models.apiVersions).toEqual(["v1", "v1alpha", "v1beta"]);
  });

  it("reports no disagreement when every version says exactly the same thing", () => {
    expect(foldGeminiAiStudioVersions({ rows: rowsAcrossVersions() }).disagreements).toEqual([]);
  });

  it("keeps an operation only one version declares, and says which one", () => {
    const folded = foldGeminiAiStudioVersions({ rows: rowsAcrossVersions({ withNestedOperationsIn: ["v1"] }) });
    const nested = folded.operations.find((operation) => operation.providerId === "models.operations.list")!;
    expect(nested.apiVersions).toEqual(["v1"]);
    expect(folded.disagreements).toEqual([]);
  });

  it("names a response schema two versions describe differently", () => {
    const stable = discoveryFixture({ version: "v1" });
    const beta = discoveryFixture({ version: "v1beta" });
    // `as`: the fixture's own shape, reached by the same path the fixture builds it at.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const betaModels = (
      beta["resources"] as Record<string, { methods: Record<string, { response: { $ref: string } }> }>
    )["models"]!;
    betaModels.methods["list"]!.response.$ref = "ListModelsResponseV2";
    const rows = [
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(stable), version: "v1" })).rows,
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(beta), version: "v1beta" })).rows,
    ];
    const folded = foldGeminiAiStudioVersions({ rows });
    const disagreement = folded.disagreements.find((one) => one.providerId === "models.list")!;
    expect(disagreement.fields).toEqual(["responseFields", "responseSchema"]);
    expect(disagreement.reason).toContain("v1=ListModelsResponse");
    expect(disagreement.reason).toContain("v1beta=ListModelsResponseV2");
    expect(disagreement.kind).toBe("models");
  });

  it("prints (none) for a version whose method declares no response at all", () => {
    const stable = discoveryFixture({ version: "v1" });
    const beta = discoveryFixture({ version: "v1beta" });
    // oxlint-disable-next-line no-unsafe-type-assertion
    const betaModels = (beta["resources"] as Record<string, { methods: Record<string, { response?: unknown }> }>)[
      "models"
    ]!;
    delete betaModels.methods["list"]!.response;
    const rows = [
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(stable), version: "v1" })).rows,
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(beta), version: "v1beta" })).rows,
    ];
    const folded = foldGeminiAiStudioVersions({ rows });
    const disagreement = folded.disagreements.find((one) => one.providerId === "models.list")!;
    expect(disagreement.fields).toEqual(["responseFields", "responseSchema"]);
    expect(disagreement.reason).toContain("responseSchema: v1=ListModelsResponse, v1beta=(none)");
  });

  it("takes the last-read version's scalars, so the folded row shows the newest shape", () => {
    const stable = discoveryFixture({ version: "v1" });
    const beta = discoveryFixture({ version: "v1beta" });
    // oxlint-disable-next-line no-unsafe-type-assertion
    const betaModels = (beta["resources"] as Record<string, { methods: Record<string, { path: string }> }>)["models"]!;
    betaModels.methods["list"]!.path = "v1beta/models:enumerate";
    const rows = [
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(stable), version: "v1" })).rows,
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(beta), version: "v1beta" })).rows,
    ];
    const folded = foldGeminiAiStudioVersions({ rows });
    const models = folded.operations.find((operation) => operation.providerId === "models.list")!;
    expect(models.pathShape).toBe("/models:enumerate");
    expect(folded.disagreements.find((one) => one.providerId === "models.list")!.fields).toEqual(["pathShape"]);
  });

  it("unions the query parameter names, so a name only one version declares is never lost", () => {
    const stable = discoveryFixture({ version: "v1" });
    const beta = discoveryFixture({ version: "v1beta" });
    // oxlint-disable-next-line no-unsafe-type-assertion
    const betaModels = (
      beta["resources"] as Record<string, { methods: Record<string, { parameters: Record<string, unknown> }> }>
    )["models"]!;
    betaModels.methods["list"]!.parameters["view"] = { location: "query" };
    const rows = [
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(stable), version: "v1" })).rows,
      ...unwrap(readGeminiAiStudioSurface({ text: JSON.stringify(beta), version: "v1beta" })).rows,
    ];
    const models = foldGeminiAiStudioVersions({ rows }).operations.find(
      (operation) => operation.providerId === "models.list",
    )!;
    expect(models.queryParams).toEqual(["pageSize", "pageToken", "view"]);
  });

  it("sorts the folded operations by provider id, so a generation's bytes are stable", () => {
    const folded = foldGeminiAiStudioVersions({ rows: rowsAcrossVersions() });
    expect(folded.operations.map((operation) => operation.providerId)).toEqual([
      "files.list",
      "generatedFiles.list",
      "media.download",
      "models.generateContent",
      "models.list",
      "models.operations.list",
    ]);
  });
});
