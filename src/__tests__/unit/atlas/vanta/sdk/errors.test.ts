import { describe, expect, it } from "vitest";

import { VantaSdkErrors } from "../../../../../atlas/vanta/sdk/errors.js";
import { BoundaryErrors } from "../../../../../lib/boundary.js";

describe("VantaSdkErrors.apiError", () => {
  it("joins the reasons into the message", () => {
    const error = VantaSdkErrors.apiError({
      method: "GET",
      operationId: "GetControl",
      path: "/v1/controls/c1",
      reasons: ["r1", "r2"],
    });
    expect(error.code).toBe("VANTA_SDK_API_ERROR");
    expect(error.message).toBe("r1; r2");
    expect(error.operationId).toBe("GetControl");
  });
});

describe("VantaSdkErrors.responseValidationError", () => {
  it("carries the boundary's refusal whole, and displays its message", () => {
    const boundaryError = BoundaryErrors.shapeChanged({
      drift: [{ detail: 'field "id" is missing', kind: "missing", path: "id" }],
      endpoint: "GET /v1/controls/{controlId}",
    });
    const error = VantaSdkErrors.responseValidationError({
      boundaryError,
      method: "GET",
      operationId: "GetControl",
      path: "/v1/controls/c1",
    });
    expect(error).toEqual({
      boundaryError,
      code: "VANTA_SDK_RESPONSE_VALIDATION_ERROR",
      message:
        'GET /v1/controls/{controlId} answered a shape this version does not read — refused, not guessed: field "id" is missing',
      method: "GET",
      operationId: "GetControl",
      path: "/v1/controls/c1",
    });
    // The display line IS the boundary's, never a second wording that could drift from it.
    expect(error.message).toBe(boundaryError.message);
  });
});
