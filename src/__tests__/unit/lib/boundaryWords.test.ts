/**
 * A boundary refusal worded for a customer-linkable door: every drift kind keeps its identifier-shaped path, and a
 * key carrying a phone number, an email address or a long index is withheld, never quoted.
 */
import { describe, expect, it } from "vitest";

import { BoundaryErrors } from "../../../lib/boundary.js";
import { boundaryRefusalWords } from "../../../lib/boundaryWords.js";

describe("boundaryRefusalWords", () => {
  it("words a body that is not JSON without the body", () => {
    const refusal = BoundaryErrors.notJson({ endpoint: "GET /v1/messages" });
    expect(boundaryRefusalWords({ refusal })).toBe("the body is not JSON");
  });

  it("keeps an identifier-shaped path for every drift kind, its digits masked", () => {
    const refusal = BoundaryErrors.shapeChanged({
      drift: [
        { detail: "unused", kind: "new", path: "items[0].tier" },
        { detail: "unused", kind: "renamed", path: "page_info.next" },
        { detail: "unused", kind: "missing", path: "items[12].status" },
        { detail: "unused", kind: "changed", path: "(body)" },
      ],
      endpoint: "GET /v1/messages",
    });
    expect(boundaryRefusalWords({ refusal })).toBe(
      'the shape changed: new field "items[#].tier"; new field "page_info.next", likely a rename; ' +
        'field "items[##].status" is missing; field "(body)" changed type or value set',
    );
  });

  it("withholds a key that is a phone number or an email address, and never quotes zod's text", () => {
    const detail = 'field "x" changed: Invalid input: customer@example.com';
    const refusal = BoundaryErrors.shapeChanged({
      drift: [
        { detail, kind: "new", path: "items[0].recipient.+61400000123" },
        { detail, kind: "new", path: "items[0].recipient.0400000123" },
        { detail, kind: "new", path: "data.customer@example.com" },
      ],
      endpoint: "GET /v1/messages",
    });
    expect(refusal.message).toContain("customer@example.com");
    expect(boundaryRefusalWords({ refusal })).toBe(
      'the shape changed: new field "items[#].recipient.‹withheld key›"; ' +
        'new field "items[#].recipient.‹withheld key›"; new field "data.‹withheld key›.com"',
    );
  });

  it("prints no digit the provider chose, even in an identifier-shaped key or one split across keys", () => {
    const refusal = BoundaryErrors.shapeChanged({
      drift: [
        { detail: "unused", kind: "new", path: "items[0].recipient0400000123" },
        { detail: "unused", kind: "new", path: "items[0].a040.b000.c123" },
        { detail: "unused", kind: "changed", path: "items[61400000123]" },
      ],
      endpoint: "GET /v1/messages",
    });
    expect(refusal.drift[0]!.path).toContain("0400000123");
    expect(boundaryRefusalWords({ refusal })).toBe(
      'the shape changed: new field "items[#].recipient##########"; new field "items[#].a###.b###.c###"; ' +
        'field "items[###########]" changed type or value set',
    );
  });
});
