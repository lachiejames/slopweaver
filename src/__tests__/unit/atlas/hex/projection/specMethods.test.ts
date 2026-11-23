/*
 * `projectHexSpecMethods`: every OpenAPI operation as a method entity, sorted by provider id, citing only the
 * pinned document whose spec id matches, and carrying a surface's withholding reason through untouched.
 */
import { describe, expect, it } from "vitest";

import { projectHexSpecMethods } from "../../../../../atlas/hex/projection.js";
import type { HexSpecSurface } from "../../../../../atlas/hex/specSurface.js";
import { AT, apiEntity, PIN_ONE, PIN_TWO } from "./harness.js";

/** A withholding reason a surface fixture supplies; the projection must carry it through untouched. */
const WITHHELD_PATH_REASON =
  "this operation's response is, or renders, the result of executing something against a data connection " +
  "— a cell's computed output, a chart drawn from one, or an agent thread quoting what a query returned. " +
  "The owner's rule is that this atlas stores no customer data locally, so the operation " +
  "is mapped in full and never called for its body. Its parameters, its declared response field names, " +
  "the credential it needs and the URL to open are all here; the rows are not, and never will be";

describe("projectHexSpecMethods", () => {
  const surfaces: readonly HexSpecSurface[] = [
    {
      hosts: ["https://zulu.example.test"],
      operations: [
        {
          disposition: "withheld",
          excludedBecause: "excluded-zulu-sentinel",
          host: "https://zulu.example.test",
          method: "POST",
          operationId: "operation-zulu-id",
          parameters: ["zulu-param-one", "zulu-param-two"],
          path: "/zulu/{zid}",
          responseFields: ["zulu.field[]", "zulu.other"],
          securitySchemes: ["zuluAuth"],
          withheldBecause: "withheld-zulu-sentinel",
        },
      ],
      pathCount: 1,
      securitySchemes: ["zuluAuth"],
      specId: "spec-unpinned",
      title: "Zulu Title",
    },
    {
      hosts: ["https://alpha.example.test"],
      operations: [
        {
          disposition: "entity",
          excludedBecause: null,
          host: "https://alpha.example.test",
          method: "GET",
          operationId: "operation-alpha-id",
          parameters: ["alpha-param"],
          path: "/alpha/{aid}",
          responseFields: ["alpha.field"],
          securitySchemes: ["alphaAuth", "alphaToken"],
          withheldBecause: null,
        },
        {
          disposition: "shape-index",
          excludedBecause: "excluded-beta-sentinel",
          host: null,
          method: "PATCH",
          operationId: null,
          parameters: [],
          path: "/beta/{bid}",
          responseFields: [],
          securitySchemes: [],
          withheldBecause: null,
        },
      ],
      pathCount: 2,
      securitySchemes: ["alphaAuth", "alphaToken"],
      specId: PIN_ONE.id,
      title: "Alpha Title",
    },
  ];

  it("projects every operation sorted by provider id, citing only the document whose specId matches", () => {
    expect(projectHexSpecMethods({ at: AT, pins: [PIN_TWO, PIN_ONE], surfaces })).toEqual([
      apiEntity({
        deepLink: "https://alpha.example.test/openapi.json",
        deepLinkStatus: "provider-provided",
        detail: {
          disposition: "entity",
          evidence: "openapi-document",
          excludedBecause: null,
          host: "https://alpha.example.test",
          observational: true,
          operationId: "operation-alpha-id",
          parameters: ["alpha-param"],
          responseFields: ["alpha.field"],
          securitySchemes: ["alphaAuth", "alphaToken"],
          withheldBecause: null,
        },
        endpoint: "GET /alpha/{aid}",
        kind: "method",
        providerId: "GET /alpha/{aid}",
      }),
      apiEntity({
        deepLink: "https://alpha.example.test/openapi.json",
        deepLinkStatus: "provider-provided",
        detail: {
          disposition: "shape-index",
          evidence: "openapi-document",
          excludedBecause: "excluded-beta-sentinel",
          host: null,
          observational: false,
          operationId: null,
          parameters: [],
          responseFields: [],
          securitySchemes: [],
          withheldBecause: null,
        },
        endpoint: "PATCH /beta/{bid}",
        kind: "method",
        providerId: "PATCH /beta/{bid}",
      }),
      apiEntity({
        deepLink: null,
        deepLinkStatus: "unavailable",
        detail: {
          disposition: "withheld",
          evidence: "openapi-document",
          excludedBecause: "excluded-zulu-sentinel",
          host: "https://zulu.example.test",
          observational: false,
          operationId: "operation-zulu-id",
          parameters: ["zulu-param-one", "zulu-param-two"],
          responseFields: ["zulu.field[]", "zulu.other"],
          securitySchemes: ["zuluAuth"],
          withheldBecause: "withheld-zulu-sentinel",
        },
        endpoint: "POST /zulu/{zid}",
        kind: "method",
        providerId: "POST /zulu/{zid}",
      }),
    ]);
  });

  it("projects nothing for a document that declares no operation", () => {
    expect(projectHexSpecMethods({ at: AT, pins: [PIN_ONE], surfaces: [] })).toEqual([]);
  });

  it("carries the operation's own withholding reason verbatim, independent of its exclusion", () => {
    const [entity] = projectHexSpecMethods({
      at: AT,
      pins: [],
      surfaces: [
        {
          hosts: [],
          operations: [
            {
              disposition: "withheld",
              excludedBecause: null,
              host: null,
              method: "GET",
              operationId: null,
              parameters: [],
              path: "/v1/projects/{projectId}/cells/{cellId}/output",
              responseFields: [],
              securitySchemes: [],
              withheldBecause: WITHHELD_PATH_REASON,
            },
          ],
          pathCount: 1,
          securitySchemes: [],
          specId: "spec-solo",
          title: "Solo",
        },
      ],
    });
    expect(entity!.channels.api!.detail).toEqual({
      disposition: "withheld",
      evidence: "openapi-document",
      excludedBecause: null,
      host: null,
      observational: true,
      operationId: null,
      parameters: [],
      responseFields: [],
      securitySchemes: [],
      withheldBecause: WITHHELD_PATH_REASON,
    });
  });
});
