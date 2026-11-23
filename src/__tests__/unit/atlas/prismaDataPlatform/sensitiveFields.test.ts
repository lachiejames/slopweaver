import { describe, expect, it } from "vitest";

import { prismaWithheldFieldFor } from "../../../../atlas/prismaDataPlatform/sensitiveFields.js";

describe("prismaWithheldFieldFor", () => {
  it("names the rule withholding an integration contact's email", () => {
    const rule = prismaWithheldFieldFor({ path: "data[].email" })!;
    expect(rule.path).toBe("data[].email");
    expect(rule.operations).toStrictEqual([
      "GET /v1/integrations",
      "GET /v1/integrations/{id}",
      "GET /v1/workspaces/{workspaceId}/integrations",
    ]);
  });

  it("names the rule withholding the direct-connection password", () => {
    expect(prismaWithheldFieldFor({ path: "data[].directConnection.pass" })!.path).toBe("data[].directConnection.pass");
  });

  it("lets a field no rule names be stored", () => {
    expect(prismaWithheldFieldFor({ path: "data[].directConnection.host" })).toBeNull();
    expect(prismaWithheldFieldFor({ path: "" })).toBeNull();
  });
});
