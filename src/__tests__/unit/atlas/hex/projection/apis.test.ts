/*
 * `projectHexApis`: one api entity per pinned spec in input order, then the two synthetic evidence bodies.
 */
import { describe, expect, it } from "vitest";

import { projectHexApis } from "../../../../../atlas/hex/projection.js";
import { AT, apiEntity, ORIGIN, PIN_ONE, PIN_TWO } from "./harness.js";

describe("projectHexApis", () => {
  it("projects each pin in input order, then the census, then the client bundle", () => {
    expect(projectHexApis({ at: AT, pins: [PIN_ONE, PIN_TWO] })).toEqual([
      apiEntity({
        deepLink: "https://alpha.example.test/openapi.json",
        deepLinkStatus: "provider-provided",
        detail: {
          byteLength: 1001,
          family: "openapi-document",
          hosts: ["https://alpha.example.test", "https://alpha-alt.example.test"],
          operationCount: 11,
          pathCount: 21,
          securitySchemes: ["alphaAuth", "alphaToken"],
          sha256: "1".repeat(64),
          title: "Title alpha",
          version: "v1.1",
        },
        endpoint: "https://alpha.example.test/openapi.json",
        kind: "api",
        providerId: "spec-alpha",
      }),
      apiEntity({
        deepLink: "https://bravo.example.test/openapi.json",
        deepLinkStatus: "provider-provided",
        detail: {
          byteLength: 1002,
          family: "openapi-document",
          hosts: ["https://bravo.example.test", "https://bravo-alt.example.test"],
          operationCount: 12,
          pathCount: 22,
          securitySchemes: ["bravoAuth", "bravoToken"],
          sha256: "2".repeat(64),
          title: "Title bravo",
          version: "v2.2",
        },
        endpoint: "https://bravo.example.test/openapi.json",
        kind: "api",
        providerId: "spec-bravo",
      }),
      apiEntity({
        deepLink: "https://app.hex.tech/api/v1",
        deepLinkStatus: "provider-provided",
        detail: {
          byteLength: 0,
          family: "unauthenticated-probe",
          hosts: [ORIGIN],
          operationCount: 13,
          pathCount: 74,
          securitySchemes: [],
          sha256: "0".repeat(64),
          title: "unauthenticated /api/v1 noun census",
          version: "measured-2026-09-07",
        },
        endpoint: "https://app.hex.tech/api/v1",
        kind: "api",
        providerId: "hex-unauthenticated-probe",
      }),
      apiEntity({
        deepLink: "https://app.hex.tech/login",
        deepLinkStatus: "provider-provided",
        detail: {
          byteLength: 9416157,
          family: "client-bundle",
          hosts: [ORIGIN],
          operationCount: 48,
          pathCount: 84,
          securitySchemes: [],
          sha256: "c8e8c24a07c57c16fa7d45253a0c570baf69660690c7f88d4d9183e852632b8e",
          title: "shipped web client bundle graph",
          version: "193-bundles",
        },
        endpoint: "https://app.hex.tech/login",
        kind: "api",
        providerId: "hex-client-bundle",
      }),
    ]);
  });

  it("projects only the two synthetic evidence bodies when the lock holds no pin", () => {
    expect(projectHexApis({ at: AT, pins: [] }).map((entity) => entity.providerId)).toEqual([
      "hex-unauthenticated-probe",
      "hex-client-bundle",
    ]);
  });
});
